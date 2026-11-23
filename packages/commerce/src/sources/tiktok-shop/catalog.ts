/**
 * TikTok Shop Creator Affiliate normalization, capability separation, TTL cache, expiration & deduplication.
 *
 * Documented governance rules enforced here:
 *   1. Separate TWO capabilities explicitly:
 *      - `displayAndLink`: showing product info, image & link in discovery/Estúdio;
 *      - `aiTryOn`: sending the product image to an external AI try-on provider (`false` by default —
 *        API access to a product image NEVER implies AI generation rights!).
 *   2. Never invent price, stock, sizes/SKUs or seller identity:
 *      - A price range (min != max) keeps `priceMinor = null` and records `priceRangeMinor` separately.
 *      - Absent SKUs stay `variants = []` (never fabricated "Tamanho único").
 *      - `has_inventory` never implies confirmed size stock (`stockConfirmed = false`).
 *   3. Brazil / BRL guard: rejects non-BR / non-BRL listings without silent currency conversion.
 *   4. Hot-data caching with explicit TTL (5 min default), staleness expiration, query-bound cursors,
 *      and canonical deduplication by `tiktok_shop:${region}:${externalProductId}`. Partial search pages
 *      never wipe unrelated cached items.
 */
import type { CatalogItemCapabilities, CatalogSourceCapabilities, NormalizedCatalogItem } from "@stylai/contracts"
import type { TikTokApiErrorKind, TikTokCreatorClient, TikTokOpenProductRaw, TikTokSearchQuery } from "./client.js"

export const TIKTOK_CREATOR_CATALOG_CAPABILITIES: CatalogSourceCapabilities = {
  search: "source_api",
  variants: "source",
  stock: "unknown",
  price: "observed",
  productLinks: true,
  affiliateLinks: true,
  pagination: "cursor",
  imageRights: "per_item_evidence",
}

export const DEFAULT_TIKTOK_CACHE_TTL_MS = 5 * 60_000

export interface NormalizedTikTokCatalogItem extends NormalizedCatalogItem {
  source: "tiktok_shop"
  region: "BR"
  canonicalKey: string
  priceRangeMinor: { min: number; max: number } | null
  hasInventorySignal: boolean | null
  capabilities: CatalogItemCapabilities
}

export type NormalizeTikTokOutcome =
  | { accepted: true; item: NormalizedTikTokCatalogItem }
  | { accepted: false; externalProductId: string; reason: "unsupported_region" | "unsupported_currency" | "missing_https_image" | "invalid_price_format" }

/** Exact integer BRL minor-unit parser (no IEEE-754 float drift). */
export function parseBrlMinor(rawAmount: string): number | null {
  const clean = rawAmount.trim()
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) return null
  const [whole, frac = ""] = clean.split(".")
  const padded = frac.padEnd(2, "0")
  const minor = Number(whole) * 100 + Number(padded)
  return Number.isSafeInteger(minor) ? minor : null
}

function isValidHttpsUrl(raw: string | null): raw is string {
  if (!raw) return false
  try {
    const u = new URL(raw)
    return u.protocol === "https:" && u.hostname.length > 0 && !u.username && !u.password
  } catch {
    return false
  }
}

function mapTikTokCategory(raw: TikTokOpenProductRaw): { id: string; label: string } {
  const text = `${raw.categoryName ?? ""} ${raw.title}`.toLowerCase()
  if (/\b(vestido|dress)\b/.test(text)) return { id: "dresses", label: "Vestidos" }
  if (/\b(jaqueta|blazer|casaco|moletom|jacket|coat)\b/.test(text)) return { id: "jackets", label: "Jaquetas" }
  if (/\b(calca|calça|jeans|pants|trouser)\b/.test(text)) return { id: "pants", label: "Calças" }
  if (/\b(saia|short|bermuda|skirt)\b/.test(text)) return { id: "bottoms", label: "Saias e shorts" }
  if (/\b(camisa|social|shirt)\b/.test(text)) return { id: "shirts", label: "Camisas" }
  if (/\b(camiseta|blusa|regata|cropped|top|t-shirt)\b/.test(text)) return { id: "tops", label: "Blusas" }
  return { id: "uncategorized", label: raw.categoryName ?? "Categoria não mapeada" }
}

