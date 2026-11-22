/**
 * Curated catalog reads (docs/API-CONTRACT.md §4). The data source is the
 * reviewed catalog in Postgres; a real supplier adapter can later fill the
 * same tables without touching try-on code. No stock, price freshness, link
 * verification or rating is invented: unknown stays null.
 *   GET /v1/catalog/products?category=&cursor=&limit=  · GET /v1/catalog/products/:id
 *   GET /v1/catalog/facets · GET /v1/explore/hero
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { apiError, isTestImageUrl, TEST_CATALOG_CAPABILITIES, TEST_CATALOG_IMAGES, TEST_IMAGE_ORIGIN } from "@stylai/contracts"
import { PrivateDatabaseError, type PrivateDatabase } from "@stylai/supabase"

const productRow = z.object({
  id: z.string().uuid(), name: z.string(), price_minor: z.number().int().nullable(), currency: z.string(),
  availability: z.enum(["available", "partial", "unavailable", "unknown"]), source_updated_at: z.string().nullable(),
  product_url: z.string().nullable(), fixture: z.boolean(), created_at: z.string(),
  category: z.object({ id: z.string(), label: z.string() }).nullable(),
  partner: z.object({ id: z.string().uuid(), name: z.string(), source: z.string() }).nullable(),
  variants: z.array(z.object({ id: z.string().uuid(), label: z.string(), available: z.boolean().nullable() })),
  images: z.array(z.object({ url: z.string(), alt: z.string().nullable(), position: z.number().int(), try_on_allowed: z.boolean() })),
})
export type CatalogRow = z.infer<typeof productRow>
const pageRow = z.object({ total: z.number().int(), items: z.array(productRow) })
export const parseCatalogPage = (raw: unknown) => pageRow.parse(raw)

/** Test-catalog images are stored under a reserved host and served by this API for display. */
export function displayImageUrl(url: string, publicBaseUrl: string): string {
  return isTestImageUrl(url) ? `${publicBaseUrl.replace(/\/+$/, "")}/catalog/test-images/${url.slice(TEST_IMAGE_ORIGIN.length)}` : url
}
const TEST_IMAGE_DIR = fileURLToPath(new URL("../../../../../packages/contracts/assets/test-catalog/", import.meta.url))

/** Front `Product` shape plus slice fields (variant ids, fixture flag, try-on readiness). */
export function presentProduct(p: CatalogRow, publicBaseUrl = "") {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    partner: p.partner ? { id: p.partner.id, name: p.partner.name } : { id: "unknown", name: "Loja não informada" },
    source: p.partner?.source ?? null,
    price: p.price_minor === null ? null : { amount: p.price_minor / 100, currency: p.currency },
    images: p.images.map((i) => ({ url: displayImageUrl(i.url, publicBaseUrl), width: 600, height: 800, alt: i.alt ?? p.name, focus: null })),
    rating: null, reviewsCount: null, sellerRating: null,
    variants: p.variants.map((v) => ({ id: v.id, label: v.label, available: v.available === true })),
    availability: p.availability,
    material: null, color: null, fit: null, deliveryDays: null, measurements: [], styles: [],
    updatedAt: p.source_updated_at,
    links: { productUrl: p.product_url, affiliateUrl: null },
    favorite: false,
    fixture: p.fixture,
    // Explicit about what the source does NOT provide (never guessed).
    stockConfirmed: false,
    priceKind: p.price_minor === null ? "none" : p.fixture ? "test_price" : "observed",
    tryOnReady: p.images.some((i) => i.try_on_allowed) && p.variants.some((v) => v.available === true),
  }
}

const listQuery = z.object({
  category: z.string().max(64).optional(),
  cursor: z.string().regex(/^\d{1,5}$/).optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
}).passthrough()

export async function registerCatalogRoutes(app: FastifyInstance, deps: { db: PrivateDatabase<"api">; publicBaseUrl?: string }) {
  const base = deps.publicBaseUrl ?? ""
  const failure = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PrivateDatabaseError) app.log.warn({ outcome: error.outcome, sqlState: error.sqlState }, "catalog read failed")
    return reply.code(503).send(apiError("service_unavailable", "Catálogo temporariamente indisponível."))
  }

  app.get("/v1/catalog/products", async (request, reply) => {
    const q = listQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send(apiError("validation", "Filtro inválido."))
    const limit = q.data.limit ?? 24
    const offset = Number(q.data.cursor ?? 0)
    try {
      const page = z.object({ total: z.number().int(), items: z.array(productRow) }).parse(await deps.db.call("list_catalog_products", limit, offset, q.data.category ?? null))
      const next = offset + page.items.length
      return { items: page.items.map((row) => presentProduct(row, base)), nextCursor: next < page.total ? String(next) : null, total: page.total }
    } catch (error) { return failure(reply, error) }
  })

  app.get<{ Params: { id: string } }>("/v1/catalog/products/:id", async (request, reply) => {
    if (!z.string().uuid().safeParse(request.params.id).success) return reply.code(404).send(apiError("not_found", "Peça não encontrada."))
    try {
      const raw = await deps.db.call("read_catalog_product", request.params.id)
      if (!raw) return reply.code(404).send(apiError("not_found", "Peça não encontrada."))
      return presentProduct(productRow.parse(raw), base)
    } catch (error) { return failure(reply, error) }
  })

  app.get("/v1/catalog/facets", async (_request, reply) => {
    try {
      const f = z.object({
        total: z.number().int(),
        categories: z.array(z.object({ id: z.string(), label: z.string(), count: z.number().int() })),
        partners: z.array(z.object({ id: z.string(), label: z.string(), count: z.number().int() })),
      }).parse(await deps.db.call("catalog_facets"))
      return { categories: f.categories, partners: f.partners, priceRange: null, total: f.total }
    } catch (error) { return failure(reply, error) }
  })

  // Which source feeds the catalog and what it really provides (the front hides the rest).
  app.get("/v1/catalog/source", async () => ({ id: "test_catalog", label: "Catálogo de teste (dados sintéticos)", capabilities: TEST_CATALOG_CAPABILITIES }))

  // Own synthetic illustrations of the test catalog (allow-listed names only).
  const allowed = new Set(TEST_CATALOG_IMAGES)
  app.get<{ Params: { "*": string } }>("/v1/catalog/test-images/*", async (request, reply) => {
    const name = request.params["*"]
    if (!allowed.has(name)) return reply.code(404).send(apiError("not_found", "Imagem não encontrada."))
    try {
      const bytes = await readFile(TEST_IMAGE_DIR + name)
      return reply.header("Content-Type", "image/png").header("Cache-Control", "public, max-age=3600").header("Cross-Origin-Resource-Policy", "same-site").send(bytes)
    } catch { return reply.code(404).send(apiError("not_found", "Imagem não encontrada.")) }
  })

  // No editorial hero yet: an honest empty answer instead of a made-up highlight.
  app.get("/v1/explore/hero", async () => ({ hero: null }))
}
