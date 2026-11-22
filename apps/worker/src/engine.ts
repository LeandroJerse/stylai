/**
 * First-slice job engine: one explicitly chosen catalog variant on one body
 * photo. Order is fixed: verify selection -> reserve spend -> dispatch once ->
 * poll -> copy output privately -> settle -> publish version. No step re-sends a
 * provider request whose outcome is unknown.
 */
import { z } from "zod"
import {
  defaultSegmindPreset, findPrice, microsToUsdNumber, pseudonymizeUser, segmindCost, spanIdFor, traceIdForJob, validateOutputImage,
  type GpuSecondPrice, type SegmindCategory, type SegmindClient, type SegmindPreset, type SpanRecord, type AttributeValue,
} from "@stylai/ai"
import { PrivateDatabaseError, type Json, type PrivateDatabase, type PrivateObjectStore } from "@stylai/supabase"

/** Plain-data copy for jsonb parameters (drops undefined, rejects non-JSON values). */
function toJson(value: unknown): Json { return JSON.parse(JSON.stringify(value)) as Json }

export interface EngineConfig {
  environment: "development" | "test" | "staging" | "production"
  /** Langfuse environment label (e.g. "integration-test" for synthetic runs). Defaults to environment. */
  telemetryEnvironment?: string
  /** True when the provider is the local simulator: telemetry is labelled synthetic. */
  simulatedProvider?: boolean
  pseudonymKey: string
  /** Internal category id -> provider category. Unmapped categories are not renderable. */
  categoryMap: Record<string, SegmindCategory>
  preset: SegmindPreset
  /** Conservative per-attempt reservation for one try-on call (USD micros). */
  segmindReserveMicros: bigint
  pollIntervalMs: number
  pollTimeoutMs: number
  photoUrlTtlSeconds: number
  submitRetries: number
}

export const defaultEngineConfig: Omit<EngineConfig, "pseudonymKey" | "environment"> = {
  categoryMap: { tops: "Upper body", jackets: "Upper body", shirts: "Upper body", bottoms: "Lower body", pants: "Lower body", dresses: "Dress" },
  preset: defaultSegmindPreset,
  segmindReserveMicros: 500_000n,
  pollIntervalMs: 2_000,
  pollTimeoutMs: 240_000,
  photoUrlTtlSeconds: 600,
  submitRetries: 2,
}

export interface EngineDeps {
  db: PrivateDatabase<"ai_worker">
  store: PrivateObjectStore
  /** Null when paid calls are disabled or the key is absent: jobs fail without spending. */
  segmind: SegmindClient | null
  config: EngineConfig
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const variantSchema = z.object({
  product_id: z.string().uuid(), variant_id: z.string().uuid(), name: z.string(), category_id: z.string().nullable(),
  source: z.string(), partner: z.string(), external_product_id: z.string(), external_variant_id: z.string(),
  variant_label: z.string(), product_url: z.string().nullable(), price_minor: z.number().int().nullable(), currency: z.string(),
  availability: z.string(), variant_available: z.boolean().nullable(), published: z.boolean(), rights_cleared: z.boolean(),
  source_updated_at: z.string().nullable(), image_url: z.string().nullable(), fixture: z.boolean().optional(),
})
const jobSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), category_id: z.string(), search_query: z.string(),
  parent_version_id: z.string().uuid().nullable(),
  photo: z.object({ bucket: z.literal("body-photos"), object_key: z.string(), mime: z.string().nullable(), usable: z.boolean().optional() }),
  variant: variantSchema.nullable(),
})
export type LoadedJob = z.infer<typeof jobSchema>

export type JobOutcome =
  | { status: "skipped" }
  | { status: "succeeded"; versionId: string }
  | { status: "failed"; code: string }
  | { status: "abandoned"; code: string } // lease lost or cancelled: nothing published

class JobFailure extends Error { constructor(readonly code: string) { super(code) } }
class LeaseLost extends Error { constructor() { super("lease_lost") } }

