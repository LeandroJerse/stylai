/**
 * Official TikTok Shop OpenAPI HMAC-SHA256 request signing (v202309+ / 202405).
 * Reference: TikTok Shop Partner Center "Sign your API request" & "Common Parameters":
 *   1. Filter query parameters excluding `sign` and `access_token`.
 *   2. Sort remaining parameter keys lexicographically (ASCII code point order) and concatenate `key + value`.
 *   3. Prepend the API request path (e.g. `/affiliate_creator/202405/open_collaborations/products/search`).
 *   4. Append the exact raw body string when present and Content-Type is not `multipart/form-data`.
 *   5. Wrap the message with `appSecret` on both ends: `${appSecret}${base}${appSecret}`.
 *   6. Compute lowercase hex HMAC-SHA256 using `appSecret` as key.
 * Timestamp window documented by TikTok Shop: 5 minutes past to 30 seconds future.
 */
import { createHmac } from "node:crypto"

export interface TikTokSignInput {
  /** Path starting with `/` (no host or query string). */
  path: string
  /** Query parameters (excluding `sign` and `access_token`; duplicates/undefined omitted). */
  query: Record<string, string | number | undefined>
  /** Exact raw serialized JSON body sent over the wire (omit for GET or multipart). */
  rawBody?: string
  /** Request Content-Type header (multipart/form-data bodies are excluded from signature). */
  contentType?: string
}

export function buildTikTokSignBaseString(input: TikTokSignInput): string {
  if (!input.path.startsWith("/")) throw new Error("TikTok API path must start with '/'")
  const keys = Object.keys(input.query)
    .filter((k) => k !== "sign" && k !== "access_token" && input.query[k] !== undefined)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const sortedParams = keys.map((k) => `${k}${String(input.query[k])}`).join("")
  const isMultipart = typeof input.contentType === "string" && input.contentType.toLowerCase().startsWith("multipart/form-data")
  const bodyPart = !isMultipart && input.rawBody ? input.rawBody : ""
  return `${input.path}${sortedParams}${bodyPart}`
}

export function signTikTokRequest(input: TikTokSignInput, appSecret: string): string {
  if (!appSecret) throw new Error("TikTok appSecret is required for signing")
  const base = buildTikTokSignBaseString(input)
  const wrapped = `${appSecret}${base}${appSecret}`
  return createHmac("sha256", appSecret).update(wrapped, "utf8").digest("hex")
}

/** Validates TikTok timestamp in epoch seconds against documented window (-300s .. +30s). */
export function isValidTikTokTimestamp(timestampSec: number, nowMs = Date.now()): boolean {
  if (!Number.isInteger(timestampSec) || timestampSec <= 0) return false
  const nowSec = Math.floor(nowMs / 1000)
  return timestampSec >= nowSec - 300 && timestampSec <= nowSec + 30
}