export function normalizeTikTokProduct(raw: TikTokOpenProductRaw, observedAtIso: string): NormalizeTikTokOutcome {
  if (raw.saleRegion !== "BR") {
    return { accepted: false, externalProductId: raw.id, reason: "unsupported_region" }
  }
  if (!isValidHttpsUrl(raw.mainImageUrl)) {
    return { accepted: false, externalProductId: raw.id, reason: "missing_https_image" }
  }

  let priceMinor: number | null = null
  let priceRangeMinor: { min: number; max: number } | null = null

  const moneySamples = [raw.salesPrice, raw.salesPriceMin, raw.salesPriceMax, raw.originalPrice].filter(Boolean)
  for (const m of moneySamples) {
    if (m && m.currency !== "BRL") {
      return { accepted: false, externalProductId: raw.id, reason: "unsupported_currency" }
    }
  }

  if (raw.salesPrice) {
    const parsed = parseBrlMinor(raw.salesPrice.amount)
    if (parsed === null) return { accepted: false, externalProductId: raw.id, reason: "invalid_price_format" }
    priceMinor = parsed
  } else if (raw.salesPriceMin && raw.salesPriceMax) {
    const min = parseBrlMinor(raw.salesPriceMin.amount)
    const max = parseBrlMinor(raw.salesPriceMax.amount)
    if (min === null || max === null || min > max) {
      return { accepted: false, externalProductId: raw.id, reason: "invalid_price_format" }
    }
    if (min === max) priceMinor = min
    else priceRangeMinor = { min, max } // Never fabricate a single variant price from a range!
  }

  const category = mapTikTokCategory(raw)
  const productUrl = isValidHttpsUrl(raw.detailLink) ? raw.detailLink : null
  const sellerName = raw.shopName ?? "Loja TikTok Shop (não identificada)"

  // Explicit separation: display/link is allowed for authorized BR discovery; AI try-on is NEVER presumed.
  const capabilities: CatalogItemCapabilities = {
    displayAndLink: true,
    aiTryOn: false,
    aiTryOnBlockedReason: "ai_image_rights_unconfirmed",
  }

  return {
    accepted: true,
    item: {
      source: "tiktok_shop",
      region: "BR",
      canonicalKey: `tiktok_shop:BR:${raw.id}`,
      seller: "tiktok-shop-br-unverified-seller",
      sellerName,
      externalProductId: raw.id,
      category: category.id,
      categoryLabel: category.label,
      name: raw.title,
      color: null,
      // Open Collaboration search does NOT return verified size/SKU variants: keep empty, never fabricate!
      variants: [],
      priceMinor,
      priceRangeMinor,
      currency: "BRL",
      priceObservedAt: priceMinor !== null || priceRangeMinor !== null ? observedAtIso : null,
      productUrl,
      image: raw.mainImageUrl,
      hasInventorySignal: raw.hasInventory,
      rights: {
        basis: "unconfirmed",
        evidence: "TikTok Shop Creator Affiliate API (creator.affiliate_collaboration.read): uso limitado a descoberta/exibição; direitos de envio da imagem ao provador de IA não comprovados.",
        tryOnAllowed: false,
      },
      capabilities,
      fixture: false,
    },
  }
}

export type TikTokCatalogState =
  | "ready"
  | "not_configured"
  | "authorization_required"
  | "scope_missing"
  | "degraded"

export interface TikTokCatalogSearchResult {
  state: TikTokCatalogState
  items: NormalizedTikTokCatalogItem[]
  rejectedCount: number
  nextCursor: string | null
  totalCount: number | null
  observedAt: string
  expiresAt: string | null
  fromCache: boolean
  requestId: string | null
  errorKind?: TikTokApiErrorKind | "cursor_query_mismatch"
}

interface CacheEntry {
  items: NormalizedTikTokCatalogItem[]
  rejectedCount: number
  nextCursor: string | null
  totalCount: number | null
  observedAtMs: number
  expiresAtMs: number
  requestId: string | null
}

function queryFingerprint(q: TikTokSearchQuery): string {
  const normKeywords = q.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).sort()
  return JSON.stringify({
    k: normKeywords,
    c: q.categoryId ?? null,
    min: q.salesPriceMinBrl ?? null,
    max: q.salesPriceMaxBrl ?? null,
    ps: Math.min(Math.max(Math.trunc(q.pageSize ?? 20), 1), 20),
  })
}

/**
 * Contextual hot-data cache with explicit TTL, expiration, refresh, cursor binding,
 * and canonical deduplication across pages without erasing unrelated cached items.
 */
