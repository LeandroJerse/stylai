/**
 * fal.ai Queue REST API adapters for fixed-price virtual try-on (docs read 2026-11-21):
 *   - fal-ai/fashn/tryon/v1.6              ($0.075/image; num_samples hardcoded to 1)
 *   - fal-ai/image-apps-v2/virtual-try-on  ($0.040/image; single-image output schema)
 *
 * Official Queue flow (https://docs.fal.ai):
 *   POST {base}/{owner}/{app}/{subpath}                  -> { request_id, status_url, response_url }
 *   GET  {base}/{owner}/{app}/requests/{id}/status       -> { status: IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED|CANCELLED }
 *   GET  {base}/{owner}/{app}/requests/{id}              -> { images: [{ url, width, height, content_type }] }
 * Auth header: `Authorization: Key <FAL_KEY>`.
 * Never retries paid submissions automatically; always copies outputs privately.
 */
import { perImageCostMicros, type PerImagePrice } from "./pricing.js"
import type { FetchLike, PollOutcome, SegmindCategory, SegmindErrorCode, SegmindResult, SubmitOutcome } from "./segmind.js"

export const FAL_FASHN_MODEL = "fal-ai/fashn/tryon/v1.6" as const
export const FAL_IMAGE_APPS_MODEL = "fal-ai/image-apps-v2/virtual-try-on" as const
export type FalTryOnModel = typeof FAL_FASHN_MODEL | typeof FAL_IMAGE_APPS_MODEL
export type FalFashnMode = "performance" | "balanced" | "quality"
export type FalGarmentPhotoType = "auto" | "model" | "flat-lay"

export function isSupportedFalModel(model: string): model is FalTryOnModel {
  return model === FAL_FASHN_MODEL || model === FAL_IMAGE_APPS_MODEL
}

/** Queue status/result routes strip subpaths per official fal.ai Queue API docs. */
export function falQueueAppBase(model: FalTryOnModel): string {
  const parts = model.split("/")
  return `${parts[0]}/${parts[1]}`
}

export function mapCategoryToFashn(category: SegmindCategory): "tops" | "bottoms" | "one-pieces" {
  if (category === "Lower body") return "bottoms"
  if (category === "Dress") return "one-pieces"
  return "tops"
}

export interface FalConfig {
  apiKey: string
  model: FalTryOnModel
  baseUrl?: string
  fashnMode?: FalFashnMode
  garmentPhotoType?: FalGarmentPhotoType
  preservePose?: boolean
  aspectRatio?: string
  fetch?: FetchLike
  requestTimeoutMs?: number
}

export interface FalSubmitInput {
  requestKey: string
  modelImageUrl: string
  clothImageUrl: string
  category: SegmindCategory
}

