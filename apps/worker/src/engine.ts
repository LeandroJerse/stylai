/**
 * Job engine: one to three explicitly chosen catalog pieces on one body photo, rendered as sequential
 * single-garment layers (base -> upper -> outer; docs/decisions/2026-11-23-composicao-multipeca.md).
 * Order is fixed: verify + freeze every piece -> per layer: reserve spend -> pilot gate -> dispatch once ->
 * poll -> settle -> next layer -> copy the final output privately -> publish version. No step re-sends a
 * provider request whose outcome is unknown; a failure at layer N fails the job without a version.
 */
import { z } from "zod"
import {
  defaultSegmindPreset, falCost, findPrice, microsToUsdNumber, pseudonymizeUser, segmindCost, spanIdFor, traceIdForJob, validateOutputImage,
  SEGMIND_OUTFIT_RESERVE, SEGMIND_OUTFIT_PRICE_VERSION, type SegmindOutfitClient,
  GEMINI_OUTFIT_RESERVE, GEMINI_OUTFIT_PRICE_VERSION, validateGeminiOutfitInput, type GeminiOutfitClient,
  type FalClient, type FalTryOnModel, type GpuSecondPrice, type PerImagePrice, type SegmindCategory, type SegmindClient, type SegmindPreset, type SpanRecord, type AttributeValue,
} from "@stylai/ai"
import { PrivateDatabaseError, type Json, type PrivateDatabase, type PrivateObjectStore } from "@stylai/supabase"
import type { PhotoRelay, PhotoRelayLease } from "./photo-relay.js"

/** Plain-data copy for jsonb parameters (drops undefined, rejects non-JSON values). */
function toJson(value: unknown): Json { return JSON.parse(JSON.stringify(value)) as Json }

export interface EngineConfig {
  environment: "development" | "test" | "staging" | "production"
  /** Server-side active try-on provider. Defaults to "segmind" (preserves existing integration). */
  provider?: "segmind" | "fal" | "gemini"
  /** Langfuse environment label (e.g. "integration-test" for synthetic runs). Defaults to environment. */
  telemetryEnvironment?: string
  /** True when the provider is the local simulator: telemetry is labelled synthetic. */
  simulatedProvider?: boolean
  /** Persistent pilot budget id (required whenever simulatedProvider is false). */
  pilotId?: string | null
  pseudonymKey: string
  /** Internal category id -> provider category. Unmapped categories are not renderable. */
  categoryMap: Record<string, SegmindCategory>
  preset: SegmindPreset
  /** Conservative per-attempt reservation for one Segmind try-on call (USD micros). */
  segmindReserveMicros: bigint
  /** Exact per-attempt reservation for one fal try-on call (USD micros; defaults to published per-image price). */
  falReserveMicros?: bigint
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
  submitRetries: 0,
}

