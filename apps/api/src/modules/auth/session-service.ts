/**
 * App sessions: Supabase tokens live encrypted in private.app_sessions; the
 * browser holds the access token in memory and an opaque HttpOnly cookie.
 * A request is authenticated only when the JWT verifies AND its Supabase
 * session maps to an active, unrevoked app session of the same user.
 */
import type { FastifyRequest } from "fastify"
import { z } from "zod"
import type { PrivateDatabase } from "@stylai/supabase"
import type { AuthProvider, ProviderSession } from "./provider.js"
import { cookieHash, newCookieValue, openTokens, sealTokens, type SessionKeys } from "./session-crypto.js"

export interface Actor { userId: string; sessionId: string; email: string; providers: string[] }
export interface SessionUser { id: string; name: string; email: string; emailVerified: boolean; avatarUrl: null; providers: string[]; createdAt: string | null }
export interface IssuedSession { cookie: string; accessToken: string; user: SessionUser }

export type RefreshOutcome = { kind: "ok"; accessToken: string; user: SessionUser } | { kind: "invalid" } | { kind: "unavailable" }

const SESSION_TTL_SECONDS = 30 * 24 * 3600
const tokensSchema = z.object({ a: z.string().min(10), r: z.string().min(1) })
const refreshRow = z.discriminatedUnion("state", [
  z.object({ state: z.literal("busy") }),
  z.object({ state: z.enum(["fresh", "leased"]), id: z.string().uuid(), user_id: z.string().uuid(), version: z.union([z.number(), z.string()]), ciphertext: z.string(), key_version: z.string() }),
])
const profileRow = z.object({ name: z.string(), created_at: z.string() })

export interface SessionServiceDeps {
  db: PrivateDatabase<"api">
  provider: AuthProvider
  keys: SessionKeys
  sleep?: (ms: number) => Promise<void>
}

export function createSessionService(deps: SessionServiceDeps) {
  const { db, provider, keys } = deps
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const seal = (s: ProviderSession) => sealTokens(keys, JSON.stringify({ a: s.accessToken, r: s.refreshToken }))
  const open = (ciphertext: string, version: string) => {
    const plain = openTokens(keys, ciphertext, version)
    if (!plain) return null
    const parsed = tokensSchema.safeParse(JSON.parse(plain))
    return parsed.success ? parsed.data : null
  }

  async function userFor(actor: Pick<Actor, "userId" | "email" | "providers">): Promise<SessionUser> {
    const profile = profileRow.safeParse(await db.call("read_profile", actor.userId))
    return {
      id: actor.userId, email: actor.email, name: profile.success ? profile.data.name : "",
      // A session only exists after Supabase confirmed the address.
      emailVerified: true, avatarUrl: null,
      providers: actor.providers.length ? actor.providers : ["password"],
      createdAt: profile.success ? profile.data.created_at : null,
    }
  }

  return {
    /** Stores a new provider session in the vault and returns the browser half. */
    async issue(session: ProviderSession): Promise<IssuedSession> {
      const verified = await provider.verifyAccessToken(session.accessToken)
      if (!verified || verified.userId !== session.user.id) throw new Error("provider_token_unverifiable")
      const cookie = newCookieValue()
      await db.call("create_app_session", verified.userId, verified.sessionId, cookieHash(cookie), seal(session), keys.version,
        Math.max(30, Math.min(session.expiresIn, 3600)), SESSION_TTL_SECONDS)
      return { cookie, accessToken: session.accessToken, user: await userFor(verified) }
    },

    /** Coordinated across tabs/instances by the vault lease + version. */
    async refresh(cookie: string): Promise<RefreshOutcome> {
      const hash = cookieHash(cookie)
      for (let attempt = 0; attempt < 12; attempt++) {
        const raw = await db.call("begin_session_refresh", hash)
        if (raw === null) return { kind: "invalid" }
        const row = refreshRow.parse(raw)
        if (row.state === "busy") { await sleep(250); continue }
        const tokens = open(row.ciphertext, row.key_version)
        if (!tokens) { await db.call("revoke_app_session", hash); return { kind: "invalid" } }
        if (row.state === "fresh") {
          const verified = await provider.verifyAccessToken(tokens.a)
          if (verified && verified.userId === row.user_id) return { kind: "ok", accessToken: tokens.a, user: await userFor(verified) }
          // Fresh by our clock but rejected by the verifier (revoked upstream): end the session.
          await db.call("revoke_app_session", hash)
          return { kind: "invalid" }
        }
        if (row.state === "leased") {
          const result = await provider.refresh(tokens.r)
          const version = String(row.version)
          if (result.kind === "unavailable") { await db.call("release_session_refresh", row.id, version); return { kind: "unavailable" } }
          if (result.kind === "invalid" || result.session.user.id !== row.user_id) { await db.call("revoke_app_session", hash); return { kind: "invalid" } }
          const saved = await db.call("complete_session_refresh", row.id, version, seal(result.session), keys.version,
            Math.max(30, Math.min(result.session.expiresIn, 3600)))
          if (!saved) return { kind: "invalid" }
          const verified = await provider.verifyAccessToken(result.session.accessToken)
          if (!verified) return { kind: "invalid" }
          return { kind: "ok", accessToken: result.session.accessToken, user: await userFor(verified) }
        }
        await sleep(250)
      }
      return { kind: "unavailable" }
    },

    /** Local revocation is authoritative; ending the Supabase session is best effort. */
    async revoke(cookie: string): Promise<void> {
      const raw = await db.call("revoke_app_session", cookieHash(cookie))
      const row = z.object({ ciphertext: z.string(), key_version: z.string() }).safeParse(raw)
      if (!row.success) return
      const tokens = open(row.data.ciphertext, row.data.key_version)
      if (tokens) await provider.signOut(tokens.a)
    },

    async resolve(request: FastifyRequest): Promise<Actor | null> {
      const header = request.headers.authorization
      if (typeof header !== "string" || !header.startsWith("Bearer ")) return null
      const verified = await provider.verifyAccessToken(header.slice(7).trim())
      if (!verified) return null
      return (await db.call("check_app_session", verified.userId, verified.sessionId)) ? verified : null
    },

    userFor,
  }
}
export type SessionService = ReturnType<typeof createSessionService>
