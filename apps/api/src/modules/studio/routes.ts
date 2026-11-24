/**
 * Studio slice routes, speaking the existing frontend contract (docs/API-CONTRACT.md):
 *   POST /v1/studio/generations  { productIds: [id], variantId? } | { productId, variantId?, parentVersionId? }
 *   POST /v1/studio/try-ons      { sourceLookId, productIds: [id], variantId? }  (garment swap = new version)
 *   GET  /v1/studio/jobs/:id     · POST /v1/studio/jobs/:id/cancel
 *   GET  /v1/studio/looks        · GET /v1/studio/looks/:id · GET /v1/studio/looks/:id/versions
 *   GET  /v1/studio/config · GET /v1/studio/jobs?active=true · GET /v1/me/balance
 * Images are short-lived signed links to /v1/media/looks/:id (see photos/routes.ts).
 * A frontend "Look" is one immutable rendered version. Only one catalog piece per
 * request in this slice: multi-piece requests get an explicit 422, never a fake result.
 */
import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { apiError, CATEGORY_GROUP, COIN_UNIT, COINS_PER_REQUEST, coinsFromRequests, MAX_COMPOSITION_ITEMS, PLAN_COINS, PLAN_LABEL, renderOrder, requiresSelectionReview, slotOfCategory, type SlotId } from "@stylai/contracts"
import { PrivateDatabaseError, type PrivateDatabase } from "@stylai/supabase"
import { signMediaUrl, type SessionKeys } from "../auth/session-crypto.js"
import { displayImageUrl } from "../catalog/routes.js"

/** Resolves the verified actor id (JWT + active app session), or null. */
export type ActorResolver = (request: FastifyRequest) => Promise<string | null>

export interface StudioDeps {
  db: PrivateDatabase<"api">
  keys: SessionKeys
  resolveActor: ActorResolver
  photoPolicyVersion: string
  /** Absolute base used in image URLs, e.g. http://localhost:5190/v1 */
  publicBaseUrl: string
  /** Whether a provider (real or simulated) is wired to the worker; shown as a capability only. */
  generationEnabled: boolean
  /**
   * How the worker of THIS stack renders: "simulated" (loopback simulator, no paid call), "real"
   * (paid provider) or "disabled". Set by the launcher; shown so a simulated image is never
   * presented as a real try-on.
   */
  generationMode?: "simulated" | "real" | "disabled"
  /** Who picks pieces (P05): the AI agent (model) or deterministic rules. Shown as is, never "agent" when it is rules. */
  /** Autonomous outfits (/studio/outfit-*) are wired in this environment. */
  outfits?: boolean
  /** Closet and Match are wired in this environment. */
  closet?: boolean
  composer?: { mode: "agent" | "rules"; model: string | null }
  /** "stores" when Procurar queries a provider API (TikTok Shop, AliExpress); default curated catalog. */
  searchScope?: "curated_catalog" | "stores"
  /** Real mode only: what one generation calls and its estimated cost (shown before the user confirms). */
  realProvider?: { provider: string; model: string; callsPerGeneration: number; estimatedUsdPerCall: number; maxUsdPerCall: number }
}

const uuid = z.string().uuid()
const sliceBody = z.object({ productId: uuid, variantId: uuid.nullable().optional(), parentVersionId: uuid.nullable().optional() }).strict()
const contractBody = z.object({
  productIds: z.array(uuid).max(6), variantId: uuid.nullable().optional(),
  prompt: z.string().max(500).optional(), referenceIds: z.array(z.string()).max(6).optional(),
  preferenceId: z.string().nullable().optional(), rules: z.unknown().optional(),
}).strict()
const slotId = z.enum(["upper", "lower", "dress", "outer"])
const compositionBody = z.object({
  compositionId: uuid,
  choices: z.array(z.object({ slot: slotId, productId: z.string().min(1).max(200), variantId: uuid.nullable().optional() })).min(1).max(3),
}).strict()
/** Stored plan subset the generation route trusts (written by the server itself). */
const storedPlan = z.object({ plan: z.object({ selectionReviewRequired: z.boolean().optional(), interpretedBy: z.string().optional(), selectionMethod: z.string().optional(), slots: z.array(z.object({
  slot: slotId, required: z.boolean().default(true), candidates: z.array(z.object({ id: z.string(), generationEligible: z.boolean(),
    generationReference: z.object({ productId: uuid, variantId: uuid, imageUrl: z.string().url() }).optional() }).passthrough()),
}).passthrough()) }).passthrough() }).passthrough()
const tryOnBody = z.object({ sourceLookId: uuid, productIds: z.array(uuid).max(6), variantId: uuid.nullable().optional() }).strict()
const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)

