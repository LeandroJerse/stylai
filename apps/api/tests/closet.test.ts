import { describe, expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { PrivateDatabaseError, type PrivateDatabase } from "@stylai/supabase"
import { buildApp } from "../src/app"
import { readSessionKeys } from "../src/modules/auth/session-crypto"
import { createPieceResolver } from "../src/modules/closet/routes"
import { A, B, fakeStore, item } from "./outfit-fixtures"

const V1 = "91000000-0000-4000-8000-000000000001", V2 = "91000000-0000-4000-8000-000000000002", D1 = "92000000-0000-4000-8000-000000000001"
const piece = (n: number, name: string) => ({ name, slot: n === 1 ? "lower" : "upper", source: "aliexpress", partner: "Loja", currency: "BRL", price_minor: 9900, canonical_id: `aliexpress:${n}`, garment_image_url: `https://ae01.alicdn.com/kf/${n}.jpg`, product_url: `https://pt.aliexpress.com/item/${n}.html`, affiliate_url: `https://s.click.aliexpress.com/e/${n}`, reference_kind: "image_reference" })
const version = (id: string) => ({
  id, look_id: "93000000-0000-4000-8000-000000000001", version: 1, parent_version_id: null, job_id: "94000000-0000-4000-8000-000000000001", product_id: "95000000-0000-4000-8000-000000000001",
  variant_id: "96000000-0000-4000-8000-000000000001", created_at: "2026-11-24T10:00:00Z", selection_snapshot: { ...piece(1, "Calça social"), items: [piece(1, "Calça social"), piece(2, "Suéter de cashmere")], render_mode: "provider" }, image: { width: 600, height: 800 },
})
async function make() {
  const saved = new Map<string, Set<string>>(), decided = new Map<string, string>(), pieces = new Map<string, Map<string, unknown>>()
  const of = <T>(m: Map<string, T>, user: string, fresh: () => T): T => { const v = m.get(user) ?? fresh(); m.set(user, v); return v }
  const calls: string[] = []
  const own = (user: unknown, id: unknown) => { if (user !== A || ![V1, V2].includes(String(id))) throw new PrivateDatabaseError("rejected", "42501") }
  const db = { call: async (op: string, ...a: unknown[]) => {
    calls.push(op)
    const user = String(a[0])
    switch (op) {
      case "list_match_deck": return user === A ? [V1, V2].filter((v) => !decided.has(v)).sort((x, y) => Number(y === a[1]) - Number(x === a[1])) : []
      case "read_look_version": return user === A ? version(String(a[1])) : null
      case "decide_look": own(a[0], a[1]); decided.set(String(a[1]), String(a[2])); if (a[2] === "save") of(saved, user, () => new Set<string>()).add(String(a[1])); return D1
      case "undo_look_decision": return user === A && a[1] === D1
      case "set_saved_look": own(a[0], a[1]); { const s = of(saved, user, () => new Set<string>()); if (a[2]) s.add(String(a[1])); else s.delete(String(a[1])); } return true
      case "list_saved_looks": return [...(saved.get(user) ?? [])].map((v) => ({ version_id: v, saved_at: "2026-11-24T11:00:00Z" }))
      case "set_saved_piece": { const p = of(pieces, user, () => new Map<string, unknown>()); if (a[2] === null) p.delete(String(a[1])); else p.set(String(a[1]), a[2]); return a[2] !== null }
      case "list_saved_pieces": return [...(pieces.get(user) ?? [])].map(([key, snapshot]) => ({ key, snapshot, saved_at: "2026-11-24T12:00:00Z" }))
      case "list_outfit_searches": return []
      default: return null
    }
  } } as unknown as PrivateDatabase<"api">
  const keys = readSessionKeys({ STYLAI_SESSION_KEY: randomBytes(32).toString("base64") })!
  const store = { ...fakeStore(() => []).service, findFresh: async (id: string) => (id === "aliexpress:77" ? item(77, "shirts", "Camisa nova da loja") : null) } as never
  const deps = { db, keys, publicBaseUrl: "http://x/v1", aliexpressCatalog: store }
  const app = await buildApp({ appOrigin: "http://localhost:5200", closet: { ...deps, resolveActor: async (r: { headers: Record<string, unknown> }) => r.headers["x-test-user"] === "a" ? A : r.headers["x-test-user"] === "b" ? B : null } })
  const call = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: object, user = "a") => app.inject({ method, url, ...(payload ? { payload } : {}), headers: { "x-test-user": user } })
  return { app, call, calls, resolve: createPieceResolver(deps) }
}

