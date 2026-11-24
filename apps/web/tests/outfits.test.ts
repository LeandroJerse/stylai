import { describe, expect, test } from "bun:test"
import { parseOutfitQuote, parseOutfitRender, parseOutfitSearch, parseOutfitSet, parseOutfitSetDetail } from "../src/api/outfits"
import { parseStudioConfig } from "../src/api/parse"
import { CONSENT_TEXT, CONSENT_VERSION } from "../src/lib/consent"
import { PHOTO_POLICY_VERSION } from "../../../packages/contracts/src/photo-validation"

const product = (id: string, over: object = {}) => ({ id, name: `Peça ${id}`, partner: { id: "p", name: "Loja" }, price: { amount: 90, currency: "BRL" }, images: [{ url: "https://ae01.alicdn.com/a.jpg" }],
  links: { affiliateUrl: "https://s.click.aliexpress.com/e/x", productUrl: "https://pt.aliexpress.com/item/1.html" }, variants: [], availability: "unknown", ...over })
const card = (slot: string, id: string, over: object = {}) => ({ slot, label: slot, reason: "corte reto", variantId: null, tryOn: { ready: true, code: null, message: null }, product: product(id), ...over })
const set = (over: object = {}) => ({ id: "s1", searchId: "q1", position: 1, kind: "assembled", recommended: true, title: "Milano", rationale: "Clássico", missingSlots: [], revision: 2, locked: ["lower"],
  pieces: [card("lower", "a"), card("upper", "b")], total: { amount: 180, currency: "BRL" }, overBudget: null, origin: { id: "swap", label: "Peça trocada por você" }, ...over })

describe("outfit parsing", () => {
  test("a set keeps slots, locks, revision and safe links only", () => {
    const s = parseOutfitSet(set({ pieces: [card("lower", "a", { product: product("a", { links: { affiliateUrl: "javascript:alert(1)", productUrl: "http://x.test" } }) }), card("bogus", "z")] }))
    expect(s).toMatchObject({ id: "s1", kind: "assembled", revision: 2, locked: ["lower"], total: { amount: 180 } })
    expect(s.pieces).toHaveLength(1)
    expect(s.pieces[0]!.product.links).toEqual({ affiliateUrl: null, productUrl: null })
  })
  test("blocked pieces keep the reason; a malformed try-on state is never treated as ready", () => {
    const s = parseOutfitSet(set({ pieces: [card("lower", "a", { tryOn: { ready: false, code: "rights_unavailable", message: "Não autorizado" } }), card("upper", "b", { tryOn: null })] }))
    expect(s.pieces.map((p) => [p.tryOn.ready, p.tryOn.message])).toEqual([[false, "Não autorizado"], [false, null]])
  })
  test("search: stage, sets, message and report; unknown status fails closed as interrupted", () => {
    const base = { id: "q1", prompt: "x", source: "aliexpress_affiliate", status: "running", createdAt: "x", finishedAt: null, stage: { id: "searching", label: "Buscando", detail: { done: 2, total: 8 } }, selection: null, message: null, errorCode: null, sets: [], report: null }
    expect(parseOutfitSearch(base)).toMatchObject({ status: "running", stage: { id: "searching", done: 2, total: 8 } })
    expect(parseOutfitSearch({ ...base, status: "weird" }).status).toBe("interrupted")
    const done = parseOutfitSearch({ ...base, status: "succeeded", sets: [set()], selection: { method: "agent", model: "claude-haiku" }, report: { interpretedBy: "agent", plannedBy: "rules_fallback", queries: [{ slot: "Conjunto completo", query: "terno", outcome: "ok", returned: 50, kept: 4 }], filtered: { leisure_for_elegant: 3 }, missingSlots: [], agent: { calls: 2, estimatedUsd: 0.004 }, notes: [] } })
    expect(done.selection).toEqual({ method: "agent", model: "claude-haiku" })
    expect(done.report!.queries[0]).toMatchObject({ query: "terno", kept: 4 })
    expect(done.report!.removed).toBe(3)
  })
  test("set detail: alternatives per slot and versions", () => {
    const d = parseOutfitSetDetail({ ...set(), alternatives: { upper: [card("upper", "c")], bogus: [card("upper", "d")] }, revisions: [{ revision: 1, label: "Sugestão original", createdAt: "x", current: false, total: null, pieces: [card("lower", "a")] }] })
    expect(d.alternatives.upper!.map((p) => p.product.id)).toEqual(["c"])
    expect(Object.keys(d.alternatives)).toEqual(["upper"])
    expect(d.revisions[0]).toMatchObject({ revision: 1, current: false })
  })
  test("quote: not ready without a confirmation, blockers and cost visible", () => {
    const q = { mode: "comparison", ready: true, blockers: [], blockedPieces: [], changes: [{ setId: "s1", slot: "upper", name: "Camisa", kind: "price", before: 90, after: 99 }], panels: [{ panel: 1, setId: "s1", revision: 3, title: "A", pieces: [], total: null }],
      generation: { simulated: true, provider: "Segmind", model: "flux-3-klein-image-edit", calls: 2, estimatedUsd: 0, maxUsd: 0 }, coins: { cost: 20, available: 30 }, budget: { ok: true, neededUsd: 0.04, remainingUsd: 1, pilot: null }, confirmation: "a".repeat(64) }
    expect(parseOutfitQuote(q)).toMatchObject({ ready: true, coins: { cost: 20 }, generation: { simulated: true, calls: 2 }, changes: [{ after: 99 }] })
    expect(parseOutfitQuote({ ...q, confirmation: null }).ready).toBe(false)
    expect(parseOutfitQuote({ ...q, generation: { ...q.generation, simulated: undefined } }).generation!.simulated).toBe(false)
  })
  test("render: per-panel state and actions; a missing action is not offered", () => {
    const r = parseOutfitRender({ id: "r1", mode: "comparison", createdAt: "x", provider: "segmind", model: "flux", status: "partial", spentUsd: 0.01, canCancel: false, canFinalize: true,
      panels: [{ panel: 1, setId: "s1", searchId: "q1", revision: 1, title: "A", state: "ready", stateLabel: "Pronto", image: { url: "http://localhost/v1/media/looks/x" }, pieces: [], attempts: 1, lookId: "l1" },
        { panel: 2, setId: "s2", revision: 1, title: "B", state: "failed", stateLabel: "Falhou", image: null, pieces: [], attempts: 1, error: { code: "x", message: "Recusado" }, canRetry: true, retryNeedsChargeAcceptance: true }],
      comparison: { state: "waiting", image: null, error: null } })
    expect(r.panels.map((p) => [p.state, p.canRetry, p.retryNeedsChargeAcceptance])).toEqual([["ready", false, false], ["failed", true, true]])
    expect(r).toMatchObject({ status: "partial", canFinalize: true, canCancel: false })
  })
  test("the capability is off unless the server declares it", () => {
    const config = (capabilities: object) => parseStudioConfig({ costs: { generate: 10, edit: null, tryOn: 10 }, budget: { min: 0, max: 0 }, sizes: {}, plans: [], unit: {}, capabilities })
    expect(config({ mode: "single_piece_try_on" }).capabilities.outfits).toBe(false)
    expect(config({ mode: "single_piece_try_on", outfits: true }).capabilities.outfits).toBe(true)
  })
})

test("the photo term on screen is the version the server requires and says how the photo travels", () => {
  expect(CONSENT_VERSION).toBe(PHOTO_POLICY_VERSION)
  expect(CONSENT_TEXT).toContain("vai dentro do próprio pedido, sem link")
})
