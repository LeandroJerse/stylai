import { describe, expect, test } from "bun:test"
import { createAliExpressAffiliateClient, type AliExpressFetch } from "@stylai/commerce"
import { createAffiliateCatalogWorker, type AffiliateCatalogConfig, type AffiliateCollection } from "../src/affiliate-catalog.js"
import { readAffiliateCatalogConfig } from "../src/affiliate-catalog-config.js"

const observed = "2026-11-25T18:00:00.000Z"
const base = Date.parse(observed)
const collection: AffiliateCollection = { slug: "camisas", label: "Camisas", searches: [{ keywords: "camisa linho", categoryIds: ["200000668"] }], categories: ["shirts"], minPriceMinor: 5000, maxPriceMinor: 20000 }
const config = { collections: [collection], pageSize: 2, maxPagesPerSearch: 2, maxOffers: 30, offerTtlMs: 7_200_000, refreshMs: 3_600_000, trackingId: "stylai-test" }
const product = (id: number, extra = {}) => ({
  product_id: id,
  product_title: "Camisa de linho",
  target_sale_price: "109.99",
  target_sale_price_currency: "BRL",
  product_detail_url: `https://pt.aliexpress.com/item/${id}.html?foreign=1`,
  product_main_image_url: "https://ae01.alicdn.com/kf/camisa.jpg",
  promotion_link: "https://s.click.aliexpress.com/e/foreign",
  ...extra,
})

const reply = (result: unknown, code = 200) => ({
  ok: true, status: 200, text: async () => JSON.stringify({ resp_result: { resp_code: code, result } }),
})

function setup(source: AliExpressFetch, clock: () => number = () => base, runtime: Partial<AffiliateCatalogConfig> = {}) {
  const claims: string[] = []
  const published: unknown[] = []
  const retried: string[] = []
  const client = createAliExpressAffiliateClient({ appKey: "test-app", appSecret: "test-secret", trackingId: config.trackingId, fetch: source })
  const worker = createAffiliateCatalogWorker({
    client, config: { ...config, ...runtime }, now: clock,
    store: {
      async claim(slug) { claims.push(slug); return { token: "lease" } },
      async publish(snapshot) { published.push(snapshot); return true },
      async retry(_slug, _token, dueAt) { retried.push(dueAt); return true },
    },
  })
  return { worker, claims, published, retried }
}

