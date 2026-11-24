import { describe, expect, test } from "bun:test"
import { randomBytes, randomUUID } from "node:crypto"
import type { AliExpressCatalogService, NormalizedAliExpressCatalogItem } from "@stylai/commerce"
import type { PrivateObjectStore } from "@stylai/supabase"
import { buildApp } from "../src/app"
import { readSessionKeys, signMediaUrl } from "../src/modules/auth/session-crypto"
import { pieceFromAliExpress, type StoredPiece } from "../src/modules/outfits/pieces"
import type { OutfitRenderDeps } from "../src/modules/outfits/renders"
import { createOutfitSearch } from "../src/modules/outfits/search"
import type { PreparedReference } from "../src/modules/outfits/references"
import { A, B, fakeDb, item, rejected } from "./outfit-fixtures"

const CAT: Record<string, "upper" | "lower"> = { shirts: "upper", pants: "lower" }
const ITEMS = [item(11, "shirts", "Camisa social branca"), item(21, "pants", "Calça alfaiataria", 15000), item(12, "shirts", "Camisa azul", 11000), item(22, "pants", "Calça cinza", 14000)]
const uuid = (n: number) => `31000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const plan = { intent: { slots: [{ slot: "lower", required: true }, { slot: "upper", required: true }], colors: [], terms: [], occasion: null, budgetTotalBrl: null, budgetMode: "prefer", avoid: [] },
  interpretedBy: "rules_fallback", plannedBy: "rules_fallback", queries: [{ slot: "upper", query: "camisa", outcome: "ok", returned: 1, kept: 1, fromCache: false, code: null }, { slot: "lower", query: "calça", outcome: "ok", returned: 1, kept: 1, fromCache: false, code: null }],
  pools: {}, rejected: {}, missingSlots: [], agent: { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: "0", promptVersions: [] }, notes: [] }
type Job = { id: string; status: string; failure_code: string | null; finished_at: string | null }
interface Panel { panel: number; set_id: string; revision: number; label: string; dropped: boolean; search_id: string; pieces: StoredPiece[]; attempts: number; version_id: string | null; charge_state: string; settled_usd_micros: number; job: Job | null }

interface Options { photo?: boolean; supports?: object; consent?: string; spent?: number; limiting?: string[]; blocked?: Record<string, string>; render?: Partial<NonNullable<OutfitRenderDeps["render"]>> | null; fresh?: () => NormalizedAliExpressCatalogItem[]; active?: boolean; enqueue?: string; retry?: string }
async function make(o: Options = {}) {
  const renders: { id: string; user: string; key: string; hash: string; mode: string; state: string; panels: Panel[]; photo_current: boolean; model: string }[] = []
  const enqueued: unknown[][] = []
  const json = (r: (typeof renders)[number]) => ({ id: r.id, request_key: r.key, mode: r.mode, provider: "segmind", model: r.model, reserve_usd_micros: 20000, created_at: "x", comparison_state: r.state, comparison_error: null,
    comparison_layout: null, comparison: r.state === "ready" ? { width: 1200, height: 800 } : null, photo_current: r.photo_current, panels: r.panels })
  const opt = o
  const f = fakeDb((op, args) => {
    switch (op) {
      case "read_photo_consent": return { policy_version: opt.consent ?? "2026-11-24-inline" }
      case "list_body_photos": return opt.photo === false ? [] : [{ angle: "front", state: "ready", validation: { supports: opt.supports ?? { upper: true, lower: true, dress: true } } }]
      case "read_ai_allowance": return { allowance: 12, reserved: 0, spent: opt.spent ?? 0 }
      case "read_active_ai_job": return opt.active ? { id: "x" } : undefined
      case "outfit_budget": return { ok: !opt.limiting?.length, calls: args[4], reserve_usd_micros: 20000, needed_usd_micros: 20000 * Number(args[4]), remaining_usd_micros: 50000, limiting: opt.limiting ?? [],
        pilot: args[5] ? { id: args[5], remaining_attempts: 0, max_attempts: 11, remaining_usd_micros: 0, limit_usd_micros: 1, paused: false } : null }
      case "list_outfit_renders": return renders.filter((r) => r.user === args[0]).map(json)
      case "read_outfit_render": { const r = renders.find((x) => x.id === args[1] && x.user === args[0]); return r ? json(r) : undefined }
      case "enqueue_outfit_render": {
        const prior = renders.find((r) => r.user === args[0] && r.key === args[1])
        if (prior) { if (prior.hash !== args[2]) throw rejected("23505"); return prior.id }
        if (opt.enqueue) throw rejected(opt.enqueue)
        enqueued.push(args)
        const panels = args[9] as { set_id: string; revision: number; label: string }[]
        const id = randomUUID()
        renders.push({ id, user: String(args[0]), key: String(args[1]), hash: String(args[2]), mode: String(args[4]), model: String(args[6]), state: args[4] === "individual" ? "not_applicable" : "waiting", photo_current: true,
          panels: panels.map((p, i) => ({ panel: i + 1, set_id: p.set_id, revision: p.revision, label: p.label, dropped: false, search_id: randomUUID(), pieces: [], attempts: 1, version_id: null, charge_state: "none", settled_usd_micros: 0,
            job: { id: randomUUID(), status: "queued", failure_code: null, finished_at: null } })) })
        return id
      }
      case "retry_outfit_panel": {
        if (opt.retry && !(opt.retry === "SA009" && args[8] === true)) throw rejected(opt.retry)
        const p = renders.find((r) => r.id === args[1])!.panels.find((x) => x.panel === args[2])!
        p.job = { id: randomUUID(), status: "queued", failure_code: null, finished_at: null }; p.attempts++
        return args[1]
      }
      case "finalize_outfit_render": renders.find((r) => r.id === args[1])!.state = "pending"; return true
      case "cancel_outfit_render": { const r = renders.find((x) => x.id === args[1])!; for (const p of r.panels) if (p.job?.status === "queued") p.job.status = "cancelled"; return 1 }
      case "read_comparison_asset": return renders.some((r) => r.id === args[1] && r.user === args[0] && r.state === "ready") ? { bucket: "generated-looks", object_key: "k.png", mime: "image/png", bytes: 3 } : undefined
    }
    return undefined
  })
  const fresh = new Map<string, NormalizedAliExpressCatalogItem>()
  const storeQueries: string[] = []
  const aliexpressCatalog = { search: async ({ keywords }: { keywords: string }) => { storeQueries.push(keywords); for (const i of opt.fresh?.() ?? ITEMS) fresh.set(i.canonicalKey, i); return {} }, findFresh: async (id: string) => fresh.get(id) ?? null } as unknown as AliExpressCatalogService
  const search = createOutfitSearch({ db: f.db, source: "aliexpress_affiliate", listCatalog: async () => [], preparer: { prepare: async (items) => new Map(items.map((i): [string, PreparedReference] => [i.canonicalKey,
    opt.blocked?.[i.canonicalKey] ? { status: "blocked", code: opt.blocked[i.canonicalKey]! } : { status: "ready", reference: { productId: uuid(Number(i.externalProductId)), variantId: uuid(900 + Number(i.externalProductId)), imageUrl: i.image, sha256: "a".repeat(64) } }])) } })
  const keys = readSessionKeys({ STYLAI_SESSION_KEY: randomBytes(32).toString("base64") })!
  const app = await buildApp({ appOrigin: "http://localhost:5200", outfitRenders: {
    db: f.db, keys, search, aliexpressCatalog, publicBaseUrl: "http://x/v1", photoPolicyVersion: "2026-11-24-inline", store: { get: async () => new Uint8Array([1, 2, 3]) } as unknown as PrivateObjectStore,
    resolveActor: async (r) => r.headers["x-test-user"] === "b" ? B : r.headers["x-test-user"] === "a" ? A : null,
    render: opt.render === null ? null : { mode: "simulated", provider: "segmind", providerLabel: "Segmind", model: "flux-3-klein-image-edit", reserveMicros: 20_000n, priceMicros: 12_870n, pilotId: null, ...opt.render } } })
  const searchId = randomUUID()
  f.searches.push({ id: searchId, user: A, key: "k", hash: "h", prompt: "x", source: "aliexpress_affiliate", model: null, status: "succeeded", stage: "done", detail: {}, method: "rules_fallback", error: null, plan })
  for (const [i, pair] of [[ITEMS[0]!, ITEMS[1]!], [ITEMS[2]!, ITEMS[3]!]].entries()) {
    const pieces = pair.map((x) => pieceFromAliExpress(x, CAT[x.category]!))
    f.sets.push({ id: randomUUID(), user: A, search: searchId, position: i + 1, kind: "assembled", recommended: i === 0, title: `Conjunto ${i + 1}`, rationale: "", missing: [], revision: 1,
      revisions: [{ revision: 1, origin: "suggested", pieces, locked: [], total: pieces.reduce((a, p) => a + p.priceMinor!, 0) }] })
  }
  const call = (method: "GET" | "POST", url: string, payload?: object, key?: string, user = "a") => app.inject({ method, url, ...(payload ? { payload } : {}), headers: { "x-test-user": user, ...(key ? { "idempotency-key": key } : {}) } })
  const sets = (n: number) => f.sets.slice(0, n).map((s) => ({ setId: s.id, revision: s.revision }))
  const quote = async (n: number) => (await call("POST", "/v1/studio/outfit-renders/quote", { mode: n === 1 ? "individual" : "comparison", sets: sets(n) })).json()
  const create = async (n: number, key = "render-key-1") => call("POST", "/v1/studio/outfit-renders", { mode: n === 1 ? "individual" : "comparison", sets: sets(n), confirmation: (await quote(n)).confirmation ?? "0".repeat(64) }, key)
  return { ...f, app, call, sets, quote, create, renders, enqueued, storeQueries, keys, opt }
}
const fail = (p: Panel, over: Partial<Panel> = {}, code = "segmind_http_429") => Object.assign(p, { job: { ...p.job!, status: "failed", failure_code: code }, ...over })
const done = (p: Panel) => Object.assign(p, { job: { ...p.job!, status: "succeeded" }, version_id: randomUUID(), settled_usd_micros: 12870 })

describe("quote", () => {
  test("a comparison of two sums calls, coins and the whole-batch ceiling, rechecking each distinct query once", async () => {
    const t = await make({ render: { mode: "real", pilotId: null } })
    try {
      const q = await t.quote(2)
      expect(q).toMatchObject({ ready: true, blockers: [], generation: { calls: 2, simulated: false, estimatedUsd: 0.02574, maxUsd: 0.04 }, coins: { cost: 20, available: 120 }, budget: { ok: true, neededUsd: 0.04 } })
      expect(q.panels.map((p: { title: string }) => p.title)).toEqual(["Conjunto 1", "Conjunto 2"])
      expect(q.confirmation).toMatch(/^[0-9a-f]{64}$/)
      expect(t.storeQueries).toEqual(["camisa"])
    } finally { await t.app.close() }
  })
  test("simulated generation is free and says so", async () => {
    const t = await make()
    try { expect((await t.quote(1)).generation).toMatchObject({ simulated: true, estimatedUsd: 0, maxUsd: 0, calls: 1 }) } finally { await t.app.close() }
  })
  test("each blocker is explicit and no confirmation is issued", async () => {
    const cases: [Options, string][] = [[{ photo: false }, "photo_required"], [{ consent: "dev-v1" }, "consent_required"], [{ supports: { upper: true, lower: false, dress: false } }, "photo_framing_insufficient"],
      [{ spent: 12 }, "insufficient_tokens"], [{ limiting: ["user"] }, "budget_user"], [{ render: { mode: "real", pilotId: "p1" }, limiting: ["pilot_attempts", "pilot_items"] }, "budget_pilot_attempts"],
      [{ render: null }, "generation_disabled"], [{ active: true }, "conflict"], [{ blocked: { "aliexpress:21": "rights_unavailable" } }, "pieces_blocked"]]
    for (const [options, code] of cases) {
      const t = await make(options)
      try {
        const q = await t.quote(1)
        expect([code, q.ready, q.confirmation, q.blockers.map((b: { code: string }) => b.code).includes(code)]).toEqual([code, false, null, true])
        if (code === "pieces_blocked") expect(q.blockedPieces[0]).toMatchObject({ slot: "lower", code: "rights_unavailable" })
      } finally { await t.app.close() }
    }
  })
  test("a changed price becomes a new version, is reported and needs a new confirmation", async () => {
    const t = await make({ fresh: () => ITEMS.map((i) => i.externalProductId === "11" ? { ...i, priceMinor: 9900 } : i) })
    try {
      const q = await t.quote(1)
      expect(q.changes).toEqual([{ setId: t.sets(1)[0]!.setId, slot: "upper", name: "Camisa social branca", kind: "price", before: 90, after: 99 }])
      expect([q.panels[0].revision, t.sets(1)[0]!.revision, q.panels[0].total.amount]).toEqual([2, 2, 249])
      // The confirmation of the previous state no longer works.
      expect((await t.call("POST", "/v1/studio/outfit-renders", { mode: "individual", sets: [{ setId: t.sets(1)[0]!.setId, revision: 1 }], confirmation: q.confirmation }, "render-key-9")).json().error.code).toBe("stale_revision")
    } finally { await t.app.close() }
  })
  test("bounds and isolation", async () => {
    const t = await make()
    try {
      const url = "/v1/studio/outfit-renders/quote"
      const [one, two] = t.sets(2)
      for (const body of [{ mode: "comparison", sets: [one] }, { mode: "individual", sets: [one, two] }, { mode: "comparison", sets: [one, one] }, { mode: "individual", sets: [] }]) expect((await t.call("POST", url, body)).statusCode).toBe(422)
      expect((await t.call("POST", url, { mode: "individual", sets: [one] }, undefined, "b")).statusCode).toBe(404)
      expect((await t.call("POST", url, { mode: "individual", sets: [one] }, undefined, "none")).statusCode).toBe(401)
      expect((await t.call("POST", url, { mode: "individual", sets: [{ ...one, revision: 7 }] })).json().error.code).toBe("stale_revision")
    } finally { await t.app.close() }
  })
})

describe("batches", () => {
  test("the whole batch is enqueued once, with the exact prepared pieces; double click and replay return the same batch", async () => {
    const t = await make()
    try {
      const body = { mode: "comparison", sets: t.sets(2), confirmation: (await t.quote(2)).confirmation }
      const twins = await Promise.all([1, 2].map(() => t.call("POST", "/v1/studio/outfit-renders", body, "render-key-1")))
      expect(twins.map((r) => r.statusCode).sort()[1]).toBe(202)
      expect(new Set(twins.map((r) => r.json().id)).size).toBe(1)
      t.opt.limiting = ["user"]; t.opt.active = true
      const replay = await t.call("POST", "/v1/studio/outfit-renders", body, "render-key-1")
      expect([replay.statusCode, replay.json().id]).toEqual([200, twins[0]!.json().id])
      expect(t.enqueued).toHaveLength(1)
      const panels = t.enqueued[0]![9] as { items: { slot: string; product_id: string; variant_id: string; image_url: string; commerce: object }[] }[]
      expect(panels[0]!.items[0]).toEqual({ slot: "upper", product_id: uuid(11), variant_id: uuid(911), image_url: "https://ae01.alicdn.com/kf/11.jpg", commerce: { canonical_id: "aliexpress:11", affiliate_url: "https://s.click.aliexpress.com/e/11" } })
      expect(replay.json()).toMatchObject({ mode: "comparison", status: "running", canCancel: true, panels: [{ state: "queued" }, { state: "queued" }] })
    } finally { await t.app.close() }
  })
  test("without the matching confirmation nothing is enqueued", async () => {
    const t = await make()
    try {
      const res = await t.call("POST", "/v1/studio/outfit-renders", { mode: "individual", sets: t.sets(1), confirmation: "0".repeat(64) }, "render-key-1")
      expect([res.statusCode, res.json().error.code]).toEqual([409, "quote_changed"])
      const q = await t.quote(1)
      t.opt.blocked = { "aliexpress:21": "rights_unavailable" }
      const revoked = await t.call("POST", "/v1/studio/outfit-renders", { mode: "individual", sets: t.sets(1), confirmation: q.confirmation }, "render-key-1")
      expect(revoked.json().error.code).toBe("pieces_blocked")
      expect((await t.call("POST", "/v1/studio/outfit-renders", { mode: "individual", sets: t.sets(1), confirmation: q.confirmation })).statusCode).toBe(400)
      expect(t.enqueued).toEqual([])
    } finally { await t.app.close() }
  })
  test("database refusals keep their meaning", async () => {
    for (const [state, status, code] of [["SA007", 409, "budget_insufficient"], ["23505", 409, "conflict"], ["SA010", 409, "photo_replaced"], ["SA003", 409, "try_on_rights_missing"]] as const) {
      const t = await make({ enqueue: state })
      try { const r = await t.create(1); expect([r.statusCode, r.json().error.code]).toEqual([status, code]) } finally { await t.app.close() }
    }
  })
  test("partial failure keeps what is ready and retries only the panel that failed", async () => {
    const t = await make()
    try {
      const id = (await t.create(2)).json().id
      const r = t.renders[0]!
      done(r.panels[0]!); fail(r.panels[1]!)
      const view = (await t.call("GET", `/v1/studio/outfit-renders/${id}`)).json()
      expect(view).toMatchObject({ status: "partial", canFinalize: false, comparison: { state: "waiting", image: null }, panels: [{ state: "ready" }, { state: "failed", canRetry: true, error: { message: "O provador recusou o pedido." } }] })
      expect(view.panels[0].image.url).toContain("/media/looks/")
      const retried = await t.call("POST", `/v1/studio/outfit-renders/${id}/retry`, { panel: 2 })
      expect(retried.json().panels.map((p: { state: string }) => p.state)).toEqual(["ready", "queued"])
      const attempts = r.panels[1]!.attempts
      expect((await t.call("POST", `/v1/studio/outfit-renders/${id}/retry`, { panel: 2 })).statusCode).toBe(200)
      expect((await t.call("POST", `/v1/studio/outfit-renders/${id}/retry`, { panel: 1 })).statusCode).toBe(200)
      expect(r.panels[1]!.attempts).toBe(attempts)
      expect((await t.call("POST", `/v1/studio/outfit-renders/${id}/retry`, { panel: 2 }, undefined, "b")).statusCode).toBe(404)
    } finally { await t.app.close() }
  })
  test("unknown outcome never offers a retry; a charged failure needs explicit acceptance; a replaced photo blocks", async () => {
    const t = await make({ retry: "SA008" })
    try {
      const id = (await t.create(2)).json().id
      const [p1, p2] = t.renders[0]!.panels as [Panel, Panel]
      fail(p1, { charge_state: "unknown" }, "provider_outcome_unknown"); fail(p2, { charge_state: "charged", settled_usd_micros: 12870 })
      const view = (await t.call("GET", `/v1/studio/outfit-renders/${id}`)).json()
      expect(view.panels.map((p: { state: string; canRetry: boolean; retryNeedsChargeAcceptance: boolean }) => [p.state, p.canRetry, p.retryNeedsChargeAcceptance])).toEqual([["needs_reconciliation", false, false], ["failed_charged", true, true]])
      expect((await t.call("POST", `/v1/studio/outfit-renders/${id}/retry`, { panel: 1 })).json().error.code).toBe("needs_reconciliation")
      t.opt.retry = "SA009"
      expect((await t.call("POST", `/v1/studio/outfit-renders/${id}/retry`, { panel: 2 })).json().error.code).toBe("second_charge")
      expect((await t.call("POST", `/v1/studio/outfit-renders/${id}/retry`, { panel: 2, acceptCharge: true })).json().panels[1].state).toBe("queued")
      fail(p2); t.renders[0]!.photo_current = false
      expect((await t.call("GET", `/v1/studio/outfit-renders/${id}`)).json().panels[1]).toMatchObject({ canRetry: false, retryBlockedReason: expect.stringContaining("foto mudou") })
      t.renders[0]!.photo_current = true; t.renders[0]!.model = "other-model"
      expect((await t.call("POST", `/v1/studio/outfit-renders/${id}/retry`, { panel: 2 })).json().error.code).toBe("provider_changed")
    } finally { await t.app.close() }
  })
  test("cancel stops what did not start; finalize is an explicit choice with two ready panels", async () => {
    const t = await make()
    try {
      const id = (await t.create(2)).json().id
      const r = t.renders[0]!
      const cancelled = (await t.call("POST", `/v1/studio/outfit-renders/${id}/cancel`)).json()
      expect([cancelled.status, cancelled.canCancel]).toEqual(["failed", false])
      done(r.panels[0]!); done(r.panels[1]!)
      r.panels.push({ ...fail({ ...r.panels[1]!, panel: 3, version_id: null }), version_id: null })
      expect((await t.call("GET", `/v1/studio/outfit-renders/${id}`)).json()).toMatchObject({ status: "partial", canFinalize: true })
      expect((await t.call("POST", `/v1/studio/outfit-renders/${id}/finalize`)).json().status).toBe("assembling")
    } finally { await t.app.close() }
  })
  test("the finished comparison is served only through its owner's signed link", async () => {
    const t = await make()
    try {
      const id = (await t.create(2)).json().id
      for (const p of t.renders[0]!.panels) done(p)
      t.renders[0]!.state = "ready"
      const view = (await t.call("GET", `/v1/studio/outfit-renders/${id}`)).json()
      expect(view).toMatchObject({ status: "succeeded", spentUsd: 0.02574 })
      const path = (url: string) => url.replace("http://x", "")
      const image = await t.call("GET", path(view.comparison.image.url))
      expect([image.statusCode, image.headers["content-type"]]).toEqual([200, "image/png"])
      expect((await t.call("GET", path(signMediaUrl("http://x/v1", t.keys, "comparison", id, B)))).statusCode).toBe(404)
      expect((await t.call("GET", path(signMediaUrl("http://x/v1", t.keys, "look", id, A)).replace("/looks/", "/comparisons/"))).statusCode).toBe(404)
      expect((await t.call("GET", "/v1/studio/outfit-renders", undefined, undefined, "b")).json().items).toEqual([])
    } finally { await t.app.close() }
  })
})
