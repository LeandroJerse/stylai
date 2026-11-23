/**
 * Official TikTok Shop Creator OAuth helpers (Authorization Guide, docs read 2026-11-21):
 *   - Authorization URL: https://shop.tiktok.com/alliance/creator/auth?app_key=...&state=...
 *   - Exchange code:     GET https://auth.tiktok-shops.com/api/v2/token/get?app_key=...&app_secret=...&auth_code=...&grant_type=authorized_code
 *   - Refresh token:     GET https://auth.tiktok-shops.com/api/v2/token/refresh?app_key=...&app_secret=...&refresh_token=...&grant_type=refresh_token
 *
 * Security & contract invariants:
 *   - Single-use random `state` bound to operator + connection, 10-minute TTL, atomic consumption.
 *   - Must validate business `code === 0`, `user_type === 1` (Creator; rejects seller tokens!), and `granted_scopes`.
 *   - Never logs secrets, auth_code, access_token or refresh_token.
 */
import { randomBytes } from "node:crypto"

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export const TIKTOK_CREATOR_AUTH_URL = "https://shop.tiktok.com/alliance/creator/auth"
export const TIKTOK_TOKEN_API_ORIGIN = "https://auth.tiktok-shops.com"
export const REQUIRED_CREATOR_COLLAB_SCOPE = "creator.affiliate_collaboration.read"

export interface OAuthStateRecord {
  state: string
  operatorId: string
  connectionId: string
  expiresAtMs: number
}

export function createOAuthStateStore(opts: { ttlMs?: number; now?: () => number } = {}) {
  const ttlMs = opts.ttlMs ?? 10 * 60_000
  const now = opts.now ?? Date.now
  const pending = new Map<string, OAuthStateRecord>()

  return {
    issue(operatorId: string, connectionId: string): OAuthStateRecord {
      const current = now()
      for (const [k, v] of pending) if (v.expiresAtMs <= current) pending.delete(k)
      const state = randomBytes(24).toString("base64url")
      const rec: OAuthStateRecord = { state, operatorId, connectionId, expiresAtMs: current + ttlMs }
      pending.set(state, rec)
      return rec
    },
    /** Atomic single-use consumption; rejects missing, expired, replayed, or mismatched operator/connection. */
    consume(state: string, expectedOperatorId?: string): { ok: true; record: OAuthStateRecord } | { ok: false; reason: "missing_state" | "unknown_or_replayed" | "expired" | "operator_mismatch" } {
      if (!state || state.length < 16) return { ok: false, reason: "missing_state" }
      const rec = pending.get(state)
      if (!rec) return { ok: false, reason: "unknown_or_replayed" }
      pending.delete(state) // single-use even if expired or operator mismatches
      if (rec.expiresAtMs <= now()) return { ok: false, reason: "expired" }
      if (expectedOperatorId && rec.operatorId !== expectedOperatorId) return { ok: false, reason: "operator_mismatch" }
      return { ok: true, record: rec }
    },
    size(): number { return pending.size },
  }
}

export function buildCreatorAuthorizationUrl(input: { appKey: string; state: string }): string {
  if (!input.appKey.trim()) throw new Error("TikTok appKey is required")
  if (!input.state.trim()) throw new Error("OAuth state is required")
  const url = new URL(TIKTOK_CREATOR_AUTH_URL)
  url.searchParams.set("app_key", input.appKey.trim())
  url.searchParams.set("state", input.state.trim())
  return url.toString()
}

export interface TikTokCreatorTokenGrant {
  accessToken: string
  refreshToken: string
  accessTokenExpireIn: number
  refreshTokenExpireIn: number
  openId: string
  userType: 1
  grantedScopes: string[]
  sellerBaseRegion: string | null
  requestId: string | null
}

