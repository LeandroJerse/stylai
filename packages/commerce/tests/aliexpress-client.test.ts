import { describe, expect, test } from "bun:test"
import { ALIEXPRESS_BUSINESS_GATEWAY, createAliExpressAffiliateClient, signAliExpressRequest, type AliExpressFetch } from "../src/index"

const SECRET = "synthetic-app-secret-value"
const product = {
  product_id: "1005001234567890", product_title: "Vestido midi floral",
  product_main_image_url: "https://ae01.alicdn.com/kf/S123.jpg", target_sale_price: "89.90", target_sale_price_currency: "BRL",
  product_detail_url: "https://pt.aliexpress.com/item/1005001234567890.html", promotion_link: "https://s.click.aliexpress.com/e/_synthetic",
  shop_name: "Loja X", shop_id: 42, second_level_category_name: "Vestidos",
}

function harness(respond: () => Promise<{ ok: boolean; status: number; body: string }>) {
  const calls: { url: string; method: string; form: URLSearchParams }[] = []
  const fetch: AliExpressFetch = async (url, init) => {
    calls.push({ url, method: init.method, form: new URLSearchParams(init.body) })
    const r = await respond()
    return { ok: r.ok, status: r.status, text: async () => r.body }
  }
  const client = createAliExpressAffiliateClient({ appKey: "500000", appSecret: SECRET, trackingId: "stylai_br", fetch, now: () => 1_700_000_000_000 })
  return { client, calls }
}
const ok = (body: unknown) => async () => ({ ok: true, status: 200, body: JSON.stringify(body) })