describe("affiliate catalog refresh", () => {
  test("discovers bounded pages, deduplicates listings, and only publishes BR offers with their generated link", async () => {
    const pages: string[] = []
    const result = setup(async (_url, request) => {
      const form = new URLSearchParams(request.body)
      if (form.get("method") === "aliexpress.affiliate.product.query") {
        expect(form.get("ship_to_country")).toBe("BR")
        expect(form.get("category_ids")).toBe("200000668")
        pages.push(form.get("page_no")!)
        const firstPage = form.get("page_no") === "1"
        return reply({ total_record_count: 999, products: firstPage ? [product(1001), product(1002, { product_title: "Vestido longo" })] : [product(1001), product(1003, { target_sale_price_currency: "USD" })] })
      }
      expect(form.get("source_values")).toBe("https://pt.aliexpress.com/item/1001.html")
      return reply({ tracking_id: "stylai-test", promotion_links: [{ source_value: form.get("source_values"), promotion_link: "https://s.click.aliexpress.com/e/ours" }] })
    })
    expect(await result.worker.refreshNext()).toMatchObject({ status: "published", count: 1 })
    expect(pages).toEqual(["1", "2"])
    expect(result.published).toEqual([expect.objectContaining({
      slug: "camisas", label: "Camisas", token: "lease", observedAt: observed, expiresAt: "2026-11-25T20:00:00.000Z",
      nextDueAt: "2026-11-25T19:00:00.000Z",
      offers: [expect.objectContaining({ canonicalKey: "aliexpress:1001", affiliateUrl: "https://s.click.aliexpress.com/e/ours", priceMinor: 10999, priceObservedAt: observed })],
      withdrawn: [],
    })])
  })

  test("link tracking mismatch retries without overwriting earlier observations", async () => {
    const result = setup(async (_url, request) => new URLSearchParams(request.body).get("method") === "aliexpress.affiliate.product.query"
      ? reply({ total_record_count: 1, products: [product(1001)] })
      : reply({ tracking_id: "foreign", promotion_links: [{ source_value: "https://pt.aliexpress.com/item/1001.html", promotion_link: "https://s.click.aliexpress.com/e/foreign" }] }))
    expect(await result.worker.refreshNext()).toMatchObject({ status: "retry", reason: "tracking_id_mismatch" })
    expect(result.published).toEqual([])
    expect(result.retried).toEqual(["2026-11-25T18:01:00.000Z"])
  })

  test("a failed later page does not publish a partial page or mistake an outage for a withdrawal", async () => {
    const result = setup(async (_url, request) => new URLSearchParams(request.body).get("page_no") === "1"
      ? reply({ total_record_count: 5, products: [product(1001), product(1002)] })
      : { ok: false, status: 503, text: async () => "" })
    expect(await result.worker.refreshNext()).toMatchObject({ status: "retry", reason: "http" })
    expect(result.published).toHaveLength(0)
  })

  test("treats a provider-confirmed empty search as empty discovery without withdrawing anything", async () => {
    const result = setup(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ resp_result: { resp_code: 405, resp_msg: "The result is empty" } }) }))
    expect(await result.worker.refreshNext()).toMatchObject({ status: "published", count: 0 })
    expect(result.published).toEqual([expect.objectContaining({ offers: [], withdrawn: [] })])
  })

  test("an observation that expired before publishing is retried", async () => {
    let wallClock = base
    const result = setup(async (_url, request) => {
      if (new URLSearchParams(request.body).get("method") === "aliexpress.affiliate.product.query") return reply({ total_record_count: 1, products: [product(1001)] })
      wallClock += config.offerTtlMs
      return reply({ tracking_id: "stylai-test", promotion_links: [] })
    }, () => wallClock)
    expect(await result.worker.refreshNext()).toMatchObject({ status: "retry", reason: "observation_expired" })
    expect(result.published).toEqual([])
  })

  test("batches 51 distinct source URLs without mixing their affiliate offers", async () => {
    const linkBatchSizes: number[] = []
    const result = setup(async (_url, request) => {
      const form = new URLSearchParams(request.body)
      if (form.get("method") === "aliexpress.affiliate.product.query") {
        const first = form.get("page_no") === "1"
        return reply({ total_record_count: 51, products: first ? Array.from({ length: 50 }, (_, index) => product(1001 + index)) : [product(1051)] })
      }
      const values = form.get("source_values")!.split(",")
      linkBatchSizes.push(values.length)
      return reply({
        tracking_id: "stylai-test",
        promotion_links: values.map((url) => ({ source_value: url, promotion_link: `https://s.click.aliexpress.com/e/${url.match(/\d+/)![0]}` })),
      })
    }, undefined, { pageSize: 50, maxOffers: 60 })
    expect(await result.worker.refreshNext()).toMatchObject({ status: "published", count: 51 })
    expect(linkBatchSizes).toEqual([50, 1])
    expect(result.published).toEqual([expect.objectContaining({
      offers: expect.arrayContaining([expect.objectContaining({ canonicalKey: "aliexpress:1051", affiliateUrl: "https://s.click.aliexpress.com/e/1051" })]),
    })])
  })

  test("drops a listing whose product ID does not correspond to its canonical shop URL", async () => {
    const requests: string[] = []
    const result = setup(async (_url, request) => {
      requests.push(new URLSearchParams(request.body).get("method")!)
      return reply({ total_record_count: 1, products: [product(1001, { product_detail_url: "https://pt.aliexpress.com/item/1002.html" })] })
    })
    expect(await result.worker.refreshNext()).toMatchObject({ status: "published", count: 0 })
    expect(requests).toEqual(["aliexpress.affiliate.product.query"])
  })

  test("does not call AliExpress when no catalog lease is available", async () => {
    const client = createAliExpressAffiliateClient({ appKey: "test-app", appSecret: "test-secret", trackingId: "stylai-test",
      fetch: async () => { throw new Error("the worker called the affiliate API without a lease") } })
    const worker = createAffiliateCatalogWorker({ client, config, store: {
      async claim() { return null },
      async publish() { throw new Error("the worker published without a lease") },
      async retry() { throw new Error("the worker retried without a lease") },
    } })
    expect(await worker.refreshNext()).toEqual({ status: "idle" })
  })

  test("backs off after repeated source failures and leaves existing offers untouched", async () => {
    const result = setup(async () => ({ ok: false, status: 503, text: async () => "" }))
    await result.worker.refreshNext()
    await result.worker.refreshNext()
    expect(result.retried).toEqual(["2026-11-25T18:01:00.000Z", "2026-11-25T18:02:00.000Z"])
    expect(result.published).toEqual([])
  })

  test("a slow successful refresh leaves a future due time for publication", async () => {
    let wallClock = base
    const result = setup(async (_url, request) => {
      const method = new URLSearchParams(request.body).get("method")
      if (method === "aliexpress.affiliate.product.query") return reply({ total_record_count: 1, products: [product(1001)] })
      wallClock += 61_000
      return reply({ tracking_id: "stylai-test", promotion_links: [{ source_value: "https://pt.aliexpress.com/item/1001.html", promotion_link: "https://s.click.aliexpress.com/e/ours" }] })
    }, () => wallClock, { refreshMs: 60_000 })
    expect(await result.worker.refreshNext()).toMatchObject({ status: "published", count: 1 })
    expect(result.published).toEqual([expect.objectContaining({ nextDueAt: "2026-11-25T18:02:01.000Z" })])
  })

  test("a broad search cannot use every slot in a collection with several terms", async () => {
    const result = setup(async (_url, request) => {
      const form = new URLSearchParams(request.body)
      if (form.get("method") === "aliexpress.affiliate.product.query") {
        return reply({ total_record_count: 3, products: form.get("keywords") === "camisa social" ? [product(2001)] : [product(1001), product(1002), product(1003)] })
      }
      const urls = form.get("source_values")!.split(",")
      return reply({ tracking_id: "stylai-test", promotion_links: urls.map((url) => ({
        source_value: url, promotion_link: `https://s.click.aliexpress.com/e/${url.match(/\d+/)![0]}`,
      })) })
    }, undefined, { pageSize: 3, maxOffers: 2, collections: [{ ...collection, searches: [{ keywords: "camisa linho" }, { keywords: "camisa social" }] }] })
    expect(await result.worker.refreshNext()).toMatchObject({ status: "published", count: 2 })
    expect(result.published).toEqual([expect.objectContaining({
      offers: [expect.objectContaining({ canonicalKey: "aliexpress:1001" }), expect.objectContaining({ canonicalKey: "aliexpress:2001" })],
    })])
  })

  test("one oversized listing does not poison an otherwise valid refresh", async () => {
    const result = setup(async (_url, request) => {
      const form = new URLSearchParams(request.body)
      if (form.get("method") === "aliexpress.affiliate.product.query") {
        return reply({ total_record_count: 2, products: [product(1001, { shop_name: "a".repeat(201) }), product(1002)] })
      }
      expect(form.get("source_values")).toBe("https://pt.aliexpress.com/item/1002.html")
      return reply({ tracking_id: "stylai-test", promotion_links: [{ source_value: form.get("source_values"), promotion_link: "https://s.click.aliexpress.com/e/ours" }] })
    })
    expect(await result.worker.refreshNext()).toMatchObject({ status: "published", count: 1 })
  })
})

