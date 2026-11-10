import { createClient } from "@supabase/supabase-js"
import type { SupabaseConfig } from "./config.js"
import type { Database } from "./database.types.js"

export type AdminPurpose = "session_vault" | "validated_ingestion" | "worker" | "deletion"
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }

/** New client per request; never cache a logged-in user's state globally. */
export function createPublicClient(config: SupabaseConfig) {
  return createClient<Database>(config.url, config.publishableKey, { auth })
}
export function createUserClient(config: SupabaseConfig, accessToken: string) {
  if (!accessToken.trim() || /[\r\n]/.test(accessToken)) throw new Error("A user access token is required")
  return createClient<Database>(config.url, config.publishableKey, { auth, global: { headers: { Authorization: `Bearer ${accessToken}` } } })
}
/** Elevated internal capability. The purpose label is not authorization middleware. */
export function createAdminClient(config: SupabaseConfig, purpose: AdminPurpose) {
  if (!config.secretKey || !["session_vault", "validated_ingestion", "worker", "deletion"].includes(purpose)) throw new Error("An explicit admin purpose and server secret are required")
  return createClient<Database>(config.url, config.secretKey, { auth })
}