describe("AliExpress affiliate client", () => {
  test("signs a business call with app key only (no access_token) and parses the wrapped response", async () => {
    const { client, calls } = harness(ok({ aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, resp_msg: "success", result: { total_record_count: 1, products: { product: [product] } } }, request_id: "req-1" } }))
    const result = await client.queryProducts({ keywords: " vestido ", pageSize: 99 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.products[0]).toMatchObject({ productId: "1005001234567890", targetSalePrice: "89.90", targetSalePriceCurrency: "BRL", shopId: "42" })
    expect(result.requestId).toBe("req-1")
    const call = calls[0]!
    expect(call.url).toBe(ALIEXPRESS_BUSINESS_GATEWAY)
    expect(call.method).toBe("POST")
    const form = Object.fromEntries(call.form)
    expect(form).toMatchObject({ method: "aliexpress.affiliate.product.query", app_key: "500000", sign_method: "sha256", timestamp: "1700000000000", keywords: "vestido", page_size: "50", target_currency: "BRL", ship_to_country: "BR", tracking_id: "stylai_br" })
    expect(form.access_token).toBeUndefined()
    const { sign, ...unsigned } = form
    expect(sign).toBe(signAliExpressRequest(unsigned, SECRET))
  })

  test("accepts the streamlined shape with a products array", async () => {
    const { client } = harness(ok({ code: "0", resp_result: { resp_code: "200", result: { products: [product, { product_id: "x" }] } }, request_id: "r" }))
    const result = await client.queryProducts({ keywords: "vestido" })
    expect(result.ok && result.products.length).toBe(1)
  })

  test("classifies provider, business, http, network and malformed failures without leaking secrets", async () => {
    const cases: [() => Promise<{ ok: boolean; status: number; body: string }>, string, string | null][] = [
      [ok({ error_response: { code: "IncompleteSignature", msg: `bad ${SECRET}`, request_id: "e1" } }), "provider_error", "IncompleteSignature"],
      [ok({ error_response: { code: `<script>${SECRET}`, msg: "x" } }), "provider_error", "unrecognized"],
      [ok({ resp_result: { resp_code: "405", resp_msg: "no result" } }), "business_error", "405"],
      [async () => ({ ok: false, status: 500, body: SECRET }), "http", "500"],
      [async () => { throw new Error(SECRET) }, "network", null],
      [async () => ({ ok: true, status: 200, body: "<html>" }), "invalid_response", null],
      [ok({ code: "15", msg: "Remote service error" }), "provider_error", "15"],
    ]
    for (const [respond, kind, code] of cases) {
      const result = await harness(respond).client.queryProducts({ keywords: "vestido" })
      expect(result).toMatchObject({ ok: false, kind, code })
      expect(JSON.stringify(result)).not.toContain(SECRET)
    }
  })

  test("generates links only for https AliExpress sources and requires full configuration", async () => {
    const { client, calls } = harness(ok({ resp_result: { resp_code: "200", result: { promotion_links: { promotion_link: [{ source_value: "https://pt.aliexpress.com/item/1.html", promotion_link: "https://s.click.aliexpress.com/e/_a" }] } } } }))
    expect(await client.generateLinks(["http://evil.test/", "https://aliexpress.com.evil.test/x"])).toMatchObject({ ok: false, code: "no_valid_source" })
    expect(calls).toHaveLength(0)
    const result = await client.generateLinks(["https://pt.aliexpress.com/item/1.html"])
    expect(result.ok && result.links).toEqual([{ sourceValue: "https://pt.aliexpress.com/item/1.html", promotionLink: "https://s.click.aliexpress.com/e/_a" }])
    expect(Object.fromEntries(calls[0]!.form)).toMatchObject({ method: "aliexpress.affiliate.link.generate", promotion_link_type: "0", tracking_id: "stylai_br", ship_to_country: "BR", source_values: "https://pt.aliexpress.com/item/1.html" })
    expect(() => createAliExpressAffiliateClient({ appKey: "k", appSecret: "", trackingId: "t" })).toThrow()
    expect(() => createAliExpressAffiliateClient({ appKey: "", appSecret: "s", trackingId: "t" })).toThrow()
  })

  test("reports the tracking_id echoed by link.generate so callers can compare it with the one sent", async () => {
    const { client } = harness(ok({ aliexpress_affiliate_link_generate_response: { resp_result: { resp_code: 200, result: { tracking_id: "stylai_br", total_result_count: 1, promotion_links: { promotion_link: [{ source_value: "https://pt.aliexpress.com/item/1.html", promotion_link: "https://s.click.aliexpress.com/e/_b" }] } } } } }))
    const result = await client.generateLinks(["https://pt.aliexpress.com/item/1.html"])
    expect(result).toMatchObject({ ok: true, trackingId: "stylai_br" })
    const { client: silent } = harness(ok({ resp_result: { resp_code: "200", result: { promotion_links: [] } } }))
    expect(await silent.generateLinks(["https://pt.aliexpress.com/item/1.html"])).toMatchObject({ ok: true, trackingId: null, links: [] })
  })

  test("never follows redirects, so the signed body cannot be re-sent to another host", async () => {
    const seen: (string | undefined)[] = []
    const fetch: AliExpressFetch = async (_url, init) => { seen.push(init.redirect); return { ok: true, status: 200, text: async () => "{}" } }
    const client = createAliExpressAffiliateClient({ appKey: "500000", appSecret: SECRET, trackingId: "stylai_br", fetch })
    await client.queryProducts({ keywords: "vestido" })
    await client.generateLinks(["https://pt.aliexpress.com/item/1.html"])
    expect(seen).toEqual(["error", "error"])
  })

  test("queries products without a tracking ID (optional per docs) but refuses link generation", async () => {
    const calls: URLSearchParams[] = []
    const fetch: AliExpressFetch = async (_url, init) => {
      calls.push(new URLSearchParams(init.body))
      return { ok: true, status: 200, text: async () => JSON.stringify({ resp_result: { resp_code: "200", result: { products: [product] } } }) }
    }
    const client = createAliExpressAffiliateClient({ appKey: "500000", appSecret: SECRET, trackingId: null, fetch })
    const result = await client.queryProducts({ keywords: "vestido", pageSize: 5 })
    expect(result.ok && result.products.length).toBe(1)
    expect(calls[0]!.has("tracking_id")).toBe(false)
    expect(await client.generateLinks(["https://pt.aliexpress.com/item/1.html"])).toMatchObject({ ok: false, kind: "configuration", code: "missing_tracking_id" })
    expect(calls).toHaveLength(1)
  })

  test("aborts slow calls at the configured timeout and reports a network failure", async () => {
    const fetch: AliExpressFetch = (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error(`timeout ${SECRET}`)))
    })
    const client = createAliExpressAffiliateClient({ appKey: "500000", appSecret: SECRET, trackingId: null, fetch, timeoutMs: 20 })
    const result = await client.queryProducts({ keywords: "vestido" })
    expect(result).toEqual({ ok: false, kind: "network", code: null, requestId: null })
  })
})
