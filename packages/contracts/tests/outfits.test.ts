import { describe, expect, test } from "bun:test"
import { interpretCompositionRules, type CompositionIntent } from "../src/composition"
import {
  buildBundleQueries, MAX_OUTFITS, outfitSlotOfCategory, rankCandidates, selectOutfitsRules, styleConflict, validateOutfits,
  type OutfitCandidate, type OutfitPools, type OutfitSlot,
} from "../src/outfits"

const CATEGORY: Record<OutfitSlot, string> = { upper: "shirts", lower: "pants", dress: "dresses", outer: "jackets", set: "outfit_sets" }
const c = (id: string, slot: OutfitSlot, name: string, priceMinor: number | null = 10000, colorTags: string[] = []): OutfitCandidate =>
  ({ id, slot, categoryId: CATEGORY[slot], name, priceMinor, colorTags })
const intent = (over: Partial<CompositionIntent> = {}): CompositionIntent => ({
  slots: [{ slot: "upper", required: true }, { slot: "lower", required: true }], colors: [], terms: [], occasion: null,
  budgetTotalBrl: null, budgetMode: "prefer", avoid: [], style: [], audience: null, ...over,
})
const PLUSH_PANTS = "Calças compridas masculinas com forro de lã, grossas, quentes, macias e confortáveis para a pele, ideais para uso doméstico, lazer e atividades ao ar livre, calças de moletom para outono e inverno."

describe("style compatibility", () => {
  test("regression 2026-11-24: plush/leisure trousers never satisfy casual elegante", () => {
    expect(styleConflict(intent({ style: ["casual elegante"] }), PLUSH_PANTS)).toBe("leisure_for_elegant")
    expect(styleConflict(intent({ style: ["estilo italiano"], occasion: "jantar" }), PLUSH_PANTS)).toBe("leisure_for_elegant")
    expect(styleConflict(intent({ occasion: "trabalho" }), PLUSH_PANTS)).toBe("leisure_for_elegant")
    expect(styleConflict(intent({ style: ["confortável"] }), PLUSH_PANTS)).toBeNull()
    expect(styleConflict(intent(), PLUSH_PANTS)).toBeNull()
  })
  test("a wool coat or tailored trousers stay compatible with casual elegante in the cold", () => {
    const cold = intent({ style: ["casual elegante"], climate: "frio" })
    expect(styleConflict(cold, "Casaco sobretudo masculino de lã gola alta")).toBeNull()
    expect(styleConflict(cold, "Calça social masculina alfaiataria slim")).toBeNull()
    expect(styleConflict(cold, "Jaqueta Masculina de Inverno Quente Forrada com Lã, Casaco de Couro Casual")).toBeNull()
  })
  test("audience, children and underwear, and the wrong season are conflicts", () => {
    expect(styleConflict(intent({ audience: "masculino" }), "Calça feminina wide leg")).toBe("audience")
    expect(styleConflict(intent({ audience: "masculino" }), "Camisa masculina e feminina unissex")).toBeNull()
    expect(styleConflict(intent(), "Conjunto infantil menino camisa e calça")).toBe("not_outfit")
    expect(styleConflict(intent(), "Pijama de inverno camisa e calça")).toBe("not_outfit")
    expect(styleConflict(intent(), "Cinta modeladora")).toBe("not_outfit")
    expect(styleConflict(intent({ climate: "frio" }), "Camisa de manga curta verão praia")).toBe("season")
    expect(styleConflict(intent({ climate: "calor" }), "Calça forrada de pelúcia inverno")).toBe("season")
    expect(styleConflict(intent({ avoid: ["couro"] }), "Jaqueta de couro")).toBe("avoided")
  })
})