const jobRow = z.object({
  id: uuid, status: z.enum(["queued", "running", "succeeded", "no_results", "failed", "cancelled"]),
  failure_code: z.string().nullable(), created_at: z.string(), finished_at: z.string().nullable(),
  parent_version_id: uuid.nullable(), product_id: uuid.nullable(), variant_id: uuid.nullable(),
  look_id: uuid.nullable(), version_id: uuid.nullable(), version: z.number().int().nullable(),
})
const snapshot = z.object({
  name: z.string(), source: z.string(), partner: z.string(), catalog_kind: z.string().optional(),
  variant_label: z.string().optional(), product_url: z.string().nullable().optional(), price_minor: z.number().nullable().optional(),
  currency: z.string().optional(), garment_image_url: z.string().nullable().optional(), source_updated_at: z.string().nullable().optional(),
  link_verification: z.string().optional(), visual_fidelity: z.string().optional(), fixture: z.boolean().optional(), render_mode: z.string().optional(),
}).passthrough()
export const versionRow = z.object({
  id: uuid, look_id: uuid, version: z.number().int(), parent_version_id: uuid.nullable(), job_id: uuid,
  product_id: uuid, variant_id: uuid, created_at: z.string(), selection_snapshot: snapshot,
  image: z.object({ width: z.number().nullable(), height: z.number().nullable() }).nullable(),
})

/** Portuguese, user-facing, never leaking provider/internal detail. */
const failureMessages: Record<string, string> = {
  provider_not_enabled: "A geração de imagens ainda não está habilitada neste ambiente.",
  provider_budget_unavailable: "Limite de gastos com IA atingido. Tente novamente mais tarde.",
  catalog_variant_unavailable: "Esta peça não está mais disponível.",
  category_not_renderable: "Ainda não conseguimos vestir este tipo de peça.",
  garment_image_missing: "Esta peça não tem imagem autorizada para o provador.",
  photo_removed: "Sua foto foi apagada ou trocada antes da geração; ela não foi usada. Nenhuma moeda foi debitada.",
  photo_not_reachable_by_provider: "Sua foto está guardada só neste computador: o provador real não consegue acessá-la neste ambiente (falta um endereço público). Nada foi cobrado.",
  garment_not_reachable_by_provider: "A imagem desta peça de teste é local e o provador real não consegue acessá-la. Nada foi cobrado.",
  provider_timeout: "O provador demorou demais para responder.",
  provider_outcome_unknown: "Não confirmamos o resultado do provador.",
  generation_needs_reconciliation: "A geração foi interrompida e está em conferência.",
  provider_failed: "O provador não conseguiu gerar esta prova.",
  output_invalid: "O provador devolveu uma imagem inválida.",
  pilot_required: "O piloto pago não está configurado neste ambiente.",
  pilot_pilot_paused: "O piloto real está pausado pelo operador.",
  pilot_uncertain_outcome: "O piloto foi pausado até a conferência de uma tentativa anterior.",
  pilot_in_flight: "Já existe uma geração real do piloto em andamento. Aguarde concluir.",
  pilot_max_attempts_reached: "O limite total de tentativas do piloto foi atingido.",
  pilot_budget_exhausted: "O limite total de orçamento do piloto foi atingido.",
  pilot_user_not_allowed: "Esta conta não faz parte do piloto real atual.",
  pilot_item_not_allowed: "Esta peça não pertence ao catálogo autorizado do piloto real.",
  too_many_pieces: "Uma composição aceita no máximo três peças.",
  try_on_rights_revoked: "O direito de uso da imagem de uma peça foi retirado antes da geração; nada foi enviado ao provador.",
  selection_changed: "Uma peça mudou (preço, título ou link) desde o pedido; monte o look de novo.",
  budget_insufficient_for_layers: "O orçamento disponível não cobre todas as camadas deste look; nada foi enviado ao provador. Gere com menos peças ou aguarde o operador.",
  budget_check_unavailable: "Não conseguimos conferir o orçamento antes de gerar; nada foi enviado ao provador.",
  garment_download_failed: "Não conseguimos baixar a imagem de uma peça; nada foi enviado ao provador.",
  garment_image_changed: "A imagem de uma peça mudou depois da conferência; nada foi enviado ao provador.",
  outfit_input_invalid: "As imagens deste conjunto são grandes demais para o provador; nada foi enviado.",
  intermediate_output_invalid: "Uma etapa intermediária da composição devolveu imagem inválida.",
  intermediate_not_reachable_by_provider: "Uma etapa intermediária não pôde ser enviada ao provador neste ambiente.",
}
export const FRAMING_MESSAGE = "Sua foto de frente aprovada não mostra o corpo inteiro: ela serve só para peças de cima. Para calças, saias e vestidos, envie no Perfil uma foto de corpo inteiro."
const steps: Record<string, string> = { queued: "Na fila", running: "Vestindo as peças escolhidas" }

