import { describe, expect, test } from "bun:test"
import type { HistoryAnswer, SegmindHistory } from "@stylai/ai"
import type { PrivateDatabase, PrivateObjectStore } from "@stylai/supabase"
import { createEngine, defaultEngineConfig } from "../src/engine.js"

const NOW = Date.parse("2026-11-24T22:00:00Z")
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const call = (over: Record<string, unknown> = {}) => ({
  id: "10000000-0000-4000-8000-000000000001", job_id: "20000000-0000-4000-8000-000000000001", user_id: "30000000-0000-4000-8000-000000000001", provider: "segmind", model: "flux-3-klein-image-edit", provider_request_id: null, status: "unknown", environment: "development",
  started_at: ago(10), finished_at: ago(9.8), error_code: "segmind_http_502", taken: ["other"], rivals: 0, ...over,
})
const FOUND: HistoryAnswer = { kind: "found", requestId: "f9f4f21a8957", httpStatus: 502, costMicros: 0n, hasOutput: false, outputUrl: null, errorFamily: "upstream_5xx" }
const PAID = { ...FOUND, httpStatus: 200, costMicros: 12870n, hasOutput: true, outputUrl: "https://images.segmind.com/a/b/x.png", errorFamily: null } as HistoryAnswer
const IMAGE = { bytes: new Uint8Array([1, 2, 3]), info: { mime: "image/png" as const, width: 300, height: 400 } }
function make(rows: unknown[], answer: HistoryAnswer, opts: { history?: boolean; image?: typeof IMAGE | null; recover?: string | null | Error } = {}) {
  const settled: unknown[][] = [], recovered: unknown[][] = [], stored: string[] = [], removed: string[] = [], asked: Parameters<SegmindHistory["find"]>[0][] = []
  let now = NOW
  const db = { call: async (op: string, ...args: unknown[]) => { if (op === "list_unreconciled_calls") return rows; if (op === "reconcile_provider_call") { settled.push(args); return true } if (op === "recover_look_job") { recovered.push(args); if (opts.recover instanceof Error) throw opts.recover; return opts.recover ?? null } return null } } as unknown as PrivateDatabase<"ai_worker">
  const history: SegmindHistory = { find: async (q) => { asked.push(q); return answer }, output: async () => opts.image ?? null }
  const store = { put: async (_b: string, k: string) => { stored.push(k) }, remove: async (_b: string, k: string) => { removed.push(k) } } as unknown as PrivateObjectStore
  const engine = createEngine({ db, store, segmind: null, now: () => now, ...(opts.history === false ? {} : { segmindHistory: history }),
    config: { ...defaultEngineConfig, provider: "segmind", environment: "development", pseudonymKey: "k".repeat(32) } })
  return { engine, settled, recovered, stored, removed, asked, later: (minutes: number) => { now += minutes * 60_000 } }
}

describe("a definite record from the provider settles the call", () => {
  test("not charged: failed at cost zero, with the evidence", async () => {
    const t = make([call()], FOUND)
    expect(await t.engine.reconcileOnce()).toBe(1)
    expect(t.settled).toEqual([["10000000-0000-4000-8000-000000000001", "failed", "0", "provider_confirmed",
      { source: "segmind_history", http_status: 502, charged: false, has_output: false, error_family: "upstream_5xx", request_id: "f9f4f21a8957" }]])
    expect(t.asked[0]).toMatchObject({ model: "flux-3-klein-image-edit", requestId: null, taken: ["other"] })
  })
  test("charged: the real cost, so that another charge needs the person's acceptance", async () => {
    const t = make([call()], { ...FOUND, httpStatus: 200, costMicros: 12870n, hasOutput: true } as HistoryAnswer)
    await t.engine.reconcileOnce()
    expect(t.settled[0]!.slice(1, 4)).toEqual(["failed", "12870", "provider_confirmed"])
    expect(t.settled[0]![4]).toMatchObject({ charged: true, has_output: true })
  })
  test("never arrived: only after 30 minutes, and only for a transport failure or a crash", async () => {
    for (const [over, want] of [[{ error_code: "segmind_transport_econnreset", started_at: ago(31) }, 1], [{ error_code: null, started_at: ago(31) }, 1],
      [{ error_code: "segmind_transport_econnreset", started_at: ago(29) }, 0], [{ error_code: "segmind_http_502", started_at: ago(90) }, 0], [{ error_code: "segmind_response_unreadable", started_at: ago(90) }, 0]] as const) {
      const t = make([call(over)], { kind: "absent" })
      expect([over, await t.engine.reconcileOnce()]).toEqual([over, want])
      if (want) expect(t.settled[0]!.slice(1)).toEqual(["failed", "0", "provider_confirmed", { source: "segmind_history", charged: false, absent: true }])
    }
  })
})