export interface EngineDeps {
  db: PrivateDatabase<"ai_worker">
  store: PrivateObjectStore
  /** Null when paid calls are disabled or the key is absent: jobs fail without spending. */
  segmind: SegmindClient | null
  segmindReconcilers?: Partial<Record<string, SegmindClient>>
  segmindOutfit?: SegmindOutfitClient | null
  gemini?: GeminiOutfitClient | null
  /** Optional fal.ai client when server selects provider="fal" (reuses the same worker, relay & ledger). */
  fal?: FalClient | null
  /** Optional per-model fal clients for cold reconciliation of prior unknown calls across model switches. */
  falReconcilers?: Partial<Record<FalTryOnModel, FalClient>>
  /** Optional restricted single-job HTTPS relay when local Storage URLs are not publicly fetchable. */
  photoRelay?: PhotoRelay | null
  config: EngineConfig
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const variantSchema = z.object({
  product_id: z.string().uuid(), variant_id: z.string().uuid(), name: z.string(), category_id: z.string().nullable(),
  source: z.string(), partner: z.string(), external_product_id: z.string(), external_variant_id: z.string().nullable(),
  reference_kind: z.enum(["sku", "image_reference"]).default("sku"),
  canonical_id: z.string().optional(), affiliate_url: z.string().nullable().optional(),
  variant_label: z.string(), product_url: z.string().nullable(), price_minor: z.number().int().nullable(), currency: z.string(),
  availability: z.string(), variant_available: z.boolean().nullable(), published: z.boolean(), rights_cleared: z.boolean(),
  source_updated_at: z.string().nullable(), image_url: z.string().nullable(), fixture: z.boolean().optional(),
})
const jobSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), category_id: z.string(), search_query: z.string(),
  parent_version_id: z.string().uuid().nullable(),
  photo: z.object({ bucket: z.literal("body-photos"), object_key: z.string(), mime: z.string().nullable(), usable: z.boolean().optional() }),
  variant: variantSchema.nullable(),
  composition_id: z.string().uuid().nullable().optional(),
  items: z.array(variantSchema.extend({ slot: z.enum(["upper", "lower", "dress", "outer"]), position: z.number().int().min(1).max(3) })).default([]),
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
  const falPrice = deps.fal ? findPrice("fal", deps.fal.model) : undefined
  const activeProvider: "segmind" | "fal" | "gemini" = config.provider ?? (deps.fal && !deps.segmind ? "fal" : "segmind")

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
      const versionId = await run(job, fence)
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

  async function run(job: LoadedJob, fence: string): Promise<string> {
    // 1. Selection: every piece is verified and frozen before any paid call. A one-piece job is the
    //    particular case of a single layer (legacy jobs carry no items).
    const selStart = now()
    const layers = job.items.length ? job.items : job.variant ? [{ ...job.variant, slot: null, position: 1 }] : []
    if (!layers.length) throw new JobFailure("explicit_variant_required")
    if (layers.length > 3) throw new JobFailure("too_many_pieces")
    const planned = layers.map((v) => {
      if (!v.published || !v.rights_cleared || v.variant_available === false || v.availability === "unavailable") throw new JobFailure("catalog_variant_unavailable")
      if (!v.image_url || !/^https:\/\//.test(v.image_url)) throw new JobFailure("garment_image_missing")
      const category = config.categoryMap[v.category_id ?? ""]
      if (!category) throw new JobFailure("category_not_renderable")
      return { v, category, clothImageUrl: v.image_url }
    })
    const pieceSnapshot = (p: (typeof planned)[number]) => ({
      name: p.v.name, source: p.v.source, partner: p.v.partner, catalog_kind: p.v.source === "curated" ? "curated" : "source",
      slot: "slot" in p.v ? p.v.slot : null,
      external_product_id: p.v.external_product_id, external_variant_id: p.v.external_variant_id, variant_label: p.v.variant_label,
      reference_kind: p.v.reference_kind,
      canonical_id: p.v.canonical_id, affiliate_url: p.v.affiliate_url,
      product_url: p.v.product_url, price_minor: p.v.price_minor, currency: p.v.currency, garment_image_url: p.v.image_url,
      source_updated_at: p.v.source_updated_at, provider_category: p.category,
      link_verification: "unverified", visual_fidelity: "unverified", fixture: p.v.fixture === true,
    })
    const snapshot = {
      ...pieceSnapshot(planned[0]!),
      selection_method: job.composition_id ? "composition_confirmed_by_person" : "explicit_user_choice",
      composition_id: job.composition_id ?? null,
      layers: planned.length,
      // Multi-layer renders are sequential single-garment try-ons: fidelity of earlier layers is NOT measured.
      render_plan: (activeProvider === "gemini" || (activeProvider === "segmind" && deps.segmindOutfit)) ? "joint_outfit_unverified" : planned.length > 1 ? "sequential_layers_unverified" : "single_garment",
      items: planned.map(pieceSnapshot),
      render_mode: config.simulatedProvider ? "simulated" : "provider",
    }
    try {
      if (job.items.length) {
        for (const item of job.items) {
          const p = planned.find((x) => x.v.product_id === item.product_id && x.v.variant_id === item.variant_id)!
          if (!(await db.call("record_job_item_snapshot", job.id, fence, item.position, toJson(pieceSnapshot(p))))) throw new LeaseLost()
        }
      }
      await db.call("record_ai_selection", job.id, fence, planned[0]!.v.product_id, planned[0]!.v.variant_id, toJson(snapshot))
    } catch (error) {
      if (error instanceof PrivateDatabaseError && error.outcome === "rejected") {
        throw new JobFailure(error.sqlState === "SA003" ? "try_on_rights_revoked" : error.sqlState === "SA004" ? "selection_changed" : "catalog_variant_unavailable")
      }
      throw error
    }
    await telemetry(job, "selection", { name: "selection", startMs: selStart, endMs: now(), attributes: {
      "langfuse.observation.type": "span", "langfuse.observation.metadata.method": snapshot.selection_method,
      "langfuse.observation.metadata.layers": planned.length,
      "langfuse.observation.metadata.product_ids": planned.map((p) => p.v.product_id).join(","),
    } })

    if (activeProvider === "gemini" || (activeProvider === "segmind" && deps.segmindOutfit)) return renderJointOutfit(job, fence, planned.map(p=>({category:p.category,imageUrl:p.clothImageUrl,garmentType:p.v.category_id??"",slot:p.v.slot})))
    // 2. Generation (paid). Disabled provider = honest failure without spend.
    const activeFal = activeProvider === "fal" ? (deps.fal ?? null) : null
    const activeSegmind = activeProvider === "segmind" ? deps.segmind : null
    if (!activeFal && !activeSegmind) throw new JobFailure("provider_not_enabled")
    const activePrice = activeFal ? falPrice : segmindPrice
    if (activeFal) {
      if (!activePrice || activePrice.kind !== "per_image") throw new JobFailure("provider_price_unknown")
    } else {
      if (!activePrice || activePrice.kind !== "gpu_seconds") throw new JobFailure("provider_price_unknown")
    }
    const providerName: "segmind" | "fal" = activeFal ? "fal" : "segmind"
    const modelName = activeFal ? activeFal.model : activeSegmind!.model
    const reserveMicros = activeFal
      ? (config.falReserveMicros ?? (activePrice as PerImagePrice).perImageMicros)
      : config.segmindReserveMicros
    // The person removed or replaced the photo after asking: its authorization is gone, never use it.
    if (job.photo.usable === false) throw new JobFailure("photo_removed")
    if (!config.simulatedProvider && planned.some((p) => !publiclyFetchable(p.clothImageUrl))) throw new JobFailure("garment_not_reachable_by_provider")
    if (!config.simulatedProvider && !config.pilotId) throw new JobFailure("pilot_required")
    // P04: every layer is a separate reservation. The WHOLE chain must fit every budget scope (job, day, provider,
    // user, pilot money and attempts) before layer 1 is paid; otherwise layer 1 could be spent and layer 2 refused.
    if (planned.length > 1) {
      const check = z.object({ ok: z.boolean(), limiting: z.array(z.string()) }).passthrough()
        .safeParse(await db.call("check_layer_budget", job.id, fence, providerName, planned.length, reserveMicros.toString(), config.pilotId ?? null))
      if (!check.success) throw new JobFailure("budget_check_unavailable")
      if (!check.data.ok) throw new JobFailure("budget_insufficient_for_layers")
    }

    const leases: PhotoRelayLease[] = []
    const intermediates: string[] = []
    const expose = async (bytes: Uint8Array, mime: "image/jpeg" | "image/png" | "image/webp"): Promise<string> => {
      if (!deps.photoRelay) throw new JobFailure("photo_not_reachable_by_provider")
      const lease = await deps.photoRelay.expose({ jobId: job.id, bytes, mime, maxLifetimeMs: Math.min(config.pollTimeoutMs * planned.length + 120_000, 15 * 60_000) })
      leases.push(lease)
      return lease.publicUrl
    }
    try {
      let modelImageUrl = await store.signedUrl("body-photos", job.photo.object_key, config.photoUrlTtlSeconds)
      if (!config.simulatedProvider && (!modelImageUrl || !publiclyFetchable(modelImageUrl)) && deps.photoRelay) {
        const mime = job.photo.mime === "image/png" || job.photo.mime === "image/webp" ? job.photo.mime : "image/jpeg"
        try { modelImageUrl = await expose(await store.get("body-photos", job.photo.object_key), mime) } catch { throw new JobFailure("photo_not_reachable_by_provider") }
      }
      // A real provider fetches inputs over the internet: local/test addresses fail BEFORE any spend.
      if (!modelImageUrl || (!config.simulatedProvider && !publiclyFetchable(modelImageUrl))) throw new JobFailure("photo_not_reachable_by_provider")

      let finalBytes: Uint8Array | null = null
      for (let step = 1; step <= planned.length; step++) {
        const piece = planned[step - 1]!
        const last = step === planned.length
        const out = await renderStep(job, fence, step, planned.length, modelImageUrl, piece.clothImageUrl, piece.category, {
          activeFal, activeSegmind, providerName, modelName, reserveMicros, activePrice: activePrice as PerImagePrice | GpuSecondPrice,
        })
        if (last) {
          finalBytes = out.kind === "bytes" ? out.bytes : await download(activeFal, activeSegmind, out.url)
        } else if (out.kind === "url" && (config.simulatedProvider || publiclyFetchable(out.url))) {
          // The provider's own short-lived https output feeds the next layer (no copy of an intermediate is kept).
          modelImageUrl = out.url
        } else {
          // Kept privately (generated-looks, job folder) and passed by a short signed URL; removed when the job ends.
          const bytes = out.kind === "bytes" ? out.bytes : await download(activeFal, activeSegmind, out.url)
          let info
          try { info = validateOutputImage(bytes) } catch { throw new JobFailure("intermediate_output_invalid") }
          const key = `${job.user_id}/${job.id}/layer-${step}.${info.mime === "image/png" ? "png" : info.mime === "image/webp" ? "webp" : "jpg"}`
          await store.put("generated-looks", key, bytes, info.mime)
          intermediates.push(key)
          const signed = await store.signedUrl("generated-looks", key, config.photoUrlTtlSeconds)
          if (signed && (config.simulatedProvider || publiclyFetchable(signed))) modelImageUrl = signed
          else {
            try { modelImageUrl = await expose(bytes, info.mime) } catch { throw new JobFailure("intermediate_not_reachable_by_provider") }
          }
        }
      }
      let info
      try { info = validateOutputImage(finalBytes!) } catch (error) { throw new JobFailure(error instanceof Error ? error.message : "output_invalid") }
      await renew(job.id, fence)
      const ext = info.mime === "image/png" ? "png" : info.mime === "image/webp" ? "webp" : "jpg"
      const objectKey = `${job.user_id}/${job.id}/look.${ext}`
      const persistStart = now()
      await store.put("generated-looks", objectKey, finalBytes!, info.mime)
      const assetId = await db.call("register_generated_asset", job.id, fence, objectKey, finalBytes!.byteLength, info.mime, info.width, info.height)
      const versionId = await db.call("complete_look_job", job.id, fence, assetId)
      if (!versionId) throw new LeaseLost()
      await telemetry(job, "persist", { name: "persist", startMs: persistStart, endMs: now(), attributes: {
        "langfuse.observation.type": "span", "langfuse.observation.metadata.version_id": versionId,
        "langfuse.observation.metadata.layers": planned.length,
      } })
      return versionId
    } finally {
      for (const lease of leases) await lease.close().catch(() => undefined)
      for (const key of intermediates) await store.remove("generated-looks", key).catch(() => undefined)
    }
  }

  async function renderJointOutfit(job: LoadedJob, fence: string, pieces: {category: SegmindCategory; imageUrl: string; garmentType:string; slot:string|null}[]): Promise<string> {
    const provider = config.provider === "segmind" ? "segmind" : "gemini"
    const client = provider === "segmind" ? deps.segmindOutfit : deps.gemini
    const reserve = provider === "segmind" ? SEGMIND_OUTFIT_RESERVE : GEMINI_OUTFIT_RESERVE
    const priceVersion = provider === "segmind" ? SEGMIND_OUTFIT_PRICE_VERSION : GEMINI_OUTFIT_PRICE_VERSION
    if(!client || !config.pilotId) throw new JobFailure("provider_not_enabled")
    if(job.photo.usable===false) throw new JobFailure("photo_removed")
    const person: {bytes:Uint8Array;mime:string;url?:string} = {bytes:await store.get("body-photos",job.photo.object_key),mime:job.photo.mime ?? "image/jpeg"}
    const garments = await Promise.all(pieces.map(async p=>({...await client.garment(p.imageUrl),category:p.category,garmentType:p.garmentType,slot:p.slot}))).catch(()=>{throw new JobFailure("garment_download_failed")})
    try { validateGeminiOutfitInput({person,garments}) } catch { throw new JobFailure("outfit_input_invalid") }
    await renew(job.id,fence)
    let heartbeat = Promise.resolve()
    let leaseFailed = false
    const timer = setInterval(()=>{heartbeat=heartbeat.then(()=>renew(job.id,fence)).catch(()=>{leaseFailed=true})},20_000)
    let relay: PhotoRelayLease | null = null
    try {
    if(provider === "segmind") {
      person.url = await store.signedUrl("body-photos",job.photo.object_key,config.photoUrlTtlSeconds) ?? undefined
      if(!person.url || !publiclyFetchable(person.url)) {
        if(!deps.photoRelay) throw new JobFailure("photo_not_reachable_by_provider")
        const mime=person.mime === "image/png" || person.mime === "image/webp" ? person.mime : "image/jpeg"
        relay=await deps.photoRelay.expose({jobId:job.id,bytes:person.bytes,mime,maxLifetimeMs:240000}).catch(error=>{throw new JobFailure(error instanceof Error && /^cloudflared_[a-z0-9_]+$/.test(error.message)?error.message:"photo_not_reachable_by_provider")})
        person.url=relay.publicUrl
      }
      if(!publiclyFetchable(person.url)) throw new JobFailure("photo_not_reachable_by_provider")
    }
    const fresh = jobSchema.safeParse(await db.call("load_ai_job",job.id,fence))
    if(!fresh.success || fresh.data.photo.usable===false || fresh.data.photo.object_key!==job.photo.object_key) throw new JobFailure("photo_removed")
    const check = z.object({ok:z.boolean()}).safeParse(await db.call("check_layer_budget",job.id,fence,provider,1,reserve.toString(),config.pilotId))
    if(!check.success || !check.data.ok) throw new JobFailure("budget_insufficient_for_layers")
    const call = await db.call("reserve_provider_call",job.id,fence,provider,client.model,priceVersion,"generation",
      `gen_${job.id.replace(/-/g,"")}_joint`,reserve.toString(),pseudonymizeUser(job.user_id,config.pseudonymKey),config.environment)
    const gate = z.object({ok:z.boolean(),reason:z.string().optional()}).parse(await db.call("reserve_pilot_dispatch",config.pilotId,call,fence,"real",
      {provider,model:client.model,images_per_call:1,pieces:pieces.length,resolution:"2K",render:"joint_outfit"}))
    if(!gate.ok) throw new JobFailure(`pilot_${gate.reason??"blocked"}`)
    try { if(!await db.call("begin_provider_call",call,fence)) throw new JobFailure("generation_needs_reconciliation") }
    catch(error) {
      if(error instanceof PrivateDatabaseError && error.outcome==="rejected") {
        await db.call("settle_provider_call",call,"released",null,{}, {},reserve.toString(),"0",null,"rejected_before_run",0,"outfit_gate_rejected")
        throw new JobFailure(error.sqlState==="SA005"?"photo_removed":error.sqlState==="SA003"?"try_on_rights_revoked":"selection_changed")
      }
      throw error
    }
    const started=now()
    // Synchronous native API: a crash/timeout cannot be polled safely. Keep its reservation; never resend.
    await db.call("settle_provider_call",call,"unknown",null,{}, {},reserve.toString(),null,null,"unknown",0,null)
    const result=await client.generate({person,garments})
    const duration=Math.max(0,Math.round(now()-started))
    if(result.kind==="rejected") {
      if(result.diagnostic) console.warn(JSON.stringify({event:"joint_outfit_rejected",provider,jobId:job.id,code:result.code,diagnostic:result.diagnostic}))
      await db.call("settle_provider_call",call,"failed",null,{}, {},reserve.toString(),"0",null,"rejected_before_run",duration,result.code)
      throw new JobFailure(result.code)
    }
    if(result.kind!=="completed") throw new JobFailure("provider_outcome_unknown")
    await db.call("settle_provider_call",call,"succeeded",result.requestId,toJson(result.usage),{resolution:"2K",images:1},reserve.toString(),
      result.computedMicros?.toString()??null,null,result.computedMicros===null?"unknown":"computed_from_usage",duration,null)
    await telemetry(job,"generation:joint",{name:"joint-outfit",startMs:started,endMs:now(),attributes:{
      "langfuse.observation.type":"generation","langfuse.observation.model.name":client.model,
      "langfuse.observation.usage_details":JSON.stringify(result.usage),
      ...(result.computedMicros===null?{}:{"langfuse.observation.cost_details":JSON.stringify({total:microsToUsdNumber(result.computedMicros)})}),
    }})
    const info=validateOutputImage(result.bytes)
    if(leaseFailed) throw new LeaseLost()
    await renew(job.id,fence)
    const key=`${job.user_id}/${job.id}/look.${info.mime==="image/png"?"png":info.mime==="image/webp"?"webp":"jpg"}`
    await store.put("generated-looks",key,result.bytes,info.mime)
    const asset=await db.call("register_generated_asset",job.id,fence,key,result.bytes.length,info.mime,info.width,info.height)
    const version=await db.call("complete_look_job",job.id,fence,asset)
    if(!version) throw new LeaseLost()
    return version
    } finally { clearInterval(timer); await heartbeat; if(relay) await relay.close().catch(()=>undefined) }
  }

  async function download(activeFal: FalClient | null, activeSegmind: SegmindClient | null, url: string): Promise<Uint8Array> {
    try {
      return await (activeFal ? activeFal.download(url, 12_582_912) : activeSegmind!.download(url, 12_582_912))
    } catch (error) {
      throw new JobFailure(error instanceof Error && /^output_/.test(error.message) ? error.message : "output_download_failed")
    }
  }

  /** One paid layer: reserve -> pilot gate -> begin (never re-sent) -> submit -> poll -> settle. */
  async function renderStep(job: LoadedJob, fence: string, step: number, total: number, modelImageUrl: string, clothImageUrl: string,
    category: SegmindCategory, p: { activeFal: FalClient | null; activeSegmind: SegmindClient | null; providerName: "segmind" | "fal"; modelName: string;
      reserveMicros: bigint; activePrice: PerImagePrice | GpuSecondPrice }): Promise<{ kind: "url"; url: string } | { kind: "bytes"; bytes: Uint8Array }> {
    const { activeFal, activeSegmind, providerName, modelName, reserveMicros, activePrice } = p
    const userRef = pseudonymizeUser(job.user_id, config.pseudonymKey)
    const attemptKey = `gen_${job.id.replace(/-/g, "")}_${step}`
    const callId = await db.call("reserve_provider_call", job.id, fence, providerName, modelName, activePrice.priceVersion,
      "generation", attemptKey, reserveMicros.toString(), userRef, config.environment)
      .catch((error: unknown) => {
        if (error instanceof PrivateDatabaseError && error.outcome === "rejected") throw new JobFailure("provider_budget_unavailable")
        throw error
      })
    if (config.pilotId) {
      const pilotRes = z.object({ ok: z.boolean(), reason: z.string().optional(), attempt_no: z.number().int().optional() }).safeParse(
        await db.call("reserve_pilot_dispatch", config.pilotId, callId, fence, config.simulatedProvider ? "simulated" : "real",
          toJson(activeFal ? { category, provider: "fal", model: modelName, images_per_call: 1, layer: step, layers: total } : { category, preset: config.preset, layer: step, layers: total })),
      )
      if (!pilotRes.success) throw new JobFailure("pilot_gate_error")
      if (!pilotRes.data.ok) throw new JobFailure(`pilot_${pilotRes.data.reason ?? "blocked"}`)
    }
    // A recovered job whose call was already dispatched is never re-sent.
    try {
      if (!(await db.call("begin_provider_call", callId, fence))) throw new JobFailure("generation_needs_reconciliation")
    } catch (error) {
      if (error instanceof PrivateDatabaseError && error.outcome === "rejected" && ["SA003", "SA004", "SA005"].includes(error.sqlState ?? "")) {
        const code = error.sqlState === "SA005" ? "photo_removed" : error.sqlState === "SA003" ? "try_on_rights_revoked" : "selection_changed"
        await db.call("settle_provider_call", callId, "released", null, {}, {}, reserveMicros.toString(), "0", null, "rejected_before_run", 0, code)
        throw new JobFailure(code)
      }
      throw error
    }

    const genStart = now()
    let submitCount = 1
    const settle = (status: "succeeded" | "failed" | "unknown", requestId: string | null, extra: {
      units?: Record<string, number>; report?: Record<string, unknown>; computed?: bigint | null; source: string; error?: string | null
    }) => db.call("settle_provider_call", callId, status, requestId, toJson(extra.units ?? {}), toJson(extra.report ?? {}),
      reserveMicros.toString(), extra.computed == null ? null : extra.computed.toString(), null, extra.source,
      Math.max(0, Math.round(now() - genStart)), extra.error ?? null)
    const genSpan = async (status: string, requestId: string | null, cost: bigint | null, units: Record<string, number>, errorCode?: string) => {
      await telemetry(job, `generation:${attemptKey}`, { name: total > 1 ? `try-on-layer-${step}` : "try-on", startMs: genStart, endMs: now(), error: status !== "succeeded", attributes: {
        "langfuse.observation.type": "generation", "langfuse.observation.model.name": modelName,
        "langfuse.observation.usage_details": JSON.stringify(units),
        ...(cost !== null ? { "langfuse.observation.cost_details": JSON.stringify({ total: microsToUsdNumber(cost) }) } : {}),
        "langfuse.observation.metadata.provider": providerName, "langfuse.observation.metadata.status": status,
        "langfuse.observation.metadata.attempt": 1, "langfuse.observation.metadata.submit_count": submitCount,
        "langfuse.observation.metadata.layer": step, "langfuse.observation.metadata.layers": total,
        "langfuse.observation.metadata.cost_source": cost !== null ? "computed_from_usage" : "unknown",
        "langfuse.observation.metadata.price_version": activePrice.priceVersion,
        ...(requestId ? { "langfuse.observation.metadata.provider_request_id": requestId } : {}),
        ...(errorCode ? { "langfuse.observation.status_message": errorCode } : {}),
      } })
    }
    const submitOnce = () => activeFal
      ? activeFal.submit({ requestKey: attemptKey, modelImageUrl, clothImageUrl, category })
      : activeSegmind!.submit({ requestKey: attemptKey, modelImageUrl, clothImageUrl, category, preset: config.preset })
    let submit = await submitOnce()
    const allowedSubmitRetries = config.pilotId || !config.simulatedProvider ? 0 : config.submitRetries
    for (let i = 0; submit.kind === "retryable" && i < allowedSubmitRetries; i++) {
      await sleep(1000 * 2 ** i)
      await renew(job.id, fence)
      submitCount++
      submit = await submitOnce()
    }
    if (submit.kind === "rejected") {
      await settle("failed", null, { computed: 0n, source: "rejected_before_run", error: submit.code })
      await genSpan("rejected", null, 0n, {}, submit.code)
      throw new JobFailure(`provider_rejected_${submit.code}`)
    }
    if (submit.kind !== "accepted") {
      await settle("unknown", null, { source: "unknown", error: submit.code })
      await genSpan("unknown", null, null, {}, "submit_outcome_unknown")
      throw new JobFailure("provider_outcome_unknown")
    }
    const requestId = submit.requestId
    await settle("unknown", requestId, { source: "unknown" })
    const deadline = now() + config.pollTimeoutMs
    for (;;) {
      await sleep(config.pollIntervalMs)
      await renew(job.id, fence)
      const poll = activeFal ? await activeFal.poll(requestId) : await activeSegmind!.poll(requestId)
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
      if (activeFal) units.images = poll.kind === "completed" ? 1 : 0
      else if (metrics.inferenceTime !== undefined) units.gpu_seconds = metrics.inferenceTime
      const cost = activeFal
        ? falCost(activePrice as PerImagePrice, poll.kind === "completed" ? "completed" : "failed", poll.kind === "completed" ? 1 : 0)
        : segmindCost(activePrice as GpuSecondPrice, metrics)
      const report = activeFal
        ? { images: poll.kind === "completed" ? 1 : 0, inference_time: metrics.inferenceTime ?? null, layer: step }
        : { credits: metrics.cost ?? null, inference_time: metrics.inferenceTime ?? null, queue_time: metrics.queueTime ?? null, layer: step }
      if (poll.kind === "failed") {
        await settle(cost.computed === null ? "unknown" : "failed", requestId, { units, report, computed: cost.computed, source: cost.source, error: "provider_failed" })
        await genSpan("failed", requestId, cost.computed, units, "provider_failed")
        throw new JobFailure(total > 1 ? `provider_failed_layer_${step}` : "provider_failed")
      }
      await settle(cost.computed === null ? "unknown" : "succeeded", requestId, { units, report, computed: cost.computed, source: cost.source })
      await genSpan("succeeded", requestId, cost.computed, units)
      return poll.result.image.kind === "url"
        ? { kind: "url", url: poll.result.image.url }
        : { kind: "bytes", bytes: new Uint8Array(Buffer.from(poll.result.image.data, "base64")) }
    }
  }

  /** Reconciles dispatched/unknown Segmind and fal calls by polling with the stored request id. */
  async function reconcileOnce(limit = 20): Promise<number> {
    const segmind = deps.segmind
    const hasSegmind = Boolean(segmind || (deps.segmindReconcilers && Object.keys(deps.segmindReconcilers).length))
    const hasFal = Boolean(deps.fal || (deps.falReconcilers && Object.keys(deps.falReconcilers).length > 0))
    if (!hasSegmind && !hasFal) return 0
    const rows = z.array(z.object({
      id: z.string().uuid(),
      provider: z.string(),
      model: z.string().optional(),
      provider_request_id: z.string().nullable(),
    })).safeParse(await db.call("list_unreconciled_calls", limit))
    if (!rows.success) return 0
    let settled = 0
    for (const row of rows.data) {
      if (!row.provider_request_id) continue // needs operator evidence
      if (row.provider === "segmind" && hasSegmind) {
        const client = (row.model && deps.segmindReconcilers?.[row.model]) || (segmind && (!row.model || segmind.model === row.model) ? segmind : null)
        if(!client) continue
        const price = findPrice("segmind", client.model)
        if(!price || price.kind !== "gpu_seconds") continue
        const poll = await client.poll(row.provider_request_id)
        if (poll.kind !== "completed" && poll.kind !== "failed") continue
        const metrics = poll.kind === "completed" ? poll.result.metrics : poll.metrics
        const cost = segmindCost(price, metrics)
        if (cost.computed === null) continue
        if (await db.call("reconcile_provider_call", row.id, poll.kind === "completed" ? "succeeded" : "failed", cost.computed.toString(),
          "computed_from_usage", toJson({ credits: metrics.cost ?? null, inference_time: metrics.inferenceTime ?? null }))) settled++
      } else if (row.provider === "fal") {
        const model = row.model as FalTryOnModel | undefined
        const falClient = (model && deps.falReconcilers?.[model]) || (deps.fal && (!model || deps.fal.model === model) ? deps.fal : null)
        if (!falClient) continue
        const price = findPrice("fal", falClient.model)
        if (!price || price.kind !== "per_image") continue
        const poll = await falClient.poll(row.provider_request_id)
        if (poll.kind !== "completed" && poll.kind !== "failed") continue
        const cost = falCost(price, poll.kind === "completed" ? "completed" : "failed", poll.kind === "completed" ? 1 : 0)
        if (cost.computed === null) continue
        const metrics = poll.kind === "completed" ? poll.result.metrics : poll.metrics
        if (await db.call("reconcile_provider_call", row.id, poll.kind === "completed" ? "succeeded" : "failed", cost.computed.toString(),
          "computed_from_usage", toJson({ images: poll.kind === "completed" ? 1 : 0, inference_time: metrics.inferenceTime ?? null }))) settled++
      }
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
