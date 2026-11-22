/**
 * Segmind Try-On Diffusion, async v2 flow (docs read 2026-11-20):
 *   POST {base}/v2/try-on-diffusion          -> { request_id, status_url, response_url }
 *   GET  {base}/v2/requests/{id}/status      -> { status: QUEUED|PROCESSING|COMPLETED|FAILED }
 *   GET  {base}/v2/requests/{id}             -> result (FAILED served as 422; unknown id 404)
 * Auth header `x-api-key`. Inputs `model_image` and `cloth_image` are URLs.
 * `X-Request-ID` deduplication is documented only on the JS SDK page; we send a
 * stable key but never rely on it to authorize a second dispatch.
 * Outputs are hosted publicly by Segmind: always copy to private storage.
 */
import { gpuCostMicros, type GpuSecondPrice } from "./pricing.js"

/** Minimal fetch signature (lets tests inject an HTTP-boundary double). */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export type SegmindCategory = "Upper body" | "Lower body" | "Dress"

export interface SegmindPreset { numInferenceSteps: number; guidanceScale: number; seed: number }
/** Documented defaults (steps 25, guidance 2). Not yet evaluated for quality. */
export const defaultSegmindPreset: SegmindPreset = { numInferenceSteps: 25, guidanceScale: 2, seed: -1 }

export interface SegmindConfig {
  apiKey: string
  baseUrl?: string
  model?: string
  fetch?: FetchLike
  requestTimeoutMs?: number
}

export type SubmitOutcome =
  | { kind: "accepted"; requestId: string }
  | { kind: "rejected"; httpStatus: number; code: SegmindErrorCode }   // provider refused before running: not billed
  | { kind: "retryable"; httpStatus: number; code: SegmindErrorCode }  // 429/5xx with a response
  | { kind: "unknown"; code: "timeout" | "network" | "bad_response" }  // may have been accepted

export type SegmindErrorCode = "invalid_request" | "unauthorized" | "forbidden" | "not_found" | "insufficient_credits"
  | "rate_limited" | "provider_error" | "unexpected_status"

export type PollOutcome =
  | { kind: "pending"; status: "QUEUED" | "PROCESSING" }
  | { kind: "completed"; result: SegmindResult }
  | { kind: "failed"; metrics: SegmindMetrics }
  | { kind: "not_found" }
  | { kind: "error"; code: "timeout" | "network" | "bad_response" | SegmindErrorCode }

export interface SegmindMetrics { cost?: number; remainingCredits?: number; inferenceTime?: number; queueTime?: number; totalTime?: number }
export interface SegmindResult { image: { kind: "url"; url: string } | { kind: "base64"; data: string }; metrics: SegmindMetrics }

