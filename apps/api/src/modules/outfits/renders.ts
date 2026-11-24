/**
 * Image generation of chosen outfits: one individual panel or a comparison of 2 to 4 panels.
 *   POST /v1/studio/outfit-renders/quote { mode, sets: [{ setId, revision }] }  -> what will run, what it costs, what blocks it
 *   POST /v1/studio/outfit-renders { mode, sets, confirmation } (Idempotency-Key) -> 202 (the WHOLE batch is reserved first)
 *   GET  /v1/studio/outfit-renders · GET .../:id
 *   POST .../:id/retry { panel, acceptCharge? } · POST .../:id/finalize · POST .../:id/cancel
 *   GET  /v1/media/comparisons/:id?u&e&s (short-lived signed link)
 * Panels are independent generations from the same approved photo; the comparison is assembled by the worker (no AI).
 */
import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { apiError, coinsFromRequests, COINS_PER_REQUEST, MAX_PANELS, MIN_PANELS } from "@stylai/contracts"
import type { AliExpressCatalogService } from "@stylai/commerce"
import { PrivateDatabaseError, type Json, type PrivateDatabase, type PrivateObjectStore } from "@stylai/supabase"
import { signMediaUrl, verifyMediaSignature, type SessionKeys } from "../auth/session-crypto.js"
import { parseCatalogPage } from "../catalog/routes.js"
import { failureMessage, FRAMING_MESSAGE } from "../studio/routes.js"
import { blockedCode, blockedMessage, orderPieces, pieceFromCatalog, presentPieceCard, pieceSchema, totalOf, type StoredPiece } from "./pieces.js"
import { fullSetRow, idempotencyKey } from "./routes.js"
import type { OutfitSearch } from "./search.js"

export interface OutfitRenderDeps {
  db: PrivateDatabase<"api">
  store: PrivateObjectStore
  keys: SessionKeys
  resolveActor: (request: FastifyRequest) => Promise<string | null>
  publicBaseUrl: string
  photoPolicyVersion: string
  search: OutfitSearch
  aliexpressCatalog?: AliExpressCatalogService | null
  /** The provider every panel uses (one synchronous joint-outfit call per panel). Null = this environment cannot run batches. */
  render: {
    mode: "simulated" | "real"
    provider: string; providerLabel: string; model: string
    reserveMicros: bigint; priceMicros: bigint
    /** Real mode only: operator pilot that bounds money, attempts and products. */
    pilotId: string | null
  } | null
}

const uuid = z.string().uuid()
const setsBody = z.array(z.object({ setId: uuid, revision: z.number().int().min(1) }).strict()).min(1).max(MAX_PANELS)
const quoteBody = z.object({ mode: z.enum(["individual", "comparison"]), sets: setsBody }).strict()
  .refine((b) => b.mode === "individual" ? b.sets.length === 1 : b.sets.length >= MIN_PANELS && b.sets.length <= MAX_PANELS)
  .refine((b) => new Set(b.sets.map((s) => s.setId)).size === b.sets.length)
