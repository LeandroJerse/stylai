import { describe, expect, test } from "bun:test"
import {
  interpretCompositionRules, renderOrder, selectCompositionRules, slotOfCategory, validateComposition,
  type CompositionCandidate, type CompositionIntent,
} from "../src/composition"

const c = (id: string, slot: CompositionCandidate["slot"], price: number | null, name = id, extra: Partial<CompositionCandidate> = {}): CompositionCandidate => ({
  id, slot, categoryId: slot === "upper" ? "tops" : slot === "lower" ? "pants" : slot === "dress" ? "dresses" : "jackets",
  name, priceMinor: price, colorTags: [], generationEligible: false, ...extra,
})
const intent = (over: Partial<CompositionIntent> = {}): CompositionIntent => ({
  slots: [{ slot: "upper", required: true }, { slot: "lower", required: true }], colors: [], terms: [], occasion: null,
  budgetTotalBrl: null, budgetMode: "prefer", avoid: [], ...over,
})

describe("composition rules", () => {
  test("interprets multi-slot requests, total budget and exclusive dress", () => {
    const look = interpretCompositionRules("Quero um look com calça preta e blusa branca até R$ 300 para o trabalho")
    expect(look.slots.map((s) => s.slot).sort()).toEqual(["lower", "upper"])
    expect(look).toMatchObject({ budgetTotalBrl: 300, budgetMode: "require" })
    expect(look.colors.sort()).toEqual(["branco", "preto"])
    expect(interpretCompositionRules("vestido vermelho e jaqueta jeans").slots.map((s) => s.slot)).toEqual(["dress", "outer"])
    // A generic outfit request defaults to top + bottom.
    expect(interpretCompositionRules("me monta uma roupa para um casamento").slots.map((s) => s.slot)).toEqual(["lower", "upper"])
    expect(interpretCompositionRules("só uma blusa azul").slots.map((s) => s.slot)).toEqual(["upper"])
  })

  test("render order is base layers first, outer last; category mapping", () => {
    expect(renderOrder(["outer", "upper", "lower"])).toEqual(["lower", "upper", "outer"])
    expect(renderOrder(["outer", "dress"])).toEqual(["dress", "outer"])
    expect([slotOfCategory("shirts"), slotOfCategory("bottoms"), slotOfCategory("jackets"), slotOfCategory("shoes")]).toEqual(["upper", "lower", "outer", null])
  })

  test("deterministic selection honours total budget, locks and unknown prices", () => {
    const bySlot = { upper: [c("u1", "upper", 20000), c("u2", "upper", 9000, "blusa preta", { colorTags: ["preto"] })], lower: [c("l1", "lower", 25000), c("l2", "lower", 15000), c("l3", "lower", null)] }
    const pick = selectCompositionRules(intent({ budgetTotalBrl: 300, budgetMode: "require", colors: ["preto"] }), bySlot, {})
    expect(pick.choices.map((x) => x.productId)).toEqual(["l2", "u2"])
    expect(pick.totalMinor).toBe(24000)
    // Locked piece is kept even when another fits better.
    const locked = selectCompositionRules(intent({ budgetTotalBrl: 400, budgetMode: "require" }), bySlot, { upper: "u1" })
    expect(locked.choices.find((x) => x.slot === "upper")?.productId).toBe("u1")
    expect(locked.choices.find((x) => x.slot === "lower")?.productId).toBe("l2")
    // Required budget impossible -> no fabricated composition.
    expect(selectCompositionRules(intent({ budgetTotalBrl: 100, budgetMode: "require" }), bySlot, {}).choices).toEqual([])
    // Empty slot is reported, other slots still chosen.
    const partial = selectCompositionRules(intent(), { upper: [c("u1", "upper", 1)], lower: [] }, {})
    expect(partial.choices.map((x) => x.slot)).toEqual(["upper"])
    expect(partial.missingSlots).toEqual(["lower"])
  })

  test("validation rejects invented ids, wrong slots, duplicates, overriding locks and over-budget", () => {
    const bySlot = { upper: [c("u1", "upper", 20000)], lower: [c("l1", "lower", 15000), c("l2", "lower", 5000)] }
    const ok = validateComposition(intent({ budgetTotalBrl: 400, budgetMode: "require" }), bySlot, [{ slot: "upper", productId: "u1", reason: "x" }, { slot: "lower", productId: "l1", reason: "y" }], {})
    expect(ok).toMatchObject({ ok: true, totalMinor: 35000 })
    const bad = validateComposition(intent({ budgetTotalBrl: 300, budgetMode: "require" }), bySlot, [
      { slot: "upper", productId: "invented", reason: "" }, { slot: "lower", productId: "u1", reason: "" }, { slot: "lower", productId: "l1", reason: "" },
    ], { lower: "l2" })
    expect(bad.ok).toBe(false)
    expect(bad.errors).toEqual(expect.arrayContaining(["unknown_product:upper", "wrong_slot:lower", "lock_overridden:lower"]))
    const over = validateComposition(intent({ budgetTotalBrl: 300, budgetMode: "require" }), bySlot, [{ slot: "upper", productId: "u1", reason: "" }, { slot: "lower", productId: "l1", reason: "" }], {})
    expect(over.errors).toContain("over_budget")
  })
})

