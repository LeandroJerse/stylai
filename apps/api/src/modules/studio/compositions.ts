/**
 * Outfit composition (docs/decisions/2026-11-23-composicao-multipeca.md):
 *   POST /v1/studio/compositions { prompt, locked? }  -> interpretation -> candidates per slot -> agent selection
 *        (server-revalidated; explicit rules fallback) -> durable snapshot -> { id, slots, choices, generation }
 *   GET  /v1/studio/compositions/:id                  -> the durable snapshot (survives cache expiry/restart)
 * Generation is requested through POST /v1/studio/generations { compositionId, choices } (studio routes).
 * Store data (titles) never reaches the agent as instructions; ids are revalidated against what was retrieved.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import {
  apiError, colorTagsOf, COINS_PER_REQUEST, interpretCompositionRules, MAX_CANDIDATES_PER_SLOT, normalizeSlots, normalizeText, PILOT_SELLER_NAME,
  buildSlotQueries, requiresSelectionReview, selectCompositionRules, SLOT_LABEL, slotOfCategory,
  type CandidatesBySlot, type CatalogSourceMode, type CompositionCandidate, type CompositionChoice, type CompositionIntent, type LockedSlots, type SlotId,
} from "@stylai/contracts"
import type { AliExpressCatalogService } from "@stylai/commerce"
import type { Composer, InterpretationCache } from "@stylai/ai"
import { ComposerResponseError } from "@stylai/ai"
import type { PrivateDatabase } from "@stylai/supabase"
import { PrivateDatabaseError } from "@stylai/supabase"
import { parseCatalogPage, presentAliExpressProduct, presentProduct, type CatalogRow } from "../catalog/routes.js"

const uuid = z.string().uuid()
const slotId = z.enum(["upper", "lower", "dress", "outer"])
const body = z.object({
  prompt: z.string().max(500),
  locked: z.partialRecord(slotId, z.string().min(1).max(200)).optional(),
}).strict()

export interface CompositionDeps {
  db: PrivateDatabase<"api">
  resolveActor: (request: FastifyRequest) => Promise<string | null>
  catalogMode: CatalogSourceMode
  publicBaseUrl?: string
  aliexpressCatalog?: AliExpressCatalogService | null
  /** Null = no model configured: explicit deterministic fallback (labelled rules_fallback). */
  composer?: Composer | null
  /** Shared, hash-keyed interpretation cache (null = no reuse). */
  interpretationCache?: InterpretationCache | null
  /** Global (DB) budget for composer calls; false = use the rules fallback without calling the model. */
  acquireComposerCall?: () => Promise<boolean>
  /** Estimated provider cost per rendered layer (USD micros) from the versioned price table (fixed-price providers). */
  renderPricePerLayerMicros: bigint
  /** Worker render provider and its per-layer reservation: the real budget ceiling per layer (P04). */
  renderProvider?: "segmind" | "fal"
  reservePerLayerMicros?: bigint
  /** USD micros per million tokens of the composer model (null when unknown). */
  composerPrice?: { inputPerMTok: bigint; outputPerMTok: bigint } | null
  listCatalog?: () => Promise<CatalogRow[]>
}

type Presented = ReturnType<typeof presentProduct> | ReturnType<typeof presentAliExpressProduct>
interface SlotPlan {
  slot: SlotId
  label: string
  required: boolean
  candidates: (Presented & { slot: SlotId; generationEligible: boolean })[]
  choice: CompositionChoice | null
  error: string | null
}

