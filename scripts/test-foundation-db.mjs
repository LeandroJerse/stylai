import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { randomBytes, randomUUID } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const name = `stylai-foundation-test-${randomUUID().slice(0,8)}`
function docker(args, options = {}) {
  return spawnSync("docker", args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 2_000_000, ...options })
}
let started = false
try {
  const run = docker(["run", "--rm", "--detach", "--network", "none", "--name", name, "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=stylai_test", "postgres:17-alpine"], { env: { ...process.env, POSTGRES_PASSWORD: randomBytes(24).toString("hex") } })
  if (run.status !== 0) throw new Error("Cannot start isolated PostgreSQL test container. Start Docker; no hosted DB was touched.\n" + (run.stderr ?? ""))
  started = true
  let ready = false
  for (let i=0; i<60; i++) {
    if (docker(["exec", name, "pg_isready", "-U", "postgres", "-d", "stylai_test"]).status === 0) { ready = true; break }
    await delay(500)
  }
  if (!ready) throw new Error("Isolated database did not become ready")
  const files = ["supabase/tests/bootstrap-postgres.sql", "supabase/migrations/20261110000100_foundation.sql", "supabase/tests/foundation.sql"]
  const input = files.map((file) => readFileSync(resolve(root,file), "utf8")).join("\n")
  const test = docker(["exec", "-i", name, "psql", "-U", "postgres", "-d", "stylai_test", "-v", "ON_ERROR_STOP=1"], { input })
  if (test.status !== 0) throw new Error("Foundation migration/RLS assertion failed:\n" + test.stderr)
  console.log(test.stdout.trim().split("\n").slice(-6).join("\n"))
  console.log("Real PostgreSQL 17 role/RLS tests passed. Supabase auth/storage system schemas used test-only compatibility fixtures; hosted Supabase still needs separate verification.")
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database test failed")
  process.exitCode = 1
} finally {
  if (started && /^stylai-foundation-test-[0-9a-f]{8}$/.test(name)) {
    const cleanup = docker(["rm", "--force", name])
    if (cleanup.status !== 0) { console.error("Test container cleanup failed:", name); process.exitCode = 1 }
  }
}
