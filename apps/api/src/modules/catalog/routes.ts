/**
 * Curated catalog reads (docs/API-CONTRACT.md §4). The data source is the
 * reviewed catalog in Postgres; a real supplier adapter can later fill the
 * same tables without touching try-on code. No stock, price freshness, link
 * verification or rating is invented: unknown stays null.
 *   GET /v1/catalog/products?category=&cursor=&limit=  · GET /v1/catalog/products/:id
 *   GET /v1/catalog/facets · GET /v1/explore/hero
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import {
  apiError, isTestImageUrl, PILOT_SELLER_NAME, TEST_CATALOG_CAPABILITIES, TEST_CATALOG_IMAGES, TEST_IMAGE_ORIGIN,
  type CatalogSourceMode,
} from "@stylai/contracts"
import {
  ALIEXPRESS_AFFILIATE_CATALOG_CAPABILITIES, TIKTOK_CREATOR_CATALOG_CAPABILITIES,
  type AliExpressCatalogService, type NormalizedAliExpressCatalogItem, type NormalizedTikTokCatalogItem, type TikTokCatalogCache,
} from "@stylai/commerce"
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

/** Presents a normalized TikTok Shop Creator discovery item (explicitly separating display/link from AI try-on). */
export function presentTikTokProduct(item: NormalizedTikTokCatalogItem) {
  return {
    id: item.canonicalKey,
    externalId: item.externalProductId,
    name: item.name,
    category: { id: item.category, label: item.categoryLabel },
    partner: { id: item.seller, name: item.sellerName },
    source: item.source,
    region: item.region,
    price: item.priceMinor === null ? null : { amount: item.priceMinor / 100, currency: item.currency },
    priceRange: item.priceRangeMinor === null ? null : { min: item.priceRangeMinor.min / 100, max: item.priceRangeMinor.max / 100, currency: item.currency },
    images: [{ url: item.image, width: 600, height: 800, alt: item.name, focus: null }],
    rating: null, reviewsCount: null, sellerRating: null,
    variants: [],
    availability: item.hasInventorySignal === false ? "unavailable" as const : "unknown" as const,
    material: null, color: item.color, fit: null, deliveryDays: null, measurements: [], styles: [],
    updatedAt: item.priceObservedAt,
    links: { productUrl: item.productUrl, affiliateUrl: null },
    favorite: false,
    fixture: false,
    stockConfirmed: false,
    priceKind: item.priceMinor !== null ? "observed" as const : item.priceRangeMinor !== null ? "range" as const : "none" as const,
    capabilities: item.capabilities,
    // Never presume AI try-on rights from product display access!
    tryOnReady: false,
  }
}

/**
 * Presents a normalized AliExpress Affiliates item. `links.affiliateUrl` is only set when the service
 * generated it with our tracking ID; otherwise the card falls back to the plain product page.
 */
export function presentAliExpressProduct(item: NormalizedAliExpressCatalogItem) {
  return {
    id: item.canonicalKey,
    externalId: item.externalProductId,
    name: item.name,
    category: { id: item.category, label: item.categoryLabel },
    partner: { id: item.seller, name: item.sellerName },
    source: item.source,
    region: "BR" as const,
    price: item.priceMinor === null ? null : { amount: item.priceMinor / 100, currency: item.currency },
    images: [{ url: item.image, width: 600, height: 800, alt: item.name, focus: null }],
    rating: null, reviewsCount: null, sellerRating: null,
    // product.query returns no SKUs, stock or shipping: nothing is invented.
    variants: [],
    availability: "unknown" as const,
    material: null, color: null, fit: null, deliveryDays: null, measurements: [], styles: [],
    updatedAt: item.priceObservedAt,
    links: { productUrl: item.productUrl, affiliateUrl: item.affiliateUrl },
    favorite: false,
    fixture: false,
    stockConfirmed: false,
    priceKind: item.priceMinor !== null ? "observed" as const : "none" as const,
    capabilities: item.capabilities,
    tryOnReady: false,
  }
}

const listQuery = z.object({
  category: z.string().max(64).optional(),
  cursor: z.string().regex(/^\d{1,5}$/).optional(),
  limit: z.coerce.number().int().min(1).max(48).optional(),
}).passthrough()