const errorCodes: Record<number, SegmindErrorCode> = {
  400: "invalid_request",
  401: "unauthorized",
  402: "insufficient_credits",
  403: "forbidden",
  404: "not_found",
  422: "invalid_request",
  429: "rate_limited",
  500: "provider_error",
  502: "provider_error",
  503: "provider_error",
  504: "provider_error",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

/** Only fal-owned HTTPS media hosts may be fetched as outputs (SSRF guard). */
export function isAllowedFalOutputUrl(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false
  return url.hostname === "fal.media" || url.hostname.endsWith(".fal.media")
}

export function parseFalResult(body: unknown): { result: SegmindResult; imageCount: number } | null {
  if (!isRecord(body)) return null
  const metrics = isRecord(body.metrics)
    ? { inferenceTime: num(body.metrics.inference_time) }
    : {}
  if (Array.isArray(body.images) && body.images.length > 0 && isRecord(body.images[0]) && typeof body.images[0].url === "string") {
    const firstUrl = body.images[0].url
    if (/^https:\/\//.test(firstUrl)) {
      return { result: { image: { kind: "url", url: firstUrl }, metrics }, imageCount: body.images.length }
    }
  }
  if (isRecord(body.image) && typeof body.image.url === "string" && /^https:\/\//.test(body.image.url)) {
    return { result: { image: { kind: "url", url: body.image.url }, metrics }, imageCount: 1 }
  }
  return null
}

export function falCost(
  price: PerImagePrice,
  outcome: "completed" | "failed",
  imageCount = 1,
): { computed: bigint | null; source: "computed_from_usage" | "unknown" } {
  if (outcome === "failed") return { computed: 0n, source: "computed_from_usage" }
  const computed = perImageCostMicros(price, imageCount)
  return computed === null ? { computed: null, source: "unknown" } : { computed, source: "computed_from_usage" }
}

/** Validates an optional queue URL returned by fal against the configured base origin (SSRF guard). */
function sameOriginQueueUrl(raw: unknown, expectedOrigin: string): string | null {
  if (typeof raw !== "string") return null
  try {
    const parsed = new URL(raw)
    if (parsed.origin !== expectedOrigin) return null
    if (!parsed.pathname.includes("/requests/")) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function buildFalPayload(config: Pick<FalConfig, "model" | "fashnMode" | "garmentPhotoType" | "preservePose" | "aspectRatio">, input: FalSubmitInput): Record<string, unknown> {
  if (config.model === FAL_FASHN_MODEL) {
    return {
      model_image: input.modelImageUrl,
      garment_image: input.clothImageUrl,
      category: mapCategoryToFashn(input.category),
      garment_photo_type: config.garmentPhotoType ?? "auto",
      mode: config.fashnMode ?? "balanced",
      // Hardcoded to 1 output image per request (never allow batch multiplication).
      num_samples: 1,
    }
  }
  return {
    person_image_url: input.modelImageUrl,
    clothing_image_url: input.clothImageUrl,
    preserve_pose: config.preservePose ?? true,
    aspect_ratio: config.aspectRatio ?? "3:4",
  }
}

export function createFalClient(config: FalConfig) {
  if (!isSupportedFalModel(config.model)) throw new Error(`Unsupported fal model: ${config.model}`)
  const base = (config.baseUrl ?? "https://queue.fal.run").replace(/\/+$/, "")
  const baseOrigin = new URL(base).origin
  const appBase = falQueueAppBase(config.model)
  const doFetch: FetchLike = config.fetch ?? fetch
  const timeoutMs = config.requestTimeoutMs ?? 30_000
  const headers = { Authorization: `Key ${config.apiKey}`, Accept: "application/json" }
  const requestUrls = new Map<string, { statusUrl: string; responseUrl: string }>()

  async function requestUrl(fullUrl: string, init: RequestInit): Promise<{ status: number; body: unknown } | { error: "timeout" | "network" }> {
    try {
      const response = await doFetch(fullUrl, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) })
      const text = await response.text()
      let body: unknown = null
      try { body = text ? JSON.parse(text) : null } catch { body = null }
      return { status: response.status, body }
    } catch (error) {
      const name = error instanceof Error ? error.name : ""
      return { error: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" }
    }
  }

  return {
    provider: "fal" as const,
    model: config.model,
    async submit(input: FalSubmitInput): Promise<SubmitOutcome> {
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.requestKey)) throw new Error("invalid request key")
      const payload = buildFalPayload(config, input)
      const response = await requestUrl(`${base}/${config.model}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if ("error" in response) return { kind: "unknown", code: response.error }
      if (response.status >= 200 && response.status < 300) {
        const id = isRecord(response.body) ? response.body.request_id : undefined
        if (typeof id !== "string" || id.length === 0 || id.length > 200) return { kind: "unknown", code: "bad_response" }
        const statusUrl = isRecord(response.body) ? sameOriginQueueUrl(response.body.status_url, baseOrigin) : null
        const responseUrl = isRecord(response.body) ? sameOriginQueueUrl(response.body.response_url, baseOrigin) : null
        if (statusUrl && responseUrl) {
          if (requestUrls.size >= 100) requestUrls.clear()
          requestUrls.set(id, { statusUrl, responseUrl })
        }
        return { kind: "accepted", requestId: id }
      }
      const code = errorCodes[response.status] ?? "unexpected_status"
      if (response.status === 429 || response.status >= 500) return { kind: "retryable", httpStatus: response.status, code }
      return { kind: "rejected", httpStatus: response.status, code }
    },
    async poll(requestId: string): Promise<PollOutcome> {
      const id = encodeURIComponent(requestId)
      const cached = requestUrls.get(requestId)
      const statusUrl = cached?.statusUrl ?? `${base}/${appBase}/requests/${id}/status`
      const responseUrl = cached?.responseUrl ?? `${base}/${appBase}/requests/${id}`

      const status = await requestUrl(statusUrl, { method: "GET", headers })
      if ("error" in status) return { kind: "error", code: status.error }
      if (status.status === 404) return { kind: "not_found" }
      if (status.status === 422) return { kind: "failed", metrics: {} }
      if (status.status !== 200 || !isRecord(status.body)) return { kind: "error", code: errorCodes[status.status] ?? "bad_response" }

      const state = status.body.status
      if (state === "IN_QUEUE") return { kind: "pending", status: "QUEUED" }
      if (state === "IN_PROGRESS") return { kind: "pending", status: "PROCESSING" }
      if (state === "FAILED" || state === "CANCELLED") {
        requestUrls.delete(requestId)
        return { kind: "failed", metrics: {} }
      }
      if (state !== "COMPLETED") return { kind: "error", code: "bad_response" }

      const result = await requestUrl(responseUrl, { method: "GET", headers })
      if ("error" in result) return { kind: "error", code: result.error }
      if (result.status === 422) {
        requestUrls.delete(requestId)
        return { kind: "failed", metrics: {} }
      }
      if (result.status !== 200) return { kind: "error", code: errorCodes[result.status] ?? "bad_response" }
      requestUrls.delete(requestId)
      const parsed = parseFalResult(result.body)
      return parsed ? { kind: "completed", result: parsed.result } : { kind: "error", code: "bad_response" }
    },
    async download(url: string, maxBytes: number): Promise<Uint8Array> {
      if (!isAllowedFalOutputUrl(url)) throw new Error("output_host_not_allowed")
      const response = await doFetch(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs) })
      if (response.status !== 200 || !response.body) throw new Error("output_download_failed")
      const declared = Number(response.headers.get("content-length") ?? "0")
      if (declared > maxBytes) throw new Error("output_size_invalid")
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > maxBytes) { await reader.cancel(); throw new Error("output_size_invalid") }
        chunks.push(value)
      }
      const out = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength }
      return out
    },
  }
}
export type FalClient = ReturnType<typeof createFalClient>
