import { describe, expect, test } from "bun:test"
import type { SegmindClient } from "@stylai/ai"
import type { PrivateDatabase, PrivateObjectStore } from "@stylai/supabase"
import { createEngine, defaultEngineConfig, publiclyFetchable } from "../src/engine.js"
import { startSinglePhotoServer, type PhotoRelay } from "../src/photo-relay.js"

const JOB_ID = "10000000-0000-4000-8000-000000000099"
const USER_ID = "20000000-0000-4000-8000-000000000099"
const PROD_ID = "30000000-0000-4000-8000-000000000099"
const VAR_ID = "40000000-0000-4000-8000-000000000099"
const CALL_ID = "50000000-0000-4000-8000-000000000099"
const ASSET_ID = "60000000-0000-4000-8000-000000000099"
const VERSION_ID = "70000000-0000-4000-8000-000000000099"

// Minimal valid 1x1 PNG bytes (synthetic, never a personal photo).
const TINY_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  ),
)

function makeFixtures(opts: {
  pollResult?: Awaited<ReturnType<SegmindClient["poll"]>>
  submitResult?: Awaited<ReturnType<SegmindClient["submit"]>>
} = {}) {
  const dbCalls: Array<{ op: string; args: unknown[] }> = []
  const telemetryPayloads: string[] = []
  const submittedModelUrls: string[] = []
  let submitCalls = 0

  const db = {
    call: async (op: string, ...args: unknown[]) => {
      dbCalls.push({ op, args })
      if (op === "claim_ai_job") return "1"
      if (op === "load_ai_job") {
        return {
          id: JOB_ID,
          user_id: USER_ID,
          category_id: "tops",
          search_query: "camisa",
          parent_version_id: null,
          photo: { bucket: "body-photos", object_key: `${USER_ID}/front.png`, mime: "image/png", usable: true },
          variant: {
            product_id: PROD_ID,
            variant_id: VAR_ID,
            name: "Camisa social off-white manga longa",
            category_id: "tops",
            source: "curated",
            partner: "Catálogo piloto — peças reais",
            external_product_id: "pilot-camisa-offwhite-met-2011-46",
            external_variant_id: "pilot-camisa-offwhite-met-2011-46-default",
            variant_label: "Peça fotografada",
            product_url: null,
            price_minor: null,
            currency: "BRL",
            availability: "unknown",
            variant_available: true,
            published: true,
            rights_cleared: true,
            source_updated_at: null,
            image_url: "https://upload.wikimedia.org/wikipedia/commons/2/2b/Dress_shirt_MET_2011.46_F.jpeg",
            fixture: false,
          },
        }
      }
      if (op === "reserve_provider_call") return CALL_ID
      if (op === "reserve_pilot_dispatch") return { ok: true, attempt_no: 1 }
      if (op === "register_generated_asset") return ASSET_ID
      if (op === "complete_look_job") return VERSION_ID
      if (op === "enqueue_telemetry_event") {
        telemetryPayloads.push(JSON.stringify(args[2]))
        return true
      }
      if (
        op === "record_ai_selection" ||
        op === "begin_provider_call" ||
        op === "settle_provider_call" ||
        op === "fail_look_job" ||
        op === "renew_ai_job_lease"
      ) {
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

  const segmind: SegmindClient = {
    model: "try-on-diffusion",
    submit: async (req) => {
      submitCalls++
      submittedModelUrls.push(req.modelImageUrl)
      return opts.submitResult ?? { kind: "accepted", requestId: "req-relay-test-001" }
    },
    poll: async () =>
      opts.pollResult ?? {
        kind: "completed",
        result: {
          image: { kind: "base64", data: Buffer.from(TINY_PNG).toString("base64") },
          metrics: { inferenceTime: 4.5, queueTime: 1.0, cost: 0.032 },
        },
      },
    download: async () => TINY_PNG,
    credits: async () => ({ ok: true, credits: 10, freeCredits: 0 }),
  }

  return { db, store, segmind, dbCalls, telemetryPayloads, submittedModelUrls, getSubmitCalls: () => submitCalls }
}

describe("restricted photo relay & worker integration (zero paid calls)", () => {
  test("publiclyFetchable() remains strict and rejects localhost/loopback/private URLs", () => {
    expect(publiclyFetchable("http://127.0.0.1:54321/storage/v1/object/sign/body-photos/a.jpg")).toBe(false)
    expect(publiclyFetchable("http://localhost:54321/storage/v1/object/sign/body-photos/a.jpg")).toBe(false)
    expect(publiclyFetchable("https://localhost/pilot-photo/abc")).toBe(false)
    expect(publiclyFetchable("https://192.168.1.10/pilot-photo/abc")).toBe(false)
    expect(publiclyFetchable("https://example-abc.trycloudflare.com/pilot-photo/tok?e=1&s=sig")).toBe(true)
  })

  test("without photoRelay, local Supabase photo fails before any paid call", async () => {
    const f = makeFixtures()
    const engine = createEngine({
      db: f.db,
      store: f.store,
      segmind: f.segmind,
      photoRelay: null,
      config: {
        ...defaultEngineConfig,
        environment: "development",
        pseudonymKey: "k".repeat(32),
        simulatedProvider: false,
        pilotId: "stylai-first-real-tryon-pilot",
      },
      sleep: async () => {},
    })
    const out = await engine.processJob(JOB_ID)
    expect(out).toEqual({ status: "failed", code: "photo_not_reachable_by_provider" })
    expect(f.getSubmitCalls()).toBe(0)
  })

  test("single-photo HTTP server serves only the signed path, blocks others (404/405), and shuts down cleanly", async () => {
    const srv = await startSinglePhotoServer({
      jobId: JOB_ID,
      bytes: TINY_PNG,
      mime: "image/png",
      maxLifetimeMs: 30_000,
    })
    const base = `http://127.0.0.1:${srv.port}`
    try {
      const okRes = await fetch(`${base}${srv.signedPath}`)
      expect(okRes.status).toBe(200)
      expect(okRes.headers.get("content-type")).toBe("image/png")
      expect(okRes.headers.get("cache-control")).toBe("no-store")
      expect(new Uint8Array(await okRes.arrayBuffer())).toEqual(TINY_PNG)

      expect((await fetch(`${base}/`)).status).toBe(404)
      expect((await fetch(`${base}/etc/passwd`)).status).toBe(404)
      expect((await fetch(`${base}${srv.signedPath}tampered`)).status).toBe(404)
      expect((await fetch(`${base}${srv.signedPath}`, { method: "POST" })).status).toBe(405)
    } finally {
      await srv.close()
    }
    await expect(fetch(`${base}${srv.signedPath}`)).rejects.toThrow()
  })

  test("worker couples photoRelay, closes lease on completion, and never leaks signed URLs into telemetry", async () => {
    const f = makeFixtures()
    let exposedCount = 0
    let closedCount = 0
    const relayToken = "SUPER_SECRET_RELAY_TOKEN_123"
    const relaySig = "SUPER_SECRET_RELAY_SIG_456"
    const photoRelay: PhotoRelay = {
      expose: async () => {
        exposedCount++
        return {
          publicUrl: `https://relay-test.trycloudflare.com/pilot-photo/${relayToken}?e=9999999999&s=${relaySig}`,
          expiresAtMs: Date.now() + 60_000,
          close: async () => {
            closedCount++
          },
        }
      },
    }

    const engine = createEngine({
      db: f.db,
      store: f.store,
      segmind: f.segmind,
      photoRelay,
      config: {
        ...defaultEngineConfig,
        environment: "development",
        pseudonymKey: "k".repeat(32),
        simulatedProvider: false,
        pilotId: "stylai-first-real-tryon-pilot",
      },
      sleep: async () => {},
    })

    const out = await engine.processJob(JOB_ID)
    expect(out).toEqual({ status: "succeeded", versionId: VERSION_ID })
    expect(exposedCount).toBe(1)
    expect(closedCount).toBe(1)
    expect(f.getSubmitCalls()).toBe(1)
    expect(f.submittedModelUrls[0]).toContain("https://relay-test.trycloudflare.com/pilot-photo/")
    for (const payload of f.telemetryPayloads) {
      expect(payload).not.toContain(relayToken)
      expect(payload).not.toContain(relaySig)
      expect(payload).not.toContain("LOCAL_SECRET")
      expect(payload).not.toContain("trycloudflare.com")
    }
  })

  test("timeout after submit does 0 automatic retries, preserves provider_request_id, and closes relay lease", async () => {
    const f = makeFixtures({
      submitResult: { kind: "accepted", requestId: "req-timeout-preserve-777" },
      pollResult: { kind: "pending", status: "PROCESSING" },
    })
    let closedCount = 0
    const photoRelay: PhotoRelay = {
      expose: async () => ({
        publicUrl: "https://relay-timeout.trycloudflare.com/pilot-photo/tok?e=9999999999&s=TIMEOUT_SECRET_SIG",
        expiresAtMs: Date.now() + 60_000,
        close: async () => {
          closedCount++
        },
      }),
    }

    let fakeNow = 1_000_000
    const engine = createEngine({
      db: f.db,
      store: f.store,
      segmind: f.segmind,
      photoRelay,
      config: {
        ...defaultEngineConfig,
        environment: "development",
        pseudonymKey: "k".repeat(32),
        simulatedProvider: false,
        pilotId: "stylai-first-real-tryon-pilot",
        pollIntervalMs: 100,
        pollTimeoutMs: 250,
        submitRetries: 2,
      },
      now: () => fakeNow,
      sleep: async (ms) => {
        fakeNow += ms
      },
    })

    const out = await engine.processJob(JOB_ID)
    expect(out).toEqual({ status: "failed", code: "provider_timeout" })
    expect(f.getSubmitCalls()).toBe(1)
    expect(closedCount).toBe(1)

    const settleCalls = f.dbCalls.filter((c) => c.op === "settle_provider_call")
    expect(settleCalls.length).toBeGreaterThanOrEqual(1)
    expect(settleCalls[0]?.args[1]).toBe("unknown")
    expect(settleCalls[0]?.args[2]).toBe("req-timeout-preserve-777")

    for (const payload of f.telemetryPayloads) {
      expect(payload).not.toContain("TIMEOUT_SECRET_SIG")
      expect(payload).not.toContain("relay-timeout.trycloudflare.com")
    }
  })
})
