/**
 * AliExpress catalog service for the Estúdio search: one `product.query` plus, when a tracking ID is
 * configured, one batched `link.generate` per NEW search, cached in memory with an explicit TTL.
 *
 * Link policy:
 * - `affiliateUrl` only comes from `aliexpress.affiliate.link.generate` called with our tracking ID
 *   (official docs: tracking_id is required there), bound to the product whose exact `productUrl`
 *   was sent as `source_value`. The `promotion_link` returned by `product.query` is discarded: it is
 *   not proof of attribution to our tracking ID.
 * - Without a tracking ID, or when link generation fails, items keep only the plain product URL and
 *   must never be presented as commissioned.
 * - Nothing here proves attribution/commission: that needs provider reports after real conversions.
 *
 * No automatic retries and no pagination: every provider call is an explicit user search.
 */
import type { AliExpressAffiliateClient, AliExpressErrorKind } from "./client.js"
import { normalizeAliExpressProduct, safeAliExpressUrl, type NormalizedAliExpressCatalogItem } from "./catalog.js"

export const DEFAULT_ALIEXPRESS_CACHE_TTL_MS = 5 * 60_000
/** Failures (incl. the undocumented resp_code 405) are remembered briefly: no repeated calls during an outage. */
export const ALIEXPRESS_NEGATIVE_TTL_MS = 30_000
/**
 * After a call-budget/rate refusal, NO new query is sent (any keywords) for this bounded window.
 * resp_code 405 is NOT throttling: a read-only envelope diagnosis (2026-11-23, 4 free calls) returned
 * resp_msg "The result is empty" for a nonsense keyword and for the failing ones, while a control query succeeded.
 * It is handled as an empty result (it was observed to flip once for "vestido", so it is labelled, not trusted).
 */
export const ALIEXPRESS_PROVIDER_BACKOFF_MS = 15_000
const MAX_INDEXED_ITEMS = 2_000

/** "unmatched": link.generate succeeded but no returned source_value matched a product. */
export type AliExpressLinkState = "generated" | "unmatched" | "missing_tracking_id" | "failed"

export interface AliExpressSearchResult {
  state: "ready" | "not_configured" | "degraded"
  items: NormalizedAliExpressCatalogItem[]
  rejectedCount: number
  /** null when no link generation applied (no items, failure or not configured). */
  links: AliExpressLinkState | null
  /** Tracking ID echoed by link.generate (compare with the configured one; not proof of attribution). */
  trackingIdEcho: string | null
  linkErrorCode: string | null
  observedAt: string
  expiresAt: string | null
  fromCache: boolean
  requestId: string | null
  errorKind: AliExpressErrorKind | null
  errorCode: string | null
  /** Sanitized provider resp_msg (diagnostics; null when absent). */
  errorMessage: string | null
  /** "provider_reported_empty": the provider answered 405 "The result is empty" (no outage). */
  emptyReason: "provider_reported_empty" | null
  /** ISO time until which no new provider query is sent (null when not backing off). */
  backoffUntil: string | null
}

export interface AliExpressSearchQuery {
  keywords: string
  pageSize?: number
  /** Person who searched: cached items are listed back only to them (commercial data is shared, searches are not). */
  viewer?: string | null
}

const fingerprint = (q: AliExpressSearchQuery) => JSON.stringify({
  k: q.keywords.trim().toLowerCase().replace(/\s+/g, " "),
  ps: Math.min(Math.max(Math.trunc(q.pageSize ?? 20), 1), 50),
})