describe("ranking", () => {
  test("drops conflicts with a reason, repeated titles, and puts the requested colour first", () => {
    const ranked = rankCandidates(intent({ style: ["elegante"], slots: [{ slot: "upper", required: true, color: "branco" }] }), [
      c("a", "upper", "Camisa social preta", 9000, ["preto"]), c("b", "upper", "Camisa social branca", 12000, ["branco"]),
      c("dup", "upper", "Camisa social branca", 13000, ["branco"]), c("bad", "upper", "Camisa de moletom lazer", 100),
    ])
    expect(ranked.kept.map((x) => x.id)).toEqual(["b", "a"])
    expect(ranked.rejected).toEqual(expect.arrayContaining([{ id: "bad", reason: "leisure_for_elegant" }, { id: "dup", reason: "duplicate_title" }]))
  })
})

const pools: OutfitPools = {
  upper: [c("u1", "upper", "Camisa branca", 9000, ["branco"]), c("u2", "upper", "Camisa azul", 8000, ["azul"])],
  lower: [c("l1", "lower", "Calça preta", 15000, ["preto"]), c("l2", "lower", "Calça bege", 30000, ["bege"])],
  set: [c("s1", "set", "Conjunto camisa e calça linho", 25000)],
}
const p = (...ids: [OutfitSlot, string][]) => ({ title: "t", rationale: "r", pieces: ids.map(([slot, productId]) => ({ slot, productId, reason: "x" })) })

describe("validation", () => {
  test("accepts only returned ids in their slot; drops repeats and incomplete or invented outfits", () => {
    const v = validateOutfits(intent(), pools, [
      p(["upper", "u1"], ["lower", "l1"]), p(["lower", "l1"], ["upper", "u1"]), p(["upper", "evil"], ["lower", "l1"]),
      p(["upper", "l1"], ["lower", "l2"]), p(["upper", "u1"]), p(["set", "s1"]), p(["set", "s1"], ["lower", "l1"]),
    ])
    expect(v.outfits.map((o) => o.pieces.map((x) => x.productId))).toEqual([["l1", "u1"], ["s1"]])
    expect(v.outfits.map((o) => o.kind)).toEqual(["assembled", "bundle"])
    expect(v.rejected.map((r) => r.reason)).toEqual(["repeated", "unknown_product", "wrong_slot", "incomplete", "slot_conflict"])
    expect(v.outfits[0]!.totalMinor).toBe(24000)
  })
  test("a required total budget excludes expensive or unpriced outfits", () => {
    const budget = intent({ budgetTotalBrl: 250, budgetMode: "require" })
    const withNull: OutfitPools = { ...pools, upper: [...pools.upper!, c("u3", "upper", "Camisa sem preço", null)] }
    const v = validateOutfits(budget, withNull, [p(["upper", "u1"], ["lower", "l2"]), p(["upper", "u3"], ["lower", "l1"]), p(["upper", "u1"], ["lower", "l1"])])
    expect(v.outfits).toHaveLength(1)
    expect(v.rejected.map((r) => r.reason)).toEqual(["over_budget", "budget_unverifiable"])
  })
  test("a locked piece cannot be replaced and audiences are never mixed", () => {
    expect(validateOutfits(intent(), pools, [p(["upper", "u2"], ["lower", "l1"])], { locked: { upper: "u1" } }).rejected[0]!.reason).toBe("lock_overridden")
    const mixed: OutfitPools = { upper: [c("m", "upper", "Camisa masculina")], lower: [c("f", "lower", "Calça feminina")] }
    expect(validateOutfits(intent(), mixed, [p(["upper", "m"], ["lower", "f"])]).rejected[0]!.reason).toBe("audience_mixed")
  })
  test("an outfit that differs only by the outer layer is a repeat; at most MAX_OUTFITS", () => {
    const many: OutfitPools = { upper: Array.from({ length: 6 }, (_, i) => c(`u${i}`, "upper", `Camisa ${i}`)), lower: [c("l", "lower", "Calça")], outer: [c("o1", "outer", "Casaco"), c("o2", "outer", "Blazer")] }
    const v = validateOutfits(intent({ slots: [...intent().slots, { slot: "outer", required: false }] }), many,
      [p(["upper", "u0"], ["lower", "l"], ["outer", "o1"]), p(["upper", "u0"], ["lower", "l"], ["outer", "o2"]), ...[1, 2, 3, 4, 5].map((i) => p(["upper", `u${i}`], ["lower", "l"]))])
    expect(v.outfits).toHaveLength(MAX_OUTFITS)
    expect(v.rejected.map((r) => r.reason)).toEqual(["repeated", "limit", "limit"])
  })
})

