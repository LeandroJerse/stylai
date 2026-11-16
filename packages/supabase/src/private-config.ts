import type { PoolConfig } from "pg"

export const privateDatabaseRoles = {
  api: "stylai_api", ai_worker: "stylai_ai_worker", payments: "stylai_payments", procurement: "stylai_procurement",
} as const
export type DatabasePurpose = keyof typeof privateDatabaseRoles
export interface PrivateDatabaseConfig<P extends DatabasePurpose = DatabasePurpose> { purpose: P; connection: PoolConfig }
const devProject = "yekhpfwxuiuakxznxaew"

/** Explicit purpose credentials only. Error text never contains URL/secret values. */
export function readPrivateDatabaseConfig<P extends DatabasePurpose>(env: Record<string, string | undefined>, purpose: P): PrivateDatabaseConfig<P> | null {
  const role = privateDatabaseRoles[purpose]
  if (!role) throw new Error("Invalid private database configuration")
  const prefix = `STYLAI_${purpose.toUpperCase()}_DATABASE`
  const raw = env[`${prefix}_URL`]
  const ca = env[`${prefix}_CA_CERT`]
  if (!raw && !ca) return null
  try {
    if (!raw) throw new Error()
    const url = new URL(raw)
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    const user = decodeURIComponent(url.username)
    const direct = url.hostname === `db.${devProject}.supabase.co` && user === role
    const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) && user === `${role}.${devProject}`
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.password || !url.pathname.slice(1) || url.search || url.hash
      || (local ? user !== role || env.NODE_ENV === "production" : !direct && !pooler)) throw new Error()
    return { purpose, connection: {
      host: url.hostname.replace(/^\[|\]$/g, ""), port: url.port ? Number(url.port) : 5432,
      user, password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
      ssl: local ? false : { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
      max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
      statement_timeout: 5000, query_timeout: 7000, lock_timeout: 2000,
      application_name: `stylai-${purpose}`, allowExitOnIdle: true,
    } }
  } catch { throw new Error("Invalid private database configuration") }
}