export async function registerCompositionRoutes(app: FastifyInstance, deps: CompositionDeps) {
  const base = deps.publicBaseUrl ?? ""
  const source = deps.catalogMode === "aliexpress_affiliate" ? "aliexpress_affiliate" : deps.catalogMode === "tiktok_shop" ? "tiktok_shop" : "curated"

  const listLocal = deps.listCatalog ?? (async () => {
    const rows: CatalogRow[] = []
    for (let offset = 0; offset < 480; offset += 48) {
      const page = parseCatalogPage(await deps.db.call("list_catalog_products", 48, offset, null))
      rows.push(...page.items)
      if (page.items.length < 48 || rows.length >= page.total) break
    }
    return deps.catalogMode === "curated_pilot" ? rows.filter((r) => !r.fixture && r.partner?.name === PILOT_SELLER_NAME) : rows
  })

  const relevance = (intent: CompositionIntent, name: string) => {
    const n = normalizeText(name)
    const tags = colorTagsOf(name)
    return intent.colors.filter((c) => tags.includes(c)).length * 2 + intent.terms.filter((t) => n.includes(t)).length
      - intent.avoid.filter((a) => n.includes(a)).length * 5
  }

  async function retrieve(intent: CompositionIntent, viewer: string): Promise<Map<SlotId, Retrieved>> {
    const out = new Map<SlotId, Retrieved>()
    if (source === "aliexpress_affiliate") {
      // At most three bounded searches per slot, sequential; stop on success or provider unavailability.
      for (const { slot } of intent.slots) {
        const queries = buildSlotQueries(intent, slot)
        if (!deps.aliexpressCatalog) { out.set(slot, { candidates: [], error: "source_not_configured", query: queries[0]!, retrieval: null }); continue }
        const attempts: { query: string; outcome: RetrievalProvenance["outcome"]; returned: number; kept: number }[] = []
        for (const keywords of queries) {
        // Filter the provider's full bounded page before shrinking the candidate/model window.
        const res = await deps.aliexpressCatalog.search({ keywords, pageSize: 50, viewer })
        // P14: provenance (sanitized provider code/message and request id; never credentials or raw payloads).
        const provenance = (outcome: RetrievalProvenance["outcome"], kept: number): RetrievalProvenance => {
          attempts.push({ query: keywords, outcome, returned: res.items.length, kept })
          return {
          provider: "aliexpress", outcome, returned: res.items.length, kept, rejectedByNormalizer: res.rejectedCount,
          code: res.errorCode, kind: res.errorKind, requestId: res.requestId, message: res.errorMessage, fromCache: res.fromCache, attempts: [...attempts],
        } }
        if (res.state !== "ready") { out.set(slot, { candidates: [], error: "source_unavailable", query: keywords, retrieval: provenance("unavailable", 0) }); break }
        // P08: only items whose title maps to this slot's garment (uncategorized = e.g. shapewear, never a candidate).
        const items = res.items.filter((i) => slotOfCategory(i.category) === slot)
        if (!items.length) {
          out.set(slot, { candidates: [], error: "no_results", query: keywords, retrieval: provenance(res.items.length ? "filtered_out" : "provider_empty", 0) })
          continue
        }
        out.set(slot, { candidates: items.slice(0, MAX_CANDIDATES_PER_SLOT).map((i) => ({ ...presentAliExpressProduct(i), slot, generationEligible: false })), error: null, query: keywords, retrieval: provenance("ok", items.length) })
        break
        }
      }
      return out
    }
    if (source === "tiktok_shop") {
      for (const { slot } of intent.slots) out.set(slot, { candidates: [], error: "source_not_supported_for_composition", query: null, retrieval: null })
      return out
    }
    const rows = await listLocal()
    for (const { slot } of intent.slots) {
      const presented = rows.filter((r) => r.category && slotOfCategory(r.category.id) === slot).map((r) => presentProduct(r, base))
        .filter((p) => p.variants.some((v) => v.available) || p.availability !== "unavailable")
        .sort((a, b) => relevance(intent, b.name) - relevance(intent, a.name) || (a.price?.amount ?? Infinity) - (b.price?.amount ?? Infinity))
      out.set(slot, { candidates: presented.slice(0, MAX_CANDIDATES_PER_SLOT).map((p) => ({ ...p, slot, generationEligible: p.tryOnReady })), error: null, query: null,
        retrieval: { provider: "curated", outcome: presented.length ? "ok" : "provider_empty", returned: presented.length, kept: Math.min(presented.length, MAX_CANDIDATES_PER_SLOT), rejectedByNormalizer: 0, code: null, kind: null, requestId: null, message: null, fromCache: false } })
    }
    return out
  }

  async function lockedPiece(slot: SlotId, id: string): Promise<SlotPlan["candidates"][number] | null> {
    if (source === "aliexpress_affiliate") {
      const item = await deps.aliexpressCatalog?.findFresh(id)
      return item ? { ...presentAliExpressProduct(item), slot, generationEligible: false } : null
    }
    if (source !== "curated" || !uuid.safeParse(id).success) return null
    const raw = await deps.db.call("read_catalog_product", id)
    if (!raw) return null
    const row = parseCatalogPage({ total: 1, items: [raw] }).items[0]!
    if (!row.category || slotOfCategory(row.category.id) !== slot) return null
    if (deps.catalogMode === "curated_pilot" && (row.fixture || row.partner?.name !== PILOT_SELLER_NAME)) return null
    const p = presentProduct(row, base)
    return { ...p, slot, generationEligible: p.tryOnReady }
  }

  const toCandidate = (p: SlotPlan["candidates"][number]): CompositionCandidate => ({
    id: p.id, slot: p.slot, categoryId: p.category?.id ?? "", name: p.name,
    priceMinor: p.price ? Math.round(p.price.amount * 100) : null, colorTags: colorTagsOf(p.name), generationEligible: p.generationEligible,
  })
  const tokenCost = (usage: { inputTokens: number; outputTokens: number }[]) => {
    if (!deps.composerPrice || !usage.length) return null
    const inTok = usage.reduce((a, u) => a + u.inputTokens, 0), outTok = usage.reduce((a, u) => a + u.outputTokens, 0)
    return ((BigInt(inTok) * deps.composerPrice.inputPerMTok + BigInt(outTok) * deps.composerPrice.outputPerMTok) / 1_000_000n).toString()
  }

  function present(id: string, plan: z.infer<typeof planSchema>) {
    const chosen = plan.slots.map((s) => s.choice ? s.candidates.find((c) => c.id === s.choice!.productId) : null).filter((c): c is NonNullable<typeof c> => Boolean(c))
    const complete = chosen.length > 0 && plan.slots.every((s) => !s.required || s.choice !== null)
    const reviewRequired = requiresSelectionReview(plan)
    const eligible = complete && !reviewRequired && chosen.every((c) => c.generationEligible)
    return {
      id, composed: true, complete, source: plan.source, selectionMethod: plan.selectionMethod, model: plan.model, intent: plan.intent,
      stages: plan.stages ?? { interpretation: plan.interpretedBy, retrieval: "ok", selection: plan.selectionMethod },
      slots: plan.slots, totalPrice: plan.totalMinor === null ? null : { amount: plan.totalMinor / 100, currency: "BRL" },
      missingSlots: plan.missingSlots,
      generation: {
        eligible,
        blockedReason: eligible ? null : chosen.length === 0 ? "no_pieces" : !complete ? "composition_incomplete" : reviewRequired ? "selection_review_required" : "ai_image_rights_unconfirmed",
        layers: chosen.length,
        render: chosen.length > 1 ? "sequential_layers_unverified" : "single_garment",
        provider: deps.renderProvider ?? "fal",
        // Segmind bills per GPU-second (no fixed price before the call): only the reservation ceiling is known.
        estimatedProviderUsd: (deps.renderProvider ?? "fal") === "segmind" ? null : Number(BigInt(chosen.length) * deps.renderPricePerLayerMicros) / 1_000_000,
        reservePerLayerUsd: Number(deps.reservePerLayerMicros ?? deps.renderPricePerLayerMicros) / 1_000_000,
        maxReservedUsd: Number(BigInt(chosen.length) * (deps.reservePerLayerMicros ?? deps.renderPricePerLayerMicros)) / 1_000_000,
        budgetNote: "O orçamento é conferido para TODAS as camadas antes da primeira; se não couber, nada é enviado ao provador.",
        coins: COINS_PER_REQUEST,
        coinsNote: "Preço provisório: uma composição consome um pedido diário (10 moedas) até decisão comercial por camada.",
      },
      agentCost: plan.agentCostMicros === null ? null : { estimatedUsd: Number(plan.agentCostMicros) / 1_000_000, source: "computed_from_usage" },
      createdAt: plan.createdAt,
    }
  }

  async function actor(request: FastifyRequest, reply: FastifyReply) {
    const id = await deps.resolveActor(request)
    if (!id) { await reply.code(401).send(apiError("unauthorized", "Entre na sua conta para usar o Estúdio.")); return null }
    return id
  }

  app.post("/v1/studio/compositions", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const input = body.safeParse(request.body)
    if (!input.success || !input.data.prompt.trim()) return reply.code(422).send(apiError("validation", "Descreva o look: peças, ocasião, cores ou orçamento total."))
    const locked: LockedSlots = input.data.locked ?? {}
    try {
      // Before ANY paid model call: the per-person daily composition limit.
      if (!(await deps.db.call("composition_quota_available", user))) {
        return reply.code(429).send(apiError("composition_limit", "Você atingiu o limite diário de looks montados. Tente amanhã."))
      }
      const usage: { inputTokens: number; outputTokens: number }[] = []
      let intent: CompositionIntent
      let interpretedBy: "agent" | "rules_fallback" = "rules_fallback"
      try {
        if (!deps.composer) throw new Error("no_composer")
        const acquire = deps.acquireComposerCall ?? (async () => true)
        // Shared interpretation cache (same as the simple search): quota only on a miss.
        const r = deps.interpretationCache
          ? await deps.interpretationCache.interpret(deps.composer, input.data.prompt, acquire)
          : await (async () => { if (!(await acquire())) throw new Error("composer_budget"); return await deps.composer!.interpret(input.data.prompt) })()
        intent = r.intent; if (r.usage) usage.push(r.usage); interpretedBy = "agent"
      } catch (error) {
        if (error instanceof ComposerResponseError) usage.push(error.usage)
        if (deps.composer) request.log.warn({ stage: "interpret", reason: error instanceof Error ? error.message.slice(0, 40) : "unknown" }, "composer fallback")
        intent = interpretCompositionRules(input.data.prompt)
      }
      // Locked pieces win slot conflicts (a locked dress replaces top/bottom and vice versa), then the contract limits apply.
      const lockedSlots = Object.keys(locked) as SlotId[]
      const conflicts = (s: SlotId) => (lockedSlots.includes("dress") && (s === "upper" || s === "lower")) || ((lockedSlots.includes("upper") || lockedSlots.includes("lower")) && s === "dress")
      intent.slots = normalizeSlots([...lockedSlots.map((slot) => ({ slot, required: true })), ...intent.slots.filter((s) => !lockedSlots.includes(s.slot) && !conflicts(s.slot))])

      const retrieved = await retrieve(intent, user)
      // A locked piece outside the new top candidates is re-read and kept; gone = explicit error, never a silent swap.
      for (const slot of lockedSlots) {
        const entry = retrieved.get(slot)
        if (!entry || entry.candidates.some((c) => c.id === locked[slot])) continue
        const piece = await lockedPiece(slot, locked[slot]!)
        if (!piece) return reply.code(409).send(apiError("lock_unavailable", `A peça travada em "${SLOT_LABEL[slot]}" não está mais disponível. Destrave ou escolha outra.`))
        entry.candidates.unshift(piece)
      }
      // P07: explicit stages; no candidates = no look (nothing persisted, nothing claimed).
      const entries = [...retrieved.values()]
      const anyCandidates = entries.some((r) => r.candidates.length > 0)
      const failedSlots = entries.filter((r) => r.error && r.error !== "no_results").length
      const retrieval = !anyCandidates ? (failedSlots ? "failed" : "empty") : entries.some((r) => r.candidates.length === 0) ? "partial" : "ok"
      if (!anyCandidates) {
        return reply.code(failedSlots ? 503 : 200).send({
          composed: false, id: null, source,
          stages: { interpretation: interpretedBy, retrieval, selection: "not_run" },
          model: interpretedBy === "agent" ? deps.composer?.model ?? null : null,
          // P14: the validated intent and each slot's effective query + provenance make an empty answer diagnosable.
          intent: observableIntent(intent),
          slots: intent.slots.map(({ slot }) => ({ slot, label: SLOT_LABEL[slot], candidates: [], choice: null, error: retrieved.get(slot)?.error ?? null,
            query: retrieved.get(slot)?.query ?? null, retrieval: retrieved.get(slot)?.retrieval ?? null })),
          agentCost: tokenCost(usage) === null ? null : { estimatedUsd: Number(tokenCost(usage)) / 1_000_000, source: "computed_from_usage" },
          message: failedSlots
            ? "A busca de lojas não respondeu; nenhum look foi montado e nada foi gravado."
            : "Não encontramos peças compatíveis para este pedido; nenhum look foi montado. Tente descrever de outro jeito.",
        })
      }
      const bySlot: CandidatesBySlot = Object.fromEntries([...retrieved].map(([slot, r]) => [slot, r.candidates.map(toCandidate)]))
      let choices: CompositionChoice[] = []
      let method: "agent" | "rules_fallback" = "rules_fallback"
      if (deps.composer && interpretedBy === "agent" && [...retrieved.values()].some((r) => r.candidates.length)) {
        try {
          if (deps.acquireComposerCall && !(await deps.acquireComposerCall())) throw new Error("composer_budget")
          const selected = await deps.composer.select(intent, bySlot, locked)
          usage.push(selected.usage)
          // A valid agent answer is final, including explicit abstentions: the rules never re-introduce a piece the agent rejected.
          if (selected.ok) { choices = selected.choices; method = "agent" }
          else request.log.warn({ stage: "select", errors: selected.errors.slice(0, 5) }, "composer selection rejected by server validation")
        } catch (error) {
          if (error instanceof ComposerResponseError) usage.push(error.usage)
          request.log.warn({ stage: "select", reason: error instanceof Error ? error.message.slice(0, 40) : "unknown" }, "composer fallback")
        }
      }
      const rules = selectCompositionRules(intent, bySlot, locked)
      if (method !== "agent") choices = rules.choices
      const priceOf = (c: CompositionChoice) => bySlot[c.slot]?.find((x) => x.id === c.productId)?.priceMinor ?? null
      const prices = choices.map(priceOf)
      const plan = {
        selectionReviewRequired: Boolean(deps.composer) && method !== "agent",
        source, selectionMethod: method, interpretedBy, model: method === "agent" || interpretedBy === "agent" ? deps.composer?.model ?? null : null,
        intent,
        slots: intent.slots.map(({ slot, required }) => ({
          slot, label: SLOT_LABEL[slot], required, candidates: retrieved.get(slot)?.candidates ?? [],
          choice: choices.find((c) => c.slot === slot) ?? null, error: retrieved.get(slot)?.error ?? null,
          query: retrieved.get(slot)?.query ?? null, retrieval: retrieved.get(slot)?.retrieval ?? null,
        })),
        totalMinor: choices.length && prices.every((p) => p !== null) ? prices.reduce<number>((a, b) => a + (b ?? 0), 0) : null,
        missingSlots: intent.slots.filter((s) => !choices.some((c) => c.slot === s.slot)).map((s) => s.slot),
        agentCostMicros: tokenCost(usage),
        stages: { interpretation: interpretedBy, retrieval, selection: method },
        createdAt: new Date().toISOString(),
      }
      const id = await deps.db.call("save_look_composition", user, source, method, plan.model, JSON.parse(JSON.stringify(plan)))
      return reply.code(201).send(present(id, planSchema.parse(plan)))
    } catch (error) {
      if (error instanceof PrivateDatabaseError && error.sqlState === "23514") {
        return reply.code(429).send(apiError("composition_limit", "Você atingiu o limite diário de looks montados. Tente amanhã."))
      }
      request.log.warn({ stage: "composition", reason: error instanceof Error ? error.name : "unknown" }, "composition failed")
      return reply.code(503).send(apiError("service_unavailable", "Não foi possível montar a composição agora. Nenhuma moeda foi usada."))
    }
  })

  app.get<{ Params: { id: string } }>("/v1/studio/compositions/:id", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return reply.code(404).send(apiError("not_found", "Composição não encontrada."))
    try {
      const raw = z.object({ id: uuid, plan: planSchema }).nullable().parse(await deps.db.call("read_look_composition", user, request.params.id))
      if (!raw) return reply.code(404).send(apiError("not_found", "Composição não encontrada."))
      return present(raw.id, raw.plan)
    } catch {
      return reply.code(503).send(apiError("service_unavailable", "Composição temporariamente indisponível."))
    }
  })
}