export function createAliExpressCatalogService(opts: {
  client: AliExpressAffiliateClient | null
  trackingId: string | null
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}) {
  const ttlMs = Math.min(Math.max(opts.ttlMs ?? DEFAULT_ALIEXPRESS_CACHE_TTL_MS, 5_000), 30 * 60_000)
  const maxEntries = Math.max(opts.maxEntries ?? 50, 5)
  const now = opts.now ?? Date.now
  const trackingId = opts.trackingId?.trim() || null
  const pages = new Map<string, { result: AliExpressSearchResult; expiresAtMs: number }>()
  const byKey = new Map<string, { item: NormalizedAliExpressCatalogItem; expiresAtMs: number }>()
  const inFlight = new Map<string, Promise<AliExpressSearchResult>>()
  const negative = new Map<string, { result: AliExpressSearchResult; untilMs: number }>()
  const viewers = new Map<string, Map<string, number>>()
  let backoff: { untilMs: number; result: AliExpressSearchResult } | null = null

  function prune(currentMs: number) {
    for (const [k, v] of pages) if (v.expiresAtMs <= currentMs) pages.delete(k)
    for (const [k, v] of negative) if (v.untilMs <= currentMs) negative.delete(k)
    for (const [k, v] of byKey) if (v.expiresAtMs <= currentMs) byKey.delete(k)
    while (byKey.size > MAX_INDEXED_ITEMS) byKey.delete(byKey.keys().next().value!)
    for (const [viewer, keys] of viewers) {
      for (const [k, exp] of keys) if (exp <= currentMs) keys.delete(k)
      if (!keys.size) viewers.delete(viewer)
    }
  }
  function remember(viewer: string | null | undefined, result: AliExpressSearchResult, expiresAtMs: number) {
    if (!viewer) return
    const keys = viewers.get(viewer) ?? new Map<string, number>()
    for (const item of result.items) keys.set(item.canonicalKey, expiresAtMs)
    viewers.set(viewer, keys)
  }

  function empty(state: AliExpressSearchResult["state"], observedAt: string, extra: Partial<AliExpressSearchResult> = {}): AliExpressSearchResult {
    return { state, items: [], rejectedCount: 0, links: null, trackingIdEcho: null, linkErrorCode: null, observedAt, expiresAt: null, fromCache: false, requestId: null, errorKind: null, errorCode: null, errorMessage: null, backoffUntil: null, emptyReason: null, ...extra }
  }

  async function fetchFresh(client: AliExpressAffiliateClient, query: AliExpressSearchQuery, key: string): Promise<AliExpressSearchResult> {
    const currentMs = now()
    const observedAt = new Date(currentMs).toISOString()
    const pageSize = Math.min(Math.max(Math.trunc(query.pageSize ?? 20), 1), 50)
    prune(currentMs)
    const res = await client.queryProducts({ keywords: query.keywords, pageNo: 1, pageSize })
    if (!res.ok && res.kind === "business_error" && res.code === "405") {
      const emptyResult = empty("ready", observedAt, { requestId: res.requestId, errorCode: "405", errorMessage: res.message ?? null, emptyReason: "provider_reported_empty" })
      negative.set(key, { result: emptyResult, untilMs: currentMs + ALIEXPRESS_NEGATIVE_TTL_MS })
      return emptyResult
    }
    if (!res.ok) {
      const failed = empty("degraded", observedAt, { requestId: res.requestId, errorKind: res.kind, errorCode: res.code, errorMessage: res.message ?? null })
      negative.set(key, { result: failed, untilMs: currentMs + ALIEXPRESS_NEGATIVE_TTL_MS })
      if (res.kind === "rate_limited") {
        const untilMs = currentMs + ALIEXPRESS_PROVIDER_BACKOFF_MS
        backoff = { untilMs, result: { ...failed, backoffUntil: new Date(untilMs).toISOString() } }
        return backoff.result
      }
      return failed
    }

    const seen = new Map<string, NormalizedAliExpressCatalogItem>()
    let rejectedCount = 0
    for (const raw of res.products) {
      const outcome = normalizeAliExpressProduct(raw, observedAt)
      if (!outcome.accepted) { rejectedCount++; continue }
      // The query's promotion link is not attributed to our tracking ID: drop it (see header).
      if (!seen.has(outcome.item.canonicalKey)) seen.set(outcome.item.canonicalKey, { ...outcome.item, affiliateUrl: null })
    }
    let items = [...seen.values()]
    let links: AliExpressLinkState | null = null
    let trackingIdEcho: string | null = null
    let linkErrorCode: string | null = null
    if (items.length) {
      const sources = items.map((item) => item.productUrl).filter((url): url is string => url !== null)
      if (!trackingId) links = "missing_tracking_id"
      else if (sources.length) {
        const generated = await client.generateLinks(sources)
        if (generated.ok && generated.trackingId !== null && generated.trackingId !== trackingId) {
          // The provider says these links belong to another tracking ID: never present them as ours.
          links = "failed"
          trackingIdEcho = generated.trackingId
          linkErrorCode = "tracking_id_mismatch"
        } else if (generated.ok) {
          trackingIdEcho = generated.trackingId
          const bySource = new Map(generated.links.map((link) => [link.sourceValue, safeAliExpressUrl(link.promotionLink, ["aliexpress.com"])]))
          items = items.map((item) => ({ ...item, affiliateUrl: item.productUrl ? bySource.get(item.productUrl) ?? null : null }))
          links = items.some((item) => item.affiliateUrl !== null) ? "generated" : "unmatched"
        } else {
          links = "failed"
          linkErrorCode = generated.code ?? generated.kind
        }
      }
    }
    const expiresAtMs = currentMs + ttlMs
    const result: AliExpressSearchResult = {
      state: "ready", items, rejectedCount, links, trackingIdEcho, linkErrorCode, observedAt,
      expiresAt: new Date(expiresAtMs).toISOString(), fromCache: false, requestId: res.requestId, errorKind: null, errorCode: null, errorMessage: null, backoffUntil: null, emptyReason: null,
    }
    if (pages.size >= maxEntries) {
      const oldest = pages.keys().next().value
      if (oldest !== undefined) pages.delete(oldest)
    }
    pages.set(key, { result, expiresAtMs })
    for (const item of items) byKey.set(item.canonicalKey, { item, expiresAtMs })
    return result
  }

  return {
    ttlMs,
    hasTrackingId: trackingId !== null,
    async search(query: AliExpressSearchQuery): Promise<AliExpressSearchResult> {
      const observedAt = new Date(now()).toISOString()
      if (!opts.client) return empty("not_configured", observedAt)
      const key = fingerprint(query)
      const hit = pages.get(key)
      if (hit && hit.expiresAtMs > now()) { remember(query.viewer, hit.result, hit.expiresAtMs); return { ...hit.result, fromCache: true } }
      const failed = negative.get(key)
      if (failed && failed.untilMs > now()) return { ...failed.result, fromCache: true }
      if (backoff && backoff.untilMs > now()) return { ...backoff.result, fromCache: true }
      // Concurrent identical searches share one provider round trip.
      const pending = inFlight.get(key) ?? fetchFresh(opts.client, query, key).finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
      const result = await pending
      if (result.state === "ready" && result.expiresAt) remember(query.viewer, result, Date.parse(result.expiresAt))
      return result
    },
    /** Non-expired items this viewer searched (never other people's searches, never expired rows). */
    async listFreshCached(viewer: string | null): Promise<NormalizedAliExpressCatalogItem[]> {
      if (!viewer) return []
      const currentMs = now()
      prune(currentMs)
      const keys = viewers.get(viewer)
      if (!keys) return []
      const out: NormalizedAliExpressCatalogItem[] = []
      for (const key of keys.keys()) {
        const entry = byKey.get(key)
        if (entry && entry.expiresAtMs > currentMs) out.push(entry.item)
      }
      return out
    },
    async findFresh(id: string): Promise<NormalizedAliExpressCatalogItem | null> {
      const key = id.startsWith("aliexpress:") ? id : `aliexpress:${id}`
      const entry = byKey.get(key)
      if (!entry) return null
      if (entry.expiresAtMs <= now()) { byKey.delete(key); return null }
      return entry.item
    },
  }
}

export type AliExpressCatalogService = ReturnType<typeof createAliExpressCatalogService>
