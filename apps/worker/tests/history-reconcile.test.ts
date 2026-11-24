import { describe, expect, test } from "bun:test"
import type { HistoryAnswer, SegmindHistory } from "@stylai/ai"
import type { PrivateDatabase, PrivateObjectStore } from "@stylai/supabase"
import { createEngine, defaultEngineConfig } from "../src/engine.js"

const NOW = Date.parse("2026-11-24T22:00:00Z")
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()
const call = (over: Record<string, unknown> = {}) => ({
  id: "10000000-0000-4000-8000-000000000001", provider: "segmind", model: "flux-3-klein-image-edit", provider_request_id: null, status: "unknown", environment: "development",
  started_at: ago(10), finished_at: ago(9.8), error_code: "segmind_http_502", taken: ["other"], rivals: 0, ...over,
})
const FOUND: HistoryAnswer = { kind: "found", requestId: "f9f4f21a8957", httpStatus: 502, costMicros: 0n, hasOutput: false, errorFamily: "upstream_5xx" }
function make(rows: unknown[], answer: HistoryAnswer, opts: { history?: boolean } = {}) {
  const settled: unknown[][] = [], asked: Parameters<SegmindHistory["find"]>[0][] = []
  let now = NOW
  const db = { call: async (op: string, ...args: unknown[]) => { if (op === "list_unreconciled_calls") return rows; if (op === "reconcile_provider_call") { settled.push(args); return true } return null } } as unknown as PrivateDatabase<"ai_worker">
  const history: SegmindHistory = { find: async (q) => { asked.push(q); return answer } }
  const engine = createEngine({ db, store: {} as PrivateObjectStore, segmind: null, now: () => now, ...(opts.history === false ? {} : { segmindHistory: history }),
    config: { ...defaultEngineConfig, provider: "segmind", environment: "development", pseudonymKey: "k".repeat(32) } })
  return { engine, settled, asked, later: (minutes: number) => { now += minutes * 60_000 } }
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
    const t = make([call()], { ...FOUND, httpStatus: 200, costMicros: 12870n, hasOutput: true })
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

describe("anything else waits", () => {
  test("a success not billed yet may still be billed: it waits, then the record is taken as it is", async () => {
    const free: HistoryAnswer = { ...FOUND, httpStatus: 200, costMicros: 0n, hasOutput: true } as HistoryAnswer
    expect(await make([call()], free).engine.reconcileOnce()).toBe(0)
    expect(await make([call({ started_at: ago(31), finished_at: ago(30.5) })], free).engine.reconcileOnce()).toBe(1)
  })
  for (const answer of [{ kind: "pending" }, { kind: "ambiguous" }, { kind: "unavailable", code: "http_403" }] as HistoryAnswer[])
    test(answer.kind, async () => { const t = make([call()], answer); expect([await t.engine.reconcileOnce(), t.settled]).toEqual([0, []]) })
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