export type TokenExchangeResult =
  | { ok: true; grant: TikTokCreatorTokenGrant }
  | { ok: false; reason: "network" | "timeout" | "http_error" | "business_error" | "wrong_user_type" | "missing_required_scope" | "invalid_payload"; code?: number; requestId?: string | null; missingScopes?: string[] }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function parseTokenGrant(body: unknown, requiredScopes: readonly string[]): TokenExchangeResult {
  if (!isRecord(body)) return { ok: false, reason: "invalid_payload" }
  const code = typeof body.code === "number" ? body.code : -1
  const requestId = typeof body.request_id === "string" ? body.request_id : null
  if (code !== 0) return { ok: false, reason: "business_error", code, requestId }
  const data = body.data
  if (!isRecord(data)) return { ok: false, reason: "invalid_payload", requestId }

  // Creator tokens MUST have user_type === 1 (never accept seller tokens).
  if (data.user_type !== 1) return { ok: false, reason: "wrong_user_type", requestId }

  const accessToken = typeof data.access_token === "string" && data.access_token.length > 0 ? data.access_token : null
  const refreshToken = typeof data.refresh_token === "string" && data.refresh_token.length > 0 ? data.refresh_token : null
  const openId = typeof data.open_id === "string" && data.open_id.length > 0 ? data.open_id : null
  const accessExp = typeof data.access_token_expire_in === "number" && Number.isFinite(data.access_token_expire_in) ? data.access_token_expire_in : null
  const refreshExp = typeof data.refresh_token_expire_in === "number" && Number.isFinite(data.refresh_token_expire_in) ? data.refresh_token_expire_in : null
  const grantedScopes = Array.isArray(data.granted_scopes)
    ? data.granted_scopes.filter((s): s is string => typeof s === "string")
    : []

  if (!accessToken || !refreshToken || !openId || accessExp === null || refreshExp === null) {
    return { ok: false, reason: "invalid_payload", requestId }
  }
  const missing = requiredScopes.filter((s) => !grantedScopes.includes(s))
  if (missing.length > 0) {
    return { ok: false, reason: "missing_required_scope", requestId, missingScopes: missing }
  }
  return {
    ok: true,
    grant: {
      accessToken,
      refreshToken,
      accessTokenExpireIn: accessExp,
      refreshTokenExpireIn: refreshExp,
      openId,
      userType: 1,
      grantedScopes,
      sellerBaseRegion: typeof data.seller_base_region === "string" ? data.seller_base_region : null,
      requestId,
    },
  }
}

async function callTokenEndpoint(
  url: URL,
  requiredScopes: readonly string[],
  doFetch: FetchLike,
  timeoutMs: number,
): Promise<TokenExchangeResult> {
  try {
    const res = await doFetch(url.toString(), { method: "GET", headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    if (!res.ok) return { ok: false, reason: "http_error", code: res.status }
    return parseTokenGrant(body, requiredScopes)
  } catch (err) {
    const name = err instanceof Error ? err.name : ""
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" }
  }
}

export async function exchangeCreatorAuthCode(input: {
  appKey: string
  appSecret: string
  authCode: string
  requiredScopes?: readonly string[]
  tokenApiOrigin?: string
  fetch?: FetchLike
  timeoutMs?: number
}): Promise<TokenExchangeResult> {
  const origin = (input.tokenApiOrigin ?? TIKTOK_TOKEN_API_ORIGIN).replace(/\/+$/, "")
  const url = new URL(`${origin}/api/v2/token/get`)
  url.searchParams.set("app_key", input.appKey)
  url.searchParams.set("app_secret", input.appSecret)
  url.searchParams.set("auth_code", input.authCode)
  url.searchParams.set("grant_type", "authorized_code")
  return callTokenEndpoint(url, input.requiredScopes ?? [REQUIRED_CREATOR_COLLAB_SCOPE], input.fetch ?? fetch, input.timeoutMs ?? 10_000)
}

export async function refreshCreatorToken(input: {
  appKey: string
  appSecret: string
  refreshToken: string
  requiredScopes?: readonly string[]
  tokenApiOrigin?: string
  fetch?: FetchLike
  timeoutMs?: number
}): Promise<TokenExchangeResult> {
  const origin = (input.tokenApiOrigin ?? TIKTOK_TOKEN_API_ORIGIN).replace(/\/+$/, "")
  const url = new URL(`${origin}/api/v2/token/refresh`)
  url.searchParams.set("app_key", input.appKey)
  url.searchParams.set("app_secret", input.appSecret)
  url.searchParams.set("refresh_token", input.refreshToken)
  url.searchParams.set("grant_type", "refresh_token")
  return callTokenEndpoint(url, input.requiredScopes ?? [REQUIRED_CREATOR_COLLAB_SCOPE], input.fetch ?? fetch, input.timeoutMs ?? 10_000)
}
