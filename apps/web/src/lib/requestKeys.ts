/**
 * Idempotency keys for Estúdio requests. One key per logical request (same pieces, variant and
 * source version) until that job settles: double clicks, network retries and reloads reuse it, so
 * the server answers with the same job instead of creating another.
 */
// One key per logical request (same piece, variant and source version) until that job settles.
// Double clicks, network retries and reloads reuse it, so the server answers with the same job.
const KEY_STORE = "stylai-tryon-keys"
type KeyEntry = { key: string; jobId: string | null }
let memory: Record<string, KeyEntry> = {}
function readKeys(): Record<string, KeyEntry> {
  try {
    const raw = window.sessionStorage.getItem(KEY_STORE)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === "object") memory = { ...(parsed as Record<string, KeyEntry>), ...memory }
  } catch {
    // Storage blocked: keys live for this page only (the server still refuses a second active job).
  }
  return memory
}
function writeKeys(map: Record<string, KeyEntry>): void {
  memory = map
  try {
    window.sessionStorage.setItem(KEY_STORE, JSON.stringify(map))
  } catch {
    // See readKeys.
  }
}
export function keyFor(fingerprint: string): string {
  const map = readKeys()
  const existing = map[fingerprint]
  if (existing) return existing.key
  const key = `tryon-${crypto.randomUUID()}`
  writeKeys({ ...map, [fingerprint]: { key, jobId: null } })
  return key
}
export function bindKey(fingerprint: string, jobId: string): void {
  const map = readKeys()
  const entry = map[fingerprint]
  if (entry) writeKeys({ ...map, [fingerprint]: { ...entry, jobId } })
}
export function forgetKey(fingerprint: string): void {
  const map = { ...readKeys() }
  delete map[fingerprint]
  writeKeys(map)
}
/** A settled job frees its key: retrying afterwards is a new, deliberate request. */
export function forgetJob(jobId: string): void {
  writeKeys(Object.fromEntries(Object.entries(readKeys()).filter(([, e]) => e.jobId !== jobId)))
}
