// QA-002: physical removal, idempotent, confirmed, retried on failure.
import { expect, test } from "bun:test"
import { mkdtempSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLocalObjectStore, type PrivateObjectStore } from "@stylai/supabase"
import { createPurger } from "../src/purge"

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
function fakeDb(rows: { id: string; bucket: string; object_key: string }[]) {
  const finished: [string, boolean, string | null][] = []
  const db = {
    call: async (op: string, ...args: unknown[]) => {
      if (op === "claim_asset_purges") return rows
      if (op === "finish_asset_purge") { finished.push(args as [string, boolean, string | null]); return true }
      throw new Error(op)
    },
  }
  return { db: db as never, finished }
}

test("local store removal is idempotent and confirmed", async () => {
  const store = createLocalObjectStore(mkdtempSync(join(tmpdir(), "stylai-purge-")))
  await store.put("body-photos", "u1/front-a.jpg", new Uint8Array([1, 2, 3]), "image/jpeg")
  await store.remove("body-photos", "u1/front-a.jpg")
  await store.remove("body-photos", "u1/front-a.jpg") // absent = success
  await expect(store.get("body-photos", "u1/front-a.jpg")).rejects.toThrow()
})

test("purge marks deleted only after removal, and schedules a retry when storage fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "stylai-purge-"))
  const local = createLocalObjectStore(dir)
  await local.put("body-photos", "u1/front-a.jpg", new Uint8Array([1]), "image/jpeg")
  await local.put("body-photos", "u1/front-b.jpg", new Uint8Array([2]), "image/jpeg")
  const flaky: PrivateObjectStore = { ...local, remove: async (b, k) => { if (k.endsWith("b.jpg")) throw new Error("storage_remove_failed"); return local.remove(b, k) } }
  const { db, finished } = fakeDb([{ id: ID(1), bucket: "body-photos", object_key: "u1/front-a.jpg" }, { id: ID(2), bucket: "body-photos", object_key: "u1/front-b.jpg" }])
  const result = await createPurger({ db, store: flaky })()
  expect(result).toEqual({ claimed: 2, removed: 1, failed: 1 })
  expect(finished).toEqual([[ID(1), true, null], [ID(2), false, "storage_remove_failed"]])
  expect(existsSync(join(dir, "body-photos", "u1", "front-a.jpg"))).toBe(false)
  expect(existsSync(join(dir, "body-photos", "u1", "front-b.jpg"))).toBe(true) // kept for the retry
})
