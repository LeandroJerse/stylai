import assert from "node:assert/strict"
import { createAliExpressAffiliateClient } from "@stylai/commerce"
import type { Json, PrivateDatabase } from "@stylai/supabase"
import { buildApp } from "../apps/api/src/app.js"
import { createAffiliateCatalogWorker } from "../apps/worker/src/affiliate-catalog.js"

/** The only double in this path is the marketplace HTTP response. */
export async function verifyAffiliateCatalogFlow(api: PrivateDatabase<"api">, db: PrivateDatabase<"catalog_worker">) {
  const productId = "1005000000000401"
  const productUrl = `https://pt.aliexpress.com/item/${productId}.html`
  const affiliateUrl = "https://s.click.aliexpress.com/e/workerFixture"
  const methods: string[] = []
  const client = createAliExpressAffiliateClient({
    appKey: "fixture-key", appSecret: "fixture-secret", trackingId: "stylai_fixture",
    acquire: () => db.call("take_affiliate_catalog_slot", 5, 20),
    async fetch(_url, request) {
      const form = new URLSearchParams(request.body)
      const method = form.get("method")
      assert(method)
      methods.push(method)
      let result
      if (method === "aliexpress.affiliate.product.query") {
        assert.equal(form.get("target_currency"), "BRL")
        assert.equal(form.get("ship_to_country"), "BR")
        result = { total_record_count: 1, products: [{
          product_id: productId, product_title: "Camisa de linho bege",
          product_main_image_url: "https://ae01.alicdn.com/kf/fixture.jpg",
          target_sale_price: "89.90", target_sale_price_currency: "BRL",
          product_detail_url: productUrl, shop_name: "Loja de teste", shop_id: "94",
        }] }
      } else {
        assert.equal(method, "aliexpress.affiliate.link.generate")
        assert.equal(form.get("tracking_id"), "stylai_fixture")
        assert.equal(form.get("source_values"), productUrl)
        result = { tracking_id: "stylai_fixture", promotion_links: [{ source_value: productUrl, promotion_link: affiliateUrl }] }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ resp_result: { resp_code: 200, result } }) }
    },
  })
  const catalog = createAffiliateCatalogWorker({
    client,
    config: {
      trackingId: "stylai_fixture", pageSize: 20, maxPagesPerSearch: 1, maxOffers: 20,
      refreshMs: 300_000, offerTtlMs: 600_000,
      collections: [{ slug: "linho", label: "Linho", searches: [{ keywords: "camisa de linho" }] }],
    },
    store: {
      async claim(slug, leaseSeconds) {
        const result = await db.call("claim_affiliate_collection", slug, leaseSeconds)
        assert(result === null || (typeof result === "object" && !Array.isArray(result) && typeof result.token === "string"))
        return result === null ? null : { token: (result as { token: string }).token }
      },
      publish: (job) => db.call("publish_affiliate_collection", job.slug, job.token, job.label, job.observedAt, job.expiresAt, job.nextDueAt,
        JSON.parse(JSON.stringify(job.offers)) as Json, job.withdrawn),
      retry: (slug, token, nextDueAt) => db.call("retry_affiliate_collection", slug, token, nextDueAt),
    },
  })
  assert.deepEqual(await catalog.refreshNext(), { status: "published", slug: "linho", count: 1 })
  assert.deepEqual(await catalog.refreshNext(), { status: "idle" })
  const app = await buildApp({ appOrigin: "http://localhost:5190", catalog: { db: api, catalogMode: "aliexpress_affiliate" } })
  try {
    const list = await app.inject("/v1/catalog/products?collection=linho")
    assert.equal(list.statusCode, 200)
    const [offer] = list.json().items
    assert.equal(list.json().total, 1)
    assert.equal(offer.id, `aliexpress:${productId}`)
    assert.deepEqual(offer.price, { amount: 89.90, currency: "BRL" })
    assert.equal(offer.links.affiliateUrl, affiliateUrl)
    assert.equal(offer.tryOnReady, false)
    assert(Date.parse(offer.offerExpiresAt) > Date.now())
    assert.equal((await app.inject("/v1/explore/hero")).json().hero.product.id, offer.id)
    assert.equal((await app.inject("/v1/catalog/facets")).json().collections[0].label, "Linho")
    assert.deepEqual(methods, ["aliexpress.affiliate.product.query", "aliexpress.affiliate.link.generate"])
  } finally { await app.close() }
  console.log("Worker → restricted PostgreSQL → public catalog passed with an AliExpress HTTP fixture.")
}
