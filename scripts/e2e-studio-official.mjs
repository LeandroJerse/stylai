// Official mode, end to end in a real browser, without paid calls:
//   local Supabase (Auth + Storage + Postgres, `bun run supabase:start`) + real API + real worker
//   + Segmind SIMULATOR (loopback) + Vite dev server + Chromium.
// Validates sign-up/e-mail confirmation (Mailpit), the try-on journey (shared with the demo test),
// idempotency under triple clicks and reload, failure without quota use, v1/v2 lineage, private
// images, two-user isolation, session revocation, and telemetry: Langfuse down -> outbox keeps the
// events and the look still completes; Langfuse up -> the same events reach Langfuse Cloud
// (environment "integration-test", synthetic, cost 0) and are read back via Observations API v2.
// Secrets: generated per run or read from apps/worker/.env.local into child env only; never printed.
// Run: node --import tsx scripts/e2e-studio-official.mjs   (bun run test:e2e:official)
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { parseEnv } from "node:util"
import { chromium } from "playwright"
import { createChecker, PARITY_QUERIES, runStudioJourney, searchResultNames, syntheticPng, testPhoto } from "../apps/web/scripts/tryon-journey.mjs"
import { traceIdForJob } from "../packages/ai/src/telemetry.ts"

// Windows: child.kill() stops `uv` but leaves its python child running; stop the whole tree.
const killTree = (child) => { if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill() }
const root = process.cwd()
const OUT = resolve(root, "test-results/e2e-official")
mkdirSync(OUT, { recursive: true })
const PORTS = { sim: 54393, api: 3310, worker: 3311, web: 5194, pose: 54392 }
const ORIGIN = `http://localhost:${PORTS.web}`
const t = createChecker("oficial")
const children = []
const DB_CONTAINER = "supabase_db_stylai-local"

// ---------------------------------------------------------------- environment (no values printed)
const status = JSON.parse(spawnSync(resolve(root, "node_modules/.bin/supabase"), ["status", "-o", "json"], { encoding: "utf8", windowsHide: true }).stdout || "{}")
if (!status.API_URL || !status.PUBLISHABLE_KEY || !status.SECRET_KEY) throw new Error("Local Supabase is not running: bun run supabase:start")
const MAILPIT = status.MAILPIT_URL ?? "http://127.0.0.1:54324"
const langfuseFile = resolve(root, "apps/worker/.env.local")
const langfuse = existsSync(langfuseFile) ? parseEnv(readFileSync(langfuseFile, "utf8")) : {}
const hasLangfuse = Boolean(langfuse.LANGFUSE_PUBLIC_KEY && langfuse.LANGFUSE_SECRET_KEY && langfuse.LANGFUSE_BASE_URL)
const password = randomBytes(18).toString("base64url")
const sessionKey = randomBytes(32).toString("base64")
const pseudonymKey = randomBytes(32).toString("hex")

function psql(sql) {
  const r = spawnSync("docker", ["exec", "-i", DB_CONTAINER, "psql", "-XqtA", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", windowsHide: true })
  if (r.status !== 0) throw new Error(`psql: ${(r.stderr ?? "").slice(0, 300)}`)
  return r.stdout.trim()
}
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`

const seed = spawnSync(process.execPath, ["--import", "tsx", "scripts/dev-db.ts", "--fixtures", "--edge-cases"], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, STYLAI_DEV_DB_PASSWORD: password } })
if (seed.status !== 0) throw new Error(`db:dev failed: ${(seed.stderr ?? "").replaceAll(password, "***").slice(0, 400)}`)

const dbUrl = (role) => `postgres://${role}:${password}@127.0.0.1:54322/postgres`
const supabaseEnv = { SUPABASE_URL: status.API_URL, SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: status.SECRET_KEY, STYLAI_OBJECT_STORE: "supabase" }
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(STYLAI_|SUPABASE_|LANGFUSE_|SEGMIND_|ANTHROPIC_|GEMINI_|TELEMETRY_)/.test(k)))

