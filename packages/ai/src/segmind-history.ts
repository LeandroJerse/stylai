/**
 * Segmind's own record of one request (GET request-history, read-only, free: credits were equal before and after on
 * 2026-11-24). Used to reconcile a paid call whose outcome we never learned. It only answers when there is exactly one
 * possible row; anything else is "ambiguous" or "unavailable" and waits for the operator. The rows carry the whole
 * request (prompt and images): they are parsed for outcome fields only, and never kept or logged.
 */
import { z } from "zod"
import { imageLimits, validateOutputImage, type ImageInfo } from "./image.js"
import { isAllowedOutputUrl, type FetchLike } from "./segmind.js"

export const SEGMIND_HISTORY_ORIGIN = "https://api.spotprod.segmind.com"
const PER_PAGE = 100
const MAX_PAGES = 3
/** Rows before this many days are only the control that the key can read this workspace's history. */
const CONTROL_DAYS = 6
/** The gateway row is created after our upload starts; clocks may differ a little. */
const EARLY_MS = 60_000

const row = z.object({
  request_id: z.string().min(8).max(200), model_name: z.string(), model_created: z.string(), model_status: z.string(),
  response_code: z.number().int().nullable(), credits_deduction: z.number().nonnegative().nullable(), generation_url: z.string().nullish(), error_family: z.string().max(64).nullish(),
})
const page = z.object({ data: z.array(z.unknown()), has_next: z.boolean().optional(), total_pages: z.number().optional() })

export interface HistoryQuery {
  model: string
  startedAt: Date
  endAt: Date
  /** Exact id, when the provider had already answered with one. */
  requestId: string | null
  /** Ids that belong to other calls of ours. */
  taken: readonly string[]
}
export type HistoryAnswer =
  | { kind: "found"; requestId: string; httpStatus: number; costMicros: bigint; hasOutput: boolean; /** Download address, only when it is a Segmind one; never stored or logged. */ outputUrl: string | null; errorFamily: string | null }
  | { kind: "pending" | "absent" | "ambiguous" }
  | { kind: "unavailable"; code: string }

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export function createSegmindHistory(config: { apiKey: string; fetch?: FetchLike; timeoutMs?: number }) {
  const http: FetchLike = config.fetch ?? fetch
  async function read(path: string): Promise<unknown> {
    const response = await http(`${SEGMIND_HISTORY_ORIGIN}${path}`, { method: "GET", headers: { "x-api-key": config.apiKey, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(config.timeoutMs ?? 20_000) })
    if (!response.ok) throw new Error(`http_${response.status}`)
    return await response.json()
  }
  return {
    /** The image already paid for: no key sent, no redirect, size capped, checked by content. Null = not available now. */
    async output(url: string): Promise<{ bytes: Uint8Array; info: ImageInfo } | null> {
      if (!isAllowedOutputUrl(url)) return null
      try {
        const response = await http(url, { method: "GET", redirect: "error", signal: AbortSignal.timeout(config.timeoutMs ?? 30_000) })
        if (response.status !== 200 || !response.body || Number(response.headers.get("content-length") ?? "0") > imageLimits.maxBytes) return null
        const reader = response.body.getReader(), chunks: Uint8Array[] = []
        let size = 0
        try {
          for (;;) {
            const part = await reader.read()
            if (part.done) break
            size += part.value.length
            if (size > imageLimits.maxBytes) return null
            chunks.push(part.value)
          }
        } finally { await reader.cancel().catch(() => undefined) }
        const bytes = new Uint8Array(Buffer.concat(chunks))
        return { bytes, info: validateOutputImage(bytes) }
      } catch { return null }
    },
    async find(q: HistoryQuery): Promise<HistoryAnswer> {
      const start = q.startedAt.getTime(), end = q.endAt.getTime()
      const rows: z.infer<typeof row>[] = []
      let covered = false
      try {
        for (let n = 1; n <= MAX_PAGES && !covered; n++) {
          const params = new URLSearchParams({ model_name: q.model, from_date: day(start - CONTROL_DAYS * 86_400_000), to_date: day(end + 86_400_000), per_page: String(PER_PAGE), page: String(n), sort_by: "model_created", sort_order: "desc" })
          const parsed = page.safeParse(await read(`/inference-request/request-history?${params}`))
          if (!parsed.success) return { kind: "unavailable", code: "bad_response" }
          for (const raw of parsed.data.data) {
            const item = row.safeParse(raw)
            // A row we cannot read could be ours: never guess around it.
            if (!item.success || !Number.isFinite(Date.parse(item.data.model_created))) return { kind: "unavailable", code: "bad_row" }
            rows.push(item.data)
          }
          covered = parsed.data.data.length < PER_PAGE || parsed.data.has_next === false || Date.parse(rows.at(-1)!.model_created) < start - EARLY_MS
        }
      } catch (error) {
        return { kind: "unavailable", code: error instanceof Error && /^http_\d{3}$/.test(error.message) ? error.message : "network" }
      }
      if (!covered) return { kind: "unavailable", code: "too_many_rows" }
      // An empty history proves nothing about this key: it must at least show something of this model.
      if (!rows.length) return { kind: "unavailable", code: "no_control" }
      // One request appears once per output, each row with its full cost.
      const unique = [...new Map(rows.filter((r) => r.model_name === q.model).map((r) => [r.request_id, r])).values()]
      const mine = q.requestId !== null
        ? unique.filter((r) => r.request_id === q.requestId)
        : unique.filter((r) => { const at = Date.parse(r.model_created); return at >= start - EARLY_MS && at <= end && !q.taken.includes(r.request_id) })
      if (mine.length > 1) return { kind: "ambiguous" }
      const hit = mine[0]
      if (!hit) return { kind: "absent" }
      if (!["COMPLETED", "FAILED"].includes(hit.model_status) || hit.response_code === null || hit.credits_deduction === null) return { kind: "pending" }
      return {
        kind: "found", requestId: hit.request_id, httpStatus: hit.response_code, costMicros: BigInt(Math.round(hit.credits_deduction * 1_000_000)),
        hasOutput: Boolean(hit.generation_url), outputUrl: hit.generation_url && isAllowedOutputUrl(hit.generation_url) ? hit.generation_url : null, errorFamily: hit.error_family && /^[a-z0-9_]{1,64}$/.test(hit.error_family) ? hit.error_family : null,
      }
    },
  }
}
export type SegmindHistory = ReturnType<typeof createSegmindHistory>
