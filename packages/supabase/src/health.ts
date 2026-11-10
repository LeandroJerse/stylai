import { createPublicClient } from "./clients.js"
import type { SupabaseConfig } from "./config.js"

export const FOUNDATION_SCHEMA_VERSION = "20261110000100"
export interface FoundationProbe { status: "ready" | "not_configured" | "schema_missing" | "schema_mismatch" | "invalid_key" | "unreachable" }

/** Executes a bounded database RPC with public credentials, not just an env check. */
export async function probeFoundation(config: SupabaseConfig | null, timeoutMs = 3000): Promise<FoundationProbe> {
  if (!config) return { status: "not_configured" }
  try {
    const { data: raw, error, status } = await createPublicClient(config).rpc("stylai_health").abortSignal(AbortSignal.timeout(timeoutMs))
    if (status === 401 || status === 403) return { status: "invalid_key" }
    if (error) return { status: error.code === "PGRST202" || error.code === "42883" ? "schema_missing" : "unreachable" }
    const data: unknown = raw
    if (!data || typeof data !== "object" || !("schema_version" in data) || data.schema_version !== FOUNDATION_SCHEMA_VERSION || !("status" in data) || data.status !== "ok") return { status: "schema_mismatch" }
    return { status: "ready" }
  } catch { return { status: "unreachable" } }
}
