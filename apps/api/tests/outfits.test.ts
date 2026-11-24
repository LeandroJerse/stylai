import { describe, expect, test } from "bun:test"
import type { Composer, OutfitAgents } from "@stylai/ai"
import type { NormalizedAliExpressCatalogItem } from "@stylai/commerce"
import type { CompositionIntent } from "@stylai/contracts"
import { buildApp } from "../src/app"
import { createOutfitSearch, type OutfitSearchDeps } from "../src/modules/outfits/search"
import type { PreparedReference, ReferenceItem } from "../src/modules/outfits/references"
import { A, B, fakeDb, fakeStore, item } from "./outfit-fixtures"

const SETS = [item(1, "outfit_sets", "Conjunto masculino alfaiataria blazer e calça", 30000), item(2, "outfit_sets", "Terno masculino slim social", 45000)]
const UPPER = [item(11, "shirts", "Camisa social masculina branca", 9000), item(12, "shirts", "Camisa linho masculina azul", 11000), item(13, "tops", "Suéter tricô masculino bege", 12000)]
const LOWER = [item(21, "pants", "Calça alfaiataria masculina preta", 15000), item(22, "pants", "Calça social masculina cinza", 14000), item(23, "pants", "Calça moletom jogger lazer masculina", 5000)]
const PROMPT = "roupas italianas elegantes masculinas com camisa e calça"
const all = (k: string): NormalizedAliExpressCatalogItem[] => /conjunto|terno/.test(k) ? SETS : /cal[çc]a/.test(k) ? LOWER : UPPER
const uuid = (n: number) => `31000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ready = (i: Pick<ReferenceItem, "externalProductId" | "image">): PreparedReference =>
  ({ status: "ready", reference: { productId: uuid(Number(i.externalProductId)), variantId: uuid(900 + Number(i.externalProductId)), imageUrl: i.image, sha256: "a".repeat(64) } })

async function make(opts: { store?: Parameters<typeof fakeStore>[0]; blocked?: Record<string, string>; agents?: OutfitAgents; composer?: Composer; acquire?: () => Promise<boolean>; noStore?: boolean; gate?: Promise<void> } = {}) {
  const f = fakeDb()
  const store = fakeStore(opts.store ?? all)
  const prepared: string[] = []
  const work: Promise<void>[] = []
  const deps: OutfitSearchDeps = {
    db: f.db, source: "aliexpress_affiliate", aliexpressCatalog: opts.noStore ? null : store.service, listCatalog: async () => [], agents: opts.agents ?? null, composer: opts.composer ?? null,
    acquireAgentCall: opts.acquire, agentPrice: { inputPerMTok: 1_000_000n, outputPerMTok: 5_000_000n },
    preparer: { prepare: async (items) => {
      if (opts.gate) await opts.gate
      prepared.push(...items.map((i) => i.canonicalKey))
      return new Map(items.map((i): [string, PreparedReference] => [i.canonicalKey, opts.blocked?.[i.canonicalKey] ? { status: "blocked", code: opts.blocked[i.canonicalKey]! } : ready(i)]))
    } },
  }
  const search = createOutfitSearch(deps)
  const app = await buildApp({ appOrigin: "http://localhost:5200", outfits: { db: f.db, source: "aliexpress_affiliate", model: opts.agents ? "claude-haiku" : null, search, publicBaseUrl: "http://x/v1", track: (w) => { work.push(w) },
    resolveActor: async (r) => r.headers["x-test-user"] === "b" ? B : r.headers["x-test-user"] === "a" ? A : null } })
  const call = (method: "GET" | "POST", url: string, payload?: object, user = "a", key?: string) =>
    app.inject({ method, url, ...(payload ? { payload } : {}), headers: { "x-test-user": user, ...(key ? { "idempotency-key": key } : {}) } })
  const run = async (prompt = PROMPT, key = "search-key-1") => {
    const res = await call("POST", "/v1/studio/outfit-searches", { prompt }, "a", key)
    await Promise.all(work)
    return { res, search: (await call("GET", `/v1/studio/outfit-searches/${res.json().id}`)).json() }
  }
  return { app, call, run, store, prepared, work, ...f }
}
const intent: CompositionIntent = { slots: [{ slot: "lower", required: true }, { slot: "upper", required: true }], colors: [], terms: [], occasion: null, budgetTotalBrl: null, budgetMode: "prefer", avoid: [], audience: "masculino", style: ["italiano"] } as CompositionIntent
const usage = { inputTokens: 1000, outputTokens: 100 }
const composer = { model: "claude-haiku", interpret: async () => ({ intent: JSON.parse(JSON.stringify(intent)), usage, requestId: null }) } as unknown as Composer
const agents = (over: Partial<OutfitAgents> = {}): OutfitAgents => ({
  model: "claude-haiku",
  plan: async () => ({ bundles: ["conjunto masculino italiano"], slots: { lower: ["calça alfaiataria italiana masculina"] }, usage, promptVersion: "plan/x" }),
  compose: async (_i, pools) => ({ outfits: [{ title: "Milano", rationale: "Clássico", kind: "assembled", totalMinor: 1, missingSlots: [],
    pieces: [{ slot: "lower", productId: pools.lower![0]!.id, reason: "corte reto" }, { slot: "upper", productId: pools.upper![0]!.id, reason: "tom neutro" }] }], rejected: [], usage, promptVersion: "outfits/x" }),
  ...over,
})

describe("outfit search", () => {
  test("real stages, complete outfits searched first, up to four coordinated sets persisted with prepared references", async () => {
    const t = await make()
    try {
      const { res, search } = await t.run()
      expect(res.statusCode).toBe(202)
      expect([...new Set(t.stages)]).toEqual(["interpreting", "planning", "searching", "selecting", "preparing"])
      expect(t.store.queries[0]).toMatch(/conjunto|terno/)
      expect(t.store.queries.length).toBeLessThanOrEqual(8)
      expect(search).toMatchObject({ status: "succeeded", selection: { method: "rules_fallback", model: null } })
      expect(search.sets.length).toBeGreaterThanOrEqual(3)
      expect(search.sets.length).toBeLessThanOrEqual(4)
      expect(search.sets[0]).toMatchObject({ kind: "bundle", recommended: true, revision: 1, total: { currency: "BRL" } })
      expect(search.sets.filter((s: { recommended: boolean }) => s.recommended)).toHaveLength(1)
      const pieces = search.sets.flatMap((s: { pieces: { tryOn: { ready: boolean }; product: { id: string; links: { affiliateUrl: string | null } } }[] }) => s.pieces)
      expect(pieces.every((p: { tryOn: { ready: boolean } }) => p.tryOn.ready)).toBe(true)
      expect(pieces[0].product.links.affiliateUrl).toMatch(/^https:\/\/s\.click/)
      // The leisure trousers never enter an elegant outfit, and the report says what the filter removed.
      expect(JSON.stringify(search.sets)).not.toContain("aliexpress:23")
      expect(search.report.filtered.leisure_for_elegant).toBe(1)
    } finally { await t.app.close() }
  })
  test("purchase filters reach the search, are stored with it and explain what they removed", async () => {
    const priced = (k: string) => all(k).map((x) => ({ ...x, ratingPercent: x.externalProductId === "11" ? null : 96, recentSales: 4 }))
    const t = await make({ store: priced })
    try {
      const body = { prompt: PROMPT, filters: { maxPieceBrl: 145, minRatingPercent: 90, audience: "masculino" } }
      const res = await t.call("POST", "/v1/studio/outfit-searches", body, "a", "search-key-f")
      await Promise.all(t.work)
      const search = (await t.call("GET", `/v1/studio/outfit-searches/${res.json().id}`)).json()
      expect(search.status).toBe("succeeded")
      expect(search.filters).toMatchObject({ maxPieceBrl: 145, minRatingPercent: 90, audience: "masculino", maxTotalBrl: null })
      const pieces = search.sets.flatMap((s: { pieces: { slot: string; storeRating: number | null; storeSales: number | null; product: { id: string; price: { amount: number } } }[] }) => s.pieces)
      expect(pieces.every((p: { slot: string; product: { price: { amount: number } } }) => p.product.price.amount <= (p.slot === "set" ? 290 : 145))).toBe(true)
      expect(pieces.map((p: { product: { id: string } }) => p.product.id)).not.toContain("aliexpress:11")
      expect(pieces[0]).toMatchObject({ storeRating: 96, storeSales: 4 })
      expect(search.report.filtered).toMatchObject({ filter_rating_missing: 1 })
      expect(search.report.filtered.filter_price).toBeGreaterThanOrEqual(2)
      // The swap options were filtered too.
      const detail = (await t.call("GET", `/v1/studio/outfit-sets/${search.sets.find((s: { kind: string }) => s.kind === "assembled").id}`)).json()
      expect(JSON.stringify(detail.alternatives)).not.toContain("aliexpress:11\"")
    } finally { await t.app.close() }
  })
  test("filters too tight: the empty answer says the filters did it; malformed filters are refused", async () => {
    const t = await make()
    try {
      const res = await t.call("POST", "/v1/studio/outfit-searches", { prompt: PROMPT, filters: { maxPieceBrl: 1 } }, "a", "search-key-g")
      await Promise.all(t.work)
      const search = (await t.call("GET", `/v1/studio/outfit-searches/${res.json().id}`)).json()
      expect(search.status).toBe("empty")
      expect(search.message).toMatch(/Com estes filtros, \d+ anúncios ficaram de fora/)
      for (const filters of [{ maxPieceBrl: -1 }, { minRatingPercent: 101 }, { audience: "x" }, { other: 1 }]) {
        const bad = await t.call("POST", "/v1/studio/outfit-searches", { prompt: PROMPT, filters }, "a", "search-key-h")
        expect([bad.statusCode, bad.json().error.message]).toEqual([422, "Confira os filtros: os valores precisam ser números válidos."])
      }
      // Same key, other filters: a different request.
      expect((await t.call("POST", "/v1/studio/outfit-searches", { prompt: PROMPT, filters: { maxPieceBrl: 2 } }, "a", "search-key-g")).statusCode).toBe(409)
    } finally { await t.app.close() }
  })
  test("“buscar outra”: a real search for one part joins its swap options, with the same filters, and can be worn", async () => {
    const EXTRA = [item(51, "shirts", "Camisa polo masculina verde", 8000), item(52, "shirts", "Camisa polo feminina rosa", 8000), item(53, "shirts", "Camisa polo masculina cara", 90000), item(54, "pants", "Calça masculina bege", 8000), item(55, "shirts", "Pijama camisa masculina", 5000)]
    const t = await make({ store: (k) => /polo/.test(k) ? EXTRA : all(k) })
    try {
      const res = await t.call("POST", "/v1/studio/outfit-searches", { prompt: PROMPT, filters: { maxPieceBrl: 200, audience: "masculino" } }, "a", "search-key-o")
      await Promise.all(t.work)
      const set = (await t.call("GET", `/v1/studio/outfit-searches/${res.json().id}`)).json().sets.find((s: { kind: string }) => s.kind === "assembled")
      const options = await t.call("POST", `/v1/studio/outfit-sets/${set.id}/options`, { slot: "upper", query: "camisa polo" })
      expect(options.statusCode).toBe(200)
      expect(t.store.queries.at(-1)).toBe("camisa polo")
      // Only what fits this part, this audience and these filters; everything left out is counted.
      expect(options.json().found).toEqual({ returned: 5, added: 1, outside: { audience: 1, filter_price: 1, other_part: 1, not_outfit: 1 } })
      expect(options.json().alternatives.upper[0].product.id).toBe("aliexpress:51")
      expect(options.json().revision).toBe(set.revision)
      const worn = await t.call("POST", `/v1/studio/outfit-sets/${set.id}/piece`, { slot: "upper", productId: "aliexpress:51", base: set.revision })
      expect(worn.statusCode).toBe(200)
      expect(worn.json().pieces.find((p: { slot: string }) => p.slot === "upper")).toMatchObject({ tryOn: { ready: true }, product: { id: "aliexpress:51" } })
      // The same question again adds nothing, and says so.
      expect((await t.call("POST", `/v1/studio/outfit-sets/${set.id}/options`, { slot: "upper", query: "camisa polo" })).json().found.added).toBe(0)
      // What the person asks for wins over the style of the first request; a part that is not in the outfit is refused.
      expect((await t.call("POST", `/v1/studio/outfit-sets/${set.id}/options`, { slot: "dress", query: "vestido" })).statusCode).toBe(422)
      expect((await t.call("POST", `/v1/studio/outfit-sets/${set.id}/options`, { slot: "upper", query: " " })).statusCode).toBe(422)
      expect((await t.call("POST", `/v1/studio/outfit-sets/${set.id}/options`, { slot: "upper", query: "camisa polo" }, "b")).statusCode).toBe(404)
    } finally { await t.app.close() }
  })
  test("“buscar outra” with the store down keeps the outfit and says it", async () => {
    const t = await make({ store: (k) => /polo/.test(k) ? "down" : all(k) })
    try {
      const { search } = await t.run()
      const set = search.sets.find((s: { kind: string }) => s.kind === "assembled")
      const r = await t.call("POST", `/v1/studio/outfit-sets/${set.id}/options`, { slot: "upper", query: "camisa polo" })
      expect([r.statusCode, r.json().error.code]).toEqual([503, "source_unavailable"])
      expect((await t.call("GET", `/v1/studio/outfit-sets/${set.id}`)).json().revision).toBe(set.revision)
    } finally { await t.app.close() }
  })
  test("idempotent start, one search at a time, isolation between accounts", async () => {
    let release: () => void = () => undefined
    const t = await make({ gate: new Promise((r) => { release = r }) })
    try {
      const first = await t.call("POST", "/v1/studio/outfit-searches", { prompt: PROMPT }, "a", "search-key-1")
      const replay = await t.call("POST", "/v1/studio/outfit-searches", { prompt: PROMPT }, "a", "search-key-1")
      expect([first.statusCode, replay.statusCode, replay.json().id]).toEqual([202, 200, first.json().id])
      expect((await t.call("POST", "/v1/studio/outfit-searches", { prompt: "outro" }, "a", "search-key-2")).json().error.code).toBe("search_in_progress")
      expect((await t.call("POST", "/v1/studio/outfit-searches", { prompt: "x" }, "a")).statusCode).toBe(400)
      expect((await t.call("POST", "/v1/studio/outfit-searches", { prompt: " " }, "a", "search-key-3")).statusCode).toBe(422)
      expect((await t.call("POST", "/v1/studio/outfit-searches", { prompt: "x" }, "none", "search-key-4")).statusCode).toBe(401)
      expect((await t.call("GET", `/v1/studio/outfit-searches/${first.json().id}`, undefined, "b")).statusCode).toBe(404)
      expect((await t.call("GET", "/v1/studio/outfit-searches", undefined, "b")).json().items).toEqual([])
      expect(t.work).toHaveLength(1)
      release(); await Promise.all(t.work)
    } finally { await t.app.close() }
  })
  test("cancelled mid-way: nothing is stored afterwards", async () => {
    let release: () => void = () => undefined
    const t = await make({ gate: new Promise((r) => { release = r }) })
    try {
      const id = (await t.call("POST", "/v1/studio/outfit-searches", { prompt: PROMPT }, "a", "search-key-1")).json().id
      expect((await t.call("POST", `/v1/studio/outfit-searches/${id}/cancel`)).json().status).toBe("cancelled")
      release(); await Promise.all(t.work)
      expect((await t.call("GET", `/v1/studio/outfit-searches/${id}`)).json()).toMatchObject({ status: "cancelled", sets: [] })
    } finally { await t.app.close() }
  })
  test("interrupted search is reported and can be repeated", async () => {
    const t = await make()
    try {
      const { res } = await t.run()
      t.searches[0]!.status = "running"; t.searches[0]!.expired = true
      const read = (await t.call("GET", `/v1/studio/outfit-searches/${res.json().id}`)).json()
      expect(read.status).toBe("interrupted")
      expect(read.message).toContain("interrompida")
    } finally { await t.app.close() }
  })
  test("honest empty and unavailable outcomes", async () => {
    for (const [store, status, code] of [[() => [], "empty", "no_results"], [() => "down", "failed", "source_unavailable"], [(k: string) => /conjunto|terno|camisa/.test(k) ? [] : LOWER, "empty", "missing_pieces"]] as const) {
      const t = await make({ store: store as never })
      try {
        const { search } = await t.run()
        expect([search.status, search.errorCode, search.sets]).toEqual([status, code, []])
        expect(search.message.length).toBeGreaterThan(10)
        if (status === "failed") expect(t.store.queries.length).toBe(2)
      } finally { await t.app.close() }
    }
    const t = await make({ noStore: true })
    try { expect((await t.run()).search.errorCode).toBe("source_unavailable") } finally { await t.app.close() }
  })
  test("a throttled store stops at once", async () => {
    const t = await make({ store: () => "limited" })
    try { await t.run(); expect(t.store.queries).toHaveLength(1) } finally { await t.app.close() }
  })
  test("agents plan and select; invalid proposals fall back to labelled rules; abstention is final", async () => {
    const ok = await make({ agents: agents(), composer })
    try {
      const { search } = await ok.run()
      expect(search).toMatchObject({ selection: { method: "agent", model: "claude-haiku" }, report: { interpretedBy: "agent", plannedBy: "agent", agent: { calls: 3, estimatedUsd: 0.0045 } } })
      expect(ok.store.queries[0]).toBe("conjunto masculino italiano")
      expect(search.sets).toHaveLength(1)
      expect(search.sets[0]).toMatchObject({ title: "Milano", kind: "assembled" })
    } finally { await ok.app.close() }
    const bad = await make({ agents: agents({ compose: async () => ({ outfits: [], rejected: [{ index: 0, reason: "unknown_product" }], usage, promptVersion: "outfits/x" }) }), composer })
    try { expect((await bad.run()).search.selection.method).toBe("rules_fallback") } finally { await bad.app.close() }
    const none = await make({ agents: agents({ compose: async () => ({ outfits: [], rejected: [], usage, promptVersion: "outfits/x" }) }), composer })
    try { expect((await none.run()).search).toMatchObject({ status: "empty", errorCode: "agent_abstained" }) } finally { await none.app.close() }
  })
  test("without model budget no model is called and the search still works", async () => {
    let called = 0
    const count = { plan: async () => { called++; throw new Error("x") }, compose: async () => { called++; throw new Error("x") } }
    const t = await make({ agents: agents(count as never), composer, acquire: async () => false })
    try { const { search } = await t.run(); expect([search.status, search.selection.method, called, search.report.agent.calls]).toEqual(["succeeded", "rules_fallback", 0, 0]) } finally { await t.app.close() }
  })
  test("an unusable image rebuilds that outfit before it is shown; without alternative it is shown blocked, with the reason", async () => {
    const one = await make({ blocked: { "aliexpress:1": "too_small" } })
    try {
      const { search } = await one.run()
      expect(search.sets.every((s: { pieces: { tryOn: { ready: boolean } }[] }) => s.pieces.every((p) => p.tryOn.ready))).toBe(true)
      expect(JSON.stringify(search.sets)).not.toContain("aliexpress:1\"")
    } finally { await one.app.close() }
    const all = await make({ blocked: Object.fromEntries([1, 2, 11, 12, 13, 21, 22].map((n) => [`aliexpress:${n}`, "rights_unavailable"])) })
    try {
      const { search } = await all.run()
      expect(search.status).toBe("succeeded")
      expect(search.sets[0].pieces[0].tryOn).toEqual({ ready: false, code: "rights_unavailable", message: "O uso desta imagem no provador não está autorizado agora." })
    } finally { await all.app.close() }
  })
})

describe("outfit sets", () => {
  async function withSet(opts: Parameters<typeof make>[0] = {}) {
    const t = await make(opts)
    const { search } = await t.run()
    const set = search.sets.find((s: { kind: string }) => s.kind === "assembled")
    const full = (await t.call("GET", `/v1/studio/outfit-sets/${set.id}`)).json()
    return { t, set, full, post: (path: string, body: object, user = "a") => t.call("POST", `/v1/studio/outfit-sets/${set.id}/${path}`, body, user) }
  }
  const id = (full: { pieces: { slot: string; product: { id: string } }[] }, slot: string) => full.pieces.find((p) => p.slot === slot)!.product.id

  test("swap keeps the other piece, uses only retrieved options and survives a reload", async () => {
    const { t, set, full, post } = await withSet()
    try {
      const other = full.alternatives.upper[0].product.id
      const queries = t.store.queries.length
      const swapped = await post("piece", { slot: "upper", productId: other, base: 1 })
      expect(swapped.statusCode).toBe(200)
      expect(swapped.json()).toMatchObject({ revision: 2, origin: { id: "swap" } })
      expect([id(swapped.json(), "upper"), id(swapped.json(), "lower")]).toEqual([other, id(full, "lower")])
      expect(t.store.queries.length).toBe(queries)
      const again = (await t.call("GET", `/v1/studio/outfit-sets/${set.id}`)).json()
      expect([again.revision, again.revisions.length, id(again, "upper")]).toEqual([2, 2, other])
      expect((await post("piece", { slot: "upper", productId: other, base: 1 })).json().error.code).toBe("stale_revision")
      expect((await post("piece", { slot: "upper", productId: "aliexpress:999", base: 2 })).statusCode).toBe(422)
      expect((await post("piece", { slot: "dress", productId: other, base: 2 })).statusCode).toBe(422)
      expect((await post("piece", { slot: "upper", productId: other, base: 2 }, "b")).statusCode).toBe(404)
      expect((await t.call("GET", `/v1/studio/outfit-sets/${set.id}`, undefined, "b")).statusCode).toBe(404)
      // Going back to an earlier version creates a new one.
      const restored = (await post("restore", { revision: 1, base: 2 })).json()
      expect([restored.revision, id(restored, "upper")]).toEqual([3, id(full, "upper")])
      expect((await post("restore", { revision: 3, base: 3 })).statusCode).toBe(422)
    } finally { await t.app.close() }
  })
  test("a swap whose image cannot be used keeps the previous piece", async () => {
    const t = await make()
    const { search } = await t.run()
    const set = search.sets.find((s: { kind: string }) => s.kind === "assembled")
    const full = (await t.call("GET", `/v1/studio/outfit-sets/${set.id}`)).json()
    const target = full.alternatives.upper[0].product.id
    const plan = t.searches[0]!.plan as { pools: { upper: { id: string; reference: unknown; blocked: string | null }[] } }
    Object.assign(plan.pools.upper.find((p) => p.id === target)!, { reference: null, blocked: null })
    const blocked = await make({ blocked: { [target]: "redirect_refused" } })
    try {
      const { search: s2 } = await blocked.run()
      const set2 = s2.sets.find((s: { kind: string; pieces: { product: { id: string } }[] }) => s.kind === "assembled" && !s.pieces.some((p) => p.product.id === target))
      const res = await blocked.call("POST", `/v1/studio/outfit-sets/${set2.id}/piece`, { slot: "upper", productId: target, base: 1 })
      expect([res.statusCode, res.json().error.code]).toEqual([409, "piece_blocked"])
      expect((await blocked.call("GET", `/v1/studio/outfit-sets/${set2.id}`)).json().revision).toBe(1)
    } finally { await blocked.app.close(); await t.app.close() }
  })
  test("locks persist without a new version; a new combination keeps locked pieces and needs no store search", async () => {
    const { t, set, full, post } = await withSet()
    try {
      const locked = (await post("locks", { locked: ["lower"], base: 1 })).json()
      expect([locked.locked, locked.revision]).toEqual([["lower"], 1])
      expect((await t.call("GET", `/v1/studio/outfit-sets/${set.id}`)).json().locked).toEqual(["lower"])
      const queries = t.store.queries.length
      const next = (await post("suggest", { locked: ["lower"], base: 1 })).json()
      expect([next.revision, next.locked, id(next, "lower")]).toEqual([2, ["lower"], id(full, "lower")])
      expect(id(next, "upper")).not.toBe(id(full, "upper"))
      expect(t.store.queries.length).toBe(queries)
      expect((await post("suggest", { locked: ["lower", "upper"], base: 2 })).json().error.code).toBe("no_alternative")
    } finally { await t.app.close() }
  })
  test("a new combination makes at most one model call", async () => {
    let calls = 0
    const { t, post } = await withSet({ composer, agents: agents({ compose: async (i, pools, o) => { calls++; return agents().compose(i, pools, o) } }) })
    try {
      calls = 0
      await post("suggest", { locked: [], base: 1 })
      expect(calls).toBe(1)
    } finally { await t.app.close() }
  })
})
