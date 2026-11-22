/**
 * Supabase Auth adapter. Supabase stays the authority for passwords, email
 * confirmation and JWT signing; the API keeps provider tokens server-side.
 * A fresh client per user operation: supabase-js keeps the last session in
 * memory even with persistSession=false, and that must never be shared.
 */
import { createClient, type Session, type SupabaseClient, type User } from "@supabase/supabase-js"
import type { SupabaseConfig } from "@stylai/supabase"

export interface ProviderUser { id: string; email: string; providers: string[]; createdAt: string | null }
export interface ProviderSession { accessToken: string; refreshToken: string; expiresIn: number; user: ProviderUser }
export interface VerifiedToken { userId: string; sessionId: string; email: string; providers: string[] }

export type SignInResult = { kind: "ok"; session: ProviderSession } | { kind: "invalid" } | { kind: "unverified" } | { kind: "rate_limited" } | { kind: "unavailable" }
export type RefreshResult = { kind: "ok"; session: ProviderSession } | { kind: "invalid" } | { kind: "unavailable" }

export interface AuthProvider {
  signUp(input: { email: string; password: string; name: string; redirectTo: string }): Promise<"ok" | "weak_password" | "rate_limited" | "unavailable">
  signIn(email: string, password: string): Promise<SignInResult>
  verifyEmail(tokenHash: string): Promise<SignInResult>
  resendConfirmation(email: string, redirectTo: string): Promise<void>
  refresh(refreshToken: string): Promise<RefreshResult>
  signOut(accessToken: string): Promise<void>
  /** Signature (JWKS), expiry and required claims. Null when not a valid access token. */
  verifyAccessToken(token: string): Promise<VerifiedToken | null>
}

const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function providersOf(meta: unknown): string[] {
  const list = meta && typeof meta === "object" && "providers" in meta && Array.isArray(meta.providers) ? meta.providers : []
  return list.filter((p): p is string => typeof p === "string").map((p) => (p === "email" ? "password" : p))
}

function toSession(session: Session | null, user: User | null): ProviderSession | null {
  if (!session || !user || !user.email) return null
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in,
    user: { id: user.id, email: user.email, providers: providersOf(user.app_metadata), createdAt: user.created_at ?? null },
  }
}

type ErrorLike = { code?: string | undefined; status?: number | undefined } | null
const isRateLimited = (e: ErrorLike) => e?.status === 429 || e?.code === "over_request_rate_limit" || e?.code === "over_email_send_rate_limit"
const isUnavailable = (e: ErrorLike) => !e?.status || e.status >= 500

export function createSupabaseAuthProvider(config: SupabaseConfig): AuthProvider {
  const fresh = (): SupabaseClient => createClient(config.url, config.publishableKey, { auth })
  // Long-lived verifier: caches the JWKS; it never holds a user session.
  const verifier = fresh()
  const admin = config.secretKey ? createClient(config.url, config.secretKey, { auth }) : null

  return {
    async signUp({ email, password, name, redirectTo }) {
      const { error } = await fresh().auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: redirectTo } })
      if (!error) return "ok" // Also for an existing address: never reveal accounts.
      if (error.code === "weak_password") return "weak_password"
      if (isRateLimited(error)) return "rate_limited"
      if (error.code === "user_already_exists" || error.code === "email_exists") return "ok"
      return isUnavailable(error) ? "unavailable" : "ok"
    },
    async signIn(email, password) {
      const { data, error } = await fresh().auth.signInWithPassword({ email, password })
      if (error) {
        if (error.code === "email_not_confirmed") return { kind: "unverified" }
        if (isRateLimited(error)) return { kind: "rate_limited" }
        if (error.code === "invalid_credentials" || error.status === 400) return { kind: "invalid" }
        return { kind: isUnavailable(error) ? "unavailable" : "invalid" }
      }
      const session = toSession(data.session, data.user)
      return session ? { kind: "ok", session } : { kind: "unavailable" }
    },
    async verifyEmail(tokenHash) {
      const { data, error } = await fresh().auth.verifyOtp({ token_hash: tokenHash, type: "email" })
      if (error) return { kind: isRateLimited(error) ? "rate_limited" : isUnavailable(error) ? "unavailable" : "invalid" }
      const session = toSession(data.session, data.user)
      return session ? { kind: "ok", session } : { kind: "invalid" }
    },
    async resendConfirmation(email, redirectTo) {
      // Outcome intentionally ignored: the route answers 204 either way.
      await fresh().auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } }).catch(() => undefined)
    },
    async refresh(refreshToken) {
      const { data, error } = await fresh().auth.refreshSession({ refresh_token: refreshToken })
      if (error) return { kind: isUnavailable(error) ? "unavailable" : "invalid" }
      const session = toSession(data.session, data.user)
      return session ? { kind: "ok", session } : { kind: "invalid" }
    },
    async signOut(accessToken) {
      if (!admin) return
      await admin.auth.admin.signOut(accessToken, "local").catch(() => undefined)
    },
    async verifyAccessToken(token) {
      if (!token || token.length > 4096 || token.split(".").length !== 3) return null
      try {
        const { data, error } = await verifier.auth.getClaims(token)
        if (error || !data) return null
        const c = data.claims
        if (typeof c.sub !== "string" || !uuid.test(c.sub) || typeof c.session_id !== "string" || !uuid.test(c.session_id)) return null
        if (c.role !== "authenticated" || typeof c.email !== "string" || c.is_anonymous === true) return null
        return { userId: c.sub, sessionId: c.session_id, email: c.email, providers: providersOf(c.app_metadata) }
      } catch {
        return null
      }
    },
  }
}