export function failureMessage(code: string | null): string {
  return failureMessages[code ?? ""]
    ?? (code?.startsWith("provider_rejected") || code?.startsWith("segmind_http_") || code?.startsWith("gemini_http_") ? "O provador recusou o pedido."
      : code?.startsWith("provider_failed_layer_") ? `O provador falhou na camada ${code.slice(-1)} da composição; nenhuma versão foi criada.`
      : "Não foi possível gerar o look.")
}

function presentJob(row: z.infer<typeof jobRow>) {
  const base = failureMessage(row.failure_code)
  return {
    id: row.id,
    kind: row.parent_version_id ? "tryon" : "generate",
    status: row.status,
    step: steps[row.status] ?? null,
    progress: row.status === "queued" ? 0.1 : row.status === "running" ? 0.5 : 1,
    // One generation = one daily request = 10 moedas (packages/contracts/src/coins.ts).
    cost: COINS_PER_REQUEST,
    charged: row.status === "succeeded",
    lookId: row.version_id,
    limiting: [],
    candidatesCount: null,
    error: row.status === "failed" ? { code: row.failure_code ?? "failed", message: `${base} Nenhuma moeda foi debitada.` } : null,
    versionId: row.version_id,
    version: row.version,
    lineageId: row.look_id,
    parentVersionId: row.parent_version_id,
  }
}

const itemSnapshot = snapshot.extend({ slot: z.string().nullable().optional() })
type ItemSnapshot = z.infer<typeof itemSnapshot>

export function presentPiece(s: ItemSnapshot, id: string, variantId: string | null, base: string, warnings: string[]) {
  return {
    role: "chosen",
    slot: s.slot ?? null,
    warnings,
    product: {
      id: typeof s.canonical_id === "string" ? s.canonical_id : id, name: s.name, category: null,
      partner: { id: s.source, name: s.partner },
      price: s.price_minor == null ? null : { amount: s.price_minor / 100, currency: s.currency ?? "BRL" },
      images: s.garment_image_url ? [{ url: displayImageUrl(s.garment_image_url, base), alt: s.name }] : [],
      variants: s.reference_kind !== "image_reference" && s.variant_label && variantId ? [{ id: variantId, label: s.variant_label, available: true }] : [],
      availability: "unknown",
      updatedAt: s.source_updated_at ?? null,
      links: { productUrl: s.product_url ?? null, affiliateUrl: typeof s.affiliate_url === "string" ? s.affiliate_url : null },
    },
  }
}

