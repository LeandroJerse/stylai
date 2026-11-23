/**
 * AliExpress Affiliates API client (business interfaces, app-level signature only).
 *
 * Official evidence (AliExpress Open Platform, read 2026-11-23):
 * - Business gateway: `https://api-sg.aliexpress.com/sync?method={api_path}&{query}` (docId=1388).
 * - Affiliate API reference samples call `client.execute(request, Protocol.TOP)` WITHOUT an access
 *   token, while seller APIs (e.g. aliexpress.solution.order.get) call
 *   `client.execute(request, accessToken, Protocol.TOP)`. Seller OAuth (docId=1364) is for
 *   "business data of Aliexpress sellers". So catalog/link calls need App Key + App Secret + tracking
 *   ID, never a seller access_token. A real call is still required to confirm account permissions.
 * - Product query params: keywords, category_ids, page_no, page_size (1-50), sort, target_currency,
 *   target_language, ship_to_country, tracking_id, fields (aliexpress.affiliate.product.query).
 * - Link generation params: promotion_link_type (0 = normal), source_values (max 50), tracking_id.
 *
 * Never returns or logs the App Secret, signatures or raw provider payloads.
 */
import { ALIEXPRESS_SIGN_METHOD, signAliExpressRequest, type AliExpressParams } from "./sign.js"

