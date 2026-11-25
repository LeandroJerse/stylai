import { describe, expect, test } from "bun:test"
import { parseFacets, parseLook, parseProduct, parseStudioConfig } from "../src/api/parse"
import { rankOffers, sumLookWith, withOffer } from "../src/lib/offers"

const product = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Trench de gabardine",
  partner: { id: "aurora", name: "Loja Aurora" },
  price: { amount: 899, currency: "BRL" },
  images: [{ url: "https://cdn.x/p1.jpg" }],
  links: { productUrl: "https://aurora.x/p1" },
  ...over,
})

const offers = [
  { partner: { id: "sul", name: "Mercado Sul" }, price: { amount: 849, currency: "BRL" }, links: { productUrl: "https://sul.x/p1" } },
  { partner: { id: "oeste", name: "Vitrine Oeste" }, price: { amount: 799, currency: "BRL" }, links: { affiliateUrl: "https://oeste.x/p1?aff=1" } },
  { partner: { id: "linho", name: "Casa Linho" }, price: { amount: 935, currency: "BRL" }, links: { productUrl: "javascript:alert(1)" } },
]

describe("parseProduct offers", () => {
  test("retains a valid expiry from the affiliate offer and accepts older responses without it", () => {
    const offerExpiresAt = "2026-11-25T18:30:00.000Z"
    expect(parseProduct(product({ offerExpiresAt })).offerExpiresAt).toBe(offerExpiresAt)
    expect(parseProduct(product()).offerExpiresAt).toBeNull()
  })
  test("parses only valid published collections, and accepts old facet responses", () => {
    const collections = [{ id: "linho", label: "Linho", count: 4 }, { label: "Inválida" }]
    expect(parseFacets({ collections }).collections).toEqual([{ id: "linho", label: "Linho", count: 4 }])
    expect(parseFacets({}).collections).toEqual([])
  })
  test("an expired offer exposes neither old prices nor links, even when changing its store", () => {
    const p = parseProduct(product({ offers, offerExpiresAt: "2000-01-01T00:00:00Z" }))
    const selected = withOffer(p, "oeste")
    expect(selected.partner.name).toBe("Vitrine Oeste")
    expect(selected.price).toBeNull()
    expect(selected.links).toEqual({ affiliateUrl: null, productUrl: null })
    expect(rankOffers(p).every((o) => o.price === null && o.links.affiliateUrl === null && o.links.productUrl === null)).toBe(true)
  })
  test("own store first, then one offer per other store", () => {
    const p = parseProduct(product({ offers: [...offers, offers[0], { partner: { id: "aurora" }, price: { amount: 1 } }, { price: { amount: 5 } }, "junk"] }))
    expect(p.offers.map((o) => o.partner.id)).toEqual(["aurora", "sul", "oeste", "linho"])
    expect(p.offers[0]?.price?.amount).toBe(899)
  })
  test("offer links follow the https rule", () => {
    const p = parseProduct(product({ offers }))
    expect(p.offers.find((o) => o.partner.id === "oeste")?.links.affiliateUrl).toBe("https://oeste.x/p1?aff=1")
    expect(p.offers.find((o) => o.partner.id === "linho")?.links.productUrl).toBeNull()
  })
  test("no offers field = only the own store", () => {
    expect(parseProduct(product()).offers).toHaveLength(1)
  })
  test("maxChosenPieces defaults to 6 when the server omits it", () => {
    const c = parseStudioConfig({ costs: { generate: 6, edit: 2, tryOn: 4 }, budget: { min: 100, max: 3000 } })
    expect(c.maxChosenPieces).toBe(6)
  })
})

describe("price rank", () => {
  test("cheapest and most expensive are flagged", () => {
    const r = rankOffers(parseProduct(product({ offers })))
    expect(r.filter((o) => o.lowest).map((o) => o.partner.id)).toEqual(["oeste"])
    expect(r.filter((o) => o.highest).map((o) => o.partner.id)).toEqual(["linho"])
  })
  test("no rank with a single store, tied prices, or mixed currencies", () => {
    expect(rankOffers(parseProduct(product())).some((o) => o.lowest || o.highest)).toBe(false)
    const tie = parseProduct(product({ offers: [{ partner: { id: "sul" }, price: { amount: 899, currency: "BRL" } }] }))
    expect(rankOffers(tie).some((o) => o.lowest || o.highest)).toBe(false)
    const mixed = parseProduct(product({ offers: [{ partner: { id: "sul" }, price: { amount: 10, currency: "USD" } }] }))
    expect(rankOffers(mixed).some((o) => o.lowest || o.highest)).toBe(false)
  })
  test("an offer without price is never ranked", () => {
    const p = parseProduct(product({ offers: [...offers, { partner: { id: "x" } }] }))
    expect(rankOffers(p).find((o) => o.partner.id === "x")).toMatchObject({ lowest: false, highest: false })
  })
})

describe("chosen store", () => {
  test("withOffer swaps partner, price and links; unknown store keeps the product", () => {
    const p = parseProduct(product({ offers }))
    const oeste = withOffer(p, "oeste")
    expect(oeste.partner.name).toBe("Vitrine Oeste")
    expect(oeste.price?.amount).toBe(799)
    expect(oeste.links.affiliateUrl).toBe("https://oeste.x/p1?aff=1")
    expect(withOffer(p, "nope")).toBe(p)
    expect(withOffer(p, undefined)).toBe(p)
  })
  test("look total follows the chosen stores", () => {
    const look = parseLook({
      id: "l1",
      title: "Look",
      image: { url: "https://cdn.x/l1.jpg" },
      pieces: [
        { product: product({ offers }), role: "look" },
        { product: product({ id: "p2", price: { amount: 100, currency: "BRL" } }), role: "look" },
      ],
    })
    expect(sumLookWith(look, {})).toBe(sumLookWith(look, { p1: "aurora" }))
    expect(sumLookWith(look, { p1: "oeste" })?.replace(/\s/g, " ")).toBe("R$ 899,00")
  })
})
