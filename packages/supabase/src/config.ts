export interface SupabaseConfig { url: string; publishableKey: string; secretKey?: string }

function legacyRole(key: string): string | null {
  try {
    const payload = key.split(".")[1]
    if (!payload) return null
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
    return decoded && typeof decoded === "object" && "role" in decoded && typeof decoded.role === "string" ? decoded.role : null
  } catch { return null }
}

/** Does not log or include credential values in errors. */
export function readSupabaseConfig(env: Record<string, string | undefined>): SupabaseConfig | null {
  const rawUrl = env.SUPABASE_URL?.trim()
  const publishableKey = (env.SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_ANON_KEY)?.trim()
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim() || undefined
  if (!rawUrl && !publishableKey && !secretKey) return null
  if (!rawUrl || !publishableKey) throw new Error("SUPABASE_URL and a publishable/anon key must be configured together")
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error("Invalid SUPABASE_URL") }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(loopback && url.protocol === "http:"))) throw new Error("SUPABASE_URL must be a bare HTTPS origin (HTTP allowed only on loopback)")
  if (!(publishableKey.startsWith("sb_publishable_") || legacyRole(publishableKey) === "anon")) throw new Error("Public configuration requires a publishable/anon key, never a secret/service-role key")
  if (secretKey && !(secretKey.startsWith("sb_secret_") || legacyRole(secretKey) === "service_role")) throw new Error("Invalid server-only Supabase secret/service-role key")
  return { url: url.origin, publishableKey, ...(secretKey ? { secretKey } : {}) }
}