const env = {
  ALIEXPRESS_APP_KEY: "app-key",
  ALIEXPRESS_APP_SECRET: "app-secret",
  ALIEXPRESS_TRACKING_ID: "stylai-test",
  ALIEXPRESS_CALLS_PER_MINUTE: "10",
  ALIEXPRESS_CALLS_PER_DAY: "100",
  STYLAI_CATALOG_CALLS_PER_MINUTE: "5",
  STYLAI_CATALOG_CALLS_PER_DAY: "60",
  STYLAI_CATALOG_REFRESH_MINUTES: "45",
  STYLAI_CATALOG_OFFER_TTL_MINUTES: "60",
  STYLAI_CATALOG_COLLECTIONS: JSON.stringify([collection]),
}

describe("catalog worker runtime settings", () => {
  test("uses explicit freshness and shared quota headroom", () => {
    expect(readAffiliateCatalogConfig(env)).toMatchObject({ trackingId: "stylai-test", minuteLimit: 5, dailyLimit: 60, refreshMs: 2_700_000, offerTtlMs: 3_600_000 })
  })

  test("fails closed without explicit retention settings or when worker limits could exhaust shared quotas", () => {
    expect(() => readAffiliateCatalogConfig({ ...env, STYLAI_CATALOG_OFFER_TTL_MINUTES: undefined })).toThrow("STYLAI_CATALOG_OFFER_TTL_MINUTES")
    expect(() => readAffiliateCatalogConfig({ ...env, STYLAI_CATALOG_CALLS_PER_MINUTE: "10" })).toThrow("STYLAI_CATALOG_CALLS_PER_MINUTE")
    expect(() => readAffiliateCatalogConfig({ ...env, STYLAI_CATALOG_CALLS_PER_MINUTE: "2" })).toThrow("STYLAI_CATALOG_CALLS_PER_MINUTE")
    expect(() => readAffiliateCatalogConfig({ ...env, STYLAI_CATALOG_CALLS_PER_DAY: "99" })).toThrow("STYLAI_CATALOG_CALLS_PER_DAY")
  })
})