const errorCodes: Record<number, SegmindErrorCode> = {
  400: "invalid_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 406: "insufficient_credits",
  429: "rate_limited", 500: "provider_error", 502: "provider_error", 504: "provider_error",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function parseMetrics(value: unknown): SegmindMetrics {
  if (!isRecord(value)) return {}
  return {
    cost: num(value.cost), remainingCredits: num(value.remaining_credits), inferenceTime: num(value.inference_time),
    queueTime: num(value.queue_time), totalTime: num(value.total_time),
  }
}

/** Result shape for try-on is not specified per model; accept the documented image-model shapes only. */
export function parseResult(body: unknown): SegmindResult | null {
  if (!isRecord(body)) return null
  const metrics = parseMetrics(body.metrics)
  if (Array.isArray(body.images) && isRecord(body.images[0]) && typeof body.images[0].url === "string") {
    return { image: { kind: "url", url: body.images[0].url }, metrics }
  }
  const output = Array.isArray(body.output) ? body.output[0] : body.output
  if (typeof output === "string") {
    if (/^https:\/\//.test(output)) return { image: { kind: "url", url: output }, metrics }
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(output) && output.length > 64) return { image: { kind: "base64", data: output }, metrics }
  }
  return null
}

/** Only Segmind-owned HTTPS hosts may be fetched as outputs (SSRF guard). */
export function isAllowedOutputUrl(raw: string): boolean {
  let url: URL
  try { url = new URL(raw) } catch { return false }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false
  return url.hostname === "segmind.com" || url.hostname.endsWith(".segmind.com")
}

export function segmindCost(price: GpuSecondPrice, metrics: SegmindMetrics): { computed: bigint | null; source: "computed_from_usage" | "unknown" } {
  if (metrics.inferenceTime === undefined) return { computed: null, source: "unknown" }
  return { computed: gpuCostMicros(price, metrics.inferenceTime), source: "computed_from_usage" }
}

export function createSegmindClient(config: SegmindConfig) {
  const base = (config.baseUrl ?? "https://api.segmind.com").replace(/\/+$/, "")
  const model = config.model ?? "try-on-diffusion"
  const doFetch: FetchLike = config.fetch ?? fetch
  const timeoutMs = config.requestTimeoutMs ?? 30_000
  const headers = { "x-api-key": config.apiKey, Accept: "application/json" }

  async function request(path: string, init: RequestInit): Promise<{ status: number; body: unknown } | { error: "timeout" | "network" }> {
    try {
      const response = await doFetch(base + path, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) })
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
    model,
    async submit(input: { requestKey: string; modelImageUrl: string; clothImageUrl: string; category: SegmindCategory; preset: SegmindPreset }): Promise<SubmitOutcome> {
      if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.requestKey)) throw new Error("invalid request key")
      const response = await request(`/v2/${model}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "X-Request-ID": input.requestKey },
        body: JSON.stringify({
          model_image: input.modelImageUrl, cloth_image: input.clothImageUrl, category: input.category,
          num_inference_steps: input.preset.numInferenceSteps, guidance_scale: input.preset.guidanceScale, seed: input.preset.seed, base64: false,
        }),
      })
      if ("error" in response) return { kind: "unknown", code: response.error }
      if (response.status >= 200 && response.status < 300) {
        const id = isRecord(response.body) ? response.body.request_id : undefined
        return typeof id === "string" && id.length > 0 && id.length <= 200 ? { kind: "accepted", requestId: id } : { kind: "unknown", code: "bad_response" }
      }
      const code = errorCodes[response.status] ?? "unexpected_status"
      if (response.status === 429 || response.status >= 500) return { kind: "retryable", httpStatus: response.status, code }
      return { kind: "rejected", httpStatus: response.status, code }
    },
    async poll(requestId: string): Promise<PollOutcome> {
      const id = encodeURIComponent(requestId)
      const status = await request(`/v2/requests/${id}/status`, { method: "GET", headers })
      if ("error" in status) return { kind: "error", code: status.error }
      if (status.status === 404) return { kind: "not_found" }
      if (status.status === 422) return { kind: "failed", metrics: parseMetrics(isRecord(status.body) ? status.body.metrics : undefined) }
      if (status.status !== 200 || !isRecord(status.body)) return { kind: "error", code: errorCodes[status.status] ?? "bad_response" }
      const state = status.body.status
      if (state === "QUEUED" || state === "PROCESSING") return { kind: "pending", status: state }
      if (state === "FAILED") return { kind: "failed", metrics: parseMetrics(status.body.metrics) }
      if (state !== "COMPLETED") return { kind: "error", code: "bad_response" }
      const result = await request(`/v2/requests/${id}`, { method: "GET", headers })
      if ("error" in result) return { kind: "error", code: result.error }
      if (result.status === 422) return { kind: "failed", metrics: parseMetrics(isRecord(result.body) ? result.body.metrics : undefined) }
      if (result.status !== 200) return { kind: "error", code: errorCodes[result.status] ?? "bad_response" }
      const parsed = parseResult(result.body)
      return parsed ? { kind: "completed", result: parsed } : { kind: "error", code: "bad_response" }
    },
    /** Downloads the output from an allowed host with a byte cap. */
    async download(url: string, maxBytes: number): Promise<Uint8Array> {
      if (!isAllowedOutputUrl(url)) throw new Error("output_host_not_allowed")
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
    /** Free account check (documented GET /v1/get-user-credits). Returns presence only. */
    async credits(): Promise<{ ok: true; credits: number; freeCredits: number } | { ok: false; code: string }> {
      const response = await request("/v1/get-user-credits", { method: "GET", headers })
      if ("error" in response) return { ok: false, code: response.error }
      if (response.status !== 200 || !isRecord(response.body)) return { ok: false, code: errorCodes[response.status] ?? "bad_response" }
      return { ok: true, credits: num(response.body.credits) ?? 0, freeCredits: num(response.body["free-credits"]) ?? 0 }
    },
  }
}
export type SegmindClient = ReturnType<typeof createSegmindClient>
