import { describe, expect, test } from "bun:test"
import {
  FAL_FASHN_MODEL, FAL_IMAGE_APPS_MODEL,
  type FalClient, type PollOutcome, type SegmindClient, type SubmitOutcome,
} from "@stylai/ai"
import type { PrivateDatabase, PrivateObjectStore } from "@stylai/supabase"
import { createEngine, defaultEngineConfig } from "../src/engine.js"
import type { PhotoRelay } from "../src/photo-relay.js"
import { readWorkerConfig } from "../src/worker-config.js"

const USER_ID = "20000000-0000-4000-8000-000000000077"
const PROD_ID = "30000000-0000-4000-8000-000000000077"
const VAR_ID = "40000000-0000-4000-8000-000000000077"
const ASSET_ID = "60000000-0000-4000-8000-000000000077"
const VERSION_ID = "70000000-0000-4000-8000-000000000077"

// Minimal valid 1x1 PNG (synthetic; never a personal photo).
const TINY_PNG = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"),
)

interface CallRecord {
  id: string
  jobId: string
  provider: string
  model: string
  reserveMicros: bigint
  status: "reserved" | "dispatched" | "succeeded" | "failed" | "unknown" | "released"
  requestId: string | null
  settledMicros: bigint | null
  costSource: string
}

/** Stateful in-memory pilot + ledger harness to test shared multi-provider budget, unknown lock & reconciliation. */
function makeSharedPilotHarness(opts: { limitMicros?: bigint; maxAttempts?: number; beginReturnsFalse?: boolean } = {}) {
  const limitMicros = opts.limitMicros ?? 2_000_000n
  const maxAttempts = opts.maxAttempts ?? 5
  const calls = new Map<string, CallRecord>()
  const pilotDispatches: string[] = []
  const telemetryPayloads: string[] = []
  let callSeq = 0

  const db = {
    call: async (op: string, ...args: unknown[]) => {
      if (op === "claim_ai_job") return "1"
      if (op === "load_ai_job") {
        const jobId = String(args[0])
        return {
          id: jobId, user_id: USER_ID, category_id: "tops", search_query: "camisa", parent_version_id: null,
          photo: { bucket: "body-photos", object_key: `${USER_ID}/front.png`, mime: "image/png", usable: true },
          variant: {
            product_id: PROD_ID, variant_id: VAR_ID, name: "Camisa social off-white manga longa", category_id: "tops",
            source: "curated", partner: "Catálogo piloto — peças reais", external_product_id: "pilot-camisa-offwhite-met-2011-46",
            external_variant_id: "pilot-camisa-offwhite-met-2011-46-default", variant_label: "Peça fotografada",
            product_url: null, price_minor: null, currency: "BRL", availability: "unknown", variant_available: true,
            published: true, rights_cleared: true, source_updated_at: null,
            image_url: "https://upload.wikimedia.org/wikipedia/commons/2/2b/Dress_shirt_MET_2011.46_F.jpeg", fixture: false,
          },
        }
      }
      if (op === "record_ai_selection" || op === "fail_look_job" || op === "renew_ai_job_lease") return true
      if (op === "register_generated_asset") return ASSET_ID
      if (op === "complete_look_job") return VERSION_ID
      if (op === "enqueue_telemetry_event") { telemetryPayloads.push(JSON.stringify(args[2])); return true }

      if (op === "reserve_provider_call") {
        const jobId = String(args[0])
        const provider = String(args[2])
        const model = String(args[3])
        const reserveMicros = BigInt(String(args[7]))
        callSeq++
        const id = `50000000-0000-4000-8000-${String(callSeq).padStart(12, "0")}`
        calls.set(id, { id, jobId, provider, model, reserveMicros, status: "reserved", requestId: null, settledMicros: null, costSource: "unknown" })
        return id
      }
      if (op === "reserve_pilot_dispatch") {
        const callId = String(args[1])
        const current = calls.get(callId)!
        const active = pilotDispatches.map((id) => calls.get(id)!).filter((c) => c.status !== "released")
        const uncertain = active.filter((c) => c.status === "unknown").length
        const inFlight = active.filter((c) => c.status === "reserved" || c.status === "dispatched").length
        const spent = active.filter((c) => c.status === "succeeded" || c.status === "failed").reduce((s, c) => s + (c.settledMicros ?? 0n), 0n)
        const reserved = active.filter((c) => c.status === "reserved" || c.status === "dispatched" || c.status === "unknown").reduce((s, c) => s + c.reserveMicros, 0n)
        if (uncertain > 0) { current.status = "released"; current.settledMicros = 0n; return { ok: false, reason: "uncertain_outcome" } }
        if (inFlight > 0) { current.status = "released"; current.settledMicros = 0n; return { ok: false, reason: "in_flight" } }
        if (active.length >= maxAttempts) { current.status = "released"; current.settledMicros = 0n; return { ok: false, reason: "max_attempts_reached" } }
        if (spent + reserved + current.reserveMicros > limitMicros) { current.status = "released"; current.settledMicros = 0n; return { ok: false, reason: "budget_exhausted" } }
        pilotDispatches.push(callId)
        return { ok: true, attempt_no: pilotDispatches.length }
      }
      if (op === "begin_provider_call") {
        if (opts.beginReturnsFalse) return false
        const c = calls.get(String(args[0]))!
        if (c.status !== "reserved") return false
        c.status = "dispatched"
        return true
      }
      if (op === "settle_provider_call") {
        const c = calls.get(String(args[0]))!
        const status = String(args[1]) as CallRecord["status"]
        const reqId = args[2] == null ? null : String(args[2])
        const computed = args[6] == null ? null : BigInt(String(args[6]))
        c.status = status
        if (reqId) c.requestId = reqId
        c.costSource = String(args[8])
        if (status === "succeeded" || status === "failed" || status === "released") c.settledMicros = computed ?? 0n
        return true
      }
      if (op === "list_unreconciled_calls") {
        return [...calls.values()]
          .filter((c) => c.status === "dispatched" || c.status === "unknown")
          .map((c) => ({ id: c.id, provider: c.provider, model: c.model, provider_request_id: c.requestId }))
      }
      if (op === "reconcile_provider_call") {
        const c = calls.get(String(args[0]))!
        c.status = String(args[1]) as "succeeded" | "failed"
        c.settledMicros = BigInt(String(args[2]))
        c.costSource = String(args[3])
        return true
      }
      throw new Error(`Unexpected db op: ${op}`)
    },
  } as unknown as PrivateDatabase<"ai_worker">

  const store = {
    kind: "supabase",
    signedUrl: async () => "http://127.0.0.1:54321/storage/v1/object/sign/body-photos/local.png?token=LOCAL_SECRET",
    get: async () => TINY_PNG,
    put: async () => undefined,
  } as unknown as PrivateObjectStore

  let relayClosed = 0
  const photoRelay: PhotoRelay = {
    expose: async () => ({
      publicUrl: "https://relay-fal.trycloudflare.com/pilot-photo/tok?e=9999999999&s=FAL_RELAY_SECRET",
      expiresAtMs: Date.now() + 60_000,
      close: async () => { relayClosed++ },
    }),
  }

  return { db, store, photoRelay, calls, pilotDispatches, telemetryPayloads, getRelayClosed: () => relayClosed }
}