describe("rules selection", () => {
  test("complete bundles come first, then distinct assembled outfits; every outfit validates", () => {
    const out = selectOutfitsRules(intent(), pools, {})
    expect(out[0]!.kind).toBe("bundle")
    expect(out.slice(1).every((o) => o.kind === "assembled")).toBe(true)
    expect(out.length).toBeGreaterThan(1)
    expect(new Set(out.map((o) => o.pieces.map((x) => x.productId).sort().join())).size).toBe(out.length)
    expect(validateOutfits(intent(), pools, out).outfits).toHaveLength(out.length)
  })
  test("never fabricates: an empty required slot yields no assembled outfit; locks and exclusions are respected", () => {
    expect(selectOutfitsRules(intent(), { upper: pools.upper }, {})).toEqual([])
    // A single outfit around a locked piece: a complete set can never hold it, so it must not use up the only place.
    expect(selectOutfitsRules(intent(), pools, { max: 1, locked: { upper: "u1" } })[0]?.pieces.find((p) => p.slot === "upper")?.productId).toBe("u1")
    const locked = selectOutfitsRules(intent(), pools, { locked: { upper: "u1" }, exclude: ["l1"], bundles: false })
    expect(locked.map((o) => o.pieces.map((x) => x.productId))).toEqual([["l2", "u1"]])
  })
  test("a cold-weather outer layer without candidates does not block the outfit and is reported", () => {
    const out = selectOutfitsRules(intent({ slots: [...intent().slots, { slot: "outer", required: true }] }), { upper: pools.upper, lower: pools.lower, outer: [] }, {})
    expect(out.length).toBeGreaterThan(0)
    expect(out[0]!.missingSlots).toEqual(["outer"])
  })
})

describe("queries and interpretation", () => {
  test("complete outfits are searched with audience and style, never for a single dress or a single piece", () => {
    expect(buildBundleQueries(intent({ audience: "masculino", style: ["estilo italiano"] }))).toEqual(["conjunto masculino alfaiataria calça", "terno masculino"])
    expect(buildBundleQueries(intent({ climate: "frio", audience: "feminino" }))[0]).toBe("conjunto feminino inverno calça")
    expect(buildBundleQueries(intent({ slots: [{ slot: "dress", required: true }] }))).toEqual([])
    expect(buildBundleQueries(intent({ slots: [{ slot: "upper", required: true }] }))).toEqual([])
  })
  test("'roupas de frio' asks for a cold outfit with an outer layer; summer does not", () => {
    const cold = interpretCompositionRules("quero roupas de frio")
    expect(cold.climate).toBe("frio")
    expect(cold.slots.map((s) => s.slot)).toEqual(["lower", "upper", "outer"])
    const summer = interpretCompositionRules("me vista com roupas de verão")
    expect(summer.climate).toBe("calor")
    expect(summer.slots.map((s) => s.slot)).toEqual(["lower", "upper"])
    expect(interpretCompositionRules("me vista com roupas italianas").climate).toBeNull()
  })
  test("category to outfit slot includes complete sets", () => {
    expect(outfitSlotOfCategory("outfit_sets")).toBe("set")
    expect(outfitSlotOfCategory("pants")).toBe("lower")
    expect(outfitSlotOfCategory("uncategorized")).toBeNull()
  })
})
