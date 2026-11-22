import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile, rename, rm, stat } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import type { SupabaseClient } from "@supabase/supabase-js"

export type PrivateBucket = "body-photos" | "references" | "generated-looks"
const buckets: readonly PrivateBucket[] = ["body-photos", "references", "generated-looks"]

/** Private object storage. Object keys are server-generated; never trust client paths. */
export interface PrivateObjectStore {
  readonly kind: "local" | "supabase"
  put(bucket: PrivateBucket, key: string, bytes: Uint8Array, mime: string): Promise<void>
  get(bucket: PrivateBucket, key: string): Promise<Uint8Array>
  /** Short-lived URL a provider can fetch. Null when the store cannot be reached from outside. */
  signedUrl(bucket: PrivateBucket, key: string, ttlSeconds: number): Promise<string | null>
  /**
   * Removes the object and confirms it is gone. Idempotent: an absent object is success.
   * Throws when removal or the absence check fails (the caller retries later).
   */
  remove(bucket: PrivateBucket, key: string): Promise<void>
}

function assertKey(bucket: string, key: string) {
  if (!buckets.includes(bucket as PrivateBucket)) throw new Error("invalid bucket")
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/.test(key) || key.includes("..") || key.includes("//")) throw new Error("invalid object key")
}

/**
 * Development/test store under a git-ignored directory. Not reachable by
 * external providers (signedUrl returns null), so it cannot feed paid try-on.
 */
export function createLocalObjectStore(root: string): PrivateObjectStore {
  const base = resolve(root)
  const path = (bucket: string, key: string) => {
    assertKey(bucket, key)
    const full = resolve(base, bucket, key)
    if (!full.startsWith(base + sep)) throw new Error("invalid object key")
    return full
  }
  return {
    kind: "local",
    async put(bucket, key, bytes) {
      const full = path(bucket, key)
      await mkdir(dirname(full), { recursive: true })
      const temp = `${full}.${process.pid}.tmp`
      await writeFile(temp, bytes, { flag: "w" })
      await rename(temp, full)
    },
    async get(bucket, key) { return new Uint8Array(await readFile(path(bucket, key))) },
    async signedUrl() { return null },
    async remove(bucket, key) {
      const full = path(bucket, key)
      await rm(full, { force: true })
      const still = await stat(full).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code === "ENOENT") return false; throw e })
      if (still) throw new Error("storage_remove_unconfirmed")
    },
  }
}

/** Supabase Storage with the server secret. Implemented, not yet exercised against a hosted project. */
export function createSupabaseObjectStore(client: SupabaseClient): PrivateObjectStore {
  return {
    kind: "supabase",
    async put(bucket, key, bytes, mime) {
      assertKey(bucket, key)
      const { error } = await client.storage.from(bucket).upload(key, bytes, { contentType: mime, upsert: false })
      if (error && !/exists/i.test(error.message)) throw new Error("storage_put_failed")
    },
    async get(bucket, key) {
      assertKey(bucket, key)
      const { data, error } = await client.storage.from(bucket).download(key)
      if (error || !data) throw new Error("storage_get_failed")
      return new Uint8Array(await data.arrayBuffer())
    },
    async signedUrl(bucket, key, ttlSeconds) {
      assertKey(bucket, key)
      const ttl = Math.min(Math.max(Math.trunc(ttlSeconds), 30), 900)
      const { data, error } = await client.storage.from(bucket).createSignedUrl(key, ttl)
      if (error || !data?.signedUrl) throw new Error("storage_sign_failed")
      return data.signedUrl
    },
    async remove(bucket, key) {
      assertKey(bucket, key)
      const { error } = await client.storage.from(bucket).remove([key])
      if (error) throw new Error("storage_remove_failed")
      // Only an explicit "does not exist" counts as done.
      const check = await client.storage.from(bucket).exists(key)
      if (check.error && check.data !== false) throw new Error("storage_remove_unconfirmed")
      if (check.data) throw new Error("storage_remove_unconfirmed")
    },
  }
}

/** Repo-root `.data/objects`, so API and worker share it regardless of their cwd. */
export function defaultLocalStoreDir(cwd: string): string {
  let dir = resolve(cwd)
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(dir, "bunfig.toml"))) return resolve(dir, ".data/objects")
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(cwd, ".data/objects")
}
