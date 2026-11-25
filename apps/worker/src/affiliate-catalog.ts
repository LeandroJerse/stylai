import {
  ALIEXPRESS_LINK_BATCH_SIZE, AliExpressCatalogError, createAliExpressCatalogConnector, linkAliExpressCatalogItems, safeAliExpressUrl,
  type AliExpressAffiliateClient, type NormalizedAliExpressCatalogItem,
} from "@stylai/commerce"

export interface AffiliateCollection {
  slug: string
  label: string
  searches: Array<{ keywords: string; categoryIds?: string[] | undefined }>
  categories?: string[] | undefined
  minPriceMinor?: number | undefined
  maxPriceMinor?: number | undefined
}

export interface AffiliateCatalogConfig {
  collections: AffiliateCollection[]
  trackingId: string
  pageSize: number
  maxPagesPerSearch: number
  maxOffers: number
  refreshMs: number
  offerTtlMs: number
}

export interface AffiliateSnapshot {
  slug: string
  token: string
  label: string
  observedAt: string
  expiresAt: string
  nextDueAt: string
  offers: NormalizedAliExpressCatalogItem[]
  withdrawn: string[]
}

export interface AffiliateCatalogStore {
  claim(slug: string, leaseSeconds: number): Promise<{ token: string } | null>
  publish(snapshot: AffiliateSnapshot): Promise<boolean>
  retry(slug: string, token: string, nextDueAt: string): Promise<boolean>
}

type RefreshResult = { status: "idle" }
  | { status: "retry"; slug: string; reason: string }
  | { status: "lost_lease"; slug: string }
  | { status: "published"; slug: string; count: number }

const leaseSeconds = 600
const retryBaseMs = 60_000
const maximumBackoffMs = 30 * 60_000
const iso = (milliseconds: number) => new Date(milliseconds).toISOString()

function isEligible(item: NormalizedAliExpressCatalogItem, collection: AffiliateCollection) {
  return Boolean(item.productUrl && safeAliExpressUrl(item.productUrl, ["aliexpress.com"]))
    && item.priceMinor !== null && Number.isSafeInteger(item.priceMinor) && item.priceMinor > 0
    && item.name.trim().length > 0 && item.name.length <= 500
    && item.seller.length <= 100 && item.sellerName.length <= 200
    && (!collection.categories?.length || collection.categories.includes(item.category))
    && (collection.minPriceMinor === undefined || item.priceMinor >= collection.minPriceMinor)
    && (collection.maxPriceMinor === undefined || item.priceMinor <= collection.maxPriceMinor)
}

function reportedEmpty(error: unknown) {
  return error instanceof AliExpressCatalogError && error.kind === "business_error" && error.code === "405"
    && error.providerMessage?.toLowerCase() === "the result is empty"
}

export function createAffiliateCatalogWorker(deps: {
  client: AliExpressAffiliateClient
  store: AffiliateCatalogStore
  config: AffiliateCatalogConfig
  now?: () => number
}) {
  const { client, config, store } = deps
  const now = deps.now ?? Date.now
  const failures = new Map<string, number>()

  async function discover(collection: AffiliateCollection, observedAt: number) {
    const items = new Map<string, NormalizedAliExpressCatalogItem>()
    const searches = collection.searches.map((search) => ({
      connector: createAliExpressCatalogConnector({
        client, keywords: search.keywords, pageSize: config.pageSize, now: () => new Date(observedAt),
        ...(search.categoryIds ? { categoryIds: search.categoryIds } : {}),
      }),
      cursor: null as string | null,
      exhausted: false,
    }))
    for (let index = 0; index < config.maxPagesPerSearch; index++) {
      const pages: NormalizedAliExpressCatalogItem[][] = []
      for (const search of searches) {
        if (search.exhausted) continue
        try {
          const page = await search.connector.page(search.cursor)
          pages.push(page.items.filter((item) => isEligible(item, collection)))
          search.cursor = page.nextCursor
          search.exhausted = page.nextCursor === null
        } catch (error) {
          if (!reportedEmpty(error)) throw error
          search.exhausted = true
        }
      }
      // Interleave pages so a broad term cannot crowd out the other searches.
      const pageLength = Math.max(0, ...pages.map((page) => page.length))
      for (let position = 0; position < pageLength; position++) {
        for (const page of pages) {
          const item = page[position]
          if (!item || items.has(item.canonicalKey)) continue
          items.set(item.canonicalKey, item)
          if (items.size === config.maxOffers) return [...items.values()]
        }
      }
      if (searches.every((search) => search.exhausted)) break
    }
    return [...items.values()]
  }

  async function retry(slug: string, token: string, reason: string): Promise<RefreshResult> {
    const attempt = Math.min((failures.get(slug) ?? 0) + 1, 6)
    failures.set(slug, attempt)
    const backoff = Math.min(retryBaseMs * 2 ** (attempt - 1), maximumBackoffMs)
    if (!await store.retry(slug, token, iso(now() + backoff))) return { status: "lost_lease", slug }
    return { status: "retry", slug, reason }
  }

  async function refresh(collection: AffiliateCollection, token: string): Promise<RefreshResult> {
    const { slug, label } = collection
    const observedAt = now()
    const expiresAt = observedAt + config.offerTtlMs
    let items: NormalizedAliExpressCatalogItem[]
    try {
      // Re-running the collection queries re-observes earlier matches. An absent result does not
      // establish delisting and must not extend, hide, or withdraw a previous valid observation.
      items = await discover(collection, observedAt)
    } catch (error) {
      return retry(slug, token, error instanceof AliExpressCatalogError ? error.kind : "discovery_failed")
    }
    if (now() >= expiresAt) return retry(slug, token, "observation_expired")
    const offers: NormalizedAliExpressCatalogItem[] = []
    for (let from = 0; from < items.length; from += ALIEXPRESS_LINK_BATCH_SIZE) {
      const batch = items.slice(from, from + ALIEXPRESS_LINK_BATCH_SIZE)
      const linked = await linkAliExpressCatalogItems(client, batch, config.trackingId)
      if (now() >= expiresAt) return retry(slug, token, "observation_expired")
      if (linked.links === "failed" || linked.links === "missing_tracking_id") {
        return retry(slug, token, linked.linkErrorCode ?? "affiliate_links_unavailable")
      }
      offers.push(...linked.items.filter((item) => item.affiliateUrl !== null))
    }
    if (items.length && !offers.length) return retry(slug, token, "unmatched_links")
    const published = await store.publish({
      slug, label, token, observedAt: iso(observedAt), expiresAt: iso(expiresAt),
      nextDueAt: iso(now() + config.refreshMs),
      offers, withdrawn: [],
    })
    if (!published) return { status: "lost_lease", slug }
    failures.delete(slug)
    return { status: "published", slug, count: offers.length }
  }

  return {
    async refreshNext(): Promise<RefreshResult> {
      for (const collection of config.collections) {
        const lease = await store.claim(collection.slug, leaseSeconds)
        if (lease) return refresh(collection, lease.token)
      }
      return { status: "idle" }
    },
  }
}
