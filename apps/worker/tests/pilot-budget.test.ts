import { describe, expect, test } from "bun:test"
import type { SegmindClient } from "@stylai/ai"
import type { PrivateDatabase, PrivateObjectStore } from "@stylai/supabase"
import { createEngine, defaultEngineConfig } from "../src/engine.js"
import { readWorkerConfig } from "../src/worker-config.js"

const JOB_ID = "10000000-0000-4000-8000-000000000001"
const USER_ID = "20000000-0000-4000-8000-000000000001"
const PROD_ID = "30000000-0000-4000-8000-000000000001"
const VAR_ID = "40000000-0000-4000-8000-000000000001"
const CALL_ID = "50000000-0000-4000-8000-000000000001"

function makeFixtures(opts: { pilotGate?: { ok: boolean; reason?: string; attempt_no?: number }; submitResult?: Awaited<ReturnType<SegmindClient["submit"]>> } = {}) {
  const calls: string[] = []
  const telemetryPayloads: string[] = []
  let submitCalls = 0
  const db = {
    call: async (op: string, ...args: unknown[]) => {
      calls.push(op)
      if (op === "claim_ai_job") return "1"
      if (op === "load_ai_job") return {
        id: JOB_ID, user_id: USER_ID, category_id: "tops", search_query: "", parent_version_id: null,
        photo: { bucket: "body-photos", object_key: `${USER_ID}/front.jpg`, mime: "image/jpeg", usable: true },
        variant: {
          product_id: PROD_ID, variant_id: VAR_ID, name: "Camiseta piloto", category_id: "tops",
          source: "curated", partner: "Catálogo piloto", external_product_id: "p1", external_variant_id: "v1",
          variant_label: "Peça fotografada", product_url: null, price_minor: null, currency: "BRL",
          availability: "unknown", variant_available: true, published: true, rights_cleared: true,
          source_updated_at: null, image_url: "https://upload.wikimedia.org/example-cc0.jpg", fixture: false,
        },
      }
      if (op === "record_ai_selection" || op === "begin_provider_call" || op === "settle_provider_call" || op === "fail_look_job" || op === "renew_ai_job_lease") return true
      if (op === "reserve_provider_call") return CALL_ID
      if (op === "reserve_pilot_dispatch") return opts.pilotGate ?? { ok: true, attempt_no: 1 }
      if (op === "enqueue_telemetry_event") { telemetryPayloads.push(JSON.stringify(args[2])); return true }
      throw new Error(`Unexpected db op: ${op}`)
    },
  } as unknown as PrivateDatabase<"ai_worker">

  const store = {
    kind: "supabase",
    signedUrl: async () => "https://relay.example.org/signed/photo?s=SECRET_SIG",
  } as unknown as PrivateObjectStore

  const segmind: SegmindClient = {
    model: "try-on-diffusion",
    submit: async () => {
      submitCalls++
      return opts.submitResult ?? { kind: "retryable", httpStatus: 503, code: "provider_error" }
    },
    poll: async () => ({ kind: "failed", metrics: {} }),
    download: async () => new Uint8Array(),
    credits: async () => ({ ok: true, credits: 10, freeCredits: 0 }),
  }

  return { db, store, segmind, calls, telemetryPayloads, getSubmitCalls: () => submitCalls }
}

describe("pilot budget worker guard", () => {
  test("real paid mode requires STYLAI_PILOT_ID and forces submitRetries=0 even if env asks for retries", () => {
    expect(() => readWorkerConfig({ STYLAI_PAID_CALLS_ENABLED: "true", SEGMIND_API_KEY: "SG_test", SEGMIND_BASE_URL: "https://api.segmind.com" })).toThrow(/STYLAI_PILOT_ID/)
    const cfg = readWorkerConfig({
      STYLAI_PAID_CALLS_ENABLED: "true",
      SEGMIND_BASE_URL: "https://api.segmind.com",
      STYLAI_PILOT_ID: "stylai-first-real-tryon-pilot",
      SEGMIND_SUBMIT_RETRIES: "2",
    })
    expect(cfg.engine.pilotId).toBe("stylai-first-real-tryon-pilot")
    expect(cfg.engine.submitRetries).toBe(0)
  })

  test("engine refuses real dispatch when pilotId is missing (never calls submit)", async () => {
    const f = makeFixtures()
    const engine = createEngine({
      db: f.db, store: f.store, segmind: f.segmind,
      config: { ...defaultEngineConfig, environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: null },
      sleep: async () => {},
    })
    const out = await engine.processJob(JOB_ID)
    expect(out).toEqual({ status: "failed", code: "pilot_required" })
    expect(f.getSubmitCalls()).toBe(0)
  })

  test("pilot gate refusal blocks before begin_provider_call and never dispatches to Segmind", async () => {
    const f = makeFixtures({ pilotGate: { ok: false, reason: "max_attempts_reached" } })
    const engine = createEngine({
      db: f.db, store: f.store, segmind: f.segmind,
      config: { ...defaultEngineConfig, environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
      sleep: async () => {},
    })
    const out = await engine.processJob(JOB_ID)
    expect(out).toEqual({ status: "failed", code: "pilot_max_attempts_reached" })
    expect(f.calls).toContain("reserve_pilot_dispatch")
    expect(f.calls).not.toContain("begin_provider_call")
    expect(f.getSubmitCalls()).toBe(0)
  })

  test("retryable 5xx/429 submit in pilot mode is NEVER retried (1 attempt only) and never leaks signed URLs to telemetry", async () => {
    const f = makeFixtures({ pilotGate: { ok: true, attempt_no: 1 }, submitResult: { kind: "retryable", httpStatus: 429, code: "rate_limited" } })
    const engine = createEngine({
      db: f.db, store: f.store, segmind: f.segmind,
      config: { ...defaultEngineConfig, environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot", submitRetries: 2 },
      sleep: async () => {},
    })
    const out = await engine.processJob(JOB_ID)
    expect(out).toEqual({ status: "failed", code: "provider_outcome_unknown" })
    expect(f.getSubmitCalls()).toBe(1)
    for (const payload of f.telemetryPayloads) {
      expect(payload).not.toContain("SECRET_SIG")
      expect(payload).not.toContain("relay.example.org")
    }
  })
})