describe("match", () => {
  test("deck, decision, and a match keeps the image and every piece", async () => {
    const t = await make()
    try {
      const deck = (await t.call("GET", `/v1/studio/match/deck?lookId=${V2}`)).json().items
      expect(deck.map((l: { id: string }) => l.id)).toEqual([V2, V1])
      const done = await t.call("POST", "/v1/studio/match/decisions", { lookId: V1, decision: "save" })
      expect([done.statusCode, done.json()]).toEqual([200, { id: D1, lookId: V1, decision: "save" }])
      const closet = (await t.call("GET", "/v1/closet")).json()
      expect(closet.looks.map((l: { id: string; saved: boolean }) => [l.id, l.saved])).toEqual([[V1, true]])
      expect(closet.pieces.map((p: { via: string; product: { id: string; links: { affiliateUrl: string } } }) => [p.product.id, p.via, p.product.links.affiliateUrl])).toEqual([
        ["aliexpress:1", "look", "https://s.click.aliexpress.com/e/1"], ["aliexpress:2", "look", "https://s.click.aliexpress.com/e/2"],
      ])
      expect((await t.call("GET", "/v1/studio/match/deck")).json().items.map((l: { id: string }) => l.id)).toEqual([V2])
      expect((await t.call("DELETE", `/v1/studio/match/decisions/${D1}`)).statusCode).toBe(204)
      expect(t.calls.some((c) => /enqueue|reserve|outfit_render/.test(c))).toBe(false)
    } finally { await t.app.close() }
  })
  test("another account sees, decides and undoes nothing; malformed input is refused", async () => {
    const t = await make()
    try {
      await t.call("POST", "/v1/studio/match/decisions", { lookId: V1, decision: "save" })
      expect((await t.call("GET", "/v1/closet", undefined, "b")).json()).toEqual({ looks: [], pieces: [] })
      expect((await t.call("POST", "/v1/studio/match/decisions", { lookId: V1, decision: "save" }, "b")).statusCode).toBe(404)
      expect((await t.call("DELETE", `/v1/studio/match/decisions/${D1}`, undefined, "b")).statusCode).toBe(404)
      expect((await t.call("PUT", `/v1/closet/looks/${V1}`, undefined, "b")).statusCode).toBe(404)
      expect((await t.call("POST", "/v1/studio/match/decisions", { lookId: V1, decision: "love" })).statusCode).toBe(422)
      expect((await t.call("POST", "/v1/studio/match/decisions", { lookId: V1, decision: "save", image: "x" })).statusCode).toBe(422)
      expect((await t.call("GET", "/v1/closet", undefined, "none")).statusCode).toBe(401)
      expect((await t.call("PUT", "/v1/closet/looks/x")).statusCode).toBe(404)
    } finally { await t.app.close() }
  })
})

describe("closet pieces", () => {
  test("the server builds the snapshot; a listing that left the store answer says so", async () => {
    const t = await make()
    try {
      expect((await t.call("PUT", "/v1/closet/pieces/aliexpress:77", { name: "outro nome", price: 1 })).statusCode).toBe(204)
      const closet = (await t.call("GET", "/v1/closet")).json()
      expect(closet.pieces).toMatchObject([{ via: "favorite", product: { id: "aliexpress:77", name: "Camisa nova da loja", favorite: true, price: { amount: 90 } } }])
      expect((await t.call("PUT", "/v1/closet/pieces/aliexpress:99")).statusCode).toBe(404)
      expect((await t.call("PUT", "/v1/closet/pieces/..%2Fetc")).statusCode).toBe(404)
      expect((await t.call("DELETE", "/v1/closet/pieces/aliexpress:77")).statusCode).toBe(204)
      expect((await t.call("GET", "/v1/closet")).json().pieces).toEqual([])
    } finally { await t.app.close() }
  })
  test("a piece of a saved look stays reachable after its listing leaves the store cache, for its owner only", async () => {
    const t = await make()
    try {
      await t.call("PUT", `/v1/closet/looks/${V1}`)
      expect((await t.resolve(A, "aliexpress:2"))?.name).toBe("Suéter de cashmere")
      expect(await t.resolve(B, "aliexpress:2")).toBeNull()
      // Favourite and part of a look: one entry, as favourite; removing the look keeps it.
      expect((await t.call("PUT", "/v1/closet/pieces/aliexpress:2")).statusCode).toBe(204)
      expect((await t.call("GET", "/v1/closet")).json().pieces.map((p: { via: string; product: { id: string } }) => [p.product.id, p.via])).toEqual([["aliexpress:2", "favorite"], ["aliexpress:1", "look"]])
      await t.call("DELETE", `/v1/closet/looks/${V1}`)
      expect((await t.call("GET", "/v1/closet")).json().pieces.map((p: { product: { id: string } }) => p.product.id)).toEqual(["aliexpress:2"])
    } finally { await t.app.close() }
  })
})
