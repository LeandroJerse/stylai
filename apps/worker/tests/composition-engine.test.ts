import { describe, expect, test } from "bun:test"
import { FAL_FASHN_MODEL, type FalClient } from "@stylai/ai"
import { PrivateDatabaseError, type PrivateDatabase, type PrivateObjectStore } from "@stylai/supabase"
import { createEngine, defaultEngineConfig } from "../src/engine.js"

const USER = "20000000-0000-4000-8000-000000000088"
const JOB = "10000000-0000-4000-8000-000000000088"
const TINY_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"))
const piece = (n: number, slot: "lower" | "upper", category: string) => ({
  product_id: `30000000-0000-4000-8000-00000000008${n}`, variant_id: `40000000-0000-4000-8000-00000000008${n}`, name: `Peça ${n}`,
  category_id: category, source: "curated", partner: "Catálogo piloto", external_product_id: `p${n}`, external_variant_id: `v${n}`,
  variant_label: "M", product_url: null, price_minor: null, currency: "BRL", availability: "unknown", variant_available: true,
  published: true, rights_cleared: true, source_updated_at: null, image_url: `https://upload.wikimedia.org/garment-${n}.jpg`, fixture: false,
  slot, position: n,
})

function harness(opts: { revokeAtDispatch?: number; imageReferences?: boolean; failLayer?: number; revokeSnapshot?: number; changedSnapshot?: number; beginFalse?: boolean; bytesOutput?: boolean; budget?: { ok: boolean; limiting: string[] } | "unavailable" } = {}) {
  const budgetChecks: unknown[][] = []
  const stored: string[] = []
  const removed: string[] = []
  const ops: string[] = []
  const settled: { key: string; status: string }[] = []
  const keys = new Map<string, string>()
  const snapshots: number[] = []
  const selections: unknown[] = []
  const db = { call: async (op: string, ...args: unknown[]) => {
    ops.push(op)
    switch (op) {
      case "claim_ai_job": return "1"
      case "load_ai_job": return {
        id: JOB, user_id: USER, category_id: "pants", search_query: "", parent_version_id: null, composition_id: "50000000-0000-4000-8000-000000000088",
        photo: { bucket: "body-photos", object_key: `${USER}/front.png`, mime: "image/png", usable: true },
        variant: piece(1, "lower", "pants"), items: [piece(1, "lower", "pants"), piece(2, "upper", "tops")].map((p) => opts.imageReferences
          ? { ...p, source: "aliexpress", canonical_id: `aliexpress:${p.external_product_id}`, affiliate_url: "https://s.click.aliexpress.com/e/test", reference_kind: "image_reference", external_variant_id: null, variant_available: null, variant_label: "Referência visual; tamanho não informado" } : p),
      }
      case "record_ai_selection": selections.push(args[4]); return true
      case "record_job_item_snapshot":
        if (opts.revokeSnapshot === args[2]) throw new PrivateDatabaseError("rejected", "SA003")
        if (opts.changedSnapshot === args[2]) throw new PrivateDatabaseError("rejected", "SA004")
        snapshots.push(Number(args[2])); return true
      case "check_layer_budget":
        budgetChecks.push(args)
        if (opts.budget === "unavailable") throw new PrivateDatabaseError("unknown")
        return { ok: true, limiting: [], max_layers: 3, needed_usd_micros: 150000, effective_ceiling_usd_micros: 2000000, ...(opts.budget ?? {}) }
      case "reserve_provider_call": { const id = `call-${String(args[6])}`; keys.set(id, String(args[6])); return id }
      case "reserve_pilot_dispatch": return { ok: true, attempt_no: 1 }
      case "begin_provider_call": if (opts.revokeAtDispatch && String(args[0]).endsWith(`_${opts.revokeAtDispatch}`)) throw new PrivateDatabaseError("rejected", "SA003"); return !opts.beginFalse
      case "settle_provider_call": settled.push({ key: keys.get(String(args[0]))!, status: String(args[1]) }); return true
      case "register_generated_asset": return "60000000-0000-4000-8000-000000000088"
      case "complete_look_job": return "70000000-0000-4000-8000-000000000088"
      default: return true
    }
  } } as unknown as PrivateDatabase<"ai_worker">
  const store = {
    signedUrl: async (_bucket: string, key: string) => `https://storage.example.com/signed/${key}`,
    get: async () => TINY_PNG, put: async (_bucket: string, key: string) => { stored.push(key) }, remove: async (_bucket: string, key: string) => { removed.push(key) },
  } as unknown as PrivateObjectStore
  const submits: { modelImageUrl: string; clothImageUrl: string; category: string; requestKey: string }[] = []
  const fal = {
    model: FAL_FASHN_MODEL,
    submit: async (input: { requestKey: string; modelImageUrl: string; clothImageUrl: string; category: string }) => {
      submits.push(input); return { kind: "accepted", requestId: `req-${submits.length}` }
    },
    poll: async (requestId: string) => {
      const layer = Number(requestId.split("-")[1])
      if (opts.failLayer === layer) return { kind: "failed", metrics: {} }
      if (opts.bytesOutput) return { kind: "completed", result: { image: { kind: "base64", data: Buffer.from(TINY_PNG).toString("base64") }, metrics: {} } }
      return { kind: "completed", result: { image: { kind: "url", url: `https://v3.fal.media/files/out-${layer}.png` }, metrics: {} } }
    },
    download: async () => TINY_PNG,
  } as unknown as FalClient
  const engine = createEngine({
    db, store, segmind: null, fal,
    config: { ...defaultEngineConfig, provider: "fal", environment: "development", pseudonymKey: "k".repeat(32), simulatedProvider: false, pilotId: "stylai-first-real-tryon-pilot" },
    sleep: async () => {},
  })
  return { engine, ops, settled, submits, snapshots, stored, removed, budgetChecks, selections }
}