export type AliExpressFetch = (input: string, init: { method: string; headers: Record<string, string>; body: string; redirect: "error"; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export const ALIEXPRESS_BUSINESS_GATEWAY = "https://api-sg.aliexpress.com/sync"
export const ALIEXPRESS_PRODUCT_QUERY = "aliexpress.affiliate.product.query"
export const ALIEXPRESS_LINK_GENERATE = "aliexpress.affiliate.link.generate"

export interface AliExpressAffiliateConfig {
  appKey: string
  appSecret: string
  /** Optional for product.query (docs: "Required: No"); mandatory for link.generate. */
  trackingId?: string | null
  fetch?: AliExpressFetch
  now?: () => number
  timeoutMs?: number
  /** Global call budget shared by every replica (DB-backed); false = do not call. Every call counts, retries included. */
  acquire?: () => Promise<boolean>
}

export interface AliExpressProductQuery {
  keywords: string
  categoryIds?: string[]
  pageNo?: number
  pageSize?: number
  sort?: "SALE_PRICE_ASC" | "SALE_PRICE_DESC" | "LAST_VOLUME_ASC" | "LAST_VOLUME_DESC"
}

/** Only the fields StylAI reads; everything is optional because the provider omits fields freely. */
export interface AliExpressProductRaw {
  productId: string
  title: string
  mainImageUrl: string | null
  targetSalePrice: string | null
  targetSalePriceCurrency: string | null
  detailUrl: string | null
  promotionLink: string | null
  shopName: string | null
  shopId: string | null
  firstLevelCategoryName: string | null
  secondLevelCategoryName: string | null
}

export type AliExpressErrorKind = "configuration" | "rate_limited" | "network" | "http" | "provider_error" | "business_error" | "invalid_response"

export type AliExpressFailure = { ok: false; kind: AliExpressErrorKind; code: string | null; requestId: string | null }

export type AliExpressProductOutcome =
  | { ok: true; products: AliExpressProductRaw[]; pageNo: number; totalRecordCount: number | null; requestId: string | null }
  | AliExpressFailure

export type AliExpressLinkOutcome =
  /** `trackingId` is the value echoed by the provider (null when absent), for comparison with the one sent. */
  | { ok: true; links: { sourceValue: string; promotionLink: string }[]; trackingId: string | null; requestId: string | null }
  | AliExpressFailure

type Json = Record<string, unknown>
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null)
/** Provider codes are echoed to operators only after reduction to a safe token. */
const safeCode = (value: unknown): string | null => {
  const raw = text(value)
  return raw && /^[A-Za-z0-9_.-]{1,64}$/.test(raw) ? raw : raw ? "unrecognized" : null
}

function unwrap(body: Json, apiName: string): { resp: Json | null; requestId: string | null; error: AliExpressFailure | null } {
  const requestId = text(body.request_id)
  const errorResponse = isObject(body.error_response) ? body.error_response : null
  if (errorResponse) return { resp: null, requestId: text(errorResponse.request_id) ?? requestId, error: { ok: false, kind: "provider_error", code: safeCode(errorResponse.code), requestId: text(errorResponse.request_id) ?? requestId } }
  // Documented shapes: streamlined `{ resp_result }` or `{ <method>_response: { resp_result } }`.
  const wrapper = body[`${apiName.replaceAll(".", "_")}_response`]
  const container = isObject(wrapper) ? wrapper : body
  const resp = isObject(container.resp_result) ? container.resp_result : null
  if (!resp) {
    const code = text(body.code)
    if (code && code !== "0") return { resp: null, requestId, error: { ok: false, kind: "provider_error", code: safeCode(code), requestId } }
    return { resp: null, requestId, error: { ok: false, kind: "invalid_response", code: null, requestId } }
  }
  const id = requestId ?? (isObject(wrapper) ? text(wrapper.request_id) : null)
  if (text(resp.resp_code) !== "200") return { resp: null, requestId: id, error: { ok: false, kind: "business_error", code: safeCode(resp.resp_code), requestId: id } }
  return { resp, requestId: id, error: null }
}

/** The reference sample shows `products: [...]`; production SDK payloads nest `products: { product: [...] }`. */
function listOf(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value
  if (isObject(value) && Array.isArray(value[key])) return value[key] as unknown[]
  return []
}

function toProduct(value: unknown): AliExpressProductRaw | null {
  if (!isObject(value)) return null
  const productId = text(value.product_id)
  const title = text(value.product_title)
  if (!productId || !/^\d{1,20}$/.test(productId) || !title) return null
  return {
    productId, title,
    mainImageUrl: text(value.product_main_image_url),
    targetSalePrice: text(value.target_sale_price),
    targetSalePriceCurrency: text(value.target_sale_price_currency),
    detailUrl: text(value.product_detail_url),
    promotionLink: text(value.promotion_link),
    shopName: text(value.shop_name),
    shopId: text(value.shop_id),
    firstLevelCategoryName: text(value.first_level_category_name),
    secondLevelCategoryName: text(value.second_level_category_name),
  }
}

export function createAliExpressAffiliateClient(config: AliExpressAffiliateConfig) {
  if (!config.appKey || !config.appSecret) throw new Error("AliExpress affiliate client requires appKey and appSecret")
  const trackingId = config.trackingId?.trim() || undefined
  const doFetch: AliExpressFetch = config.fetch ?? ((input, init) => fetch(input, init))
  const now = config.now ?? Date.now

  async function call(apiName: string, business: AliExpressParams): Promise<{ resp: Json | null; requestId: string | null; error: AliExpressFailure | null }> {
    if (config.acquire && !(await config.acquire().catch(() => false))) {
      return { resp: null, requestId: null, error: { ok: false, kind: "rate_limited", code: "call_budget_exhausted", requestId: null } }
    }
    const params: AliExpressParams = { ...business, method: apiName, app_key: config.appKey, sign_method: ALIEXPRESS_SIGN_METHOD, timestamp: String(now()) }
    params.sign = signAliExpressRequest(params, config.appSecret)
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (value !== undefined && String(value) !== "") form.set(key, String(value))
    let response: Awaited<ReturnType<AliExpressFetch>>
    try {
      response = await doFetch(ALIEXPRESS_BUSINESS_GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", Accept: "application/json" },
        body: form.toString(),
        // Never follow redirects: a 307/308 would re-send the signed body to whatever host it names.
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs ?? 10_000),
      })
    } catch {
      return { resp: null, requestId: null, error: { ok: false, kind: "network", code: null, requestId: null } }
    }
    if (!response.ok) return { resp: null, requestId: null, error: { ok: false, kind: "http", code: String(response.status), requestId: null } }
    let body: unknown
    try { body = JSON.parse(await response.text()) } catch { body = null }
    if (!isObject(body)) return { resp: null, requestId: null, error: { ok: false, kind: "invalid_response", code: null, requestId: null } }
    return unwrap(body, apiName)
  }

  return {
    async queryProducts(query: AliExpressProductQuery): Promise<AliExpressProductOutcome> {
      const keywords = query.keywords.trim().slice(0, 100)
      if (!keywords) return { ok: false, kind: "invalid_response", code: "empty_keywords", requestId: null }
      const pageNo = Math.max(1, Math.trunc(query.pageNo ?? 1))
      const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? 20), 1), 50)
      const result = await call(ALIEXPRESS_PRODUCT_QUERY, {
        keywords, page_no: pageNo, page_size: pageSize, sort: query.sort,
        category_ids: query.categoryIds?.length ? query.categoryIds.join(",") : undefined,
        target_currency: "BRL", target_language: "PT", ship_to_country: "BR", tracking_id: trackingId,
      })
      if (result.error) return result.error
      const payload = isObject(result.resp!.result) ? result.resp!.result : {}
      const products = listOf(payload.products, "product").map(toProduct).filter((item): item is AliExpressProductRaw => item !== null)
      const total = Number(text(payload.total_record_count))
      return { ok: true, products, pageNo, totalRecordCount: Number.isSafeInteger(total) && total >= 0 ? total : null, requestId: result.requestId }
    },

    async generateLinks(sourceValues: string[]): Promise<AliExpressLinkOutcome> {
      if (!trackingId) return { ok: false, kind: "configuration", code: "missing_tracking_id", requestId: null }
      const values = sourceValues.filter((value) => /^https:\/\/([a-z0-9-]+\.)*aliexpress\.com\//i.test(value)).slice(0, 50)
      if (!values.length) return { ok: false, kind: "invalid_response", code: "no_valid_source", requestId: null }
      const result = await call(ALIEXPRESS_LINK_GENERATE, { promotion_link_type: 0, source_values: values.join(","), tracking_id: trackingId, ship_to_country: "BR" })
      if (result.error) return result.error
      const payload = isObject(result.resp!.result) ? result.resp!.result : {}
      const links = listOf(payload.promotion_links, "promotion_link").flatMap((entry) => {
        if (!isObject(entry)) return []
        const sourceValue = text(entry.source_value)
        const promotionLink = text(entry.promotion_link)
        return sourceValue && promotionLink ? [{ sourceValue, promotionLink }] : []
      })
      return { ok: true, links, trackingId: text(payload.tracking_id), requestId: result.requestId }
    },
  }
}

export type AliExpressAffiliateClient = ReturnType<typeof createAliExpressAffiliateClient>