export function presentLook(v: z.infer<typeof versionRow>, base: string, keys: SessionKeys, user: string) {
  const s = v.selection_snapshot
  const items = z.array(itemSnapshot).safeParse((s as { items?: unknown }).items)
  const multi = items.success && items.data.length > 1
  const warnings = [
    ...(s.visual_fidelity !== "verified" ? ["Aparência no render não verificada"] : []),
    ...(s.link_verification !== "verified" ? ["Link não verificado"] : []),
    ...(s.catalog_kind === "curated" ? ["Catálogo curado"] : []),
    ...(s.fixture === true ? ["Produto de teste (não é oferta real; sem estoque nem link)"] : []),
    ...(s.render_mode === "simulated" ? ["Imagem simulada para teste, não gerada pelo provador real"] : []),
    ...(multi ? [s.render_plan === "joint_outfit_unverified" ? "Prévia ilustrativa: conjunto gerado em uma imagem sem fidelidade medida" : "Prévia ilustrativa: composição por camadas sem fidelidade medida"] : []),
  ]
  return {
    id: v.id,
    title: multi ? items.data.map((i) => i.name).join(" + ") : s.name,
    note: null,
    image: { url: signMediaUrl(base, keys, "look", v.id, user), width: v.image?.width ?? null, height: v.image?.height ?? null, alt: `Prévia com ${s.name}` },
    imageAvailable: v.image !== null,
    // Pieces frozen at generation time (one-piece looks keep the version's own product).
    pieces: items.success && items.data.length
      ? items.data.map((item, i) => presentPiece(item, i === 0 ? v.product_id : `${v.id}:${i + 1}`, i === 0 ? v.variant_id : null, base, warnings))
      : [presentPiece(s, v.product_id, v.variant_id, base, warnings)],
    prompt: null,
    origin: v.parent_version_id ? "tryon" : "generate",
    version: v.version,
    parentId: v.parent_version_id,
    createdAt: v.created_at,
    candidatesCount: 0,
    saved: false,
    simulated: s.render_mode === "simulated",
    lineageId: v.look_id,
    variantId: v.variant_id,
  }
}

function dbFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof PrivateDatabaseError && error.outcome === "rejected") {
    if (error.sqlState === "23505") return reply.code(409).send(apiError("conflict", "Já existe um pedido em andamento ou esta chave foi usada com outros dados."))
    if (error.sqlState === "23514") return reply.code(422).send(apiError("unprocessable", "Não foi possível aceitar o pedido: escolha a variante, a peça está indisponível ou as moedas de hoje acabaram."))
    if (error.sqlState === "42501") return reply.code(403).send(apiError("forbidden", "Foto, consentimento ou versão indisponível para esta conta."))
    // Raised atomically by enqueue_look_job (the API pre-check only explains).
    if (error.sqlState === "SA001") return reply.code(409).send(apiError("photo_framing_insufficient", FRAMING_MESSAGE))
    if (error.sqlState === "SA003") return reply.code(409).send(apiError("try_on_rights_missing", "Uma das peças não tem imagem autorizada para o provador (direito de uso não comprovado). Troque a peça ou gere sem ela."))
    if (error.sqlState === "SA002") return reply.code(409).send(apiError("photo_revalidation_required", "Atualizamos o validador de fotos. No Perfil, toque em “Tentar validar de novo” na foto de frente."))
  }
  return reply.code(503).send(apiError("service_unavailable", "Serviço temporariamente indisponível."))
}

