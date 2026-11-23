/**
 * Search step of the Estúdio ("Procurar"): request + preferences -> criteria -> candidates from the
 * CURATED catalog. It runs before any generation and never claims to be a live store search.
 *   POST /v1/studio/searches { prompt, rules? } -> { source, interpretation, items: Candidate[], total }
 * Interpretation is rule-based (no AI call). The catalog source is the published curated catalog
 * (private.list_catalog_products); a supplier adapter can later feed the same tables.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { apiError, buildSlotQuery, interpretCompositionRules, PILOT_SELLER_NAME, searchCatalog, type CatalogSourceMode, type CompositionIntent } from "@stylai/contracts"
import type { ComposerUsage, InterpretationCache, OutfitAgent } from "@stylai/ai"
import type { AliExpressCatalogService, TikTokCatalogCache } from "@stylai/commerce"
import type { PrivateDatabase } from "@stylai/supabase"
import { presentAliExpressProduct, presentProduct, presentTikTokProduct, type CatalogRow } from "./routes.js"

const body = z.object({
  prompt: z.string().max(500),
  productIds: z.array(z.string().uuid()).max(6).optional(),
  preferenceId: z.string().nullable().optional(),
  rules: z.object({ budget: z.object({ value: z.number().nonnegative(), mode: z.enum(["require", "prefer", "off"]) }).partial().passthrough().optional() }).passthrough().nullable().optional(),
  cursor: z.string().max(512).nullable().optional(),
  mode: z.string().optional(),
}).passthrough()

const PAGE_SCAN_SIZE = 48
const MAX_LOCAL_SCAN_ITEMS = 480

export interface SearchDeps {
  db: PrivateDatabase<"api">
  resolveActor: (request: FastifyRequest) => Promise<string | null>
  /** Reads the curated catalog rows (injectable for tests). */
  listCatalog?: () => Promise<CatalogRow[]>
  publicBaseUrl?: string
  pilotOnly?: boolean
  catalogMode?: CatalogSourceMode
  tiktokCache?: TikTokCatalogCache | null
  aliexpressCatalog?: AliExpressCatalogService | null
  /** Cheap interpretation agent (Haiku by default) turning the request into a store query; null = rules (P10). */
  agent?: OutfitAgent | null
  interpretationCache?: InterpretationCache | null
  /** Global DB call budget for the agent; false = rules, no model call. */
  acquireAgentCall?: () => Promise<boolean>
  /** USD micros per million tokens of the agent model (null = cost not computable). */
  agentPrice?: { inputPerMTok: bigint; outputPerMTok: bigint } | null
}

/** Request -> ONE store query: agent (cached) when available, otherwise deterministic rules. Never raw prompt text. */
async function storeQuery(deps: SearchDeps, prompt: string, log: FastifyRequest["log"]) {
  let intent: CompositionIntent | null = null
  let usage: ComposerUsage | null = null
  let cached = false
  if (deps.agent) {
    try {
      // Quota is consumed only on a cache miss, right before the paid call (hits are free and survive an exhausted quota).
      const acquire = deps.acquireAgentCall ?? (async () => true)
      const r = deps.interpretationCache
        ? await deps.interpretationCache.interpret(deps.agent, prompt, acquire)
        : await (async () => { if (!(await acquire())) throw new Error("agent_budget"); return { ...(await deps.agent!.interpret(prompt)), cached: false } })()
      intent = r.intent; usage = r.usage; cached = r.cached
    } catch (error) {
      log.warn({ stage: "search_interpret", reason: error instanceof Error ? error.message.slice(0, 40) : "unknown" }, "search agent fallback")
    }
  }
  const interpretedBy = intent ? "agent" as const : "rules" as const
  const finalIntent = intent ?? interpretCompositionRules(prompt)
  const slot = finalIntent.slots.find((s) => s.query)?.slot ?? finalIntent.slots[0]!.slot
  const micros = usage && deps.agentPrice
    ? (BigInt(usage.inputTokens) * deps.agentPrice.inputPerMTok + BigInt(usage.outputTokens) * deps.agentPrice.outputPerMTok) / 1_000_000n
    : usage ? null : 0n
  return {
    keywords: buildSlotQuery(finalIntent, slot), slot, interpretedBy,
    model: interpretedBy === "agent" ? deps.agent!.model : null,
    cached, usage, estimatedUsd: micros === null ? null : Number(micros) / 1_000_000,
  }
}

