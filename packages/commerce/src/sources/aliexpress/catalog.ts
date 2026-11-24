/**
 * AliExpress affiliate catalog adapter: normalizes `aliexpress.affiliate.product.query` results into the
 * shared NormalizedCatalogItem contract and exposes a CatalogConnector.
 *
 * Rules (same governance as the TikTok source):
 * - Display/link capability and AI try-on capability are separate; `aiTryOn` stays false because
 *   affiliate API access does not prove the right to send product images to an AI provider.
 * - Never invent price, stock, sizes or seller identity: no SKUs are returned by product.query, so
 *   `variants` stays empty; non-BRL prices are rejected rather than converted.
 * - The price unit of `target_sale_price` is not stated unambiguously in the reference sample; it is
 *   parsed as a decimal amount in BRL and must be confirmed against a real response before launch.
 */
import type { CatalogConnector, CatalogItemCapabilities, CatalogSourceCapabilities, NormalizedCatalogItem } from "@stylai/contracts"
import { parseBrlMinor } from "../tiktok-shop/catalog.js"
import type { AliExpressAffiliateClient, AliExpressErrorKind, AliExpressProductRaw } from "./client.js"

export const ALIEXPRESS_AFFILIATE_CATALOG_CAPABILITIES: CatalogSourceCapabilities = {
  search: "source_api",
  variants: "source",
  stock: "unknown",
  price: "observed",
  productLinks: true,
  affiliateLinks: true,
  pagination: "page",
  imageRights: "per_item_evidence",
}

export interface NormalizedAliExpressCatalogItem extends NormalizedCatalogItem {
  source: "aliexpress"
  canonicalKey: string
  /** Tracked affiliate link (only when https); `productUrl` keeps the plain product page. */
  affiliateUrl: string | null
  capabilities: CatalogItemCapabilities
}

export type NormalizeAliExpressOutcome =
  | { accepted: true; item: NormalizedAliExpressCatalogItem }
  | { accepted: false; externalProductId: string; reason: "unsupported_currency" | "missing_https_image" | "invalid_price_format" }

/** https URL on an allow-listed host (suffix match on a dot boundary), without credentials; else null. */
export function safeAliExpressUrl(raw: string | null, hostSuffixes: string[]): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    const allowed = hostSuffixes.some((suffix) => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))
    return url.protocol === "https:" && allowed && !url.username && !url.password ? url.toString() : null
  } catch { return null }
}

/** Plain product page without query/hash: provider tracking/pricing parameters (e.g. pdp_npi) are not ours to forward. */
function canonicalProductUrl(raw: string | null): string | null {
  const safe = safeAliExpressUrl(raw, ["aliexpress.com", "aliexpress.us"])
  if (!safe) return null
  const url = new URL(safe)
  return `${url.origin}${url.pathname}`
}

function mapCategory(raw: AliExpressProductRaw): { id: string; label: string } {
  const title = raw.title.toLowerCase()
  const text = `${raw.secondLevelCategoryName ?? ""} ${title}`.toLowerCase()
  // A bundle is not a standalone garment: keep it discoverable, but never assign its full price/image to one slot.
  const upper = /\b(camisas?|shirts?|blusas?|tops?|blouses?|blazers?|jaquetas?|jackets?|casacos?|coats?|coletes?|vests?)\b/.test(title)
  const lower = /\b(calças?|calcas?|pants|trousers?|shorts?|bermudas?|saias?|skirts?)\b/.test(title)
  if (upper && lower && /\b(conjuntos?|sets?|two[ -]piece|2[ -]piece|duas pe[çc]as)\b/.test(title)) {
    return { id: "outfit_sets", label: "Conjuntos (múltiplas peças)" }
  }
  // English "dress shirt" is a shirt, not a dress.
  if (/\bdress shirts?\b/.test(title)) return { id: "shirts", label: "Camisas" }
  if (/\b(vestido|dress)/.test(text)) return { id: "dresses", label: "Vestidos" }
  if (/\b(jaqueta|blazer|casaco|jacket|coat)/.test(text)) return { id: "jackets", label: "Jaquetas" }
  if (/\b(calça|calca|jeans|pants|trouser)/.test(text)) return { id: "pants", label: "Calças" }
  if (/\b(saia|short|bermuda|skirt)/.test(text)) return { id: "bottoms", label: "Saias e shorts" }
  if (/\b(camisa|shirt)\b/.test(text)) return { id: "shirts", label: "Camisas" }
  if (/\b(blusa|regata|cropped|top|camiseta|t-shirt|blouse)/.test(text)) return { id: "tops", label: "Blusas" }
  return { id: "uncategorized", label: raw.secondLevelCategoryName ?? "Categoria não mapeada" }
}

