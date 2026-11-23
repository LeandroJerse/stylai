/**
 * Read-only TikTok Shop Affiliate Creator API client (v202405):
 *   - POST /affiliate_creator/202405/open_collaborations/products/search
 *   - POST /affiliate_creator/202405/open_collaborations/products (by IDs)
 * Scope: `creator.affiliate_collaboration.read` (requires Creator token `user_type = 1`).
 * Never mutates showcases ("Select Affiliate Product") and never calls Seller inventory APIs.
 */
import { signTikTokRequest } from "./sign.js"
import type { FetchLike } from "./oauth.js"

export const TIKTOK_OPEN_API_ORIGIN = "https://open-api.tiktokglobalshop.com"
export const TIKTOK_SEARCH_OPEN_PRODUCTS_PATH = "/affiliate_creator/202405/open_collaborations/products/search"
export const TIKTOK_GET_OPEN_PRODUCTS_BY_IDS_PATH = "/affiliate_creator/202405/open_collaborations/products"

export interface TikTokCreatorClientConfig {
  appKey: string
  appSecret: string
  baseUrl?: string
  fetch?: FetchLike
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
  maxReadRetries?: number
}

export interface TikTokSearchQuery {
  keywords: string[]
  pageSize?: number
  pageToken?: string | null
  categoryId?: string | null
  salesPriceMinBrl?: string | null
  salesPriceMaxBrl?: string | null
}

export interface TikTokMoneyRaw {
  currency: string
  amount: string
}

export interface TikTokOpenProductRaw {
  id: string
  title: string
  shopName: string | null
  mainImageUrl: string | null
  detailLink: string | null
  saleRegion: string | null
  hasInventory: boolean | null
  salesPrice: TikTokMoneyRaw | null
  salesPriceMin: TikTokMoneyRaw | null
  salesPriceMax: TikTokMoneyRaw | null
  originalPrice: TikTokMoneyRaw | null
  categoryId: string | null
  categoryName: string | null
  unitsSold: number | null
}

export type TikTokApiErrorKind =
  | "token_expired"
  | "scope_missing"
  | "invalid_signature"
  | "rate_limited"
  | "ambiguous_36009004"
  | "business_error"
  | "http_error"
  | "timeout"
  | "network"
  | "invalid_payload"

