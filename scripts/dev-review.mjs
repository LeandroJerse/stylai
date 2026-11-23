// Local review stack: API :3100, worker :3101, LOCAL pose analyzer :54391 (MediaPipe, no paid API) and the
// official front on http://localhost:5198 (STYLAI_REVIEW_PORT), over the local Supabase (`bun run supabase:start`).
//   node scripts/dev-review.mjs          -> SIMULATION: Segmind simulator :54395, no paid call (default)
//   node scripts/dev-review.mjs --real   -> REAL AI: the worker uses apps/worker/.env.local (SEGMIND_API_KEY,
//                                           STYLAI_PAID_CALLS_ENABLED, LANGFUSE_*). Values are passed to the
//                                           child process only, never printed. Missing config = real error.
//   node scripts/dev-review.mjs --aliexpress -> catalog = AliExpress Affiliates (real, read-only calls per
//                                           search). App Key/Secret/Tracking ID come from the DPAPI store
//                                           (docs/security/adequacao/Set-AliExpressAffiliate.ps1) into the API child ONLY.
// Secrets for the local roles/session are generated per run; nothing is written to .env files.
// Logs: test-results/review-*.log. Ctrl+C stops everything.
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEnv } from "node:util"
import { assertReviewPortsAvailable } from "./review-ports.mjs"
import { loadAliExpressEnvironment, withoutAliExpressEnv } from "./aliexpress-runtime.mjs"

// Windows: child.kill() stops `uv` but leaves its python child running; stop the whole tree.
const killTree = (child) => { if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill() }
const root = process.cwd()
const real = process.argv.includes("--real")
// Loaded before anything starts so a missing protected config fails fast; values never printed.
const aliexpressEnv = process.argv.includes("--aliexpress") ? loadAliExpressEnvironment() : {}
await assertReviewPortsAvailable([Number(process.env.STYLAI_REVIEW_PORT ?? "5198"), 3100, 3101, 54391, ...(!real ? [54395] : [])])
const status = JSON.parse(spawnSync(resolve(root, "node_modules/.bin/supabase"), ["status", "-o", "json"], { encoding: "utf8", windowsHide: true }).stdout || "{}")
if (!status.API_URL || !["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Supabase is not running: bun run supabase:start")
const password = randomBytes(18).toString("base64url")
const seed = spawnSync(process.execPath, ["--import", "tsx", "scripts/dev-db.ts", "--fixtures"], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, STYLAI_DEV_DB_PASSWORD: password } })
if (seed.status !== 0) throw new Error("Local catalog/roles initialization failed (see scripts/dev-db.ts)")

// Inherited ALIEXPRESS_* never reach any child; the API receives them only via aliexpressEnv.
const clean = withoutAliExpressEnv(Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(STYLAI_|SUPABASE_|LANGFUSE_|SEGMIND_|ANTHROPIC_|GEMINI_|TELEMETRY_|VITE_)/.test(k))))
const supabase = { SUPABASE_URL: status.API_URL, SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: status.SECRET_KEY, STYLAI_OBJECT_STORE: "supabase" }
const db = (role) => `postgres://${role}:${password}@127.0.0.1:54322/postgres`
const origin = `http://localhost:${process.env.STYLAI_REVIEW_PORT ?? "5198"}`
const tsx = ["--conditions=development", "--import", "tsx"]
mkdirSync(resolve(root, "test-results"), { recursive: true })
const children = []
function start(name, command, args, env, cwd = root) {
  const log = createWriteStream(resolve(root, "test-results", `review-${name}.log`))
  const child = spawn(command, args, { cwd, env: { ...clean, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.pipe(log); child.stderr.pipe(log); children.push(child)
}

// Real mode: only the provider/telemetry names below are read from the worker env file.
let workerProvider = { SEGMIND_BASE_URL: "http://127.0.0.1:54395", STYLAI_ENVIRONMENT: "test" }
if (real) {
  const file = resolve(root, "apps/worker/.env.local")
  const env = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}
  const pick = Object.fromEntries(Object.entries(env).filter(([k]) => /^(SEGMIND_API_KEY|SEGMIND_MODEL|SEGMIND_RESERVE_USD_MICROS|SEGMIND_SUBMIT_RETRIES|STYLAI_PAID_CALLS_ENABLED|LANGFUSE_PUBLIC_KEY|LANGFUSE_SECRET_KEY|LANGFUSE_BASE_URL|LANGFUSE_TRACING_ENVIRONMENT)$/.test(k)))
  workerProvider = { ...pick, STYLAI_ENVIRONMENT: "development" }
  const missing = ["SEGMIND_API_KEY", "STYLAI_PAID_CALLS_ENABLED"].filter((k) => !pick[k])
  console.log(`REAL AI mode. Worker config names present: ${Object.keys(pick).sort().join(", ") || "none"}${missing.length ? ` · MISSING: ${missing.join(", ")} (generation will fail with the real error)` : ""}`)
} else {
  start("simulator", process.execPath, [...tsx, "scripts/segmind-simulator.ts", "54395"], {})
}
// A stale analyzer on the port would answer with old code: refuse instead of silently using it.
if (await fetch("http://127.0.0.1:54391/health").then(() => true, () => false)) throw new Error("port 54391 already in use (stale pose analyzer?)")
start("pose-analyzer", "uv", ["run", "tools/pose-validator/analyzer.py", "serve", "54391"], {})
start("api", process.execPath, [...tsx, "apps/api/src/server.ts"], {
  NODE_ENV: "development", API_PORT: "3100", SERVICE_HOST: "127.0.0.1", APP_ORIGIN: origin, API_PUBLIC_BASE_URL: `${origin}/v1`,
  STYLAI_API_DATABASE_URL: db("stylai_api"), STYLAI_SESSION_KEY: randomBytes(32).toString("base64"),
  STYLAI_RATE_LIMIT_PER_MINUTE: "600", STYLAI_POSE_ANALYZER_URL: "http://127.0.0.1:54391", STYLAI_GENERATION_MODE: real ? "real" : "simulated", ...supabase,
  ...aliexpressEnv,
})
start("worker", process.execPath, [...tsx, "apps/worker/src/server.ts"], {
  NODE_ENV: "development", WORKER_PORT: "3101", SERVICE_HOST: "127.0.0.1", STYLAI_AI_WORKER_DATABASE_URL: db("stylai_ai_worker"),
  TELEMETRY_PSEUDONYM_KEY: randomBytes(32).toString("hex"), WORKER_POLL_IDLE_MS: "500", ...supabase, ...workerProvider,
})
start("web", process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--port", new URL(origin).port, "--strictPort"], { VITE_API_BASE_URL: `${origin}/v1`, VITE_API_PROXY_TARGET: "http://127.0.0.1:3100" }, resolve(root, "apps/web"))
if (aliexpressEnv.STYLAI_CATALOG_MODE) console.log(`Catálogo: AliExpress Affiliates (chamadas reais por busca nova). Tracking ID: ${aliexpressEnv.ALIEXPRESS_TRACKING_ID ? "configurado" : "ausente (links comuns)"}`)
console.log(`Official review (${real ? "IA REAL" : "simulação"}): ${origin}  ·  e-mails: ${status.MAILPIT_URL ?? "http://127.0.0.1:54324"}  ·  demo: bun run dev:web:demo (http://localhost:5192)`)
console.log("Local plan of an account: bun run db:dev -- --plan <email> paid|free")
const stop = () => { for (const c of children) killTree(c); process.exit(0) }
process.on("SIGINT", stop); process.on("SIGTERM", stop)