export function createTikTokCatalogCache(opts: {
  client: TikTokCreatorClient | null
  getAccessToken: () => Promise<string | null>
  onAuthorizationFailure?: (rejectedToken: string) => Promise<void>
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}) {
  const ttlMs = Math.min(Math.max(opts.ttlMs ?? DEFAULT_TIKTOK_CACHE_TTL_MS, 5_000), 30 * 60_000)
  const maxEntries = Math.max(opts.maxEntries ?? 100, 10)
  const now = opts.now ?? Date.now

  const pages = new Map<string, CacheEntry>()
  const byCanonicalKey = new Map<string, { item: NormalizedTikTokCatalogItem; expiresAtMs: number }>()
  const cursorOwner = new Map<string, { fingerprint: string; expiresAtMs: number }>()
  let epoch = 0
  let activeToken: string | null = null
  let revokedToken: string | null = null
  function clear(): void {
    epoch++
    pages.clear()
    byCanonicalKey.clear()
    cursorOwner.clear()
  }
  async function authorizedToken(): Promise<string | null> {
    const token = await opts.getAccessToken().catch(() => null)
    if (!token || token === revokedToken) { clear(); activeToken = null; return null }
    if (token !== activeToken) { clear(); activeToken = token }
    return token
  }

  function mapErrorState(kind: TikTokApiErrorKind): TikTokCatalogState {
    if (kind === "token_expired") return "authorization_required"
    if (kind === "scope_missing") return "scope_missing"
    return "degraded"
  }

  return {
    ttlMs,
    async search(query: TikTokSearchQuery, options: { forceRefresh?: boolean } = {}): Promise<TikTokCatalogSearchResult> {
      const currentMs = now()
      const observedAt = new Date(currentMs).toISOString()

      if (!opts.client) {
        return { state: "not_configured", items: [], rejectedCount: 0, nextCursor: null, totalCount: null, observedAt, expiresAt: null, fromCache: false, requestId: null }
      }

      const denied = (): TikTokCatalogSearchResult => ({ state: "authorization_required", items: [], rejectedCount: 0, nextCursor: null, totalCount: null, observedAt, expiresAt: null, fromCache: false, requestId: null })
      const token = await authorizedToken()
      if (!token) return denied()
      const requestEpoch = epoch

      const fp = queryFingerprint(query)
      if (query.pageToken) {
        const bound = cursorOwner.get(query.pageToken)
        if (!bound || bound.fingerprint !== fp || bound.expiresAtMs <= currentMs) {
          return {
            state: "degraded", items: [], rejectedCount: 0, nextCursor: null, totalCount: null,
            observedAt, expiresAt: null, fromCache: false, requestId: null, errorKind: "cursor_query_mismatch",
          }
        }
      }

      const cacheKey = `${fp}::${query.pageToken ?? ""}`
      const hit = pages.get(cacheKey)
      if (!options.forceRefresh && hit && hit.expiresAtMs > currentMs) {
        return {
          state: "ready",
          items: hit.items,
          rejectedCount: hit.rejectedCount,
          nextCursor: hit.nextCursor,
          totalCount: hit.totalCount,
          observedAt: new Date(hit.observedAtMs).toISOString(),
          expiresAt: new Date(hit.expiresAtMs).toISOString(),
          fromCache: true,
          requestId: hit.requestId,
        }
      }

      const res = await opts.client.searchOpenProducts(query, token)
      const currentToken = await authorizedToken()
      if (requestEpoch !== epoch || currentToken !== token) return denied()
      if (!res.ok) {
        if (res.kind === "token_expired" || res.kind === "scope_missing") {
          revokedToken = token; activeToken = null; clear()
          await opts.onAuthorizationFailure?.(token).catch(() => undefined)
        }
        return {
          state: mapErrorState(res.kind),
          items: [],
          rejectedCount: 0,
          nextCursor: null,
          totalCount: null,
          observedAt,
          expiresAt: null,
          fromCache: false,
          requestId: res.requestId ?? null,
          errorKind: res.kind,
        }
      }

      // Deduplicate within page by canonicalKey and upsert into item index without deleting unrelated entries.
      const deduped = new Map<string, NormalizedTikTokCatalogItem>()
      let rejectedCount = 0
      for (const raw of res.products) {
        const norm = normalizeTikTokProduct(raw, observedAt)
        if (!norm.accepted) { rejectedCount++; continue }
        deduped.set(norm.item.canonicalKey, norm.item)
      }
      const items = [...deduped.values()]
      const expiresAtMs = currentMs + ttlMs

      if (pages.size >= maxEntries) {
        const oldestKey = pages.keys().next().value
        if (oldestKey) pages.delete(oldestKey)
      }
      pages.set(cacheKey, {
        items, rejectedCount, nextCursor: res.nextPageToken, totalCount: res.totalCount,
        observedAtMs: currentMs, expiresAtMs, requestId: res.requestId,
      })
      for (const item of items) {
        byCanonicalKey.set(item.canonicalKey, { item, expiresAtMs })
      }
      if (res.nextPageToken) {
        cursorOwner.set(res.nextPageToken, { fingerprint: fp, expiresAtMs })
      }

      return {
        state: "ready",
        items,
        rejectedCount,
        nextCursor: res.nextPageToken,
        totalCount: res.totalCount,
        observedAt,
        expiresAt: new Date(expiresAtMs).toISOString(),
        fromCache: false,
        requestId: res.requestId,
      }
    },

    /** Reads non-expired deduplicated items currently cached in memory (never returns expired rows). */
    async listFreshCached(): Promise<NormalizedTikTokCatalogItem[]> {
      if (!await authorizedToken()) return []
      const currentMs = now()
      const out: NormalizedTikTokCatalogItem[] = []
      for (const [k, entry] of byCanonicalKey) {
        if (entry.expiresAtMs <= currentMs) byCanonicalKey.delete(k)
        else out.push(entry.item)
      }
      return out
    },

    /** Clears all cached creator data (e.g. on authorization revocation per TikTok data retention terms). */
    purgeOnRevocation(): void {
      revokedToken = activeToken
      activeToken = null
      clear()
    },
  }
}
export type TikTokCatalogCache = ReturnType<typeof createTikTokCatalogCache>