export type TikTokSearchOutcome =
  | { ok: true; products: TikTokOpenProductRaw[]; nextPageToken: string | null; totalCount: number | null; requestId: string | null }
  | { ok: false; kind: TikTokApiErrorKind; code?: number; httpStatus?: number; requestId?: string | null; message?: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asString(v: unknown): string | null {
  if (typeof v === "string" && v.trim().length > 0) return v.trim()
  if (typeof v === "number" && Number.isSafeInteger(v)) return String(v)
  return null
}

function parseMoney(v: unknown): TikTokMoneyRaw | null {
  if (!isRecord(v)) return null
  const currency = asString(v.currency)
  const amount = asString(v.amount)
  return currency && amount ? { currency: currency.toUpperCase(), amount } : null
}

function parseProduct(raw: unknown): TikTokOpenProductRaw | null {
  if (!isRecord(raw)) return null
  // External IDs MUST remain exact strings (safe beyond Number.MAX_SAFE_INTEGER).
  const id = asString(raw.id)
  const title = asString(raw.title)
  if (!id || !title) return null

  const shop = isRecord(raw.shop) ? raw.shop : null
  const shopName = asString(shop?.name) ?? asString(raw.shop_name)
  const mainImageUrl = asString(raw.main_image_url)
  const detailLink = asString(raw.detail_link) ?? asString(raw.product_url)
  const saleRegion = asString(raw.sale_region)?.toUpperCase() ?? null
  const hasInventory = typeof raw.has_inventory === "boolean" ? raw.has_inventory : null

  const salesPrice = parseMoney(raw.sales_price)
  const salesRange = isRecord(raw.sales_price_range) ? raw.sales_price_range : null
  const salesPriceMin = parseMoney(salesRange?.min ?? raw.min_sales_price)
  const salesPriceMax = parseMoney(salesRange?.max ?? raw.max_sales_price)
  const originalPrice = parseMoney(raw.original_price)

  const catChains = Array.isArray(raw.category_chains) ? raw.category_chains : []
  const lastCat = catChains.length > 0 && isRecord(catChains[catChains.length - 1]) ? (catChains[catChains.length - 1] as Record<string, unknown>) : null
  const categoryId = asString(lastCat?.id) ?? asString(raw.category_id)
  const categoryName = asString(lastCat?.local_name) ?? asString(raw.category_name)
  const unitsSold = typeof raw.units_sold === "number" && Number.isFinite(raw.units_sold) ? raw.units_sold : null

  return {
    id, title, shopName, mainImageUrl, detailLink, saleRegion, hasInventory,
    salesPrice, salesPriceMin, salesPriceMax, originalPrice, categoryId, categoryName, unitsSold,
  }
}

function classifyBusinessError(code: number, message: string): TikTokApiErrorKind {
  const lower = message.toLowerCase()
  if (code === 36009004) return "ambiguous_36009004"
  if (code === 105001 || code === 105002 || code === 105003 || lower.includes("token expired") || lower.includes("invalid access token") || lower.includes("access_token")) return "token_expired"
  if (code === 105004 || lower.includes("scope") || lower.includes("permission") || lower.includes("unauthorized")) return "scope_missing"
  if (code === 106001 || lower.includes("sign") || lower.includes("signature")) return "invalid_signature"
  if (code === 36009002 || lower.includes("rate limit") || lower.includes("throttl")) return "rate_limited"
  return "business_error"
}

export function createTikTokCreatorClient(config: TikTokCreatorClientConfig) {
  if (!config.appKey.trim()) throw new Error("TikTok appKey is required")
  if (!config.appSecret.trim()) throw new Error("TikTok appSecret is required")
  const base = (config.baseUrl ?? TIKTOK_OPEN_API_ORIGIN).replace(/\/+$/, "")
  const doFetch: FetchLike = config.fetch ?? fetch
  const now = config.now ?? Date.now
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const timeoutMs = config.timeoutMs ?? 10_000
  const maxReadRetries = Math.min(Math.max(config.maxReadRetries ?? 2, 0), 2)

  async function signedPost(
    path: string,
    query: Record<string, string | number | undefined>,
    bodyObj: Record<string, unknown>,
    accessToken: string,
  ): Promise<{ ok: true; data: Record<string, unknown>; requestId: string | null } | { ok: false; kind: TikTokApiErrorKind; code?: number; httpStatus?: number; requestId?: string | null; message?: string }> {
    if (!accessToken.trim()) return { ok: false, kind: "token_expired", message: "missing_access_token" }
    const rawBody = JSON.stringify(bodyObj)
    const contentType = "application/json"

    for (let attempt = 0; attempt <= maxReadRetries; attempt++) {
      const timestamp = Math.floor(now() / 1000)
      const fullQuery: Record<string, string | number | undefined> = {
        ...query,
        app_key: config.appKey,
        timestamp,
      }
      const sign = signTikTokRequest({ path, query: fullQuery, rawBody, contentType }, config.appSecret)
      const url = new URL(`${base}${path}`)
      for (const [k, v] of Object.entries(fullQuery)) {
        if (v !== undefined) url.searchParams.set(k, String(v))
      }
      url.searchParams.set("sign", sign)

      try {
        const res = await doFetch(url.toString(), {
          method: "POST",
          headers: {
            "content-type": contentType,
            "x-tts-access-token": accessToken,
            Accept: "application/json",
          },
          body: rawBody,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        })
        const text = await res.text()
        let parsed: unknown = null
        try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }

        if (res.status === 429 || res.status >= 500) {
          if (attempt < maxReadRetries) {
            const retryAfter = Number(res.headers.get("retry-after") ?? "0")
            const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 5_000)
              : Math.min(400 * 2 ** attempt, 3_000)
            await sleep(delayMs)
            continue
          }
          return { ok: false, kind: res.status === 429 ? "rate_limited" : "http_error", httpStatus: res.status }
        }
        if (res.status === 401) return { ok: false, kind: "token_expired", httpStatus: 401 }
        if (res.status === 403) return { ok: false, kind: "scope_missing", httpStatus: 403 }
        if (!res.ok) return { ok: false, kind: "http_error", httpStatus: res.status }
        if (!isRecord(parsed)) return { ok: false, kind: "invalid_payload", httpStatus: res.status }

        const code = typeof parsed.code === "number" ? parsed.code : -1
        const requestId = asString(parsed.request_id)
        const message = typeof parsed.message === "string" ? parsed.message : ""
        if (code !== 0) {
          const kind = classifyBusinessError(code, message)
          if (kind === "rate_limited" && attempt < maxReadRetries) {
            await sleep(Math.min(400 * 2 ** attempt, 3_000))
            continue
          }
          return { ok: false, kind, code, requestId, message: message.slice(0, 160) }
        }
        if (!isRecord(parsed.data)) return { ok: false, kind: "invalid_payload", requestId }
        return { ok: true, data: parsed.data, requestId }
      } catch (err) {
        const name = err instanceof Error ? err.name : ""
        const kind: TikTokApiErrorKind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network"
        if (attempt < maxReadRetries) {
          await sleep(Math.min(400 * 2 ** attempt, 3_000))
          continue
        }
        return { ok: false, kind }
      }
    }
    return { ok: false, kind: "network" }
  }

  return {
    async searchOpenProducts(query: TikTokSearchQuery, accessToken: string): Promise<TikTokSearchOutcome> {
      const keywords = query.keywords
        .map((k) => k.trim().slice(0, 255))
        .filter((k) => k.length > 0)
        .slice(0, 20)
      const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? 20), 1), 20)

      const body: Record<string, unknown> = {}
      if (keywords.length > 0) body.title_keywords = keywords
      if (query.categoryId) body.category = { id: query.categoryId }
      if (query.salesPriceMinBrl || query.salesPriceMaxBrl) {
        body.sales_price_range = {
          ...(query.salesPriceMinBrl ? { amount_ge: query.salesPriceMinBrl } : {}),
          ...(query.salesPriceMaxBrl ? { amount_le: query.salesPriceMaxBrl } : {}),
        }
      }

      const res = await signedPost(
        TIKTOK_SEARCH_OPEN_PRODUCTS_PATH,
        {
          page_size: pageSize,
          ...(query.pageToken ? { page_token: query.pageToken } : {}),
        },
        body,
        accessToken,
      )
      if (!res.ok) return res
      const rawProducts = Array.isArray(res.data.products) ? res.data.products : []
      const products = rawProducts.map(parseProduct).filter((p): p is TikTokOpenProductRaw => p !== null)
      const nextPageToken = asString(res.data.next_page_token)
      const totalCount = typeof res.data.total_count === "number" && Number.isFinite(res.data.total_count) ? res.data.total_count : null
      return { ok: true, products, nextPageToken, totalCount, requestId: res.requestId }
    },

    async getOpenProductsByIds(productIds: string[], accessToken: string): Promise<TikTokSearchOutcome> {
      const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))].slice(0, 20)
      if (ids.length === 0) return { ok: true, products: [], nextPageToken: null, totalCount: 0, requestId: null }
      const res = await signedPost(
        TIKTOK_GET_OPEN_PRODUCTS_BY_IDS_PATH,
        {},
        { product_ids: ids },
        accessToken,
      )
      if (!res.ok) return res
      const rawProducts = Array.isArray(res.data.products) ? res.data.products : []
      const products = rawProducts.map(parseProduct).filter((p): p is TikTokOpenProductRaw => p !== null)
      return { ok: true, products, nextPageToken: null, totalCount: products.length, requestId: res.requestId }
    },
  }
}
export type TikTokCreatorClient = ReturnType<typeof createTikTokCreatorClient>
