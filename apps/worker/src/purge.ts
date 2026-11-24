/**
 * QA-002: removes the bytes of private objects whose use was already revoked (state 'deleting').
 * One lease per object (claim_asset_purges), idempotent removal confirmed by the store, and
 * finish_asset_purge marks 'deleted' only on confirmed absence; failures retry with backoff.
 * Never logs object keys (they contain the user id).
 */
import { z } from "zod"
import type { PrivateDatabase, PrivateObjectStore } from "@stylai/supabase"

const claimed = z.array(z.object({ id: z.string().uuid(), bucket: z.enum(["body-photos", "references", "generated-looks"]), object_key: z.string() }))

export interface PurgeResult { claimed: number; removed: number; failed: number }

/** Cached product references: expired or withdrawn with their source policy. The record goes only after the bytes. */
export function createReferencePurger(deps: { db: PrivateDatabase<"ai_worker">; store: PrivateObjectStore; batch?: number }) {
  return async function purgeReferences(): Promise<PurgeResult> {
    const keys = z.array(z.string()).parse((await deps.db.call("claim_reference_purges", deps.batch ?? 20)) ?? [])
    let removed = 0, failed = 0
    for (const key of keys) {
      try {
        await deps.store.remove("references", key)
        await deps.db.call("finish_reference_purge", key, true)
        removed++
      } catch { failed++ }
    }
    return { claimed: keys.length, removed, failed }
  }
}

export function createPurger(deps: { db: PrivateDatabase<"ai_worker">; store: PrivateObjectStore; batch?: number }) {
  return async function purgeOnce(): Promise<PurgeResult> {
    const rows = claimed.parse((await deps.db.call("claim_asset_purges", deps.batch ?? 10)) ?? [])
    let removed = 0, failed = 0
    for (const row of rows) {
      try {
        await deps.store.remove(row.bucket, row.object_key)
        await deps.db.call("finish_asset_purge", row.id, true, null)
        removed++
      } catch (error) {
        failed++
        const code = error instanceof Error && /^storage_[a-z_]+$/.test(error.message) ? error.message : "remove_failed"
        await deps.db.call("finish_asset_purge", row.id, false, code).catch(() => undefined)
      }
    }
    return { claimed: rows.length, removed, failed }
  }
}