const retryAfterSeconds = (until: string | null) => (until ? Math.max(1, Math.ceil((Date.parse(until) - Date.now()) / 1000)) : 30)

/** Transparent failure: provider, sanitized code and request id; never products, never a synthetic substitute. */
export function providerUnavailable(ae: { state: string; errorKind: string | null; errorCode: string | null; requestId: string | null; backoffUntil: string | null }) {
  const retry = retryAfterSeconds(ae.backoffUntil)
  const reason = ae.state === "not_configured" ? "a busca no AliExpress não está configurada neste servidor"
    : ae.errorKind === "business_error" ? `o AliExpress respondeu com erro de negócio (código ${ae.errorCode ?? "?"} do provedor; significado não documentado)`
    : ae.errorKind === "rate_limited" ? "o limite de chamadas ao AliExpress foi atingido"
    : "o AliExpress não respondeu de forma utilizável"
  return {
    error: {
      code: "source_unavailable",
      message: `Busca de lojas indisponível: ${reason}. Nenhum catálogo sintético foi usado no lugar. Tente de novo em ${retry} s.`,
      provider: { name: "aliexpress", kind: ae.errorKind, code: ae.errorCode, requestId: ae.requestId, retryAfterSeconds: retry },
    },
  }
}

/** Small page on purpose: every new search is a real provider call (plus one link.generate). */
const ALIEXPRESS_PAGE_SIZE = 5