describe("composition validation hardening", () => {
  const bySlot = { upper: [c("u1", "upper", 1000)], lower: [c("l1", "lower", 1000)] }
  test("a locked slot can never be silently dropped; agent omissions of required slots are rejected", () => {
    const missingLock = validateComposition(intent(), bySlot, [{ slot: "lower", productId: "l1", reason: "" }], { upper: "u1" })
    expect(missingLock.errors).toContain("missing_locked:upper")
    const agentOmits = validateComposition(intent(), bySlot, [{ slot: "lower", productId: "l1", reason: "" }], {}, { requireAll: true })
    expect(agentOmits.errors).toContain("missing_required:upper")
    // A slot without candidates is not required (nothing to choose from).
    expect(validateComposition(intent(), { lower: bySlot.lower }, [{ slot: "lower", productId: "l1", reason: "" }], {}, { requireAll: true }).ok).toBe(true)
  })
})

describe("per-slot queries (P10)", () => {
  test("masculine request keeps audience, garment type and each slot's own colour", async () => {
    const { buildSlotQuery } = await import("../src/composition")
    const i = interpretCompositionRules("camisa masculina de linho branca e calça chino masculina azul marinho")
    expect(i.audience).toBe("masculino")
    const upper = i.slots.find((s) => s.slot === "upper")!, lower = i.slots.find((s) => s.slot === "lower")!
    expect(upper.color).toBe("branco")
    expect(lower.color).toBe("azul")
    const qUpper = buildSlotQuery(i, "upper"), qLower = buildSlotQuery(i, "lower")
    expect(qUpper).toContain("camisa")
    expect(qUpper).toContain("masculina")
    expect(qUpper).toContain("linho")
    expect(qUpper).not.toContain("azul")
    expect(qUpper).not.toMatch(/blusa|feminin/)
    expect(qLower).toContain("calça")
    expect(qLower).toContain("chino")
    expect(qLower).toContain("masculina")
    expect(qLower).not.toContain("branc")
  })

  test("feminine and neutral requests; dress and outer layers", async () => {
    const { buildSlotQuery } = await import("../src/composition")
    const f = interpretCompositionRules("vestido vermelho feminino com jaqueta jeans")
    expect(buildSlotQuery(f, "dress")).toMatch(/^vestido .*vermelh/)
    expect(buildSlotQuery(f, "outer")).toContain("jaqueta")
    expect(buildSlotQuery(f, "outer")).not.toContain("vermelh")
    const n = interpretCompositionRules("me monta uma roupa para um casamento")
    expect(n.audience).toBeNull()
    expect(buildSlotQuery(n, "upper")).not.toMatch(/feminin|masculin/)
  })

  test("an agent query is used only after hard sanitization and must name the slot's garment", async () => {
    const { buildSlotQuery } = await import("../src/composition")
    const base = interpretCompositionRules("calça masculina preta")
    const withAgent = { ...base, slots: base.slots.map((s) => ({ ...s, query: "calça social masculina preta <script> https://x" })) }
    const q = buildSlotQuery(withAgent, "lower")
    expect(q).toBe("calça social masculina preta")
    const offSlot = { ...base, slots: base.slots.map((s) => ({ ...s, query: "relógio dourado" })) }
    expect(buildSlotQuery(offSlot, "lower")).toMatch(/^calça/)
  })
})