export function normalizeAliExpressProduct(raw: AliExpressProductRaw, observedAtIso: string): NormalizeAliExpressOutcome {
  const image = safeAliExpressUrl(raw.mainImageUrl, ["alicdn.com", "aliexpress-media.com"])
  if (!image) return { accepted: false, externalProductId: raw.productId, reason: "missing_https_image" }
  let priceMinor: number | null = null
  if (raw.targetSalePrice !== null) {
    if (raw.targetSalePriceCurrency !== "BRL") return { accepted: false, externalProductId: raw.productId, reason: "unsupported_currency" }
    priceMinor = parseBrlMinor(raw.targetSalePrice)
    if (priceMinor === null) return { accepted: false, externalProductId: raw.productId, reason: "invalid_price_format" }
  }
  const category = mapCategory(raw)
  return {
    accepted: true,
    item: {
      source: "aliexpress",
      canonicalKey: `aliexpress:${raw.productId}`,
      seller: raw.shopId ? `aliexpress-shop-${raw.shopId}` : "aliexpress-unidentified-shop",
      sellerName: raw.shopName ?? "Loja AliExpress (não identificada)",
      externalProductId: raw.productId,
      category: category.id,
      categoryLabel: category.label,
      name: raw.title,
      color: null,
      variants: [],
      priceMinor,
      currency: "BRL",
      priceObservedAt: priceMinor !== null ? observedAtIso : null,
      productUrl: canonicalProductUrl(raw.detailUrl),
      // Never adopt product.query's promotion_link: tracked links only come from link.generate (search.ts).
      affiliateUrl: null,
      image,
      rights: {
        basis: "unconfirmed",
        evidence: "AliExpress Affiliates API (aliexpress.affiliate.product.query): exibição e link de afiliado para descoberta; direito de envio da imagem ao provador de IA não comprovado.",
        tryOnAllowed: false,
      },
      capabilities: { displayAndLink: true, aiTryOn: false, aiTryOnBlockedReason: "ai_image_rights_unconfirmed" },
      fixture: false,
    },
  }
}

export interface AliExpressCatalogPage {
  items: NormalizedAliExpressCatalogItem[]
  rejectedCount: number
  nextCursor: string | null
  requestId: string | null
}

export class AliExpressCatalogError extends Error {
  constructor(readonly kind: AliExpressErrorKind, readonly code: string | null) { super(`aliexpress_${kind}`) }
}

/** Keyword-bound connector; the cursor is the next page number. Failures throw, never fall back to fixtures. */
export function createAliExpressCatalogConnector(options: { client: AliExpressAffiliateClient; keywords: string; pageSize?: number; now?: () => Date }) {
  const now = options.now ?? (() => new Date())
  async function page(cursor: string | null): Promise<AliExpressCatalogPage> {
    const pageNo = cursor === null ? 1 : Number(cursor)
    if (!Number.isSafeInteger(pageNo) || pageNo < 1) throw new AliExpressCatalogError("invalid_response", "invalid_cursor")
    const result = await options.client.queryProducts({ keywords: options.keywords, pageNo, pageSize: options.pageSize ?? 20 })
    if (!result.ok) throw new AliExpressCatalogError(result.kind, result.code)
    const observedAt = now().toISOString()
    const seen = new Set<string>()
    const items: NormalizedAliExpressCatalogItem[] = []
    let rejectedCount = 0
    for (const raw of result.products) {
      const outcome = normalizeAliExpressProduct(raw, observedAt)
      if (!outcome.accepted) { rejectedCount++; continue }
      if (seen.has(outcome.item.canonicalKey)) continue
      seen.add(outcome.item.canonicalKey)
      items.push(outcome.item)
    }
    const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 50)
    const more = result.totalRecordCount !== null ? pageNo * pageSize < result.totalRecordCount : result.products.length === pageSize
    return { items, rejectedCount, nextCursor: more && result.products.length > 0 ? String(pageNo + 1) : null, requestId: result.requestId }
  }
  const connector: CatalogConnector & { page: typeof page } = {
    id: "aliexpress_affiliate",
    label: "AliExpress Affiliates API (BR, BRL)",
    capabilities: ALIEXPRESS_AFFILIATE_CATALOG_CAPABILITIES,
    page,
    async list(cursor) { const result = await page(cursor); return { items: result.items, nextCursor: result.nextCursor } },
  }
  return connector
}