export async function registerSearchRoutes(app: FastifyInstance, deps: SearchDeps, parseRows: (raw: unknown) => { total: number; items: CatalogRow[] }) {
  const catalogMode: CatalogSourceMode = deps.catalogMode ?? (deps.pilotOnly ? "curated_pilot" : "test_catalog")
  const pilotOnly = catalogMode === "curated_pilot"

  const listAllLocal = deps.listCatalog ?? (async () => {
    const collected: CatalogRow[] = []
    for (let offset = 0; offset < MAX_LOCAL_SCAN_ITEMS; offset += PAGE_SCAN_SIZE) {
      const page = parseRows(await deps.db.call("list_catalog_products", PAGE_SCAN_SIZE, offset, null))
      collected.push(...page.items)
      if (page.items.length < PAGE_SCAN_SIZE || collected.length >= page.total) break
    }
    return pilotOnly ? collected.filter((r) => !r.fixture && r.partner?.name === PILOT_SELLER_NAME) : collected
  })

  app.post("/v1/studio/searches", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const viewer = await deps.resolveActor(request)
    if (!viewer) return reply.code(401).send(apiError("unauthorized", "Entre na sua conta para usar o Estúdio."))
    const input = body.safeParse(request.body)
    if (!input.success || !input.data.prompt.trim()) return reply.code(422).send({ error: { code: "validation", message: "Diga o que você procura, por exemplo a peça, a cor ou o orçamento.", fields: { prompt: "Descreva o que procura." } } })

    if (catalogMode === "aliexpress_affiliate") {
      if (!deps.aliexpressCatalog) {
        return reply.code(503).send(apiError("service_unavailable", "Busca AliExpress não configurada no servidor. Nenhum catálogo sintético foi usado como substituto."))
      }
      const query = await storeQuery(deps, input.data.prompt, request.log)
      const keywords = query.keywords
      let ae: Awaited<ReturnType<AliExpressCatalogService["search"]>>
      try { ae = await deps.aliexpressCatalog.search({ keywords, pageSize: ALIEXPRESS_PAGE_SIZE, viewer }) }
      catch { return reply.code(503).send(apiError("service_unavailable", "Busca no AliExpress temporariamente indisponível. Nenhum catálogo sintético foi usado como substituto.")) }
      if (ae.state !== "ready") {
        request.log.warn({ provider: "aliexpress", state: ae.state, errorKind: ae.errorKind, errorCode: ae.errorCode, providerMessage: ae.errorMessage,
          requestId: ae.requestId, backoffUntil: ae.backoffUntil, fromCache: ae.fromCache }, "aliexpress search unavailable")
        return reply.code(503).header("Retry-After", String(retryAfterSeconds(ae.backoffUntil))).send(providerUnavailable(ae))
      }
      return {
        source: "aliexpress_affiliate",
        catalog: "aliexpress_affiliate",
        sourceState: ae.state,
        // How the request became a store query (transparent: agent vs rules, model, tokens, cost, cache).
        query,
        // Honest empty: the provider itself reported no result (resp_code 405 "The result is empty").
        emptyReason: ae.emptyReason,
        ...(ae.emptyReason ? { provider: { name: "aliexpress", code: ae.errorCode, requestId: ae.requestId } } : {}),
        observedAt: ae.observedAt,
        expiresAt: ae.expiresAt,
        fromCache: ae.fromCache,
        nextCursor: null,
        // Affiliate link state, kept apart from product display: "generated" | "missing_tracking_id" | "failed".
        links: ae.links,
        interpretation: { category: null, color: null, budget: null, terms: keywords.split(" ") },
        items: ae.items.map((item) => ({
          product: presentAliExpressProduct(item),
          usedInLook: false,
          failed: ["Sem imagem liberada para prova", "Sem variante/tamanho confirmado"],
        })),
        total: ae.items.length,
        scanned: ae.items.length + ae.rejectedCount,
        truncated: false,
      }
    }

    if (catalogMode === "tiktok_shop") {
      if (!deps.tiktokCache) {
        return reply.code(503).send(apiError("service_unavailable", "Busca TikTok Shop não configurada no servidor. Nenhum catálogo sintético foi usado como substituto."))
      }
      const keywords = input.data.prompt.trim().split(/\s+/).filter(Boolean).slice(0, 20)
      const budgetMax = input.data.rules?.budget?.mode === "require" && typeof input.data.rules.budget.value === "number"
        ? input.data.rules.budget.value.toFixed(2)
        : null
      const tt = await deps.tiktokCache.search({
        keywords,
        pageSize: 20,
        pageToken: input.data.cursor ?? null,
        salesPriceMaxBrl: budgetMax,
      })
      if (tt.state !== "ready") {
        const msg = tt.state === "authorization_required"
          ? "Autorização de criador no TikTok Shop ausente ou expirada. Reconecte a conta autorizada no Brasil."
          : tt.state === "scope_missing"
            ? "O token do TikTok Shop não possui a permissão creator.affiliate_collaboration.read."
            : "Busca no TikTok Shop temporariamente indisponível. Nenhum catálogo sintético foi usado como substituto."
        return reply.code(503).send(apiError("service_unavailable", msg))
      }
      return {
        source: "tiktok_shop",
        catalog: "tiktok_shop",
        sourceState: tt.state,
        observedAt: tt.observedAt,
        expiresAt: tt.expiresAt,
        fromCache: tt.fromCache,
        nextCursor: tt.nextCursor,
        interpretation: { category: null, color: null, budget: null, terms: keywords },
        items: tt.items.map((item) => ({
          product: presentTikTokProduct(item),
          usedInLook: false,
          // Explicit separation: discovery/display/link is allowed; AI try-on is blocked until rights + variants exist.
          failed: [
            "Sem imagem liberada para prova",
            "Sem variante/tamanho confirmado",
          ],
        })),
        total: tt.items.length,
        scanned: tt.items.length + tt.rejectedCount,
        truncated: Boolean(tt.nextCursor),
      }
    }

    let rows: CatalogRow[]
    try { rows = await listAllLocal() } catch { return reply.code(503).send(apiError("service_unavailable", "Catálogo temporariamente indisponível.")) }

    // Same rules as the demo adapter (packages/contracts/src/search-rules.ts).
    const presented = new Map(rows.map((row) => [row.id, presentProduct(row, deps.publicBaseUrl ?? "")]))
    const result = searchCatalog(input.data.prompt, rows.map((row) => {
      const p = presented.get(row.id)!
      return { id: row.id, name: row.name, category: row.category, priceMinor: row.price_minor, hasAvailableVariant: p.variants.some((v) => v.available), tryOnReady: p.tryOnReady }
    }), input.data.rules?.budget ?? null)

    return {
      source: "curated_catalog",
      catalog: pilotOnly ? "curated_pilot" : "test_catalog",
      interpretation: result.interpretation,
      items: result.items.map(({ id, failed }) => ({ product: presented.get(id)!, usedInLook: false, failed })),
      total: result.items.length,
      scanned: rows.length,
      truncated: rows.length >= MAX_LOCAL_SCAN_ITEMS,
    }
  })
}