export async function registerCatalogRoutes(
  app: FastifyInstance,
  deps: {
    db: PrivateDatabase<"api">
    publicBaseUrl?: string
    pilotOnly?: boolean
    catalogMode?: CatalogSourceMode
    tiktokCache?: TikTokCatalogCache | null
    aliexpressCatalog?: AliExpressCatalogService | null
    /** Optional actor: AliExpress cached items are listed only to the person who searched them. */
    resolveActor?: (request: FastifyRequest) => Promise<string | null>
  },
) {
  const viewerOf = async (request: FastifyRequest) => (deps.resolveActor ? await deps.resolveActor(request).catch(() => null) : null)
  const aliexpressUnavailable = (reply: FastifyReply) =>
    reply.code(503).send(apiError("service_unavailable", "Catálogo AliExpress não configurado no servidor. Nenhum catálogo sintético foi usado como substituto."))
  const base = deps.publicBaseUrl ?? ""
  const catalogMode: CatalogSourceMode = deps.catalogMode ?? (deps.pilotOnly ? "curated_pilot" : "test_catalog")
  const pilotOnly = catalogMode === "curated_pilot"
  const isPilotRow = (row: CatalogRow) => !row.fixture && row.partner?.name === PILOT_SELLER_NAME
  const failure = (reply: FastifyReply, error: unknown) => {
    if (error instanceof PrivateDatabaseError) app.log.warn({ outcome: error.outcome, sqlState: error.sqlState }, "catalog read failed")
    return reply.code(503).send(apiError("service_unavailable", "Catálogo temporariamente indisponível."))
  }

  app.get("/v1/catalog/products", async (request, reply) => {
    const q = listQuery.safeParse(request.query)
    if (!q.success) return reply.code(400).send(apiError("validation", "Filtro inválido."))
    const limit = q.data.limit ?? 24
    const offset = Number(q.data.cursor ?? 0)
    if (catalogMode === "aliexpress_affiliate") {
      if (!deps.aliexpressCatalog) return aliexpressUnavailable(reply)
      const cached = (await deps.aliexpressCatalog.listFreshCached(await viewerOf(request))).filter((item) => !q.data.category || item.category === q.data.category)
      const slice = cached.slice(offset, offset + limit)
      const next = offset + slice.length
      return { items: slice.map(presentAliExpressProduct), nextCursor: next < cached.length ? String(next) : null, total: cached.length, source: "aliexpress_affiliate" }
    }
    if (catalogMode === "tiktok_shop") {
      if (!deps.tiktokCache) {
        return reply.code(503).send(apiError("service_unavailable", "Catálogo TikTok Shop não configurado ou sem autorização de criador ativa."))
      }
      const cached = (await deps.tiktokCache.listFreshCached())
        .filter((item) => !q.data.category || item.category === q.data.category)
      const slice = cached.slice(offset, offset + limit)
      const next = offset + slice.length
      return { items: slice.map(presentTikTokProduct), nextCursor: next < cached.length ? String(next) : null, total: cached.length, source: "tiktok_shop" }
    }
    try {
      const scanLimit = pilotOnly ? 48 : limit
      const scanOffset = pilotOnly ? 0 : offset
      const page = z.object({ total: z.number().int(), items: z.array(productRow) }).parse(await deps.db.call("list_catalog_products", scanLimit, scanOffset, q.data.category ?? null))
      if (pilotOnly) {
        const filtered = page.items.filter(isPilotRow)
        const slice = filtered.slice(offset, offset + limit)
        const next = offset + slice.length
        return { items: slice.map((row) => presentProduct(row, base)), nextCursor: next < filtered.length ? String(next) : null, total: filtered.length }
      }
      const next = offset + page.items.length
      return { items: page.items.map((row) => presentProduct(row, base)), nextCursor: next < page.total ? String(next) : null, total: page.total }
    } catch (error) { return failure(reply, error) }
  })

  app.get<{ Params: { id: string } }>("/v1/catalog/products/:id", async (request, reply) => {
    if (catalogMode === "aliexpress_affiliate") {
      if (!deps.aliexpressCatalog) return aliexpressUnavailable(reply)
      const found = /^(aliexpress:)?\d{1,20}$/.test(request.params.id) ? await deps.aliexpressCatalog.findFresh(request.params.id) : null
      if (!found) return reply.code(404).send(apiError("not_found", "Peça não encontrada no cache ativo do AliExpress. Faça a busca de novo."))
      return presentAliExpressProduct(found)
    }
    if (catalogMode === "tiktok_shop") {
      if (!deps.tiktokCache) return reply.code(503).send(apiError("service_unavailable", "Catálogo TikTok Shop não configurado ou sem autorização de criador ativa."))
      const found = (await deps.tiktokCache.listFreshCached()).find((item) => item.canonicalKey === request.params.id || item.externalProductId === request.params.id)
      if (!found) return reply.code(404).send(apiError("not_found", "Peça não encontrada no cache ativo do TikTok Shop."))
      return presentTikTokProduct(found)
    }
    if (!z.string().uuid().safeParse(request.params.id).success) return reply.code(404).send(apiError("not_found", "Peça não encontrada."))
    try {
      const raw = await deps.db.call("read_catalog_product", request.params.id)
      if (!raw) return reply.code(404).send(apiError("not_found", "Peça não encontrada."))
      const row = productRow.parse(raw)
      if (pilotOnly && !isPilotRow(row)) return reply.code(404).send(apiError("not_found", "Peça não encontrada."))
      return presentProduct(row, base)
    } catch (error) { return failure(reply, error) }
  })

  app.get("/v1/catalog/facets", async (request, reply) => {
    if (catalogMode === "aliexpress_affiliate") {
      if (!deps.aliexpressCatalog) return aliexpressUnavailable(reply)
      const items = await deps.aliexpressCatalog.listFreshCached(await viewerOf(request))
      const cats = new Map<string, { id: string; label: string; count: number }>()
      for (const item of items) {
        const c = cats.get(item.category) ?? { id: item.category, label: item.categoryLabel, count: 0 }
        c.count++; cats.set(c.id, c)
      }
      return { categories: [...cats.values()], partners: [], priceRange: null, total: items.length }
    }
    if (catalogMode === "tiktok_shop") {
      if (!deps.tiktokCache) return reply.code(503).send(apiError("service_unavailable", "Catálogo TikTok Shop não configurado ou sem autorização de criador ativa."))
      const items = await deps.tiktokCache.listFreshCached()
      const cats = new Map<string, { id: string; label: string; count: number }>()
      const partners = new Map<string, { id: string; label: string; count: number }>()
      for (const item of items) {
        const c = cats.get(item.category) ?? { id: item.category, label: item.categoryLabel, count: 0 }
        c.count++; cats.set(c.id, c)
        const p = partners.get(item.seller) ?? { id: item.seller, label: item.sellerName, count: 0 }
        p.count++; partners.set(p.id, p)
      }
      return { categories: [...cats.values()], partners: [...partners.values()], priceRange: null, total: items.length }
    }
    try {
      if (pilotOnly) {
        const page = z.object({ total: z.number().int(), items: z.array(productRow) }).parse(await deps.db.call("list_catalog_products", 48, 0, null))
        const filtered = page.items.filter(isPilotRow)
        const cats = new Map<string, { id: string; label: string; count: number }>()
        const partners = new Map<string, { id: string; label: string; count: number }>()
        for (const item of filtered) {
          if (item.category) {
            const c = cats.get(item.category.id) ?? { id: item.category.id, label: item.category.label, count: 0 }
            c.count++; cats.set(c.id, c)
          }
          if (item.partner) {
            const p = partners.get(item.partner.id) ?? { id: item.partner.id, label: item.partner.name, count: 0 }
            p.count++; partners.set(p.id, p)
          }
        }
        return { categories: [...cats.values()], partners: [...partners.values()], priceRange: null, total: filtered.length }
      }
      const f = z.object({
        total: z.number().int(),
        categories: z.array(z.object({ id: z.string(), label: z.string(), count: z.number().int() })),
        partners: z.array(z.object({ id: z.string(), label: z.string(), count: z.number().int() })),
      }).parse(await deps.db.call("catalog_facets"))
      return { categories: f.categories, partners: f.partners, priceRange: null, total: f.total }
    } catch (error) { return failure(reply, error) }
  })

  // Which source feeds the catalog and what it really provides (explicit mode; never silent fallback).
  app.get("/v1/catalog/source", async () => {
    if (catalogMode === "aliexpress_affiliate") {
      return {
        id: "aliexpress_affiliate",
        label: "AliExpress — Affiliates API (BR, BRL)",
        // This mode returns no SKUs and does not paginate (one small page per search).
        capabilities: { ...ALIEXPRESS_AFFILIATE_CATALOG_CAPABILITIES, variants: "none", pagination: "none", affiliateLinks: Boolean(deps.aliexpressCatalog?.hasTrackingId) },
        configured: Boolean(deps.aliexpressCatalog),
      }
    }
    if (catalogMode === "tiktok_shop") {
      return {
        id: "tiktok_shop",
        label: "TikTok Shop — Colaborações do criador (BR)",
        capabilities: TIKTOK_CREATOR_CATALOG_CAPABILITIES,
        configured: Boolean(deps.tiktokCache),
      }
    }
    return pilotOnly
      ? { id: "curated_pilot", label: PILOT_SELLER_NAME, capabilities: { ...TEST_CATALOG_CAPABILITIES, variants: "source", price: "none" } }
      : { id: "test_catalog", label: "Catálogo de teste (dados sintéticos)", capabilities: TEST_CATALOG_CAPABILITIES }
  })

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