describe("fal server selection, engine lifecycle, shared budget & reconciliation (zero paid calls)", () => {
  test("server-side provider selection preserves Segmind default and validates fal config", () => {
    const def = readWorkerConfig({})
    expect(def.provider).toBe("segmind")
    expect(def.engine.provider).toBe("segmind")

    const fashn = readWorkerConfig({
      STYLAI_TRYON_PROVIDER: "fal",
      STYLAI_PAID_CALLS_ENABLED: "true",
      FAL_API_KEY: "fal_k",
      STYLAI_PILOT_ID: "stylai-first-real-tryon-pilot",
      SEGMIND_SUBMIT_RETRIES: "2",
    })
    expect(fashn.provider).toBe("fal")
    expect(fashn.fal.model).toBe(FAL_FASHN_MODEL)
    expect(fashn.engine.falReserveMicros).toBe(75_000n)
    expect(fashn.engine.submitRetries).toBe(0)

    const imgApps = readWorkerConfig({
      STYLAI_TRYON_PROVIDER: "fal",
      FAL_MODEL: FAL_IMAGE_APPS_MODEL,
      STYLAI_PAID_CALLS_ENABLED: "true",
      FAL_API_KEY: "fal_k",
      STYLAI_PILOT_ID: "stylai-first-real-tryon-pilot",
    })
    expect(imgApps.fal.model).toBe(FAL_IMAGE_APPS_MODEL)
    expect(imgApps.engine.falReserveMicros).toBe(40_000n)

    expect(() => readWorkerConfig({ STYLAI_TRYON_PROVIDER: "fal", STYLAI_PAID_CALLS_ENABLED: "true", FAL_API_KEY: "fal_k" })).toThrow(/STYLAI_PILOT_ID/)
    expect(() => readWorkerConfig({ STYLAI_TRYON_PROVIDER: "fal", FAL_MODEL: "fal-ai/other" })).toThrow(/FAL_MODEL/)
    expect(() => readWorkerConfig({ STYLAI_TRYON_PROVIDER: "fal", FAL_BASE_URL: "https://evil.example" })).toThrow(/FAL_BASE_URL/)
  })

  test("fal FASHN v1.6 and ImageApps VTON succeed via relay with exact per-image accounting and zero URL leaks", async () => {
    const h = makeSharedPilotHarness()
    let fashnSubmits = 0
    let fashnPolls = 0
    const fashnClient: FalClient = {
      provider: "fal",
      model: FAL_FASHN_MODEL,
      submit: async () => { fashnSubmits++; return { kind: "accepted", requestId: "fal-fashn-1" } },
      poll: async () => {
        fashnPolls++
        if (fashnPolls === 1) return { kind: "pending", status: "QUEUED" }
        if (fashnPolls === 2) return { kind: "pending", status: "PROCESSING" }
        return { kind: "completed", result: { image: { kind: "url", url: "https://v3b.fal.media/files/fashn.png" }, metrics: {} } }
      },
      download: async () => TINY_PNG,
    }
    const imgAppsClient: FalClient = {
      provider: "fal",
      model: FAL_IMAGE_APPS_MODEL,
      submit: async () => ({ kind: "accepted", requestId: "fal-imgapps-1" }),
      poll: async () => ({ kind: "completed", result: { image: { kind: "url", url: "https://v3.fal.media/files/imgapps.png" }, metrics: {} } }),
      download: async () => TINY_PNG,
    }

    const fashnEngine = createEngine({
      db: h.db, store: h.store, segmind: null, fal: fashnClient, photoRelay: h.photoRelay,
      config: { ...defaultEngineConfig, provider: "fal", environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
      sleep: async () => {},
    })
    const out1 = await fashnEngine.processJob("10000000-0000-4000-8000-000000000001")
    expect(out1).toEqual({ status: "succeeded", versionId: VERSION_ID })
    expect(fashnSubmits).toBe(1)
    expect(fashnPolls).toBe(3)

    const imgAppsEngine = createEngine({
      db: h.db, store: h.store, segmind: null, fal: imgAppsClient, photoRelay: h.photoRelay,
      config: { ...defaultEngineConfig, provider: "fal", environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
      sleep: async () => {},
    })
    const out2 = await imgAppsEngine.processJob("10000000-0000-4000-8000-000000000002")
    expect(out2).toEqual({ status: "succeeded", versionId: VERSION_ID })
    expect(h.getRelayClosed()).toBe(2)

    const records = [...h.calls.values()]
    expect(records[0]?.provider).toBe("fal")
    expect(records[0]?.model).toBe(FAL_FASHN_MODEL)
    expect(records[0]?.settledMicros).toBe(75_000n)
    expect(records[1]?.model).toBe(FAL_IMAGE_APPS_MODEL)
    expect(records[1]?.settledMicros).toBe(40_000n)
    for (const payload of h.telemetryPayloads) {
      expect(payload).not.toContain("FAL_RELAY_SECRET")
      expect(payload).not.toContain("LOCAL_SECRET")
      expect(payload).not.toContain("trycloudflare.com")
    }
  })

  test("duplication (already dispatched) and failure (rejected / provider_failed) never re-send", async () => {
    const dupHarness = makeSharedPilotHarness({ beginReturnsFalse: true })
    let dupSubmits = 0
    const dupFal: FalClient = {
      provider: "fal", model: FAL_FASHN_MODEL,
      submit: async () => { dupSubmits++; return { kind: "accepted", requestId: "never" } },
      poll: async () => ({ kind: "failed", metrics: {} }),
      download: async () => TINY_PNG,
    }
    const dupEngine = createEngine({
      db: dupHarness.db, store: dupHarness.store, segmind: null, fal: dupFal, photoRelay: dupHarness.photoRelay,
      config: { ...defaultEngineConfig, provider: "fal", environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
      sleep: async () => {},
    })
    expect(await dupEngine.processJob("10000000-0000-4000-8000-000000000010")).toEqual({ status: "failed", code: "generation_needs_reconciliation" })
    expect(dupSubmits).toBe(0)

    const failHarness = makeSharedPilotHarness()
    let failSubmits = 0
    const makeFal = (submit: () => Promise<SubmitOutcome>, poll: () => Promise<PollOutcome>): FalClient => ({
      provider: "fal", model: FAL_FASHN_MODEL,
      submit: async () => { failSubmits++; return submit() },
      poll,
      download: async () => TINY_PNG,
    })
    const rejectedEngine = createEngine({
      db: failHarness.db, store: failHarness.store, segmind: null,
      fal: makeFal(async () => ({ kind: "rejected", httpStatus: 402, code: "insufficient_credits" }), async () => ({ kind: "failed", metrics: {} })),
      photoRelay: failHarness.photoRelay,
      config: { ...defaultEngineConfig, provider: "fal", environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
      sleep: async () => {},
    })
    expect(await rejectedEngine.processJob("10000000-0000-4000-8000-000000000011")).toEqual({ status: "failed", code: "provider_rejected_insufficient_credits" })
    expect(failSubmits).toBe(1)

    const pollFailedEngine = createEngine({
      db: failHarness.db, store: failHarness.store, segmind: null,
      fal: makeFal(async () => ({ kind: "accepted", requestId: "req-fail-2" }), async () => ({ kind: "failed", metrics: {} })),
      photoRelay: failHarness.photoRelay,
      config: { ...defaultEngineConfig, provider: "fal", environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
      sleep: async () => {},
    })
    expect(await pollFailedEngine.processJob("10000000-0000-4000-8000-000000000012")).toEqual({ status: "failed", code: "provider_failed" })
    expect(failSubmits).toBe(2)
    expect([...failHarness.calls.values()].map((c) => [c.status, c.settledMicros])).toEqual([["failed", 0n], ["failed", 0n]])
  })

  test("timeout/uncertain outcome blocks ALL subsequent dispatches across providers until reconciled, with 0 auto-retries", async () => {
    const h = makeSharedPilotHarness()
    let falSubmits = 0
    let segmindSubmits = 0
    let fakeNow = 1_000_000

    const timeoutFal: FalClient = {
      provider: "fal", model: FAL_FASHN_MODEL,
      submit: async () => { falSubmits++; return { kind: "accepted", requestId: "req-fal-timeout-42" } },
      poll: async () => ({ kind: "pending", status: "PROCESSING" }),
      download: async () => TINY_PNG,
    }
    const segmind: SegmindClient = {
      model: "try-on-diffusion",
      submit: async () => { segmindSubmits++; return { kind: "accepted", requestId: "req-seg-after" } },
      poll: async () => ({ kind: "completed", result: { image: { kind: "base64", data: Buffer.from(TINY_PNG).toString("base64") }, metrics: { inferenceTime: 10 } } }),
      download: async () => TINY_PNG,
      credits: async () => ({ ok: true, credits: 10, freeCredits: 0 }),
    }

    // 1. fal FASHN job times out after submit: 0 retries, request_id preserved, status = unknown.
    const engineFal = createEngine({
      db: h.db, store: h.store, segmind: null, fal: timeoutFal, photoRelay: h.photoRelay,
      config: {
        ...defaultEngineConfig, provider: "fal", environment: "development", pseudonymKey: "k".repeat(32),
        simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot", pollIntervalMs: 100, pollTimeoutMs: 250, submitRetries: 2,
      },
      now: () => fakeNow,
      sleep: async (ms) => { fakeNow += ms },
    })
    expect(await engineFal.processJob("10000000-0000-4000-8000-000000000021")).toEqual({ status: "failed", code: "provider_timeout" })
    expect(falSubmits).toBe(1)
    const firstCall = [...h.calls.values()][0]!
    expect(firstCall.status).toBe("unknown")
    expect(firstCall.requestId).toBe("req-fal-timeout-42")

    // 2. While uncertain, a Segmind job AND another fal job are BOTH blocked by uncertain_outcome (0 submits!).
    const engineSeg = createEngine({
      db: h.db, store: h.store, segmind,
      falReconcilers: {
        [FAL_FASHN_MODEL]: {
          provider: "fal", model: FAL_FASHN_MODEL,
          submit: async () => { throw new Error("reconciler must never submit") },
          poll: async (id) => {
            expect(id).toBe("req-fal-timeout-42")
            return { kind: "completed", result: { image: { kind: "url", url: "https://v3b.fal.media/files/reconciled.png" }, metrics: {} } }
          },
          download: async () => TINY_PNG,
        },
      },
      photoRelay: h.photoRelay,
      config: { ...defaultEngineConfig, provider: "segmind", environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
      sleep: async () => {},
    })
    expect(await engineSeg.processJob("10000000-0000-4000-8000-000000000022")).toEqual({ status: "failed", code: "pilot_uncertain_outcome" })
    expect(await engineFal.processJob("10000000-0000-4000-8000-000000000023")).toEqual({ status: "failed", code: "pilot_uncertain_outcome" })
    expect(segmindSubmits).toBe(0)
    expect(falSubmits).toBe(1)

    // 3. Cold reconciliation via engineSeg resolves the unknown fal call (75,000 micros), unblocking Segmind!
    expect(await engineSeg.reconcileOnce()).toBe(1)
    expect(firstCall.status).toBe("succeeded")
    expect(firstCall.settledMicros).toBe(75_000n)

    // 4. Now Segmind job proceeds and shares the same pilot counter (attempt 2, 75k + 72k = 147k).
    expect(await engineSeg.processJob("10000000-0000-4000-8000-000000000024")).toEqual({ status: "succeeded", versionId: VERSION_ID })
    expect(segmindSubmits).toBe(1)
    const settledTotal = [...h.calls.values()].filter((c) => c.status === "succeeded").reduce((s, c) => s + (c.settledMicros ?? 0n), 0n)
    expect(settledTotal).toBe(75_000n + 72_000n)
  })

  test("concurrency: a 2nd concurrent job is blocked by pilot_in_flight (0 submits) while 1st call is in flight", async () => {
    const h = makeSharedPilotHarness()
    let releaseFirstSubmit!: () => void
    const firstSubmitGate = new Promise<void>((r) => { releaseFirstSubmit = r })
    let submits = 0
    const slowFal: FalClient = {
      provider: "fal", model: FAL_IMAGE_APPS_MODEL,
      submit: async () => {
        submits++
        await firstSubmitGate
        return { kind: "accepted", requestId: "req-conc-1" }
      },
      poll: async () => ({ kind: "completed", result: { image: { kind: "url", url: "https://v3.fal.media/files/c.png" }, metrics: {} } }),
      download: async () => TINY_PNG,
    }
    const engine = createEngine({
      db: h.db, store: h.store, segmind: null, fal: slowFal, photoRelay: h.photoRelay,
      config: { ...defaultEngineConfig, provider: "fal", environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
      sleep: async () => {},
    })
    const p1 = engine.processJob("10000000-0000-4000-8000-000000000031")
    await new Promise((r) => setTimeout(r, 15))
    const out2 = await engine.processJob("10000000-0000-4000-8000-000000000032")
    expect(out2).toEqual({ status: "failed", code: "pilot_in_flight" })
    expect(submits).toBe(1)
    releaseFirstSubmit()
    expect(await p1).toEqual({ status: "succeeded", versionId: VERSION_ID })
    expect(submits).toBe(1)
  })
})
