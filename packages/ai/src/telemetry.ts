/**
 * Langfuse telemetry via its documented OTLP/HTTP endpoint (JSON encoding):
 *   POST {LANGFUSE_BASE_URL}/api/public/otel/v1/traces
 *   Authorization: Basic base64(public:secret), x-langfuse-ingestion-version: 4
 * Why not the SDK span processor: Langfuse does not deduplicate re-sent spans and
 * the SDK cannot choose span ids or report per-batch delivery. Here every span is
 * complete and immutable, has a deterministic id, is stored in a durable outbox
 * and is marked sent only on a 2xx. A request with unknown delivery is never
 * resent automatically. The database ledger remains the cost source of truth.
 */
import { createHash, createHmac } from "node:crypto"
import type { FetchLike } from "./segmind.js"

export function pseudonymizeUser(userId: string, key: string): string {
  if (key.length < 32) throw new Error("pseudonym key too short")
  return "u_" + createHmac("sha256", key).update(userId).digest("hex").slice(0, 32)
}

export function traceIdForJob(jobId: string): string {
  const hex = jobId.replace(/-/g, "").toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error("invalid job id")
  return hex
}

export function spanIdFor(eventKey: string): string {
  return createHash("sha256").update(eventKey).digest("hex").slice(0, 16)
}

export type AttributeValue = string | number | boolean
/** One finished span, as stored in the outbox. Only sanitized, allow-listed data. */
export interface SpanRecord {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startMs: number
  endMs: number
  error?: boolean
  attributes: Record<string, AttributeValue>
}

const allowedKeys = new Set([
  "langfuse.trace.name", "langfuse.user.id", "langfuse.session.id", "langfuse.environment", "langfuse.release", "langfuse.version",
  "langfuse.observation.type", "langfuse.observation.level", "langfuse.observation.status_message",
  "langfuse.observation.model.name", "langfuse.observation.usage_details", "langfuse.observation.cost_details",
  "langfuse.observation.input", "langfuse.observation.output",
])
const allowedMetadata = /^langfuse\.(trace|observation)\.metadata\.[a-z][a-z0-9_]{0,40}$/

const forbidden: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,          // e-mail
  /\b(sk|pk)-lf-[A-Za-z0-9-]+/,                               // Langfuse keys
  /\bsk-ant-[A-Za-z0-9_-]+/,                                  // Anthropic keys
  /\bSG_[0-9a-fA-F]{8,}/,                                     // Segmind keys
  /\bAIza[0-9A-Za-z_-]{20,}/,                                 // Google API keys
  /[?&](token|signature|sig|x-amz-signature|key|apikey|api_key)=/i, // signed URLs / keys in query
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/i,
]

/** Drops keys outside the allow-list and refuses values that look sensitive. */
export function sanitizeAttributes(input: Record<string, AttributeValue>): Record<string, AttributeValue> {
  const out: Record<string, AttributeValue> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key) && !allowedMetadata.test(key)) continue
    if (typeof value === "string") {
      if (value.length > 2000 || forbidden.some((re) => re.test(value))) continue
    } else if (typeof value === "number" && !Number.isFinite(value)) continue
    out[key] = value
  }
  return out
}

/** USD decimal for Langfuse cost_details, derived exactly from micros. */
export function microsToUsdNumber(micros: bigint): number {
  return Number(micros) / 1_000_000
}

function toAnyValue(value: AttributeValue) {
  if (typeof value === "string") return { stringValue: value }
  if (typeof value === "boolean") return { boolValue: value }
  return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }
}

export function buildOtlpPayload(spans: readonly SpanRecord[], service: { name: string; version: string }) {
  return {
    resourceSpans: [{
      resource: { attributes: [
        { key: "service.name", value: { stringValue: service.name } },
        { key: "service.version", value: { stringValue: service.version } },
      ] },
      scopeSpans: [{
        scope: { name: "stylai-motor", version: service.version },
        spans: spans.map((s) => ({
          traceId: s.traceId,
          spanId: s.spanId,
          ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
          name: s.name,
          kind: 1,
          startTimeUnixNano: (BigInt(Math.trunc(s.startMs)) * 1_000_000n).toString(),
          endTimeUnixNano: (BigInt(Math.trunc(Math.max(s.endMs, s.startMs))) * 1_000_000n).toString(),
          attributes: Object.entries(sanitizeAttributes(s.attributes)).map(([key, value]) => ({ key, value: toAnyValue(value) })),
          status: { code: s.error ? 2 : 1 },
        })),
      }],
    }],
  }
}

export interface LangfuseConfig { publicKey: string; secretKey: string; baseUrl: string; environment: string }

export function readLangfuseConfig(env: Record<string, string | undefined>): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY, secretKey = env.LANGFUSE_SECRET_KEY, baseUrl = env.LANGFUSE_BASE_URL
  if (!publicKey || !secretKey || !baseUrl) return null
  const url = new URL(baseUrl)
  if (url.protocol !== "https:" && !(url.hostname === "127.0.0.1" || url.hostname === "localhost")) throw new Error("LANGFUSE_BASE_URL must be https")
  return { publicKey, secretKey, baseUrl: url.origin, environment: env.LANGFUSE_TRACING_ENVIRONMENT ?? "development" }
}

/** sent: 2xx · retry: definitely not delivered · dead: rejected payload · unknown: may have been delivered */
export type ExportOutcome = "sent" | "retry" | "dead" | "unknown"

export function createOtlpExporter(config: LangfuseConfig, options: { fetch?: FetchLike; timeoutMs?: number; service?: { name: string; version: string } } = {}) {
  const doFetch: FetchLike = options.fetch ?? fetch
  const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64")
  const service = options.service ?? { name: "stylai-worker", version: "0.1.0" }
  return async function exportSpans(spans: readonly SpanRecord[]): Promise<ExportOutcome> {
    if (spans.length === 0) return "sent"
    let response: Response
    try {
      response = await doFetch(`${config.baseUrl}/api/public/otel/v1/traces`, {
        method: "POST",
        redirect: "error",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", "x-langfuse-ingestion-version": "4" },
        body: JSON.stringify(buildOtlpPayload(spans, service)),
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      })
    } catch (error) {
      const cause = error instanceof Error && error.cause && typeof error.cause === "object" && "code" in error.cause ? String(error.cause.code) : ""
      // Connection never established: safe to retry. Anything else may have reached the server.
      return ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET_BEFORE_SEND"].includes(cause) ? "retry" : "unknown"
    }
    await response.body?.cancel().catch(() => undefined)
    if (response.status >= 200 && response.status < 300) return "sent"
    if (response.status === 429 || response.status === 503) return "retry"
    if (response.status >= 500) return "unknown"
    return "dead"
  }
}
export type OtlpExporter = ReturnType<typeof createOtlpExporter>
