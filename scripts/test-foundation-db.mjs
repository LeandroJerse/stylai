import assert from "node:assert/strict"
import { execFile, spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { randomBytes, randomUUID } from "node:crypto"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const name = `stylai-foundation-test-${randomUUID().slice(0,8)}`
const execFileAsync = promisify(execFile)
function docker(args, options = {}) {
  return spawnSync("docker", args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 2_000_000, ...options })
}
function session(sql) {
  const flags = ["exec", name, "psql", "-XqtA", "-U", "postgres", "-d", "stylai_test", "-v", "ON_ERROR_STOP=1", "-c", sql]
  return execFileAsync("docker", flags, { cwd: root, windowsHide: true, timeout: 15000 })
}

async function verifyConcurrency() {
  const a = "10000000-0000-4000-8000-000000000001"
  const b = "10000000-0000-4000-8000-000000000002"
  const photo = "20000000-0000-4000-8000-000000000001"
  const enqueue = `select private.enqueue_ai_job('${a}','same-key',repeat('a',64),'${photo}','test-tops','test-v1')`
  const jobs = await Promise.allSettled([session(`set role service_role; ${enqueue}; select pg_sleep(0.5)`), session(`set role service_role; ${enqueue}`)])
  for (const job of jobs) if (job.status === "rejected") throw job.reason
  assert.match(jobs[0].value.stdout.trim(), /^[0-9a-f-]{36}$/)
  assert.equal(jobs[0].value.stdout.trim(), jobs[1].value.stdout.trim(), "concurrent enqueue did not reuse the job")
  const pay = (owner, suffix) => `set role service_role; select private.start_order_payment('${owner}','40000000-0000-4000-8000-00000000000${suffix}','pix','sandbox','test-merchant'); select pg_sleep(0.5)`
  const orders = await Promise.allSettled([session(pay(a,1)), session(pay(b,2))])
  assert.equal(orders.filter((order) => order.status === "fulfilled").length, 1, "concurrent orders exceeded shared funding")
  const rejected = orders.find((order) => order.status === "rejected")
  assert.match(rejected.reason.stderr, /procurement funding unavailable/)
  const verified = await session("select (select count(*) from private.ai_jobs), (select reserved from private.ai_daily_usage), (select count(*) from private.orders), (select count(*) from private.payment_attempts), (select reserved_minor from private.procurement_budgets)")
  assert.equal(verified.stdout.trim(), "1|1|1|1|7000", "race left partial or duplicate rows")
  console.log("Multi-session PostgreSQL checks passed: request idempotency and shared procurement funding.")
}
let started = false
try {
  const run = docker(["run", "--rm", "--detach", "--network", "none", "--name", name, "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_DB=stylai_test", "postgres:17-alpine"], { env: { ...process.env, POSTGRES_PASSWORD: randomBytes(24).toString("hex") } })
  if (run.status !== 0) throw new Error("Cannot start isolated PostgreSQL test container. Start Docker; no hosted DB was touched.\n" + (run.stderr ?? ""))
  started = true
  let ready = false
  for (let i=0; i<60; i++) {
    // The image starts a temporary socket-only server during initialization.
    if (docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-d", "stylai_test"]).status === 0) { ready = true; break }
    await delay(500)
  }
  if (!ready) throw new Error("Isolated database did not become ready")
  const migrations = readdirSync(resolve(root, "supabase/migrations"))
    .filter((file) => /^\d{14}_.+\.sql$/.test(file)).sort()
    .map((file) => `supabase/migrations/${file}`)
  const files = ["supabase/tests/bootstrap-postgres.sql", ...migrations, "supabase/tests/foundation.sql", "supabase/tests/domain.sql", "supabase/tests/commerce.sql", "supabase/tests/server-boundary.sql", "supabase/tests/motor-slice.sql", "supabase/tests/studio-journey.sql", "supabase/tests/concurrency-fixtures.sql"]
  const input = files.map((file) => readFileSync(resolve(root,file), "utf8")).join("\n")
  const test = docker(["exec", "-i", name, "psql", "-U", "postgres", "-d", "stylai_test", "-v", "ON_ERROR_STOP=1"], { input })
  if (test.status !== 0) throw new Error("Migration/RLS assertion failed:\n" + test.stderr)
  console.log(test.stdout.split("\n").filter((line) => line.includes("assertions passed")).join("\n"))
  await verifyConcurrency()
  console.log("Real PostgreSQL 17 role, RLS and transaction tests passed using Auth/Storage compatibility fixtures.")
} catch (error) {
  console.error(error instanceof Error ? error.message : "Database test failed")
  process.exitCode = 1
} finally {
  if (started && /^stylai-foundation-test-[0-9a-f]{8}$/.test(name)) {
    const cleanup = docker(["rm", "--force", name])
    if (cleanup.status !== 0) { console.error("Test container cleanup failed:", name); process.exitCode = 1 }
  }
}
