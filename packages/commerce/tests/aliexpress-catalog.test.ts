import { describe, expect, test } from "bun:test"
import { AliExpressCatalogError, createAliExpressCatalogConnector, normalizeAliExpressProduct, type AliExpressAffiliateClient, type AliExpressProductRaw } from "../src/index"

const raw = (overrides: Partial<AliExpressProductRaw> = {}): AliExpressProductRaw => ({
  productId: "1005001", title: "Vestido longo verde", mainImageUrl: "https://ae01.alicdn.com/kf/a.jpg",
  targetSalePrice: "129.9", targetSalePriceCurrency: "BRL", detailUrl: "https://pt.aliexpress.com/item/1005001.html",
  promotionLink: "https://s.click.aliexpress.com/e/_x", shopName: "Loja", shopId: "9", firstLevelCategoryName: null, secondLevelCategoryName: null,
  ...overrides,
})

describe("AliExpress catalog normalization", () => {
  test("distinguishes outfit sets, dress shirts and denim jackets", () => {
    for (const [title, category] of [
      ["Conjunto masculino camisa e calça linho", "outfit_sets"],
      ["Men shirt and pants two piece set", "outfit_sets"],
      ["Conjunto de Moda Masculina em Linho, Blazer + Calças", "outfit_sets"],
      ["Conjunto de 2 Peças: Jaqueta com Zíper + Calças Retas", "outfit_sets"],
      ["Conjunto Colete com Fivela + Calças de Cintura Alta", "outfit_sets"],
      ["Conjunto blazer + bermuda", "outfit_sets"],
      ["Men dress shirt long sleeve", "shirts"],
      ["Jaqueta jeans masculina", "jackets"],
      ["Camisa masculina de linho", "shirts"],
    ] as const) {
      const result = normalizeAliExpressProduct(raw({ title, secondLevelCategoryName: "Men's Clothing" }), "t")
      expect(result.accepted && result.item.category).toBe(category)
      expect(result.accepted && result.item.capabilities.aiTryOn).toBe(false)
    }
  })
  test("keeps display/link separate from AI try-on and never invents variants", () => {
    const outcome = normalizeAliExpressProduct(raw(), "2026-11-23T00:00:00.000Z")
    expect(outcome.accepted).toBe(true)
    if (!outcome.accepted) return
    expect(outcome.item).toMatchObject({
      source: "aliexpress", canonicalKey: "aliexpress:1005001", category: "dresses", priceMinor: 12990, currency: "BRL",
      // The query's promotion_link is never adopted: affiliate links only come from link.generate.
      variants: [], affiliateUrl: null, fixture: false,
      rights: { basis: "unconfirmed", tryOnAllowed: false },
      capabilities: { displayAndLink: true, aiTryOn: false, aiTryOnBlockedReason: "ai_image_rights_unconfirmed" },
    })
  })

  test("rejects non-BRL prices, non-https or foreign images and malformed prices; drops untrusted links", () => {
    expect(normalizeAliExpressProduct(raw({ targetSalePriceCurrency: "USD" }), "t")).toMatchObject({ accepted: false, reason: "unsupported_currency" })
    expect(normalizeAliExpressProduct(raw({ mainImageUrl: "http://ae01.alicdn.com/a.jpg" }), "t")).toMatchObject({ accepted: false, reason: "missing_https_image" })
    expect(normalizeAliExpressProduct(raw({ mainImageUrl: "https://evil.test/a.jpg" }), "t")).toMatchObject({ accepted: false, reason: "missing_https_image" })
    expect(normalizeAliExpressProduct(raw({ targetSalePrice: "12,90" }), "t")).toMatchObject({ accepted: false, reason: "invalid_price_format" })
    const noPrice = normalizeAliExpressProduct(raw({ targetSalePrice: null, targetSalePriceCurrency: null, promotionLink: "http://s.click.aliexpress.com/e/_x", detailUrl: "https://evil.test/" }), "t")
    expect(noPrice.accepted && [noPrice.item.priceMinor, noPrice.item.priceObservedAt, noPrice.item.affiliateUrl, noPrice.item.productUrl]).toEqual([null, null, null, null])
  })

  test("connector pages by number, dedupes, counts rejects and throws instead of falling back", async () => {
    let fail = false
    const client = {
      async queryProducts(query: { pageNo?: number }) {
        if (fail) return { ok: false as const, kind: "provider_error" as const, code: "AppKeyNotAuthorized", requestId: null }
        return { ok: true as const, products: [raw(), raw(), raw({ productId: "2", targetSalePriceCurrency: "USD" })], pageNo: query.pageNo ?? 1, totalRecordCount: 45, requestId: "r" }
      },
      async generateLinks() { throw new Error("unused") },
    } as unknown as AliExpressAffiliateClient
    const connector = createAliExpressCatalogConnector({ client, keywords: "vestido", pageSize: 20 })
    const first = await connector.page(null)
    expect([first.items.length, first.rejectedCount, first.nextCursor]).toEqual([1, 1, "2"])
    expect((await connector.list("3")).nextCursor).toBeNull()
    await expect(connector.list("0")).rejects.toBeInstanceOf(AliExpressCatalogError)
    fail = true
    await expect(connector.list(null)).rejects.toMatchObject({ kind: "provider_error", code: "AppKeyNotAuthorized" })
  })
})
