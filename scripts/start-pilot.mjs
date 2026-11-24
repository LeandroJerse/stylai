// P02: reproducible LOCAL pilot launcher (API :3100, worker :3101, analyzer :54391, web :5198) WITHOUT seed/reset and
// WITHOUT editing any .env. Keys are read from the workspace-root .env.local by allow-listed NAME only (pilot-runtime.mjs)
// and passed to the one process that needs them; values are never printed.
//   node scripts/start-pilot.mjs --dry-run --real --pilot=stylai-first-real-tryon-pilot --relay=cloudflared --composer --catalog=aliexpress_affiliate
//   (same flags without --dry-run starts the stack; Ctrl+C stops it). Simulation unless --real.
// Not for production: DPAPI/root env files are local operator tooling (see docs/operations/runbook-composicao-producao.md).
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEnv } from "node:util"
import { planPilotRuntime } from "./pilot-runtime.mjs"
import { loadAliExpressEnvironment, withoutAliExpressEnv } from "./aliexpress-runtime.mjs"

const root = process.cwd()
const argv = process.argv.slice(2)
const rootEnvFile = resolve(root, "../.env.local")
const rootEnv = existsSync(rootEnvFile) ? parseEnv(readFileSync(rootEnvFile, "utf8")) : {}
const plan = planPilotRuntime({ argv, rootEnv })
const aliexpress = plan.catalog === "aliexpress_affiliate"
// AliExpress credentials come from the DPAPI store: validated BEFORE any mutation (also in --dry-run; values never printed).
let aliexpressEnv = {}
let dpapi = aliexpress ? "não validado" : "não usado"
if (aliexpress) {
  try { aliexpressEnv = loadAliExpressEnvironment(); dpapi = "válido (App Key/Secret presentes; Tracking ID " + (aliexpressEnv.ALIEXPRESS_TRACKING_ID ? "presente" : "ausente") + ")" }
  catch { dpapi = "INVÁLIDO/ausente"; plan.errors.push("AliExpress DPAPI configuration unavailable (run Set-AliExpressAffiliate.ps1)") }
}
console.log(JSON.stringify({ ...plan.report, catalog: plan.catalog, real: plan.real, aliexpressDpapi: dpapi, errors: plan.errors }, null, 2))
if (plan.errors.length) process.exit(2)
if (argv.includes("--dry-run")) { console.log("Dry-run: nada iniciado; portas, banco, papéis e processos não foram tocados."); process.exit(0) }

const { assertReviewPortsAvailable } = await import("./review-ports.mjs")
await assertReviewPortsAvailable([5198, 3100, 3101, 54391, ...(plan.real ? [] : [54395])])
const supabaseBin = resolve(root, process.platform === "win32" ? "node_modules/.bin/supabase.exe" : "node_modules/.bin/supabase")
const statusRun = spawnSync(supabaseBin, ["status", "-o", "json"], { encoding: "utf8", windowsHide: true })
if (statusRun.error || statusRun.status !== 0) throw new Error("supabase status failed (is the local stack running?)")
let status
try { status = JSON.parse(statusRun.stdout) } catch { throw new Error("supabase status returned invalid JSON") }
if (!status.API_URL || !["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Supabase is not running")
// Roles only (no fixtures, no catalog/user/pilot reset): fresh per-run passwords for the restricted roles.
const password = randomBytes(18).toString("base64url")
const roles = spawnSync("docker", ["exec", "-i", "supabase_db_stylai-local", "psql", "-XqtA", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
  { encoding: "utf8", windowsHide: true, input: `begin; alter role stylai_api login password '${password}'; alter role stylai_ai_worker login password '${password}'; commit;` })
if (roles.status !== 0) throw new Error("Local role initialization failed")

const clean = withoutAliExpressEnv(Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !/^(FAL_|TIKTOK_|OPENAI_|STYLAI_|SUPABASE_|LANGFUSE_|SEGMIND_|ANTHROPIC_|GEMINI_|TELEMETRY_|VITE_)/.test(k))))
const supabase = { SUPABASE_URL: status.API_URL, SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: status.SECRET_KEY, STYLAI_OBJECT_STORE: "supabase" }
const db = (role) => `postgres://${role}:${password}@127.0.0.1:54322/postgres`
const origin = "http://localhost:5198"
const tsx = ["--conditions=development", "--import", "tsx"]
mkdirSync(resolve(root, "test-results"), { recursive: true })
const children = []
const start = (name, command, args, env, cwd = root) => {
  const log = createWriteStream(resolve(root, "test-results", `pilot-${name}.log`))
  const child = spawn(command, args, { cwd, env: { ...clean, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.pipe(log); child.stderr.pipe(log); children.push(child)
}
const workerFile = resolve(root, "apps/worker/.env.local")
const langfuse = existsSync(workerFile)
  ? Object.fromEntries(Object.entries(parseEnv(readFileSync(workerFile, "utf8"))).filter(([k]) => /^LANGFUSE_(PUBLIC_KEY|SECRET_KEY|BASE_URL)$/.test(k))) : {}
if (!plan.real) start("simulator", process.execPath, [...tsx, "scripts/segmind-simulator.ts", "54395"], {})
start("pose-analyzer", "uv", ["run", "tools/pose-validator/analyzer.py", "serve", "54391"], {})
start("api", process.execPath, [...tsx, "apps/api/src/server.ts"], {
  NODE_ENV: "development", API_PORT: "3100", SERVICE_HOST: "127.0.0.1", APP_ORIGIN: origin, API_PUBLIC_BASE_URL: `${origin}/v1`,
  STYLAI_API_DATABASE_URL: db("stylai_api"), STYLAI_SESSION_KEY: randomBytes(32).toString("base64"),
  STYLAI_RATE_LIMIT_PER_MINUTE: "600", STYLAI_POSE_ANALYZER_URL: "http://127.0.0.1:54391", ...supabase, ...plan.api, ...aliexpressEnv,
})
start("worker", process.execPath, [...tsx, "apps/worker/src/server.ts"], {
  NODE_ENV: "development", WORKER_PORT: "3101", SERVICE_HOST: "127.0.0.1", STYLAI_AI_WORKER_DATABASE_URL: db("stylai_ai_worker"),
  TELEMETRY_PSEUDONYM_KEY: randomBytes(32).toString("hex"), WORKER_POLL_IDLE_MS: "500", ...supabase, ...langfuse,
  ...(plan.real ? plan.worker : { SEGMIND_BASE_URL: "http://127.0.0.1:54395", STYLAI_ENVIRONMENT: "test" }),
})
start("web", process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--port", "5198", "--strictPort"],
  { VITE_API_BASE_URL: `${origin}/v1`, VITE_API_PROXY_TARGET: "http://127.0.0.1:3100" }, resolve(root, "apps/web"))
console.log(`Piloto local (${plan.real ? `${plan.worker.STYLAI_TRYON_PROVIDER.toUpperCase()} REAL` : "simulação"}): ${origin} · logs test-results/pilot-*.log`)
const stop = () => { for (const c of children) { if (process.platform === "win32" && c.pid) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { windowsHide: true }); else c.kill() } process.exit(0) }
process.on("SIGINT", stop); process.on("SIGTERM", stop)
