import { describe, expect, test } from "bun:test"
import { createAliExpressAffiliateClient, normalizeAliExpressProduct, type AliExpressFetch } from "../src/index"

const base = {
  product_id: "1005001234567890", product_title: "Vestido midi floral", product_main_image_url: "https://ae01.alicdn.com/kf/S123.jpg",
  target_sale_price: "89.90", target_sale_price_currency: "BRL", product_detail_url: "https://pt.aliexpress.com/item/1005001234567890.html",
}
async function read(extra: Record<string, unknown>) {
  const fetch: AliExpressFetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: { products: { product: [{ ...base, ...extra }] } } } } }) })
  const r = await createAliExpressAffiliateClient({ appKey: "500000", appSecret: "synthetic-app-secret-value", fetch }).queryProducts({ keywords: "vestido" })
  if (!r.ok) throw new Error(r.kind)
  const n = normalizeAliExpressProduct(r.products[0]!, "2026-11-24T00:00:00.000Z")
  if (!n.accepted) throw new Error(n.reason)
  return { rating: n.item.ratingPercent, sales: n.item.recentSales }
}

describe("store rating and sales", () => {
  test("percentage and units are read as the store sends them", async () => expect(await read({ evaluate_rate: "92.1%", lastest_volume: 1830 })).toEqual({ rating: 92.1, sales: 1830 }))
  test("missing stays unknown, never zero", async () => expect(await read({})).toEqual({ rating: null, sales: null }))
  test("a bare number is not a percentage (it could be stars)", async () => expect(await read({ evaluate_rate: "4.6" })).toEqual({ rating: null, sales: null }))
  test("values out of range or malformed are ignored", async () => expect(await read({ evaluate_rate: "140%", lastest_volume: "1.2k" })).toEqual({ rating: null, sales: null }))
})
