/**
 * Search step of the Estúdio ("Procurar"): request + preferences -> criteria -> candidates from the
 * CURATED catalog. It runs before any generation and never claims to be a live store search.
 *   POST /v1/studio/searches { prompt, rules? } -> { source, interpretation, items: Candidate[], total }
 * Interpretation is rule-based (no AI call). The catalog source is the published curated catalog
 * (private.list_catalog_products); a supplier adapter can later feed the same tables.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { apiError, searchCatalog } from "@stylai/contracts"
import type { PrivateDatabase } from "@stylai/supabase"
import { presentProduct, type CatalogRow } from "./routes.js"

const body = z.object({
  prompt: z.string().max(500),
  productIds: z.array(z.string().uuid()).max(6).optional(),
  preferenceId: z.string().nullable().optional(),
  rules: z.object({ budget: z.object({ value: z.number().nonnegative(), mode: z.enum(["require", "prefer", "off"]) }).partial().passthrough().optional() }).passthrough().nullable().optional(),
  mode: z.string().optional(),
}).passthrough()

/** Above this, the request cannot be answered from one page of the curated catalog. */
const CATALOG_SCAN_LIMIT = 48

export interface SearchDeps {
  db: PrivateDatabase<"api">
  resolveActor: (request: FastifyRequest) => Promise<string | null>
  /** Reads the curated catalog rows (injectable for tests). */
  listCatalog?: () => Promise<CatalogRow[]>
  publicBaseUrl?: string
}

export async function registerSearchRoutes(app: FastifyInstance, deps: SearchDeps, parseRows: (raw: unknown) => { total: number; items: CatalogRow[] }) {
  const list = deps.listCatalog ?? (async () => parseRows(await deps.db.call("list_catalog_products", CATALOG_SCAN_LIMIT, 0, null)).items)

  app.post("/v1/studio/searches", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!(await deps.resolveActor(request))) return reply.code(401).send(apiError("unauthorized", "Entre na sua conta para usar o Estúdio."))
    const input = body.safeParse(request.body)
    if (!input.success || !input.data.prompt.trim()) return reply.code(422).send({ error: { code: "validation", message: "Diga o que você procura, por exemplo a peça, a cor ou o orçamento.", fields: { prompt: "Descreva o que procura." } } })
    let rows: CatalogRow[]
    try { rows = await list() } catch { return reply.code(503).send(apiError("service_unavailable", "Catálogo temporariamente indisponível.")) }

    // Same rules as the demo adapter (packages/contracts/src/search-rules.ts).
    const presented = new Map(rows.map((row) => [row.id, presentProduct(row, deps.publicBaseUrl ?? "")]))
    const result = searchCatalog(input.data.prompt, rows.map((row) => {
      const p = presented.get(row.id)!
      return { id: row.id, name: row.name, category: row.category, priceMinor: row.price_minor, hasAvailableVariant: p.variants.some((v) => v.available), tryOnReady: p.tryOnReady }
    }), input.data.rules?.budget ?? null)

    return {
      source: "curated_catalog",
      catalog: "test_catalog",
      interpretation: result.interpretation,
      items: result.items.map(({ id, failed }) => ({ product: presented.get(id)!, usedInLook: false, failed })),
      total: result.items.length,
      scanned: rows.length,
      truncated: rows.length >= CATALOG_SCAN_LIMIT,
    }
  })
}
