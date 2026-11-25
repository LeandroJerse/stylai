import { describe, expect, test } from "bun:test"
import { AliExpressCatalogError, createAliExpressAffiliateClient, createAliExpressCatalogConnector, normalizeAliExpressProduct, type AliExpressAffiliateClient, type AliExpressProductRaw } from "../src/index"

const raw = (overrides: Partial<AliExpressProductRaw> = {}): AliExpressProductRaw => ({
  productId: "1005001", title: "Vestido longo verde", mainImageUrl: "https://ae01.alicdn.com/kf/a.jpg",
  targetSalePrice: "129.9", targetSalePriceCurrency: "BRL", detailUrl: "https://pt.aliexpress.com/item/1005001.html",
  promotionLink: "https://s.click.aliexpress.com/e/_x", shopName: "Loja", shopId: "9", firstLevelCategoryName: null, secondLevelCategoryName: null,
  ...overrides,
})

describe("AliExpress catalog normalization", () => {
  test("a full provider page without a total can continue to the next page", async () => {
    const client = createAliExpressAffiliateClient({
      appKey: "test-app", appSecret: "test-secret",
      fetch: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({
        resp_result: { resp_code: "200", result: { products: [{
          product_id: "1005001", product_title: "Vestido longo verde", product_main_image_url: "https://ae01.alicdn.com/kf/a.jpg",
        }] } },
      }) }),
    })
    const connector = createAliExpressCatalogConnector({ client, keywords: "vestido", pageSize: 1 })
    expect((await connector.page(null)).nextCursor).toBe("2")
  })

  test("distinguishes outfit sets, dress shirts and denim jackets", () => {
    for (const [title, category] of [
      ["Conjunto masculino camisa e calça linho", "outfit_sets"],
      ["Men shirt and pants two piece set", "outfit_sets"],
      ["Conjunto de Moda Masculina em Linho, Blazer + Calças", "outfit_sets"],
      ["Conjunto de 2 Peças: Jaqueta com Zíper + Calças Retas", "outfit_sets"],
      ["Conjunto Colete com Fivela + Calças de Cintura Alta", "outfit_sets"],
      ["Conjunto blazer + bermuda", "outfit_sets"],
      ["Conjunto masculino de inverno 2 peças", "outfit_sets"],
      ["Terno masculino slim fit", "outfit_sets"],
      ["Conjunto de suéter e calça feminino", "outfit_sets"],
      ["Suéter masculino de tricô gola alta", "tops"],
      ["Sobretudo feminino de lã", "jackets"],
      ["Parka masculina com capuz", "jackets"],
      ["Cardigan de tricô", "jackets"],
      // Real listings seen on 2026-11-24: a set must never pass as one loose piece.
      ["Blusa Casual de Manga Longa em Cor Sólida com Calças Boca de Sino", "outfit_sets"],
      ["Conjunto casual masculino de linho, lapela elástica, mangas curtas e calças macias", "outfit_sets"],
      ["Conjunto de Suéter Masculino de Gola Redonda com Estampa 3D", "uncategorized"],
      ["Conjunto de Roupa Masculina de Inverno: Jaqueta de Algodão", "uncategorized"],
      ["Calça social masculina, combina com camisa e blazer", "pants"],
      ["Camisa social masculina para usar com calça", "shirts"],
      // Accessories and costumes that only MENTION a garment (real results for "terno masculino", 2026-11-24).
      ["Peruca Bob Curta de Fibra Sintética, Estilo Masculino Elegante, para Banquete, Terno e Baile", "uncategorized"],
      ["Oferta por tempo limitado! Moda europeia terno broche pino corrente borla, perfeito para ternos masculinos", "uncategorized"],
      ["Caixa de presente com gravata e lenço de bolso para homens, acessórios de terno clássico", "uncategorized"],
      ["Halloween rei triton traje masculino poseidon merman terno sereia", "uncategorized"],
      ["Gravata Impermeável para Casamento, Gravatas Listradas para Camisa Social Masculina", "uncategorized"],
      ["Abotoaduras Requintadas para Camisa Social Masculina", "uncategorized"],
      ["Masculino corporal hussar militar coaplay traje jaqueta oficial casaco", "uncategorized"],
      ["Calça social masculina com cinto", "pants"],
      ["Terno masculino 3 peças blazer colete e calça", "outfit_sets"],
      ["Conjunto de panelas 2 peças", "uncategorized"],
      ["Conjunto de lingerie 2 peças", "uncategorized"],
      ["Calça de terno social", "pants"],
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