const createBody = z.object({ mode: z.enum(["individual", "comparison"]), sets: setsBody, confirmation: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
const retryBody = z.object({ panel: z.number().int().min(1).max(MAX_PANELS), acceptCharge: z.boolean().optional() }).strict()
const mediaQuery = z.object({ u: uuid, e: z.coerce.number().int(), s: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
const budgetRow = z.object({
  ok: z.boolean(), calls: z.number(), needed_usd_micros: z.number(), remaining_usd_micros: z.number(), limiting: z.array(z.string()),
  pilot: z.object({ remaining_attempts: z.number(), max_attempts: z.number(), remaining_usd_micros: z.number(), limit_usd_micros: z.number(), paused: z.boolean() }).passthrough().nullable(),
})
const renderRow = z.object({
  id: uuid, mode: z.enum(["individual", "comparison"]), provider: z.string(), model: z.string(), reserve_usd_micros: z.number(), created_at: z.string(),
  comparison_state: z.enum(["not_applicable", "waiting", "pending", "building", "ready", "failed"]), comparison_error: z.string().nullable(), comparison_layout: z.unknown(),
  comparison: z.object({ width: z.number().nullable(), height: z.number().nullable() }).nullable(), photo_current: z.boolean().nullable(),
  panels: z.array(z.object({
    panel: z.number().int(), set_id: uuid, revision: z.number().int(), label: z.string(), dropped: z.boolean(), search_id: uuid.nullable(), pieces: z.array(pieceSchema).nullable(),
    attempts: z.number().int(), version_id: uuid.nullable(), charge_state: z.enum(["none", "charged", "unknown"]), settled_usd_micros: z.number(),
    job: z.object({ id: uuid, status: z.string(), failure_code: z.string().nullable(), finished_at: z.string().nullable() }).nullable(),
  })),
})
type RenderRow = z.infer<typeof renderRow>
const assetRow = z.object({ bucket: z.literal("generated-looks"), object_key: z.string(), mime: z.enum(["image/png", "image/jpeg", "image/webp"]) })

const LIMIT_MESSAGE: Record<string, string> = {
  pilot_missing: "O piloto real não está configurado neste ambiente.", pilot_paused: "O piloto real está pausado pelo operador.",
  pilot_user: "Esta conta não faz parte do piloto real.", pilot_uncertain: "Uma tentativa anterior do piloto ainda precisa de conferência.",
  pilot_attempts: "A cota de gerações do piloto não cobre este pedido.", pilot_budget: "O orçamento do piloto não cobre este pedido.",
  pilot_target: "O modelo configurado não está autorizado no piloto.", pilot_items: "O piloto ainda não autoriza imagens preparadas automaticamente.",
  global: "O limite de gastos do ambiente não cobre este pedido.", provider: "O limite de gastos do provador não cobre este pedido.",
  user: "Seu limite diário de gastos não cobre este pedido.", job: "O limite por geração é menor que a reserva necessária.",
}
const MONTAGE_ERROR: Record<string, string> = {
  photo_removed: "Sua foto foi apagada ou o termo foi revogado; o comparativo não foi montado.",
  panel_image_unavailable: "Uma das imagens não está mais disponível.",
}
const usd = (micros: bigint | number) => Number(micros) / 1_000_000
type Blocker = { code: string; message: string }
type FullSet = z.infer<typeof fullSetRow>
interface Change { slot: string; name: string; kind: "price" | "image"; before: number | null; after: number | null }
interface Panel { row: FullSet; pieces: StoredPiece[]; changes: Change[] }

export async function registerOutfitRenderRoutes(app: FastifyInstance, deps: OutfitRenderDeps) {
  const base = deps.publicBaseUrl.replace(/\/+$/, "")
  async function actor(request: FastifyRequest, reply: FastifyReply) {
    const id = await deps.resolveActor(request)
    if (!id) { await reply.code(401).send(apiError("unauthorized", "Entre na sua conta para continuar.")); return null }
    return id
  }
  const notFound = (reply: FastifyReply) => reply.code(404).send(apiError("not_found", "Geração não encontrada."))
  function failure(request: FastifyRequest, reply: FastifyReply, error: unknown) {
    if (error instanceof PrivateDatabaseError && error.outcome === "rejected") {
      const known: Record<string, [number, string, string]> = {
        "23505": [409, "conflict", "Já existe uma geração em andamento nesta conta. Aguarde terminar."],
        "23514": [422, "unprocessable", "Não foi possível aceitar o pedido: confira as peças e o saldo de moedas."],
        "42501": [403, "forbidden", "Foto, termo ou conjunto indisponível para esta conta."],
        SA001: [409, "photo_framing_insufficient", FRAMING_MESSAGE],
        SA002: [409, "photo_revalidation_required", "Atualizamos o validador de fotos. No Perfil, toque em “Tentar validar de novo” na foto de frente."],
        SA003: [409, "try_on_rights_missing", "O uso da imagem de uma peça não está mais autorizado. Troque a peça e confira de novo."],
        SA004: [409, "quote_changed", "A imagem de uma peça mudou. Confira o pedido de novo."],
        SA007: [409, "budget_insufficient", "O orçamento disponível não cobre todas as imagens deste pedido. Nada foi enviado nem cobrado."],
        SA008: [409, "needs_reconciliation", "O resultado da tentativa anterior ainda não foi confirmado. Não vamos repetir até conferir, para não cobrar duas vezes."],
        SA009: [409, "second_charge", "A tentativa anterior foi cobrada pelo provador. Gerar de novo cobra outra vez: confirme para continuar."],
        SA011: [409, "provider_changed", "O modelo de geração mudou desde este pedido. Faça um novo pedido para usar o atual."],
        SA010: [409, "photo_replaced", "Sua foto mudou desde este pedido. Faça um novo comparativo para usar a foto atual em todos os painéis."],
      }
      const hit = known[error.sqlState ?? ""]
      if (hit) return reply.code(hit[0]).send(apiError(hit[1], hit[2]))
    }
    request.log.warn({ stage: "outfit_render", reason: error instanceof Error ? error.name : "unknown" }, "outfit render route failed")
    return reply.code(503).send(apiError("service_unavailable", "Serviço temporariamente indisponível."))
  }

  /* ---------------------------------------------------------------- quote */

  async function readPanels(user: string, sets: { setId: string; revision: number }[]): Promise<Panel[] | "missing" | "stale"> {
    const out: Panel[] = []
    for (const s of sets) {
      const raw = await deps.db.call("read_outfit_set", user, s.setId)
      if (!raw) return "missing"
      const row = fullSetRow.parse(raw)
      if (row.revision !== s.revision) return "stale"
      out.push({ row, pieces: row.pieces.map((p) => ({ ...p })), changes: [] })
    }
    return out
  }

  /** Price and image as the source reports them NOW. A change becomes a new version of the set, never a silent update. */
  async function recheck(user: string, panels: Panel[]): Promise<void> {
    const asked = new Map<string, boolean>()
    for (const panel of panels) {
      for (const piece of panel.pieces) {
        if (piece.source === "aliexpress") {
          let item = await deps.aliexpressCatalog?.findFresh(piece.id) ?? null
          const query = item ? null : panel.row.plan.queries.find((q) => q.slot === piece.slot && q.outcome === "ok")?.query
          if (query && deps.aliexpressCatalog && !asked.has(query)) {
            // The same free store query that found it (one per distinct query, cached by the service).
            asked.set(query, true)
            await deps.aliexpressCatalog.search({ keywords: query, pageSize: 50, viewer: user })
          }
          item ??= await deps.aliexpressCatalog?.findFresh(piece.id) ?? null
          if (!item) continue // not returned now: shown with the date of the last observation
          if (item.priceMinor !== piece.priceMinor) panel.changes.push({ slot: piece.slot, name: piece.name, kind: "price", before: piece.priceMinor, after: item.priceMinor })
          if (item.image !== piece.image) { panel.changes.push({ slot: piece.slot, name: piece.name, kind: "image", before: null, after: null }); piece.reference = null }
          Object.assign(piece, { priceMinor: item.priceMinor, priceObservedAt: item.priceObservedAt, image: item.image, affiliateUrl: item.affiliateUrl ?? piece.affiliateUrl })
        } else {
          const raw = await deps.db.call("read_catalog_product", piece.id)
          if (!raw) { piece.reference = null; piece.blocked = "not_found"; continue }
          const now = pieceFromCatalog(parseCatalogPage({ total: 1, items: [raw] }).items[0]!, piece.slot)
          if (now.priceMinor !== piece.priceMinor) panel.changes.push({ slot: piece.slot, name: piece.name, kind: "price", before: piece.priceMinor, after: now.priceMinor })
          const variantId = piece.variantId && now.variants.some((v) => v.id === piece.variantId) ? piece.variantId : now.variantId
          Object.assign(piece, { priceMinor: now.priceMinor, priceObservedAt: now.priceObservedAt, variants: now.variants, variantId, blocked: now.blocked, reference: now.reference ? { ...now.reference, variantId } : null })
        }
      }
      if (panel.changes.length) {
        const pieces = orderPieces(panel.pieces), total = totalOf(pieces)
        panel.row.revision = await deps.db.call("save_outfit_set_revision", user, panel.row.id, panel.row.revision, "refresh", JSON.parse(JSON.stringify(pieces)) as Json,
          panel.row.locked, total === null ? null : String(total))
      }
    }
  }
  /** Rights and bytes confirmed now: a revoked policy or removed image blocks here, before any spend. */
  async function confirmReferences(panels: Panel[]): Promise<void> {
    const pieces = panels.flatMap((p) => p.pieces).filter((p) => p.source === "aliexpress")
    for (const p of pieces) { p.reference = null; p.blocked = null }
    await deps.search.prepare(pieces)
  }

  async function photoBlocker(user: string, panels: Panel[]): Promise<Blocker | null> {
    const consent = z.object({ policy_version: z.string() }).nullable().parse(await deps.db.call("read_photo_consent", user))
    if (consent?.policy_version !== deps.photoPolicyVersion) return { code: "consent_required", message: "Leia e aceite no Perfil o termo atual de uso da foto." }
    const photos = z.array(z.object({ angle: z.string(), state: z.string(), validation: z.unknown().optional() })).parse((await deps.db.call("list_body_photos", user)) ?? [])
    const front = photos.find((p) => p.angle === "front" && p.state === "ready")
    if (!front) return { code: "photo_required", message: "Adicione no Perfil uma foto de frente aprovada antes de gerar." }
    const supports = z.object({ supports: z.object({ upper: z.boolean(), lower: z.boolean(), dress: z.boolean() }) }).safeParse(front.validation)
    const groups = panels.flatMap((p) => p.pieces.map((x) => x.slot === "set" ? "dress" as const : x.slot === "outer" ? "upper" as const : x.slot))
    if (!supports.success || groups.some((g) => !supports.data.supports[g])) return { code: "photo_framing_insufficient", message: FRAMING_MESSAGE }
    return null
  }
  const items = (panel: Panel): Json => panel.pieces.map((p) => ({
    slot: p.slot, product_id: p.reference!.productId, variant_id: p.reference!.variantId, image_url: p.reference!.imageUrl,
    commerce: p.source === "aliexpress" ? { canonical_id: p.id, affiliate_url: p.affiliateUrl } : null,
  }))
  const confirmationOf = (user: string, mode: string, panels: Panel[]): string => createHash("sha256").update(JSON.stringify({
    v: 1, user, mode, render: deps.render && { m: deps.render.model, p: deps.render.provider, r: deps.render.reserveMicros.toString(), s: deps.render.mode },
    panels: panels.map((p) => ({ set: p.row.id, revision: p.row.revision, pieces: p.pieces.map((x) => ({ id: x.id, price: x.priceMinor, image: x.image, variant: x.variantId, ref: x.reference && [x.reference.productId, x.reference.sha256 ?? null] })) })),
  })).digest("hex")

  async function quote(user: string, mode: "individual" | "comparison", panels: Panel[]) {
    const calls = panels.length
    const blockers: Blocker[] = []
    if (await deps.db.call("read_active_ai_job", user)) blockers.push({ code: "conflict", message: "Já existe uma geração em andamento nesta conta. Aguarde terminar." })
    const photo = await photoBlocker(user, panels)
    if (photo) blockers.push(photo)
    if (!deps.render) blockers.push({ code: "generation_disabled", message: "A geração de imagens não está habilitada neste ambiente." })
    const blockedPieces = panels.flatMap((p) => p.pieces.filter((x) => blockedCode(x) !== null).map((x) => ({ setId: p.row.id, slot: x.slot, name: x.name, code: blockedCode(x)!, message: blockedMessage(blockedCode(x)!) })))
    if (blockedPieces.length) blockers.push({ code: "pieces_blocked", message: "Há peças que não podem ir para o provador. Troque por uma das alternativas do conjunto." })
    const allowance = z.object({ allowance: z.number(), reserved: z.number(), spent: z.number() }).parse(await deps.db.call("read_ai_allowance", user))
    const left = allowance.allowance - allowance.reserved - allowance.spent
    if (left < calls) blockers.push({ code: "insufficient_tokens", message: `Este pedido usa ${coinsFromRequests(calls)} moedas e você tem ${coinsFromRequests(Math.max(left, 0))} hoje.` })
    const products = panels.flatMap((p) => p.pieces).map((p) => p.reference?.productId).filter((x): x is string => Boolean(x))
    const budget = deps.render ? budgetRow.parse(await deps.db.call("outfit_budget", user, deps.render.provider, deps.render.model, deps.render.reserveMicros.toString(), calls, deps.render.pilotId, deps.render.pilotId ? products : null)) : null
    for (const l of budget?.limiting ?? []) blockers.push({ code: `budget_${l}`, message: LIMIT_MESSAGE[l] ?? "O orçamento disponível não cobre este pedido." })
    const changes = panels.flatMap((p) => p.changes.map((c) => ({ setId: p.row.id, ...c, before: c.before === null ? null : c.before / 100, after: c.after === null ? null : c.after / 100 })))
    return {
      mode, ready: blockers.length === 0, blockers, blockedPieces, changes,
      panels: panels.map((p, i) => {
        const total = totalOf(p.pieces)
        return { panel: i + 1, setId: p.row.id, revision: p.row.revision, title: p.row.title, pieces: p.pieces.map((x) => presentPieceCard(x, base)), total: total === null ? null : { amount: total / 100, currency: "BRL" } }
      }),
      generation: deps.render ? { simulated: deps.render.mode === "simulated", provider: deps.render.providerLabel, model: deps.render.model, calls,
        estimatedUsd: deps.render.mode === "simulated" ? 0 : usd(deps.render.priceMicros * BigInt(calls)), maxUsd: deps.render.mode === "simulated" ? 0 : usd(deps.render.reserveMicros * BigInt(calls)) } : null,
      coins: { cost: coinsFromRequests(calls), available: coinsFromRequests(Math.max(left, 0)) },
      budget: budget ? { ok: budget.ok, neededUsd: usd(budget.needed_usd_micros), remainingUsd: usd(budget.remaining_usd_micros),
        pilot: budget.pilot ? { remainingAttempts: budget.pilot.remaining_attempts, maxAttempts: budget.pilot.max_attempts, remainingUsd: usd(budget.pilot.remaining_usd_micros), paused: budget.pilot.paused } : null } : null,
      confirmation: blockers.length === 0 ? confirmationOf(user, mode, panels) : null,
    }
  }

  app.post("/v1/studio/outfit-renders/quote", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const body = quoteBody.safeParse(request.body)
    if (!body.success) return reply.code(422).send(apiError("validation", `Escolha um conjunto, ou de ${MIN_PANELS} a ${MAX_PANELS} conjuntos diferentes para comparar.`))
    try {
      const panels = await readPanels(user, body.data.sets)
      if (panels === "missing") return reply.code(404).send(apiError("not_found", "Conjunto não encontrado."))
      if (panels === "stale") return reply.code(409).send(apiError("stale_revision", "Um dos conjuntos mudou. Recarregamos a versão atual; confira de novo."))
      await recheck(user, panels)
      await confirmReferences(panels)
      return await quote(user, body.data.mode, panels)
    } catch (error) { return failure(request, reply, error) }
  })

  /* ---------------------------------------------------------------- renders */

  const PANEL_LABEL: Record<string, string> = {
    queued: "Na fila", running: "Gerando", ready: "Pronto", failed: "Falhou", failed_charged: "Falhou após cobrança", cancelled: "Cancelado",
    needs_reconciliation: "Em conferência", dropped: "Fora do comparativo",
  }
  function present(row: RenderRow, user: string) {
    const panels = row.panels.map((p) => {
      const active = p.job?.status === "queued" || p.job?.status === "running"
      const state = p.version_id ? "ready" : p.dropped ? "dropped" : active ? p.job!.status as "queued" | "running" : p.charge_state === "unknown" ? "needs_reconciliation"
        : p.charge_state === "charged" ? "failed_charged" : p.job?.status === "cancelled" ? "cancelled" : "failed"
      const retryable = ["failed", "failed_charged", "cancelled"].includes(state)
      return {
        panel: p.panel, setId: p.set_id, searchId: p.search_id, revision: p.revision, title: p.label, state, stateLabel: PANEL_LABEL[state]!, dropped: p.dropped, attempts: p.attempts,
        lookId: p.version_id, image: p.version_id ? { url: signMediaUrl(base, deps.keys, "look", p.version_id, user), width: null, height: null, alt: `Prévia: ${p.label}` } : null,
        pieces: (p.pieces ?? []).map((x) => presentPieceCard(x, base)),
        error: state === "needs_reconciliation" ? { code: "needs_reconciliation", message: "O provador não confirmou o resultado. Estamos conferindo com ele, sem repetir o pedido, para não cobrar duas vezes. Costuma levar alguns minutos; se demorar, precisa de conferência manual." }
          : retryable && p.job?.failure_code ? { code: p.job.failure_code, message: failureMessage(p.job.failure_code) } : null,
        spentUsd: usd(p.settled_usd_micros),
        canRetry: retryable && row.photo_current === true && p.attempts < 5, retryNeedsChargeAcceptance: state === "failed_charged",
        retryBlockedReason: retryable && row.photo_current !== true ? "Sua foto mudou desde este pedido. Faça um novo pedido para usar a foto atual." : retryable && p.attempts >= 5 ? "Limite de tentativas deste painel atingido." : null,
      }
    })
    const active = panels.some((p) => p.state === "queued" || p.state === "running")
    const readyCount = panels.filter((p) => p.state === "ready" && !p.dropped).length
    const kept = panels.filter((p) => !p.dropped)
    const building = row.comparison_state === "pending" || row.comparison_state === "building"
    const status = active ? "running" : building ? "assembling"
      : row.mode === "individual" ? (readyCount ? "succeeded" : "failed")
      : row.comparison_state === "ready" ? "succeeded" : readyCount ? "partial" : "failed"
    return {
      id: row.id, mode: row.mode, createdAt: row.created_at, provider: row.provider, model: row.model, status, panels,
      comparison: row.mode === "individual" ? null : {
        state: row.comparison_state,
        image: row.comparison_state === "ready" && row.comparison ? { url: signMediaUrl(base, deps.keys, "comparison", row.id, user), width: row.comparison.width, height: row.comparison.height, alt: `Comparativo: ${kept.map((p) => p.title).join(", ")}` } : null,
        error: row.comparison_state === "failed" ? { code: row.comparison_error ?? "failed", message: MONTAGE_ERROR[row.comparison_error ?? ""] ?? "Não conseguimos montar o comparativo. As imagens prontas continuam salvas." } : null,
      },
      spentUsd: usd(row.panels.reduce((a, p) => a + p.settled_usd_micros, 0)),
      canCancel: panels.some((p) => p.state === "queued"),
      // "Montar com os prontos": explicit choice, at least two ready panels and nothing running.
      canFinalize: row.mode === "comparison" && !active && readyCount >= MIN_PANELS && (row.comparison_state === "failed" || (row.comparison_state === "waiting" && kept.some((p) => p.state !== "ready"))),
    }
  }
  async function read(user: string, id: string) {
    const raw = await deps.db.call("read_outfit_render", user, id)
    return raw ? renderRow.parse(raw) : null
  }

  app.post("/v1/studio/outfit-renders", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const key = idempotencyKey.safeParse(request.headers["idempotency-key"])
    if (!key.success) return reply.code(400).send(apiError("validation", "Cabeçalho Idempotency-Key ausente ou inválido."))
    const body = createBody.safeParse(request.body)
    if (!body.success || !quoteBody.safeParse({ mode: body.data.mode, sets: body.data.sets }).success) return reply.code(422).send(apiError("validation", "Pedido inválido. Confira os conjuntos escolhidos."))
    try {
      if (!deps.render) return reply.code(503).send(apiError("generation_disabled", "A geração de imagens não está habilitada neste ambiente."))
      const { mode, sets, confirmation } = body.data
      // The stored request is what the person confirmed: a replay (same key) returns the same batch, whatever changed since.
      const hash = createHash("sha256").update(JSON.stringify({ v: 1, mode, sets, confirmation })).digest("hex")
      const panels = await readPanels(user, sets)
      if (panels === "missing") return reply.code(404).send(apiError("not_found", "Conjunto não encontrado."))
      const replay = async () => {
        const recent = z.array(renderRow.extend({ request_key: z.string().optional() })).parse((await deps.db.call("list_outfit_renders", user, 20)) ?? [])
        return recent.find((r) => r.request_key === key.data) ?? null
      }
      const prior = await replay()
      if (!prior) {
        if (panels === "stale") return reply.code(409).send(apiError("stale_revision", "Um dos conjuntos mudou depois da conferência. Confira de novo."))
        await confirmReferences(panels)
        const fresh = await quote(user, mode, panels)
        if (fresh.confirmation !== confirmation) {
          // The twin of a double click may have just created this very batch (which is why money or the queue changed).
          const twin = await replay()
          if (twin) return reply.code(200).send(present(twin, user))
          const reason = fresh.blockers[0]
          return reply.code(409).send(apiError(reason?.code ?? "quote_changed", reason?.message ?? "Algo mudou depois da conferência. Veja o resumo atualizado e confirme de novo."))
        }
      }
      const id = await deps.db.call("enqueue_outfit_render", user, key.data, hash, deps.photoPolicyVersion, mode, deps.render.provider, deps.render.model, deps.render.reserveMicros.toString(),
        deps.render.pilotId, prior || panels === "stale" ? [] : panels.map((p) => ({ set_id: p.row.id, revision: p.row.revision, label: p.row.title, items: items(p) })) as Json)
      const row = await read(user, id)
      return row ? reply.code(prior ? 200 : 202).send(present(row, user)) : notFound(reply)
    } catch (error) {
      if (error instanceof PrivateDatabaseError && error.sqlState === "23514") {
        const a = z.object({ allowance: z.number(), reserved: z.number(), spent: z.number() }).safeParse(await deps.db.call("read_ai_allowance", user).catch(() => null))
        if (a.success && a.data.allowance - a.data.reserved - a.data.spent < body.data.sets.length) {
          return reply.code(402).send(apiError("insufficient_tokens", `Suas moedas de hoje não cobrem este pedido (cada imagem usa ${COINS_PER_REQUEST}).`))
        }
      }
      return failure(request, reply, error)
    }
  })
  app.get("/v1/studio/outfit-renders", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    try { return { items: z.array(renderRow).parse((await deps.db.call("list_outfit_renders", user, 12)) ?? []).map((r) => present(r, user)) } } catch (error) { return failure(request, reply, error) }
  })
  app.get<{ Params: { id: string } }>("/v1/studio/outfit-renders/:id", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return notFound(reply)
    try { const row = await read(user, request.params.id); return row ? present(row, user) : notFound(reply) } catch (error) { return failure(request, reply, error) }
  })

  async function change(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, act: (user: string, id: string) => Promise<unknown>) {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return notFound(reply)
    try {
      const row = await read(user, request.params.id)
      if (!row) return notFound(reply)
      await act(user, row.id)
      return present((await read(user, row.id))!, user)
    } catch (error) { return failure(request, reply, error) }
  }
  app.post<{ Params: { id: string } }>("/v1/studio/outfit-renders/:id/retry", async (request, reply) => {
    const body = retryBody.safeParse(request.body)
    if (!body.success) return reply.code(422).send(apiError("validation", "Escolha o painel que falhou."))
    if (!deps.render) return reply.code(503).send(apiError("generation_disabled", "A geração de imagens não está habilitada neste ambiente."))
    const render = deps.render
    return change(request, reply, async (user, id) => {
      const row = (await read(user, id))!
      // Double click: the panel is already running or ready, which is what was asked.
      const panel = row.panels.find((p) => p.panel === body.data.panel)
      if (panel && (panel.version_id || panel.job?.status === "queued" || panel.job?.status === "running")) return
      if (row.provider !== render.provider || row.model !== render.model || BigInt(row.reserve_usd_micros) < render.reserveMicros) throw new PrivateDatabaseError("rejected", "SA011")
      await deps.db.call("retry_outfit_panel", user, id, body.data.panel, deps.photoPolicyVersion, render.provider, render.model, render.reserveMicros.toString(), render.pilotId, body.data.acceptCharge === true)
        .catch((error: unknown) => { if (!(error instanceof PrivateDatabaseError && error.sqlState === "23505")) throw error; return read(user, id).then((now) => { if (!now?.panels.some((p) => p.panel === body.data.panel && (p.job?.status === "queued" || p.job?.status === "running"))) throw error }) })
    })
  })
  app.post<{ Params: { id: string } }>("/v1/studio/outfit-renders/:id/finalize", (request, reply) => change(request, reply, (user, id) => deps.db.call("finalize_outfit_render", user, id)))
  app.post<{ Params: { id: string } }>("/v1/studio/outfit-renders/:id/cancel", (request, reply) => change(request, reply, (user, id) => deps.db.call("cancel_outfit_render", user, id)))

  app.get<{ Params: { id: string } }>("/v1/media/comparisons/:id", async (request, reply) => {
    const q = mediaQuery.safeParse(request.query)
    const id = request.params.id
    if (!q.success || !uuid.safeParse(id).success || !verifyMediaSignature(deps.keys, "comparison", id, q.data.u, q.data.e, q.data.s)) {
      return reply.code(404).send(apiError("not_found", "Imagem não encontrada ou link expirado."))
    }
    try {
      const asset = assetRow.safeParse(await deps.db.call("read_comparison_asset", q.data.u, id))
      if (!asset.success) return reply.code(404).send(apiError("not_found", "Imagem não encontrada ou expirada."))
      const bytes = await deps.store.get(asset.data.bucket, asset.data.object_key)
      return reply.header("Content-Type", asset.data.mime).header("Cache-Control", "private, max-age=300")
        .header("Cross-Origin-Resource-Policy", "same-site").header("Referrer-Policy", "no-referrer").send(Buffer.from(bytes))
    } catch { return reply.code(503).send(apiError("service_unavailable", "Imagem temporariamente indisponível.")) }
  })
}