export function createEngine(deps: EngineDeps) {
  const { db, store, config } = deps
  const now = deps.now ?? Date.now
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const segmindPrice = findPrice("segmind", deps.segmind?.model ?? "try-on-diffusion")

  async function telemetry(job: LoadedJob, key: string, span: Omit<SpanRecord, "traceId" | "spanId" | "parentSpanId">, root = false) {
    const traceId = traceIdForJob(job.id)
    const record: SpanRecord = {
      traceId, spanId: spanIdFor(root ? `job:${job.id}` : `${job.id}:${key}`),
      ...(root ? {} : { parentSpanId: spanIdFor(`job:${job.id}`) }),
      ...span,
      attributes: {
        "langfuse.environment": config.telemetryEnvironment ?? config.environment,
        ...(config.simulatedProvider ? { "langfuse.trace.metadata.synthetic": true, "langfuse.observation.metadata.provider_mode": "simulated" } : {}),
        ...span.attributes,
      },
    }
    try {
      await db.call("enqueue_telemetry_event", `${job.id}:${key}`, job.id, toJson({ span: record }))
    } catch { /* telemetry never fails a job */ }
  }

  async function renew(jobId: string, fence: string) {
    if (!(await db.call("renew_ai_job_lease", jobId, fence))) throw new LeaseLost()
  }

  async function processJob(jobId: string): Promise<JobOutcome> {
    const fence = await db.call("claim_ai_job", jobId)
    if (!fence) return { status: "skipped" }
    const startedAt = now()
    const raw = await db.call("load_ai_job", jobId, fence)
    const parsed = jobSchema.safeParse(raw)
    if (!parsed.success) {
      await db.call("fail_look_job", jobId, fence, "job_payload_invalid")
      return { status: "failed", code: "job_payload_invalid" }
    }
    const job = parsed.data
    const userRef = pseudonymizeUser(job.user_id, config.pseudonymKey)
    const rootAttrs = (status: string, code?: string): Record<string, AttributeValue> => ({
      "langfuse.trace.name": job.parent_version_id ? "look.swap" : "look.create",
      "langfuse.user.id": userRef,
      "langfuse.observation.type": "span",
      "langfuse.trace.metadata.job_id": job.id,
      "langfuse.trace.metadata.status": status,
      ...(code ? { "langfuse.observation.status_message": code } : {}),
      ...(job.parent_version_id ? { "langfuse.trace.metadata.parent_version_id": job.parent_version_id } : {}),
    })
    try {
      const versionId = await run(job, fence, userRef)
      await telemetry(job, "job", { name: "look-job", startMs: startedAt, endMs: now(), attributes: { ...rootAttrs("succeeded"), "langfuse.trace.metadata.version_id": versionId } }, true)
      return { status: "succeeded", versionId }
    } catch (error) {
      if (error instanceof LeaseLost) {
        await telemetry(job, "job", { name: "look-job", startMs: startedAt, endMs: now(), error: true, attributes: rootAttrs("abandoned", "lease_lost") }, true)
        return { status: "abandoned", code: "lease_lost" }
      }
      const code = error instanceof JobFailure ? error.code : error instanceof PrivateDatabaseError ? `db_${error.outcome}` : "internal_error"
      let failed = false
      try { failed = await db.call("fail_look_job", job.id, fence, code) } catch { failed = false }
      await telemetry(job, "job", { name: "look-job", startMs: startedAt, endMs: now(), error: true, attributes: rootAttrs(failed ? "failed" : "abandoned", code) }, true)
      return failed ? { status: "failed", code } : { status: "abandoned", code }
    }
  }

  async function run(job: LoadedJob, fence: string, userRef: string): Promise<string> {
    // 1. Selection: the explicit variant is verified and frozen before any paid call.
    const selStart = now()
    const v = job.variant
    if (!v) throw new JobFailure("explicit_variant_required")
    if (!v.published || !v.rights_cleared || v.variant_available === false || v.availability === "unavailable") throw new JobFailure("catalog_variant_unavailable")
    if (!v.image_url || !/^https:\/\//.test(v.image_url)) throw new JobFailure("garment_image_missing")
    const category = config.categoryMap[job.category_id]
    if (!category) throw new JobFailure("category_not_renderable")
    const snapshot = {
      name: v.name, source: v.source, partner: v.partner, catalog_kind: v.source === "curated" ? "curated" : "source",
      external_product_id: v.external_product_id, external_variant_id: v.external_variant_id, variant_label: v.variant_label,
      product_url: v.product_url, price_minor: v.price_minor, currency: v.currency, garment_image_url: v.image_url,
      source_updated_at: v.source_updated_at, selection_method: "explicit_user_choice", provider_category: category,
      // Product identity is verified by the catalog; these remain separate, unproven claims:
      link_verification: "unverified", visual_fidelity: "unverified",
      fixture: v.fixture === true,
      // A simulated render must never be mistaken for the real provider's output.
      render_mode: config.simulatedProvider ? "simulated" : "provider",
    }
    try {
      await db.call("record_ai_selection", job.id, fence, v.product_id, v.variant_id, snapshot)
    } catch (error) {
      if (error instanceof PrivateDatabaseError && error.outcome === "rejected") throw new JobFailure("catalog_variant_unavailable")
      throw error
    }
    await telemetry(job, "selection", { name: "selection", startMs: selStart, endMs: now(), attributes: {
      "langfuse.observation.type": "span", "langfuse.observation.metadata.method": "explicit_user_choice",
      "langfuse.observation.metadata.source": v.source, "langfuse.observation.metadata.product_id": v.product_id,
      "langfuse.observation.metadata.variant_id": v.variant_id,
    } })

    // 2. Generation (paid). Disabled provider = honest failure without spend.
    const segmind = deps.segmind
    if (!segmind) throw new JobFailure("provider_not_enabled")
    if (!segmindPrice || segmindPrice.kind !== "gpu_seconds") throw new JobFailure("provider_price_unknown")
    // The person removed or replaced the photo after asking: its authorization is gone, never use it.
    if (job.photo.usable === false) throw new JobFailure("photo_removed")
    const modelImageUrl = await store.signedUrl("body-photos", job.photo.object_key, config.photoUrlTtlSeconds)
    if (!modelImageUrl) throw new JobFailure("photo_not_reachable_by_provider")
    // A real provider fetches both inputs over the internet: local/test addresses fail BEFORE any spend
    // (honest error instead of a paid call that cannot work). The loopback simulator is exempt.
    if (!config.simulatedProvider) {
      if (!publiclyFetchable(v.image_url)) throw new JobFailure("garment_not_reachable_by_provider")
      if (!publiclyFetchable(modelImageUrl)) throw new JobFailure("photo_not_reachable_by_provider")
    }

    const attemptKey = `gen_${job.id.replace(/-/g, "")}_1`
    const callId = await db.call("reserve_provider_call", job.id, fence, "segmind", segmind.model, segmindPrice.priceVersion,
      "generation", attemptKey, config.segmindReserveMicros.toString(), userRef, config.environment)
      .catch((error: unknown) => {
        if (error instanceof PrivateDatabaseError && error.outcome === "rejected") throw new JobFailure("provider_budget_unavailable")
        throw error
      })
    // A recovered job whose call was already dispatched is never re-sent.
    if (!(await db.call("begin_provider_call", callId, fence))) throw new JobFailure("generation_needs_reconciliation")

    const genStart = now()
    const settle = (status: "succeeded" | "failed" | "unknown", requestId: string | null, extra: {
      units?: Record<string, number>; report?: Record<string, unknown>; computed?: bigint | null; source: string; error?: string | null
    }) => db.call("settle_provider_call", callId, status, requestId, toJson(extra.units ?? {}), toJson(extra.report ?? {}),
      config.segmindReserveMicros.toString(), extra.computed == null ? null : extra.computed.toString(), null, extra.source,
      Math.max(0, Math.round(now() - genStart)), extra.error ?? null)
    const genSpan = async (status: string, requestId: string | null, cost: bigint | null, units: Record<string, number>, errorCode?: string) => {
      await telemetry(job, `generation:${attemptKey}`, { name: "try-on", startMs: genStart, endMs: now(), error: status !== "succeeded", attributes: {
        "langfuse.observation.type": "generation", "langfuse.observation.model.name": segmind.model,
        "langfuse.observation.usage_details": JSON.stringify(units),
        ...(cost !== null ? { "langfuse.observation.cost_details": JSON.stringify({ total: microsToUsdNumber(cost) }) } : {}),
        "langfuse.observation.metadata.provider": "segmind", "langfuse.observation.metadata.status": status,
        // One logical attempt per job; submitCount includes same-key retries after 429/5xx.
        "langfuse.observation.metadata.attempt": 1, "langfuse.observation.metadata.submit_count": submitCount,
        "langfuse.observation.metadata.cost_source": cost !== null ? "computed_from_usage" : "unknown",
        "langfuse.observation.metadata.price_version": segmindPrice.priceVersion,
        ...(requestId ? { "langfuse.observation.metadata.provider_request_id": requestId } : {}),
        ...(errorCode ? { "langfuse.observation.status_message": errorCode } : {}),
      } })
    }

    let submitCount = 1
    let submit = await segmind.submit({ requestKey: attemptKey, modelImageUrl, clothImageUrl: v.image_url, category, preset: config.preset })
    for (let i = 0; submit.kind === "retryable" && i < config.submitRetries; i++) {
      await sleep(1000 * 2 ** i)
      await renew(job.id, fence)
      submitCount++
      submit = await segmind.submit({ requestKey: attemptKey, modelImageUrl, clothImageUrl: v.image_url, category, preset: config.preset })
    }
    if (submit.kind === "rejected") {
      await settle("failed", null, { computed: 0n, source: "rejected_before_run", error: submit.code })
      await genSpan("rejected", null, 0n, {}, submit.code)
      throw new JobFailure(`provider_rejected_${submit.code}`)
    }
    if (submit.kind !== "accepted") {
      await settle("unknown", null, { source: "unknown", error: submit.kind === "retryable" ? submit.code : submit.code })
      await genSpan("unknown", null, null, {}, "submit_outcome_unknown")
      throw new JobFailure("provider_outcome_unknown")
    }
    const requestId = submit.requestId
    // Persist the provider request id before polling (cost still unknown).
    await settle("unknown", requestId, { source: "unknown" })

    const deadline = now() + config.pollTimeoutMs
    for (;;) {
      await sleep(config.pollIntervalMs)
      await renew(job.id, fence)
      const poll = await segmind.poll(requestId)
      if (poll.kind === "pending" || (poll.kind === "error" && ["timeout", "network", "provider_error", "rate_limited"].includes(poll.code))) {
        if (now() > deadline) {
          await genSpan("timeout", requestId, null, {}, "poll_timeout")
          throw new JobFailure("provider_timeout")
        }
        continue
      }
      if (poll.kind === "not_found" || poll.kind === "error") {
        await genSpan("unknown", requestId, null, {}, poll.kind === "error" ? poll.code : "not_found")
        throw new JobFailure("provider_outcome_unknown")
      }
      const metrics = poll.kind === "completed" ? poll.result.metrics : poll.metrics
      const units: Record<string, number> = {}
      if (metrics.inferenceTime !== undefined) units.gpu_seconds = metrics.inferenceTime
      const cost = segmindCost(segmindPrice as GpuSecondPrice, metrics)
      const report = { credits: metrics.cost ?? null, inference_time: metrics.inferenceTime ?? null, queue_time: metrics.queueTime ?? null }
      if (poll.kind === "failed") {
        await settle(cost.computed === null ? "unknown" : "failed", requestId, { units, report, computed: cost.computed, source: cost.source, error: "provider_failed" })
        await genSpan("failed", requestId, cost.computed, units, "provider_failed")
        throw new JobFailure("provider_failed")
      }
      // 3. Copy the output privately; vendor URLs are public and short-lived.
      let bytes: Uint8Array
      try {
        bytes = poll.result.image.kind === "url"
          ? await segmind.download(poll.result.image.url, 12_582_912)
          : new Uint8Array(Buffer.from(poll.result.image.data, "base64"))
      } catch (error) {
        await settle(cost.computed === null ? "unknown" : "succeeded", requestId, { units, report, computed: cost.computed, source: cost.source, error: "output_download_failed" })
        await genSpan("output_unavailable", requestId, cost.computed, units, "output_download_failed")
        throw new JobFailure(error instanceof Error && /^output_/.test(error.message) ? error.message : "output_download_failed")
      }
      let info
      try { info = validateOutputImage(bytes) } catch (error) {
        await settle(cost.computed === null ? "unknown" : "succeeded", requestId, { units, report, computed: cost.computed, source: cost.source, error: "output_invalid" })
        await genSpan("output_invalid", requestId, cost.computed, units, "output_invalid")
        throw new JobFailure(error instanceof Error ? error.message : "output_invalid")
      }
      await settle(cost.computed === null ? "unknown" : "succeeded", requestId, { units, report, computed: cost.computed, source: cost.source })
      await genSpan("succeeded", requestId, cost.computed, units)
      await renew(job.id, fence)
      const ext = info.mime === "image/png" ? "png" : info.mime === "image/webp" ? "webp" : "jpg"
      const objectKey = `${job.user_id}/${job.id}/look.${ext}`
      const persistStart = now()
      await store.put("generated-looks", objectKey, bytes, info.mime)
      const assetId = await db.call("register_generated_asset", job.id, fence, objectKey, bytes.byteLength, info.mime, info.width, info.height)
      const versionId = await db.call("complete_look_job", job.id, fence, assetId)
      if (!versionId) throw new LeaseLost()
      await telemetry(job, "persist", { name: "persist", startMs: persistStart, endMs: now(), attributes: {
        "langfuse.observation.type": "span", "langfuse.observation.metadata.version_id": versionId,
      } })
      return versionId
    }
  }

  /** Reconciles dispatched/unknown Segmind calls by polling with the stored request id. */
  async function reconcileOnce(limit = 20): Promise<number> {
    const segmind = deps.segmind
    if (!segmind || !segmindPrice || segmindPrice.kind !== "gpu_seconds") return 0
    const rows = z.array(z.object({ id: z.string().uuid(), provider: z.string(), provider_request_id: z.string().nullable() }))
      .safeParse(await db.call("list_unreconciled_calls", limit))
    if (!rows.success) return 0
    let settled = 0
    for (const row of rows.data) {
      if (row.provider !== "segmind" || !row.provider_request_id) continue // needs operator evidence
      const poll = await segmind.poll(row.provider_request_id)
      if (poll.kind !== "completed" && poll.kind !== "failed") continue
      const metrics = poll.kind === "completed" ? poll.result.metrics : poll.metrics
      const cost = segmindCost(segmindPrice, metrics)
      if (cost.computed === null) continue
      if (await db.call("reconcile_provider_call", row.id, poll.kind === "completed" ? "succeeded" : "failed", cost.computed.toString(),
        "computed_from_usage", toJson({ credits: metrics.cost ?? null, inference_time: metrics.inferenceTime ?? null }))) settled++
    }
    return settled
  }

  return { processJob, reconcileOnce }
}
export type Engine = ReturnType<typeof createEngine>

/** https on a public-looking host: not loopback, private ranges, *.local/.test/.invalid (e.g. the test catalog). */
export function publiclyFetchable(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== "https:") return false
  const h = u.hostname.toLowerCase()
  if (h === "localhost" || /\.(local|localhost|test|invalid|internal)$/.test(h)) return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]") return false
  return true
}