function start(name, args, env, cwd = root) {
  const log = createWriteStream(join(OUT, `${name}.log`))
  const child = spawn(process.execPath, args, { cwd, env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  child.stdout.pipe(log); child.stderr.pipe(log)
  children.push(child)
  return child
}
async function waitHttp(url, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    try { const r = await fetch(url); if (r.status < 500) return true } catch { /* not yet */ }
    await delay(300)
  }
  throw new Error(`timeout waiting for ${url}`)
}
const tsx = ["--conditions=development", "--import", "tsx"]
function startWorker(langfuseEnv) {
  return start(`worker-${langfuseEnv.LANGFUSE_BASE_URL?.includes("127.0.0.1") ? "langfuse-down" : "langfuse-up"}`, [...tsx, "apps/worker/src/server.ts"], {
    NODE_ENV: "development", STYLAI_ENVIRONMENT: "test", WORKER_PORT: String(PORTS.worker), SERVICE_HOST: "127.0.0.1",
    STYLAI_AI_WORKER_DATABASE_URL: dbUrl("stylai_ai_worker"), TELEMETRY_PSEUDONYM_KEY: pseudonymKey,
    SEGMIND_BASE_URL: `http://127.0.0.1:${PORTS.sim}`, WORKER_POLL_IDLE_MS: "300",
    ...supabaseEnv, ...langfuseEnv,
  })
}
const stopChild = (child) => new Promise((r) => { if (child.exitCode !== null) return r(); child.once("exit", r); child.kill() })

try {
  start("segmind-simulator", [...tsx, "scripts/segmind-simulator.ts", String(PORTS.sim)], { SEGMIND_SIMULATOR_DELAY_MS: "2500" })
  // Local pose analyzer (MediaPipe in Python): the REAL validator, not a mock. A stale analyzer already on the
  // port would silently answer with old code: refuse to run instead.
  if (await fetch(`http://127.0.0.1:${PORTS.pose}/health`).then(() => true, () => false)) throw new Error(`port ${PORTS.pose} already in use (stale pose analyzer?)`)
  const pose = spawn("uv", ["run", "tools/pose-validator/analyzer.py", "serve", String(PORTS.pose)], { cwd: root, env: clean, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  const poseLog = createWriteStream(join(OUT, "pose-analyzer.log")); pose.stdout.pipe(poseLog); pose.stderr.pipe(poseLog); children.push(pose)
  start("api", [...tsx, "apps/api/src/server.ts"], {
    NODE_ENV: "development", API_PORT: String(PORTS.api), SERVICE_HOST: "127.0.0.1", APP_ORIGIN: ORIGIN,
    API_PUBLIC_BASE_URL: `${ORIGIN}/v1`, STYLAI_API_DATABASE_URL: dbUrl("stylai_api"), STYLAI_SESSION_KEY: sessionKey, ...supabaseEnv,
    STYLAI_RATE_LIMIT_PER_MINUTE: "600", STYLAI_POSE_ANALYZER_URL: `http://127.0.0.1:${PORTS.pose}`, STYLAI_GENERATION_MODE: "simulated",
  })
  // Phase A: Langfuse unreachable (closed loopback port -> ECONNREFUSED). Not port 9: fetch blocks it as a "bad port".
  let worker = startWorker({ LANGFUSE_PUBLIC_KEY: "pk-lf-unreachable", LANGFUSE_SECRET_KEY: "sk-lf-unreachable", LANGFUSE_BASE_URL: "http://127.0.0.1:54399", LANGFUSE_TRACING_ENVIRONMENT: "integration-test" })
  start("web", [resolve(root, "node_modules/vite/bin/vite.js"), "--port", String(PORTS.web), "--strictPort"], { VITE_API_BASE_URL: `${ORIGIN}/v1`, VITE_API_PROXY_TARGET: `http://127.0.0.1:${PORTS.api}`, VITE_GOOGLE_CLIENT_ID: "" }, resolve(root, "apps/web"))
  await waitHttp(`http://127.0.0.1:${PORTS.sim}/__stats`)
  await waitHttp(`http://127.0.0.1:${PORTS.pose}/health`, 180000)
  await waitHttp(`http://127.0.0.1:${PORTS.api}/health/live`)
  await waitHttp(`http://127.0.0.1:${PORTS.worker}/health/live`)
  await waitHttp(ORIGIN)
  t.check((await fetch(`http://127.0.0.1:${PORTS.api}/health/ready`)).status === 200, "API pronta (Supabase + papel restrito stylai_api)")

  const api = (path, init = {}) => fetch(`${ORIGIN}/v1${path}`, { ...init, headers: { Origin: ORIGIN, ...(init.headers ?? {}) } })
  /** Newest confirmation link for an address (minCount: wait until that many e-mails arrived). Never printed. */
  async function confirmationLink(email, minCount = 1) {
    for (let i = 0; i < 40; i++) {
      const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((r) => r.json())
      const id = (search.messages?.length ?? 0) >= minCount ? search.messages?.[0]?.ID : null
      if (id) {
        const message = await fetch(`${MAILPIT}/api/v1/message/${id}`).then((r) => r.json())
        const href = /href="([^"]*token_hash=[^"]*)"/.exec(message.HTML ?? "")?.[1]?.replaceAll("&amp;", "&")
        const token = href ? /token_hash=([A-Za-z0-9_-]+)/.exec(href)?.[1] : undefined
        if (href && token) return { href, token }
      }
      await delay(500)
    }
    throw new Error("confirmation e-mail not received")
  }
  const confirmationToken = async (email, minCount = 1) => (await confirmationLink(email, minCount)).token
  // QA-007: the link must open the ACTIVE app origin (no manual edit), on the confirmation screen.
  const linkOk = (href) => href.startsWith(`${ORIGIN}/#/confirmar-email?token_hash=`) && href.includes("&type=email")
  const run = randomBytes(4).toString("hex")
  const emailA = `ana-${run}@example.com`, emailB = `bia-${run}@example.com`

  // ------------------------------------------------------------- browser, user A
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e)))
  // QA-010: features the engine does not offer must never be requested (no 503 noise, no retries).
  const unavailableCalls = []
  const frontDeletes = []
  page.on("request", (r) => { if (r.method() === "DELETE" && new URL(r.url()).pathname === "/v1/me/body-photos/front") frontDeletes.push(Date.now()) })
  page.on("request", (r) => { const u = new URL(r.url()); if (/^\/v1\/(me\/measurements|plans|preferences)(\/|$)|\/candidates$/.test(u.pathname)) unavailableCalls.push(u.pathname) })
  const shots = (name) => page.screenshot({ path: join(OUT, `${name}.png`) })

  await page.goto(`${ORIGIN}/#/criar-conta`)
  await page.getByLabel("Nome").fill("Ana Teste")
  await page.getByLabel("E-mail").fill(emailA)
  await page.getByLabel("Senha", { exact: true }).fill("senhaTeste123")
  await page.getByRole("button", { name: "Criar conta" }).click()
  await page.getByRole("heading", { name: "Confira seu e-mail" }).waitFor({ timeout: 15000 })
  t.check(true, "cadastro real (Supabase Auth) pede confirmação; sem sessão antes do link")
  t.check((await api("/me")).status === 401, "sem sessão antes da confirmação")
  const linkA = await confirmationLink(emailA)
  t.check(linkOk(linkA.href), `link do e-mail de cadastro abre a origem ativa (${ORIGIN})`, new URL(linkA.href).origin)
  // Resend: same rule, a fresh link to the same origin. Auth enforces a minimum interval per address
  // (local max_frequency): wait like a person would before asking again.
  await delay(2000)
  t.check((await api("/auth/email/verify/resend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: emailA }) })).status === 204, "reenvio do e-mail de confirmação aceito")
  const resent = await confirmationLink(emailA, 2)
  t.check(linkOk(resent.href), "link do e-mail reenviado também abre a origem ativa", new URL(resent.href).origin)
  const tokenA = resent.token
  await page.goto(`${ORIGIN}/#/confirmar-email?token_hash=${tokenA}&type=email`)
  await page.getByRole("heading", { name: "Estúdio" }).waitFor({ timeout: 15000 })
  t.check(!page.url().includes("token_hash"), "link de confirmação abre o Estúdio e some da barra de endereço")
  const userA = psql(`select id from auth.users where email=${lit(emailA)}`)

  const evidence = await runStudioJourney(page, t, {
    base: ORIGIN, pieceA: "Blusa básica branca (teste)", pieceB: "Jaqueta jeans azul (teste)", promptA: "blusa branca", promptB: "jaqueta jeans",
    startCoins: 30, // new account = free plan (30 moedas/day)
    photos: { front: testPhoto("front"), side: testPhoto("side"), profile: testPhoto("profile"), selfie: testPhoto("selfie"), twoPeople: testPhoto("two-people"), tightTop: testPhoto("front-tight-top"), headCut: testPhoto("profile-head-cut") },
    jobTimeout: 45000, shots,
    prepareFailure: async () => ({ prompt: "blusa coral", piece: "Blusa coral (simula falha do provador) (teste)" }),
  })
  t.check(frontDeletes.length === 1, "exclusão confirmada com clique triplo envia uma única requisição DELETE", String(frontDeletes.length))
  // Catalog parity: same queries as the demo e2e, through the UI (official API + database).
  const parity = {}
  for (const q of PARITY_QUERIES) parity[q] = await searchResultNames(page, q)
  writeFileSync(join(root, "test-results", "catalog-parity-official.json"), JSON.stringify(parity, null, 2))
  t.check(Object.values(parity).every((names) => names.length > 0), "buscas de paridade retornam peças no oficial")
  t.check(await page.locator('section[aria-label="Estúdio"] [data-testid="catalog-notice"]').isVisible().catch(() => false), "Estúdio identifica “Catálogo de teste”")
  // Reload while signed in: the session comes back from the HttpOnly cookie, the Estúdio keeps the history.
  await page.reload()
  await page.getByRole("heading", { name: "Estúdio" }).waitFor({ timeout: 15000 })
  t.check(await page.getByRole("button", { name: "Entrar" }).count() === 0, "recarregar mantém a sessão (cookie HttpOnly + refresh)")
  t.check(pageErrors.length === 0, "sem erros de JavaScript no navegador", pageErrors.join(" | "))
  await page.evaluate(() => { location.hash = "#/closet" })
  t.check(await page.getByText("Nenhum look guardado").waitFor({ timeout: 10000 }).then(() => true, () => false), "Closet vazio explica como guardar o primeiro look (sem carregamento infinito)")
  await page.evaluate(() => { location.hash = "#/perfil" })
  t.check(await page.getByTestId("measurements-unavailable").waitFor({ timeout: 10000 }).then(() => true, () => false), "Medidas indisponíveis mostram estado neutro no Perfil")
  t.check(unavailableCalls.length === 0, "nenhuma chamada a medidas, planos, preferências ou acervo durante a jornada", [...new Set(unavailableCalls)].join(","))
  // Photos persist (server + private storage): after reload, side and profile are still approved and in use.
  await page.evaluate(() => { location.hash = "#/perfil" })
  await page.getByTestId("photo-slot-profile").waitFor({ timeout: 15000 })
  await page.waitForFunction(() => document.querySelector('[data-testid="photo-state-profile"]')?.getAttribute("data-state") === "approved", null, { timeout: 15000 }).catch(() => undefined)
  t.check(await page.getByTestId("photo-state-profile").getAttribute("data-state") === "approved", "após recarregar, a foto de perfil continua salva e aprovada")
  t.check((await page.getByTestId("photo-slot-side").getAttribute("data-testid")) !== null && await page.locator('[data-testid="photo-slot-side"] img').count() > 0, "após recarregar, a foto três quartos continua salva")
  // Plan change is a server fact: the balance comes from the database, nothing resets on reload/login.
  const plan = spawnSync(process.execPath, ["--conditions=development", "--import", "tsx", "scripts/dev-db.ts", "--plan", emailA, "paid"], { cwd: root, encoding: "utf8", windowsHide: true })
  t.check(plan.status === 0, "conta A passa para o plano pago de teste (local)", (plan.stderr ?? "").slice(0, 200))
  await page.reload()
  await page.getByRole("heading", { name: "Perfil" }).first().waitFor({ timeout: 15000 }).catch(() => undefined)
  await page.evaluate(() => { location.hash = "#/estudio" })
  await page.getByRole("heading", { name: "Estúdio" }).waitFor({ timeout: 15000 })
  const header = await page.locator("header").first().innerText().catch(() => "")
  t.check(/\b100\b/.test(header), "plano pago: 120 moedas/dia − 20 já gastas hoje = 100 (saldo do backend, sem reset)", header.replace(/\s+/g, " ").slice(0, 120))
  for (let i = 0; i < 2; i++) { await page.reload(); await page.getByRole("heading", { name: "Estúdio" }).waitFor({ timeout: 15000 }) }
  t.check(/\b100\b/.test(await page.locator("header").first().innerText().catch(() => "")), "recarregar a página não redefine o saldo")

  // ------------------------------------------------------------- backend evidence for A
  const jobs = psql(`select status||':'||count(*) from private.ai_jobs where user_id=${lit(userA)} group by status order by 1`).split("\n").join(",")
  t.check(jobs === "failed:1,succeeded:2", "3 pedidos no banco: v1, v2 e a falha (o clique triplo não duplicou)", jobs)
  const usage = psql(`select reserved||'/'||spent from private.ai_daily_usage where user_id=${lit(userA)}`)
  t.check(usage === "0/2", "uso diário: 2 gerações (20 moedas), a falha não contou, nada reservado", usage)
  const stats = await fetch(`http://127.0.0.1:${PORTS.sim}/__stats`).then((r) => r.json())
  t.check(stats.submits === 3 && new Set(stats.keys).size === 3, "simulador recebeu 3 envios, um por pedido, chaves distintas", JSON.stringify({ submits: stats.submits }))
  t.check(stats.photoOk === stats.photoFetches && stats.photoOk === 3, "simulador baixou a foto pelo link temporário do Storage privado")
  const calls = psql(`select c.environment||':'||c.status||':'||coalesce(c.settled_usd_micros::text,'null') from private.provider_calls c join private.ai_jobs j on j.id=c.job_id where j.user_id=${lit(userA)} order by c.created_at`).split("\n")
  t.check(calls.length === 3 && calls.every((c) => c.startsWith("test:") && c.endsWith(":0")), "ledger: 3 chamadas no ambiente test, custo calculado 0 (simulador)", calls.join(","))
  const lineage = psql(`select string_agg(v.version||':'||(v.selection_snapshot->>'name')||':'||coalesce(v.selection_snapshot->>'render_mode',''),',' order by l.created_at,v.version) from private.look_versions v join private.looks l on l.id=v.look_id where v.user_id=${lit(userA)}`)
  t.check(lineage === "1:Blusa básica branca (teste):simulated,2:Jaqueta jeans azul (teste):simulated", "linhagem no banco: v1→v2; snapshot congelado e marcado como simulado", lineage)
  const v1Version = psql(`select v.id from private.look_versions v where v.user_id=${lit(userA)} and v.version=1`)
  t.check(evidence.v1Reopened.some((src) => new URL(src).pathname.endsWith(`/media/looks/${v1Version}`)), "v1 reaberta mostra a imagem da própria v1", evidence.v1Reopened.join(","))
  t.check(psql(`select count(*) from private.assets where user_id=${lit(userA)} and kind='body_photo' and body_angle='front' and state='ready'`) === "0", "foto de frente apagada no Perfil não fica disponível para gerar")
  const validations = psql(`select body_angle||':'||validation_status from private.assets where user_id=${lit(userA)} and kind='body_photo' and validation_status is not null order by created_at`).split("\n").join(",")
  t.check(validations === "front:approved,side:approved,profile:approved,front:needs_adjustment,side:needs_adjustment,front:approved,side:needs_adjustment,front:needs_adjustment", "banco: validação gravada por versão de foto (sha256), na ordem dos envios", validations)
  t.check(psql(`select count(*) from private.assets where user_id=${lit(userA)} and kind='body_photo' and validation_status is not null and (content_sha256 is null or validator_version not like 'mp-pose-full-%')`) === "0", "cada validação ligada ao sha256 da foto e à versão do validador local")

  // Private images: signed link works; tampered/absent signature does not; Storage is not public.
  const signed = new URL(evidence.v1Image)
  const img = await fetch(signed)
  t.check(img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/"), "link assinado devolve a imagem privada")
  const tampered = new URL(signed); tampered.searchParams.set("s", "A".repeat(43))
  t.check((await fetch(tampered)).status === 404, "assinatura adulterada é recusada")
  t.check((await fetch(`${signed.origin}${signed.pathname}`)).status === 404, "sem assinatura é recusado")
  const objectKey = psql(`select a.object_key from private.look_versions v join private.assets a on a.id=v.asset_id where v.id=${lit(signed.pathname.split("/").pop())}`)
  const publicUrl = `${status.API_URL}/storage/v1/object/public/generated-looks/${objectKey}`
  t.check((await fetch(publicUrl)).status >= 400, "bucket generated-looks não é público no Storage")
  const anon = await fetch(`${status.API_URL}/storage/v1/object/generated-looks/${objectKey}`, { headers: { apikey: status.PUBLISHABLE_KEY, Authorization: `Bearer ${status.PUBLISHABLE_KEY}` } })
  t.check(anon.status >= 400, "chave pública do Supabase não lê o objeto privado")

  // ------------------------------------------------------------- user B: isolation + session revocation
  t.check((await api("/auth/sign-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Bia Teste", email: emailB, password: "senhaTeste456" }) })).status === 202, "cadastro de B via API: 202 pendente")
  const verifyB = await api("/auth/email/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tokenHash: await confirmationToken(emailB) }) })
  const sessionB = await verifyB.json()
  const cookieB = (verifyB.headers.get("set-cookie") ?? "").split(";")[0]
  t.check(verifyB.status === 200 && typeof sessionB.accessToken === "string" && cookieB.startsWith("stylai_session="), "B confirma e recebe sessão (token em memória + cookie HttpOnly)")
  t.check(/HttpOnly/i.test(verifyB.headers.get("set-cookie") ?? "") && /Path=\/v1\/auth/i.test(verifyB.headers.get("set-cookie") ?? ""), "cookie de sessão HttpOnly e restrito a /v1/auth")
  const asB = (path, init = {}) => api(path, { ...init, headers: { Authorization: `Bearer ${sessionB.accessToken}`, ...(init.headers ?? {}) } })
  const v1Id = signed.pathname.split("/").pop()
  const jobA = psql(`select id from private.ai_jobs where user_id=${lit(userA)} and status='succeeded' order by created_at limit 1`)
  t.check((await asB(`/studio/looks/${v1Id}`)).status === 404, "B não abre look de A")
  t.check((await asB(`/studio/looks/${v1Id}/versions`)).status === 404, "B não lista versões de A")
  t.check((await asB(`/studio/jobs/${jobA}`)).status === 404, "B não vê job de A")
  t.check((await asB("/studio/looks").then((r) => r.json())).items.length === 0, "histórico de B vazio")
  const forged = new URL(signed); forged.searchParams.set("u", sessionB.user.id)
  t.check((await fetch(forged)).status === 404, "link de imagem redirecionado para B é recusado")
  // Generation is blocked by the API itself without consent/photo (not only by the interface).
  const product = psql("select p.id from public.products p where p.name='Jaqueta jeans azul (teste)'")
  const generate = (key) => asB("/studio/generations", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ productId: product }) })
  const noConsent = await generate(`b-noconsent-${run}`)
  t.check(noConsent.status === 403 && (await noConsent.json()).error.code === "consent_required", "API: sem consentimento, geração recusada (403)")
  // The photo route keeps its own limit (10/min per IP). A and B share 127.0.0.1 here: on 429 the test
  // checks the message, waits for Retry-After and sends again (the limit itself is not relaxed).
  let limited = null
  const upload = async (blob, name = "b.png") => {
    const send = () => { const form = new FormData(); form.append("file", blob, name); return asB("/me/body-photos/front", { method: "PUT", body: form }) }
    let r = await send()
    if (r.status === 429) {
      limited ??= { message: (await r.clone().json()).error?.message, retry: Number(r.headers.get("retry-after") ?? 60) }
      await delay((Number(r.headers.get("retry-after") ?? 60) + 1) * 1000)
      r = await send()
    }
    return r
  }
  const uploadNoConsent = await upload(new Blob([syntheticPng(480, 800, [90, 140, 90])], { type: "image/png" }))
  t.check(uploadNoConsent.status === 403 && (await uploadNoConsent.json()).error.code === "consent_required", "API: upload sem consentimento recusado com mensagem clara")
  await asB("/privacy/consents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: "2026-11-24-inline", purpose: "body_photo_try_on" }) })
  const noPhoto = await generate(`b-nophoto-${run}`)
  t.check(noPhoto.status === 409 && (await noPhoto.json()).error.code === "photo_required", "API: sem foto válida, geração recusada (409 photo_required)")
  const gif = await upload(new Blob([Buffer.from("GIF89a\x01\x00\x01\x00")], { type: "image/gif" }), "x.gif")
  t.check(gif.status === 422 && /JPEG, PNG ou WebP/.test((await gif.json()).error.message), "API: formato inválido → 422 com mensagem clara")
  const small = await upload(new Blob([syntheticPng(200, 300, [90, 140, 90])], { type: "image/png" }))
  t.check(small.status === 422 && /600 px/.test((await small.json()).error.message), "API: resolução abaixo de 600 px → 422 com mensagem clara")
  const big = await upload(new Blob([new Uint8Array(13 * 1024 * 1024)], { type: "image/png" }))
  t.check(big.status === 413, "API: arquivo acima de 12 MB → 413", String(big.status))
  // A file without a person is stored as a candidate that needs adjustment and never unlocks generation.
  const flat = await upload(new Blob([syntheticPng(480, 800, [90, 140, 90])], { type: "image/png" }))
  const flatBody = await flat.json()
  t.check(flat.status === 200 && flatBody.inUse === false && flatBody.validation?.status === "needs_adjustment", "API: imagem sem pessoa fica “precisa de ajuste” (validação no servidor)", JSON.stringify(flatBody.validation?.issues ?? []))
  const notApproved = await generate(`b-flat-${run}`)
  t.check(notApproved.status === 409, "API: foto não aprovada não libera geração (o cliente não decide)", String(notApproved.status))
  const real = testPhoto("front")
  const okUpload = await upload(new Blob([real.buffer], { type: "image/jpeg" }), "front.jpg")
  const okBody = await okUpload.json()
  t.check(okUpload.status === 200 && okBody.inUse === true && okBody.validation?.status === "approved", "B envia foto real de corpo inteiro: aprovada pelo validador local", JSON.stringify(okBody.validation ?? null))
  // QA-006: a phone JPEG with EXIF Orientation=6 (pixels sideways) is normalized once on the server.
  const exif = testPhoto("front-exif6")
  const exifUp = await upload(new Blob([exif.buffer], { type: "image/jpeg" }), "phone.jpg")
  const exifBody = await exifUp.json()
  t.check(exifUp.status === 200 && exifBody.validation?.status === "approved" && exifBody.image?.height > exifBody.image?.width,
    "API: JPEG de celular com EXIF de rotação é normalizado no servidor e aprovado (em pé)", `${exifUp.status} ${exifBody.image?.width}x${exifBody.image?.height}`)
  const removed = await asB("/me/body-photos/front", { method: "DELETE" })
  const afterDelete = await generate(`b-deleted-${run}`)
  t.check(removed.status === 204 && afterDelete.status === 409, "API: depois de apagar a foto, geração recusada de novo")
  const again = await upload(new Blob([real.buffer], { type: "image/jpeg" }), "front.jpg")
  t.check(again.status === 200 && (await again.json()).validation?.status === "approved", "B cadastra a foto de novo (resultado reaproveitado para os mesmos bytes)")
  if (limited) t.check(limited.message === "Muitas requisições. Tente novamente em instantes.", "API: limite de envios de foto responde 429 com mensagem clara (não 500)", JSON.stringify(limited))
  const steal = await asB("/studio/try-ons", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `steal-${run}-0001` }, body: JSON.stringify({ sourceLookId: v1Id, productIds: [product] }) })
  t.check(steal.status === 403, "B não cria versão a partir do look de A", String(steal.status))
  t.check((await api("/auth/refresh", { method: "POST", headers: { Cookie: cookieB, Origin: "https://evil.example" } })).status === 403, "refresh com Origin de outro site é recusado (CSRF)")
  t.check((await api("/auth/sign-out", { method: "POST", headers: { Cookie: cookieB } })).status === 204, "B sai da conta")
  t.check((await asB("/me")).status === 401, "token de B ainda válido no relógio é recusado após sair (sessão revogada)")
  t.check((await api("/auth/refresh", { method: "POST", headers: { Cookie: cookieB } })).status === 401, "cookie revogado não renova sessão")

  // ------------------------------------------------------------- telemetry phase A: Langfuse down
  const outboxA = () => psql(`select o.state||':'||count(*) from private.telemetry_outbox o join private.ai_jobs j on j.id=o.job_id where j.user_id=${lit(userA)} group by o.state order by o.state`).split("\n").join(",")
  const before = outboxA()
  t.check(!before.includes("sent") && /pending|sending/.test(before), "Langfuse fora do ar: eventos ficam na outbox (nenhum marcado como enviado)", before)
  t.check(jobs.includes("succeeded:2"), "Langfuse fora do ar não impediu os looks de serem concluídos")
  const payloads = psql(`select string_agg(o.payload::text,' ') from private.telemetry_outbox o join private.ai_jobs j on j.id=o.job_id where j.user_id=${lit(userA)}`)
  const forbidden = [emailA, userA, "Bearer", "token=", "/media/", "storage/v1", "senhaTeste", "x-api-key"]
  t.check(forbidden.every((f) => !payloads.includes(f)), "outbox sem e-mail, id real do usuário, tokens, URLs assinadas ou senha", forbidden.filter((f) => payloads.includes(f)).join(","))
  t.check(/u_[0-9a-f]{32}/.test(payloads) && payloads.includes("integration-test") && payloads.includes("synthetic"), "outbox usa pseudônimo, ambiente integration-test e marca synthetic")

  // ------------------------------------------------------------- telemetry phase B: real Langfuse
  if (!hasLangfuse) t.check(false, "credenciais do Langfuse presentes em apps/worker/.env.local")
  else {
    await stopChild(worker)
    // Re-queue now instead of waiting for the exponential backoff (operator action, same rows).
    psql(`update private.telemetry_outbox set next_attempt_at=now() where state='pending'`)
    worker = startWorker({ LANGFUSE_PUBLIC_KEY: langfuse.LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY: langfuse.LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL: langfuse.LANGFUSE_BASE_URL, LANGFUSE_TRACING_ENVIRONMENT: "integration-test" })
    let after = ""
    for (let i = 0; i < 120; i++) { after = outboxA(); if (!/pending|sending|retry/.test(after)) break; await delay(1000) }
    t.check(/^sent:\d+$/.test(after), "Langfuse de volta: todos os eventos da outbox enviados (2xx)", after)
    const auth = `Basic ${Buffer.from(`${langfuse.LANGFUSE_PUBLIC_KEY}:${langfuse.LANGFUSE_SECRET_KEY}`).toString("base64")}`
    const traceId = traceIdForJob(jobA)
    let rows = []
    for (let i = 0; i < 24 && rows.length < 4; i++) {
      await delay(5000)
      const r = await fetch(`${langfuse.LANGFUSE_BASE_URL}/api/public/v2/observations?traceId=${traceId}&fields=core,basic,usage&limit=50`, { headers: { Authorization: auth }, redirect: "error" })
      if (r.ok) rows = (await r.json()).data ?? []
    }
    const names = rows.map((r) => r.name).sort()
    t.check(["look-job", "persist", "selection", "try-on"].every((n) => names.includes(n)), "Langfuse: trace do job com look-job, selection, try-on e persist", names.join(","))
    t.check(rows.length > 0 && rows.every((r) => r.environment === "integration-test"), "Langfuse: ambiente integration-test (separado de development)")
    const gen = rows.find((r) => r.name === "try-on")
    t.check(gen && (gen.totalCost === 0 || gen.totalCost === null || gen.totalCost === undefined), "Langfuse: custo do try-on simulado é 0", JSON.stringify(gen?.costDetails ?? null))
    const text = JSON.stringify(rows)
    t.check(forbidden.every((f) => !text.includes(f)), "Langfuse: observações sem dados pessoais ou segredos")
    t.check(rows.filter((r) => r.name === "try-on").length === 1, "Langfuse: uma observação try-on por job (sem duplicata nesta execução)")
    console.log(`trace: ${langfuse.LANGFUSE_BASE_URL}/project/cmwpaucmw00jfad0d028xwkog/traces/${traceId}`)
  }
  await browser.close()
} finally {
  for (const child of children) killTree(child)
}
const failed = t.failed()
console.log(`\n${t.results.length - failed.length}/${t.results.length} verificações ok`)
if (failed.length) { console.error(`${failed.length} falha(s) no modo oficial`); process.exit(1) }
console.log("E2E oficial ok")