export async function registerStudioRoutes(app: FastifyInstance, deps: StudioDeps) {
  const base = deps.publicBaseUrl.replace(/\/+$/, "")

  async function actor(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const id = await deps.resolveActor(request)
    if (!id) { await reply.code(401).send(apiError("unauthorized", "Entre na sua conta para continuar.")); return null }
    return id
  }

  async function enqueue(request: FastifyRequest, reply: FastifyReply, user: string, input: { productId: string; variantId: string | null; parent: string | null }) {
    const key = idempotencyKey.safeParse(request.headers["idempotency-key"])
    if (!key.success) return reply.code(400).send(apiError("validation", "Cabeçalho Idempotency-Key ausente ou inválido."))
    const hash = createHash("sha256").update(JSON.stringify({ v: 1, product: input.productId, variant: input.variantId, parent: input.parent })).digest("hex")
    try {
      // Specific, user-facing reasons first. The database still enforces every rule
      // atomically; with an active job the call goes straight to it (replay or 409).
      const active = await deps.db.call("read_active_ai_job", user)
      if (!active) {
        const consent = z.object({ policy_version: z.string() }).nullable().parse(await deps.db.call("read_photo_consent", user))
        if (consent?.policy_version !== deps.photoPolicyVersion) return reply.code(403).send(apiError("consent_required", "Aceite o termo de uso da foto para usar o provador."))
        const photos = z.array(z.object({ angle: z.string(), state: z.string(), validation: z.unknown().optional() })).parse((await deps.db.call("list_body_photos", user)) ?? [])
        const front = photos.find((p) => p.angle === "front" && p.state === "ready")
        if (!front) return reply.code(409).send(apiError("photo_required", "Adicione no Perfil uma foto de frente aprovada antes de gerar."))
        // The approved photo must show enough of the body for this garment (validated on the server).
        const product = z.object({ category: z.object({ id: z.string() }).nullable() }).passthrough().nullable().safeParse(await deps.db.call("read_catalog_product", input.productId))
        const group = product.success && product.data?.category ? CATEGORY_GROUP[product.data.category.id] : undefined
        const supports = z.object({ supports: z.object({ upper: z.boolean(), lower: z.boolean(), dress: z.boolean() }) }).safeParse(front.validation)
        // Fail closed: unknown category or missing/malformed metadata never unlock a generation.
        if (!group) return reply.code(422).send(apiError("category_not_renderable", "Ainda não conseguimos vestir este tipo de peça."))
        if (!supports.success || supports.data.supports[group] !== true) return reply.code(409).send(apiError("photo_framing_insufficient", FRAMING_MESSAGE))
      }
      const jobId = await deps.db.call("enqueue_look_job", user, key.data, hash, deps.photoPolicyVersion, input.productId, input.variantId, input.parent)
      return reply.code(202).send(presentJob(jobRow.parse(await deps.db.call("read_ai_job", user, jobId))))
    } catch (error) {
      if (error instanceof PrivateDatabaseError && error.sqlState === "23514") {
        const a = z.object({ allowance: z.number(), reserved: z.number(), spent: z.number() }).safeParse(await deps.db.call("read_ai_allowance", user).catch(() => null))
        if (a.success && a.data.reserved + a.data.spent >= a.data.allowance) {
          return reply.code(402).send(apiError("insufficient_tokens", `Suas moedas de hoje acabaram (cada geração usa ${COINS_PER_REQUEST}). O saldo renova à meia-noite (UTC).`))
        }
      }
      return dbFailure(reply, error)
    }
  }

  type Piece = { slot: SlotId; productId: string; variantId: string | null; imageUrl?: string }

  /** Pieces from catalog ids (no composition): slot derived from each product's category. */
  async function piecesFromCatalog(ids: readonly string[]): Promise<Piece[] | null> {
    const out: Piece[] = []
    for (const id of ids) {
      const p = z.object({ category: z.object({ id: z.string() }).nullable() }).passthrough().nullable().safeParse(await deps.db.call("read_catalog_product", id))
      const slot = p.success && p.data?.category ? slotOfCategory(p.data.category.id) : null
      if (!slot || out.some((x) => x.slot === slot)) return null
      out.push({ slot, productId: id, variantId: null })
    }
    return out
  }

  async function enqueueComposition(request: FastifyRequest, reply: FastifyReply, user: string, input: { pieces: Piece[]; parent: string | null; compositionId: string | null }) {
    const key = idempotencyKey.safeParse(request.headers["idempotency-key"])
    if (!key.success) return reply.code(400).send(apiError("validation", "Cabeçalho Idempotency-Key ausente ou inválido."))
    if (input.pieces.length < 1 || input.pieces.length > MAX_COMPOSITION_ITEMS) return reply.code(422).send(apiError("validation", "Escolha de uma a três peças."))
    const ordered = renderOrder(input.pieces.map((x) => x.slot)).map((slot) => input.pieces.find((x) => x.slot === slot)!)
    const hash = createHash("sha256").update(JSON.stringify({ v: 2, pieces: ordered, parent: input.parent, composition: input.compositionId })).digest("hex")
    try {
      const active = await deps.db.call("read_active_ai_job", user)
      if (!active) {
        const consent = z.object({ policy_version: z.string() }).nullable().parse(await deps.db.call("read_photo_consent", user))
        if (consent?.policy_version !== deps.photoPolicyVersion) return reply.code(403).send(apiError("consent_required", "Aceite o termo de uso da foto para usar o provador."))
        const photos = z.array(z.object({ angle: z.string(), state: z.string(), validation: z.unknown().optional() })).parse((await deps.db.call("list_body_photos", user)) ?? [])
        const front = photos.find((p) => p.angle === "front" && p.state === "ready")
        if (!front) return reply.code(409).send(apiError("photo_required", "Adicione no Perfil uma foto de frente aprovada antes de gerar."))
        const supports = z.object({ supports: z.object({ upper: z.boolean(), lower: z.boolean(), dress: z.boolean() }) }).safeParse(front.validation)
        const groups = ordered.map((x) => (x.slot === "outer" ? "upper" : x.slot))
        if (!supports.success || groups.some((g) => supports.data.supports[g] !== true)) return reply.code(409).send(apiError("photo_framing_insufficient", FRAMING_MESSAGE))
      }
      const items = ordered.map((x) => ({ slot: x.slot, product_id: x.productId, variant_id: x.variantId, ...(x.imageUrl ? { image_url: x.imageUrl } : {}) }))
      const jobId = await deps.db.call("enqueue_composition_job", user, key.data, hash, deps.photoPolicyVersion, items, input.parent, input.compositionId)
      return reply.code(202).send(presentJob(jobRow.parse(await deps.db.call("read_ai_job", user, jobId))))
    } catch (error) {
      if (error instanceof PrivateDatabaseError && error.sqlState === "23514") {
        const a = z.object({ allowance: z.number(), reserved: z.number(), spent: z.number() }).safeParse(await deps.db.call("read_ai_allowance", user).catch(() => null))
        if (a.success && a.data.reserved + a.data.spent >= a.data.allowance) {
          return reply.code(402).send(apiError("insufficient_tokens", `Suas moedas de hoje acabaram (cada geração usa ${COINS_PER_REQUEST}). O saldo renova à meia-noite (UTC).`))
        }
      }
      return dbFailure(reply, error)
    }
  }

  /** Composition confirmed by the person: every chosen id must be a generation-eligible candidate of its slot. */
  async function piecesFromComposition(user: string, compositionId: string, choices: { slot: SlotId; productId: string; variantId?: string | null }[]): Promise<Piece[] | "not_found" | "invalid" | "blocked" | "incomplete" | "review"> {
    const raw = await deps.db.call("read_look_composition", user, compositionId)
    const plan = storedPlan.safeParse(raw)
    if (!plan.success) return "not_found"
    if (requiresSelectionReview(plan.data.plan)) return "review"
    const out: Piece[] = []
    for (const choice of choices) {
      const slot = plan.data.plan.slots.find((x) => x.slot === choice.slot)
      const cand = slot?.candidates.find((c) => c.id === choice.productId)
      if (!cand || out.some((x) => x.slot === choice.slot)) return "invalid"
      if (!cand.generationEligible) return "blocked"
      if (cand.generationReference) {
        if (choice.variantId && choice.variantId !== cand.generationReference.variantId) return "invalid"
        out.push({ slot: choice.slot, productId: cand.generationReference.productId, variantId: cand.generationReference.variantId, imageUrl: cand.generationReference.imageUrl })
        continue
      }
      if (!uuid.safeParse(cand.id).success) return "blocked"
      // The person's size choice (validated by the database against the product); null only when one size exists.
      out.push({ slot: choice.slot, productId: cand.id, variantId: choice.variantId ?? null })
    }
    if (plan.data.plan.slots.some((s) => s.required && !choices.some((c) => c.slot === s.slot))) return "incomplete"
    return out
  }

  async function routeComposition(request: FastifyRequest, reply: FastifyReply, user: string, body: z.infer<typeof compositionBody>, parent: string | null) {
    const pieces = await piecesFromComposition(user, body.compositionId, body.choices)
    if (pieces === "not_found") return reply.code(404).send(apiError("not_found", "Composição não encontrada. Monte o look de novo."))
    if (pieces === "review") return reply.code(409).send(apiError("selection_review_required", "O agente não concluiu a seleção. Peça uma nova sugestão antes de gerar."))
    if (pieces === "incomplete") return reply.code(409).send(apiError("composition_incomplete", "Falta uma peça obrigatória do look. Busque uma alternativa antes de gerar."))
    if (pieces === "invalid") return reply.code(422).send(apiError("validation", "As peças escolhidas não pertencem a esta composição."))
    if (pieces === "blocked") return reply.code(409).send(apiError("try_on_rights_missing", "Esta composição tem peças sem direito de uso de imagem para o provador (ex.: AliExpress). A pesquisa e os links continuam disponíveis; a geração com essas peças está bloqueada."))
    return enqueueComposition(request, reply, user, { pieces, parent, compositionId: body.compositionId })
  }

  app.post("/v1/studio/generations", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const composed = compositionBody.safeParse(request.body)
    if (composed.success) return routeComposition(request, reply, user, composed.data, null)
    const slice = sliceBody.safeParse(request.body)
    if (slice.success) return enqueue(request, reply, user, { productId: slice.data.productId, variantId: slice.data.variantId ?? null, parent: slice.data.parentVersionId ?? null })
    const contract = contractBody.safeParse(request.body)
    if (!contract.success) return reply.code(400).send(apiError("validation", "Escolha uma peça do catálogo."))
    if (contract.data.productIds.length === 1) return enqueue(request, reply, user, { productId: contract.data.productIds[0]!, variantId: contract.data.variantId ?? null, parent: null })
    const pieces = await piecesFromCatalog(contract.data.productIds)
    if (!pieces) return reply.code(422).send(apiError("validation", "Escolha no máximo uma peça por parte do corpo (cima, baixo, peça única, camada externa)."))
    return enqueueComposition(request, reply, user, { pieces, parent: null, compositionId: null })
  })

  app.post("/v1/studio/try-ons", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    // Swapping a piece of a composition re-renders the WHOLE chain (outer layers depend on inner ones).
    const composed = compositionBody.extend({ sourceLookId: uuid }).safeParse(request.body)
    if (composed.success) return routeComposition(request, reply, user, composed.data, composed.data.sourceLookId)
    const body = tryOnBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send(apiError("validation", "Escolha o look de origem e a nova peça."))
    if (body.data.productIds.length === 1) return enqueue(request, reply, user, { productId: body.data.productIds[0]!, variantId: body.data.variantId ?? null, parent: body.data.sourceLookId })
    const pieces = await piecesFromCatalog(body.data.productIds)
    if (!pieces) return reply.code(422).send(apiError("validation", "Escolha no máximo uma peça por parte do corpo."))
    return enqueueComposition(request, reply, user, { pieces, parent: body.data.sourceLookId, compositionId: null })
  })

  app.get<{ Params: { id: string } }>("/v1/studio/jobs/:id", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return reply.code(404).send(apiError("not_found", "Pedido não encontrado."))
    try {
      const raw = await deps.db.call("read_ai_job", user, request.params.id)
      if (!raw) return reply.code(404).send(apiError("not_found", "Pedido não encontrado."))
      return presentJob(jobRow.parse(raw))
    } catch (error) { return dbFailure(reply, error) }
  })

  app.post<{ Params: { id: string } }>("/v1/studio/jobs/:id/cancel", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return reply.code(404).send(apiError("not_found", "Pedido não encontrado."))
    try {
      await deps.db.call("cancel_ai_job", user, request.params.id)
      const raw = await deps.db.call("read_ai_job", user, request.params.id)
      if (!raw) return reply.code(404).send(apiError("not_found", "Pedido não encontrado."))
      return presentJob(jobRow.parse(raw))
    } catch (error) { return dbFailure(reply, error) }
  })

  async function version(user: string, id: string) {
    const raw = await deps.db.call("read_look_version", user, id)
    return raw ? versionRow.parse(raw) : null
  }

  /** Versions of this person kept in the Closet. */
  async function savedIds(user: string): Promise<Set<string>> {
    if (!deps.closet) return new Set()
    return new Set(z.array(z.object({ version_id: uuid })).parse((await deps.db.call("list_saved_looks", user, 100)) ?? []).map((s) => s.version_id))
  }

  app.get("/v1/studio/looks", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    try {
      const list = z.array(z.object({ latest_version_id: uuid.nullable() })).parse((await deps.db.call("list_looks", user, 12)) ?? [])
      const items = []
      const saved = await savedIds(user)
      for (const item of list) {
        if (!item.latest_version_id) continue
        const v = await version(user, item.latest_version_id)
        if (v) items.push({ ...presentLook(v, base, deps.keys, user), saved: saved.has(v.id) })
      }
      return { items }
    } catch (error) { return dbFailure(reply, error) }
  })

  app.get<{ Params: { id: string } }>("/v1/studio/looks/:id", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return reply.code(404).send(apiError("not_found", "Look não encontrado."))
    try {
      const v = await version(user, request.params.id)
      if (!v) return reply.code(404).send(apiError("not_found", "Look não encontrado."))
      return { ...presentLook(v, base, deps.keys, user), saved: (await savedIds(user)).has(v.id) }
    } catch (error) { return dbFailure(reply, error) }
  })

  app.get<{ Params: { id: string } }>("/v1/studio/looks/:id/versions", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return reply.code(404).send(apiError("not_found", "Look não encontrado."))
    try {
      const v = await version(user, request.params.id)
      if (!v) return reply.code(404).send(apiError("not_found", "Look não encontrado."))
      const lineage = z.object({ versions: z.array(z.object({ id: uuid })) }).parse(await deps.db.call("read_look", user, v.look_id))
      const items = []
      for (const entry of lineage.versions) { const full = await version(user, entry.id); if (full) items.push(presentLook(full, base, deps.keys, user)) }
      return { items }
    } catch (error) { return dbFailure(reply, error) }
  })

  app.get("/v1/studio/config", async () => ({
    // Moedas: free 30, paid 120 per day; one generation or swap = 10 (packages/contracts/src/coins.ts).
    // Edit cost is NOT defined by the owner: null (and edits are unavailable in this engine).
    costs: { generate: COINS_PER_REQUEST, edit: null, tryOn: COINS_PER_REQUEST },
    unit: COIN_UNIT,
    quotaStatus: "provisional",
    plans: [
      { id: "free", name: PLAN_LABEL.free, coinsPerPeriod: PLAN_COINS.free, period: "day" },
      { id: "paid", name: PLAN_LABEL.paid, coinsPerPeriod: PLAN_COINS.paid, period: "day" },
    ],
    costGaps: ["edit", "monthly_limit", "paid_plan_price", "reset_time_confirmation"],
    generationMode: deps.generationMode ?? (deps.generationEnabled ? "simulated" : "disabled"),
    realProvider: deps.generationMode === "real" ? deps.realProvider ?? null : null,
    maxReferences: 0, maxChosenPieces: 1, maxPromptLength: 500,
    budget: { min: 0, max: 0, step: 1, currency: "BRL" },
    acceptedImageTypes: ["image/jpeg", "image/png", "image/webp"], maxImageBytes: 12_582_912, minImageHeight: 600,
    sizes: { top: [], bottom: [], shoes: [] },
    // What the engine really does today. The Estúdio keeps its layout and marks the rest as unavailable.
    capabilities: {
      mode: "single_piece_try_on", search: true, searchScope: deps.searchScope ?? "curated_catalog", dress: true, adjustments: false,
      bodyPhotoRequired: true, closet: deps.closet === true, generation: deps.generationEnabled, edits: false, match: deps.closet === true, references: false, preferences: false,
      // Not offered by this engine: the front sends no request for them (QA-010).
      measurements: false, plans: false, candidates: false, outfits: deps.outfits === true,
      // Rating and sales only exist where the store publishes them.
      outfitFilters: deps.outfits !== true ? [] : ["audience", "price", "total", ...(deps.searchScope === "stores" ? ["rating", "sales"] : [])],
      composer: deps.composer ?? { mode: "rules", model: null },
    },
    photoPolicyVersion: deps.photoPolicyVersion,
  }))

  app.get<{ Querystring: { active?: string } }>("/v1/studio/jobs", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (request.query.active !== "true") return reply.code(400).send(apiError("validation", "Use active=true."))
    try {
      const raw = await deps.db.call("read_active_ai_job", user)
      return { items: raw ? [presentJob(jobRow.parse(raw))] : [] }
    } catch (error) { return dbFailure(reply, error) }
  })

  app.get("/v1/me/balance", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    try {
      const a = z.object({ allowance: z.number().int(), reserved: z.number().int(), spent: z.number().int(), resets_at: z.string() }).parse(await deps.db.call("read_ai_allowance", user))
      // Database counts requests; the API presents moedas (10 per request). Nothing is reset here.
      const paid = a.allowance >= 12
      return {
        tokens: coinsFromRequests(a.allowance - a.reserved - a.spent),
        plan: { id: paid ? "paid" : "free", name: paid ? PLAN_LABEL.paid : PLAN_LABEL.free, tokensPerPeriod: coinsFromRequests(a.allowance), period: "day", price: null },
        renewsAt: a.resets_at,
      }
    } catch (error) { return dbFailure(reply, error) }
  })
}

/**
 * Test-only actor for HTTP-level tests that do not exercise sessions.
 * Refused outside development/test and never wired by server.ts. Not a login system.
 */
export function createDevActorResolver(env: { nodeEnv: string; devActorId: string | undefined }): ActorResolver | null {
  if (!env.devActorId) return null
  if (env.nodeEnv !== "development" && env.nodeEnv !== "test") throw new Error("STYLAI_DEV_ACTOR_ID is only allowed in development/test")
  if (!uuid.safeParse(env.devActorId).success) throw new Error("Invalid STYLAI_DEV_ACTOR_ID")
  const id = env.devActorId
  return async () => id
}