describe("the image already paid for is delivered", () => {
  const KEY = "30000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/recovered.png"
  test("kept, settled at the real cost, and never paid again", async () => {
    const t = make([call()], PAID, { image: IMAGE, recover: "40000000-0000-4000-8000-000000000001" })
    expect(await t.engine.reconcileOnce()).toBe(1)
    expect([t.stored, t.settled, t.removed]).toEqual([[KEY], [], []])
    expect(t.recovered[0]).toEqual(["10000000-0000-4000-8000-000000000001", KEY, 3, "image/png", 300, 400, "12870",
      { source: "segmind_history", http_status: 200, charged: true, has_output: true, error_family: null, request_id: "f9f4f21a8957", recovered: true }])
    expect(JSON.stringify(t.recovered)).not.toContain("images.segmind.com")
  })
  test("no longer allowed (photo, consent or account gone): the copy is deleted and the charge is recorded", async () => {
    const t = make([call()], PAID, { image: IMAGE, recover: null })
    expect(await t.engine.reconcileOnce()).toBe(1)
    expect([t.stored, t.removed]).toEqual([[KEY], [KEY]])
    expect(t.settled[0]!.slice(1, 4)).toEqual(["failed", "12870", "provider_confirmed"])
  })
  test("a database failure deletes the copy and waits", async () => {
    const t = make([call()], PAID, { image: IMAGE, recover: new Error("db") })
    expect([await t.engine.reconcileOnce().catch(() => 0), t.removed, t.settled]).toEqual([0, [KEY], []])
  })
  test("image not available yet: waits up to two hours, then records the charge", async () => {
    expect(await make([call()], PAID, { image: null }).engine.reconcileOnce()).toBe(0)
    const late = make([call({ started_at: ago(121), finished_at: ago(120.8) })], PAID, { image: null })
    expect([await late.engine.reconcileOnce(), late.settled[0]!.slice(1, 3), late.stored]).toEqual([1, ["failed", "12870"], []])
  })
  test("without an address to download from, the charge is recorded at once", async () => {
    const t = make([call()], { ...PAID, outputUrl: null } as HistoryAnswer, { image: IMAGE })
    expect([await t.engine.reconcileOnce(), t.recovered.length, t.settled[0]![2]]).toEqual([1, 0, "12870"])
  })
})

describe("anything else waits", () => {
  test("a success not billed yet may still be billed: it waits, then the record is taken as it is", async () => {
    const free: HistoryAnswer = { ...FOUND, httpStatus: 200, costMicros: 0n, hasOutput: true } as HistoryAnswer
    expect(await make([call()], free).engine.reconcileOnce()).toBe(0)
    expect(await make([call({ started_at: ago(31), finished_at: ago(30.5) })], free).engine.reconcileOnce()).toBe(1)
  })
  for (const answer of [{ kind: "pending" }, { kind: "ambiguous" }, { kind: "unavailable", code: "http_403" }] as HistoryAnswer[])
    test(answer.kind, async () => { const t = make([call()], answer); expect([await t.engine.reconcileOnce(), t.settled]).toEqual([0, []]) })
  test("its job was not closed yet (worker just restarted): it waits, nothing is settled over it", async () => {
    const t = make([call({ job_active: true })], PAID, { image: IMAGE, recover: null })
    expect([await t.engine.reconcileOnce(), t.asked.length, t.settled]).toEqual([0, 0, []])
  })
  test("a call that may still be running is never asked about", async () => {
    // Before the call the worker stores "unknown" without a reason: it may be in flight.
    const running = make([call({ error_code: null, started_at: ago(2), finished_at: ago(2) })], FOUND)
    expect([await running.engine.reconcileOnce(), running.asked.length]).toEqual([0, 0])
    const justEnded = make([call({ started_at: ago(1.2), finished_at: ago(0.5) })], FOUND)
    expect([await justEnded.engine.reconcileOnce(), justEnded.asked.length]).toEqual([0, 0])
  })
  test("two unidentified calls in the same minutes: no guess, unless the provider id is known", async () => {
    const t = make([call({ rivals: 1 })], FOUND)
    expect([await t.engine.reconcileOnce(), t.asked.length]).toEqual([0, 0])
    const known = make([call({ rivals: 1, provider_request_id: "f9f4f21a8957" })], FOUND)
    expect([await known.engine.reconcileOnce(), known.asked[0]!.requestId]).toEqual([1, "f9f4f21a8957"])
  })
  test("simulated and test calls, other providers and other models never reach the real history", async () => {
    const t = make([call({ environment: "test" }), call({ provider: "gemini" }), call({ model: "try-on-diffusion" })], FOUND)
    expect([await t.engine.reconcileOnce(), t.asked.length]).toEqual([0, 0])
    const off = make([call()], FOUND, { history: false })
    expect(await off.engine.reconcileOnce()).toBe(0)
  })
  test("an unresolved call is asked about less and less often", async () => {
    const t = make([call()], { kind: "pending" })
    for (let i = 0; i < 60; i++) { await t.engine.reconcileOnce(); t.later(1) }
    expect(t.asked.length).toBeGreaterThanOrEqual(3)
    expect(t.asked.length).toBeLessThanOrEqual(8)
  })
})