describe("multi-piece composition engine", () => {
  test("revocation at second dispatch preserves first spend and releases the undispatched reservation", async () => {
    const h = harness({ revokeAtDispatch: 2 })
    expect(await h.engine.processJob(JOB)).toEqual({ status: "failed", code: "try_on_rights_revoked" })
    expect(h.submits).toHaveLength(1)
    expect(h.settled.at(-1)).toMatchObject({ status: "released" })
    expect(h.ops).not.toContain("complete_look_job")
  })
  test("authorized image references render without inventing supplier SKU or stock", async () => {
    const h = harness({ imageReferences: true })
    expect((await h.engine.processJob(JOB)).status).toBe("succeeded")
    expect(h.submits).toHaveLength(2)
    expect(h.selections[0]).toMatchObject({ items: [
      { source: "aliexpress", reference_kind: "image_reference", external_variant_id: null, affiliate_url: "https://s.click.aliexpress.com/e/test" },
      { source: "aliexpress", reference_kind: "image_reference", external_variant_id: null, affiliate_url: "https://s.click.aliexpress.com/e/test" },
    ] })
  })
  test("renders base then upper layer, chaining the provider output, one paid call per layer", async () => {
    const h = harness()
    expect(await h.engine.processJob(JOB)).toEqual({ status: "succeeded", versionId: "70000000-0000-4000-8000-000000000088" })
    expect(h.snapshots).toEqual([1, 2])
    expect(h.submits.map((s) => [s.requestKey.endsWith("_1") ? 1 : 2, s.category, s.modelImageUrl])).toEqual([
      [1, "Lower body", `https://storage.example.com/signed/${USER}/front.png`],
      [2, "Upper body", "https://v3.fal.media/files/out-1.png"],
    ])
    expect(h.settled.filter((s) => s.status === "succeeded").map((s) => s.key.slice(-2))).toEqual(["_1", "_2"])
    // Every piece is frozen before the first paid reservation.
    expect(h.ops.lastIndexOf("record_job_item_snapshot")).toBeLessThan(h.ops.indexOf("reserve_provider_call"))
  })

  test("a byte output between layers is kept privately, passed by short signed URL, then removed", async () => {
    const h = harness({ bytesOutput: true })
    expect((await h.engine.processJob(JOB)).status).toBe("succeeded")
    const layerKey = `${USER}/${JOB}/layer-1.png`
    expect(h.stored).toContain(layerKey)
    expect(h.submits[1]!.modelImageUrl).toBe(`https://storage.example.com/signed/${layerKey}`)
    expect(h.removed).toContain(layerKey)
  })

  test("a failure on layer 2 fails the job without a version; layer 1 stays settled (no double charge, no retry)", async () => {
    const h = harness({ failLayer: 2 })
    expect(await h.engine.processJob(JOB)).toEqual({ status: "failed", code: "provider_failed_layer_2" })
    expect(h.ops).not.toContain("complete_look_job")
    expect(h.submits).toHaveLength(2)
    expect(h.settled.map((s) => `${s.key.slice(-2)}:${s.status}`)).toEqual(["_1:unknown", "_1:succeeded", "_2:unknown", "_2:failed"])
  })

  test("rights revoked after selection fail closed before any provider reservation or upload", async () => {
    const h = harness({ revokeSnapshot: 2 })
    expect(await h.engine.processJob(JOB)).toEqual({ status: "failed", code: "try_on_rights_revoked" })
    expect(h.ops).not.toContain("reserve_provider_call")
    expect(h.submits).toHaveLength(0)
  })

  test("a recovered job whose frozen piece changed fails explicitly (no abandon loop, no spend)", async () => {
    const h = harness({ changedSnapshot: 1 })
    expect(await h.engine.processJob(JOB)).toEqual({ status: "failed", code: "selection_changed" })
    expect(h.ops).toContain("fail_look_job")
    expect(h.submits).toHaveLength(0)
  })

  test("a chain that does not fit the budget is refused BEFORE layer 1 is paid (P04)", async () => {
    const h = harness({ budget: { ok: false, limiting: ["job"] } })
    expect(await h.engine.processJob(JOB)).toEqual({ status: "failed", code: "budget_insufficient_for_layers" })
    expect(h.ops).not.toContain("reserve_provider_call")
    expect(h.submits).toHaveLength(0)
    expect(h.budgetChecks[0]!.slice(2, 6)).toEqual(["fal", 2, "75000", "stylai-first-real-tryon-pilot"])
  })

  test("an unavailable budget check fails closed without spending", async () => {
    const h = harness({ budget: "unavailable" })
    expect((await h.engine.processJob(JOB)).status).not.toBe("succeeded")
    expect(h.submits).toHaveLength(0)
  })

  test("a recovered job whose first layer was already dispatched is never re-sent", async () => {
    const h = harness({ beginFalse: true })
    expect(await h.engine.processJob(JOB)).toEqual({ status: "failed", code: "generation_needs_reconciliation" })
    expect(h.submits).toHaveLength(0)
  })
})