interface RetrievalProvenance {
  attempts?: { query: string; outcome: RetrievalProvenance["outcome"]; returned: number; kept: number }[]
  provider: "aliexpress" | "curated"
  /** ok | provider_empty (store answered nothing) | filtered_out (store answered, nothing mapped to the slot) | unavailable */
  outcome: "ok" | "provider_empty" | "filtered_out" | "unavailable"
  returned: number
  kept: number
  rejectedByNormalizer: number
  code: string | null
  kind: string | null
  requestId: string | null
  /** Sanitized provider resp_msg (client allow-list). */
  message: string | null
  fromCache: boolean
}
interface Retrieved { candidates: SlotPlan["candidates"]; error: string | null; query: string | null; retrieval: RetrievalProvenance | null }
/** P14: the validated intent, reduced to what explains the search (no free text from the person beyond the plan). */
const observableIntent = (intent: CompositionIntent) => ({
  audience: intent.audience ?? null, style: intent.style ?? [], occasion: intent.occasion, colors: intent.colors,
  budgetTotalBrl: intent.budgetTotalBrl, budgetMode: intent.budgetMode, avoid: intent.avoid,
  slots: intent.slots.map((s) => ({ slot: s.slot, required: s.required, query: s.query ?? null, color: s.color ?? null })),
})

const candidateSchema = z.object({ id: z.string(), slot: slotId, generationEligible: z.boolean() }).passthrough()
const planSchema = z.object({
  selectionReviewRequired: z.boolean().optional(),
  source: z.string(), selectionMethod: z.enum(["agent", "rules_fallback"]), interpretedBy: z.enum(["agent", "rules_fallback"]),
  model: z.string().nullable(), intent: z.unknown(),
  slots: z.array(z.object({ slot: slotId, label: z.string(), required: z.boolean(), candidates: z.array(candidateSchema),
    choice: z.object({ slot: slotId, productId: z.string(), reason: z.string() }).nullable(), error: z.string().nullable(),
    query: z.string().nullable().optional(), retrieval: z.unknown().optional() })),
  totalMinor: z.number().nullable(), missingSlots: z.array(slotId), agentCostMicros: z.string().nullable(), createdAt: z.string(),
  stages: z.object({ interpretation: z.string(), retrieval: z.string(), selection: z.string() }).optional(),
})
