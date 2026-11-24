import { describe, expect, test } from "bun:test"
import { parseOptions, parseOutfitSearch, parseOutfitSet } from "../src/api/outfits"
import { parseStudioConfig } from "../src/api/parse"
import { FILTER_IDS, filterLabels, filterReportText, filtersToSend, NO_FILTERS, parseAmount } from "../src/lib/filters"

describe("amounts as people type them", () => {
  const cases: [string, number | null][] = [["80", 80], ["R$ 79,90", 79.9], ["79.9", 79.9], ["1.234,56", 1234.56], ["1.200", 1200], ["", null], ["abc", null], ["0", null], ["-5", null], ["999999999", null]]
  for (const [text, n] of cases) test(`“${text}”`, () => expect(parseAmount(text)).toBe(n))
})

describe("what is sent", () => {
  test("nothing set, nothing sent", () => expect(filtersToSend(NO_FILTERS, FILTER_IDS)).toBeNull())
  test("an inverted range is read in order", () => expect(filtersToSend({ ...NO_FILTERS, minPieceBrl: 200, maxPieceBrl: 50 }, FILTER_IDS)).toEqual({ minPieceBrl: 50, maxPieceBrl: 200 }))
  test("a filter the server does not offer is never sent", () => expect(filtersToSend({ ...NO_FILTERS, minRatingPercent: 90, audience: "feminino" }, ["audience", "price", "total"])).toEqual({ audience: "feminino" }))
})

describe("labels", () => {
  test("short and in order", () => expect(filterLabels({ audience: "masculino", maxPieceBrl: 80, maxTotalBrl: 250, minRatingPercent: 90, minSales: 5 })).toEqual(["Masculino", "até R$ 80 por peça", "look até R$ 250", "nota 90%+", "5+ vendas"]))
  test("range", () => expect(filterLabels({ minPieceBrl: 30, maxPieceBrl: 79.9 })).toEqual(["R$ 30 a R$ 79,90 por peça"]))
  test("report says how many and why", () => {
    expect(filterReportText({ price: 8, rating: 0, ratingMissing: 4, sales: 0, audience: 0 })).toBe("Seus filtros tiraram 12 anúncios: 8 pelo preço e 4 sem nota na loja.")
    expect(filterReportText({ price: 0, rating: 0, ratingMissing: 0, sales: 1, audience: 0 })).toBe("Seus filtros tiraram 1 anúncio: 1 pelas vendas.")
    expect(filterReportText({ price: 0, rating: 0, ratingMissing: 0, sales: 0, audience: 0 })).toBeNull()
  })
})

describe("parsing", () => {
  test("search filters and their report come from the server", () => {
    const s = parseOutfitSearch({ id: "s", prompt: "x", status: "succeeded", filters: { audience: "feminino", maxPieceBrl: 80, minRatingPercent: "x" }, sets: [], report: { filtered: { filter_price: 3, filter_rating_missing: 2, leisure_for_elegant: 4 } } })
    expect(s.filters).toEqual({ ...NO_FILTERS, audience: "feminino", maxPieceBrl: 80 })
    expect(s.report!.filters).toEqual({ price: 3, rating: 0, ratingMissing: 2, sales: 0, audience: 0 })
    expect(s.report!.removed).toBe(4)
  })
  test("store rating and sales of a piece; malformed values stay unknown", () => {
    const set = (extra: object) => parseOutfitSet({ id: "a", searchId: "b", pieces: [{ slot: "upper", label: "x", tryOn: { ready: true }, product: { id: "p", name: "Camisa", partner: { id: "l" } }, ...extra }] }).pieces[0]!
    expect([set({ storeRating: 92.1, storeSales: 12 }).storeRating, set({ storeRating: 92.1, storeSales: 12 }).storeSales]).toEqual([92.1, 12])
    expect([set({ storeRating: "a" }).storeRating, set({}).storeSales]).toEqual([null, null])
  })
  test("“buscar outra” groups the reasons and never trusts malformed counts", () => {
    const found = (f: unknown) => parseOptions({ id: "a", searchId: "b", pieces: [], found: f }).found
    expect(found({ returned: 10, added: 2, outside: { other_part: 3, filter_price: 2, audience: 1, not_outfit: 1, duplicate_title: 1 } })).toEqual({ returned: 10, added: 2, otherPart: 3, filtered: 3, unsuitable: 2 })
    expect(found(null)).toEqual({ returned: 0, added: 0, otherPart: 0, filtered: 0, unsuitable: 0 })
  })
  test("offered filters fail closed", () => {
    const config = (caps: object) => parseStudioConfig({ costs: { generate: 10, edit: null, tryOn: 10 }, budget: { min: 0, max: 0 }, capabilities: caps }).capabilities.outfitFilters
    expect(config({ outfitFilters: ["price", "unknown"] })).toEqual(["price"])
    expect(config({})).toEqual([])
  })
})
