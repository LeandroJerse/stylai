import { describe, expect, test } from "bun:test"
import { interpretCompositionRules, type CompositionIntent } from "../src/composition"
import { applyFiltersToIntent, countFilters, filterConflict, NO_FILTERS, normalizeFilters, type OutfitFilters } from "../src/outfit-filters"
import { rankCandidates, searchPlan, styleConflict, type OutfitCandidate } from "../src/outfits"

const f = (over: Partial<OutfitFilters>): OutfitFilters => ({ ...NO_FILTERS, ...over })
const x = (over: Partial<Parameters<typeof filterConflict>[1]> = {}) => ({ slot: "upper" as const, name: "Camisa de linho", priceMinor: 8000, ratingPercent: 95, recentSales: 10, ...over })
const intent = (over: Partial<CompositionIntent> = {}): CompositionIntent => ({
  slots: [{ slot: "upper", required: true }, { slot: "lower", required: true }], colors: [], terms: [], occasion: null, budgetTotalBrl: null, budgetMode: "prefer", avoid: [], style: [], audience: null, ...over,
})

describe("filters", () => {
  test("malformed values are dropped and an inverted range is read in order", () => {
    expect(normalizeFilters({ audience: "x", minPieceBrl: 200, maxPieceBrl: 50, maxTotalBrl: -1, minRatingPercent: 300, minSales: 1.5 })).toEqual(f({ minPieceBrl: 50, maxPieceBrl: 200 }))
    expect(normalizeFilters(null)).toEqual(NO_FILTERS)
    expect(countFilters(f({ minPieceBrl: 10, maxPieceBrl: 20, audience: "feminino" }))).toBe(2)
  })
  test("price per piece, and a set sold in one listing counts as two pieces", () => {
    expect(filterConflict(f({ maxPieceBrl: 80 }), x())).toBeNull()
    expect(filterConflict(f({ maxPieceBrl: 79.99 }), x())).toBe("filter_price")
    expect(filterConflict(f({ minPieceBrl: 81 }), x())).toBe("filter_price")
    expect(filterConflict(f({ maxPieceBrl: 80 }), x({ slot: "set", priceMinor: 16000 }))).toBeNull()
    expect(filterConflict(f({ maxPieceBrl: 80 }), x({ slot: "set", priceMinor: 16001 }))).toBe("filter_price")
    expect(filterConflict(f({ maxPieceBrl: 80 }), x({ priceMinor: null }))).toBe("filter_price")
  })
  test("a listing without rating or sales does not satisfy a filter on it", () => {
    expect(filterConflict(f({ minRatingPercent: 90 }), x())).toBeNull()
    expect(filterConflict(f({ minRatingPercent: 96 }), x())).toBe("filter_rating")
    expect(filterConflict(f({ minRatingPercent: 90 }), x({ ratingPercent: null }))).toBe("filter_rating_missing")
    expect(filterConflict(f({ minSales: 10 }), x())).toBeNull()
    expect(filterConflict(f({ minSales: 1 }), x({ recentSales: null }))).toBe("filter_sales")
  })
  test("audience removes only what names the other audience", () => {
    expect(filterConflict(f({ audience: "feminino" }), x({ name: "Camisa masculina" }))).toBe("filter_audience")
    expect(filterConflict(f({ audience: "feminino" }), x())).toBeNull()
  })
  test("audience and total reach the whole flow; the stricter total wins", () => {
    const i = applyFiltersToIntent(intent({ budgetTotalBrl: 300, budgetMode: "require" }), f({ audience: "masculino", maxTotalBrl: 200 }))
    expect([i.audience, i.budgetTotalBrl, i.budgetMode]).toEqual(["masculino", 200, "require"])
    expect(applyFiltersToIntent(intent({ budgetTotalBrl: 150, budgetMode: "require" }), f({ maxTotalBrl: 200 })).budgetTotalBrl).toBe(150)
    expect(applyFiltersToIntent(intent({ budgetTotalBrl: 150, budgetMode: "require" }), NO_FILTERS).budgetTotalBrl).toBe(150)
  })
  test("ranking applies the filters and reports each reason", () => {
    const c = (id: string, over: Partial<OutfitCandidate>): OutfitCandidate => ({ id, slot: "upper", categoryId: "shirts", name: `Camisa ${id}`, priceMinor: 5000, colorTags: [], ratingPercent: 95, recentSales: 3, ...over })
    const out = rankCandidates(intent(), [c("ok", {}), c("cara", { priceMinor: 20000 }), c("sem-nota", { ratingPercent: null })], f({ maxPieceBrl: 100, minRatingPercent: 90 }))
    expect(out.kept.map((k) => k.id)).toEqual(["ok"])
    expect(out.rejected).toEqual(expect.arrayContaining([{ id: "cara", reason: "filter_price" }, { id: "sem-nota", reason: "filter_rating_missing" }]))
  })
})

describe("summer request of 2026-11-24", () => {
  const summer = intent({ climate: "calor" })
  test("long sleeves and Christmas clothes are not summer", () => {
    expect(styleConflict(summer, "Camiseta Feminina de Manga Longa Vintage com Estampa Floral")).toBe("season")
    expect(styleConflict(summer, "Camisetas femininas de manga comprida com gola redonda")).toBe("season")
    expect(styleConflict(summer, "Blusa de Natal feminina")).toBe("season")
    expect(styleConflict(summer, "Camiseta masculina de manga curta")).toBeNull()
  })
  test("a light long-sleeved shirt stays possible for an elegant dinner, and when asked for", () => {
    expect(styleConflict(intent({ climate: "calor", style: ["elegante"] }), "Camisa social de linho manga longa")).toBeNull()
    expect(styleConflict(intent({ climate: "calor", slots: [{ slot: "upper", required: true, query: "camisa manga longa" }] }), "Camisa de manga longa")).toBeNull()
  })
  test("Christmas clothes only when asked", () => {
    expect(styleConflict(intent(), "Blusa de Natal feminina")).toBe("season")
    expect(styleConflict(intent({ occasion: "natal" }), "Blusa de Natal feminina")).toBeNull()
  })
  test("“short” is read by the store as an English adjective: the query becomes “bermuda”", () => {
    const lower = (extra: string[], over: Partial<CompositionIntent> = {}) => searchPlan(intent({ climate: "calor", ...over }), { slots: { lower: extra } }).filter((q) => q.slot === "lower").map((q) => q.query)
    expect(lower(["short linho calor"])[0]).toBe("bermuda linho")
    expect(lower(["shorts"], { audience: "masculino" })[0]).toBe("bermuda masculina")
    expect(lower(["shorts femininos jeans"])[0]).toBe("bermuda feminina jeans")
    expect(lower(["saia", "short"])).toContain("bermuda")
  })
  test("season words are dropped from store queries: the store answers them empty", () => {
    const q = searchPlan(intent({ climate: "calor" }), { slots: { upper: ["camiseta leve verão", "regata fresca para o verão"] } }).filter((s) => s.slot === "upper").map((s) => s.query)
    expect(q.slice(0, 2)).toEqual(["camiseta", "regata"])
  })
  test("the rules plan for heat asks for short sleeves and bermudas first", () => {
    const plan = searchPlan(interpretCompositionRules("me vista com roupas de verão"))
    expect(plan.some((q) => q.slot === "upper" && /manga curta|regata/.test(q.query))).toBe(true)
    expect(plan.some((q) => q.slot === "lower" && q.query.startsWith("bermuda"))).toBe(true)
  })
})
