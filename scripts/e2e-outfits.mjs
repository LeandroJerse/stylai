// Coordinated outfits end to end through the INTERFACE, without any paid call:
//   local Supabase + real API + real worker + FLUX SIMULATOR (loopback, free) + Vite + Chromium.
//   node --import tsx scripts/e2e-outfits.mjs                      -> synthetic test catalog (no network)
//   node --import tsx scripts/e2e-outfits.mjs --source=aliexpress  -> REAL AliExpress search and real reference downloads (free);
//                                                                     selection by rules (no Anthropic), images still simulated.
// Covers: photo + term, search stages, reload in the middle, swap, lock, new combination, versions, individual image,
// comparison with partial failure and recovery, unknown outcome (never resent), reconciliation, saved searches, isolation
// and photo removal. Credentials come from the existing DPAPI mechanism into the API child only; never printed.
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { chromium } from "playwright"
import { addProfilePhoto, createChecker, gotoTab, testPhoto } from "../apps/web/scripts/tryon-journey.mjs"
import { loadAliExpressEnvironment, withoutAliExpressEnv } from "./aliexpress-runtime.mjs"

const aliexpress = process.argv.includes("--source=aliexpress")
const root = process.cwd()
const OUT = resolve(root, `test-results/e2e-outfits-${aliexpress ? "aliexpress" : "simulado"}`)
mkdirSync(OUT, { recursive: true })
const PORTS = { sim: 54396, api: 3320, worker: 3321, web: 5195, pose: 54394 }
const ORIGIN = `http://localhost:${PORTS.web}`
const SIM = `http://127.0.0.1:${PORTS.sim}`
const t = createChecker(aliexpress ? "conjuntos/aliexpress" : "conjuntos/simulado")
const children = []
const killTree = (child) => { if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }); else child.kill() }
const status = JSON.parse(spawnSync(resolve(root, "node_modules/.bin/supabase"), ["status", "-o", "json"], { encoding: "utf8", windowsHide: true }).stdout || "{}")
if (!status.API_URL || !["localhost", "127.0.0.1"].includes(new URL(status.API_URL).hostname)) throw new Error("Local Supabase is not running: bun run supabase:start")
const MAILPIT = status.MAILPIT_URL ?? "http://127.0.0.1:54324"
const aliexpressEnv = aliexpress ? loadAliExpressEnvironment() : {}
const password = randomBytes(18).toString("base64url")
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`
function psql(sql) {
  const r = spawnSync("docker", ["exec", "-i", "supabase_db_stylai-local", "psql", "-XqtA", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", windowsHide: true })
  if (r.status !== 0) throw new Error(`psql: ${(r.stderr ?? "").slice(0, 300)}`)
  return r.stdout.trim()
}
/** What a simulated run must never touch: the pilot, its ledger, the limits and the paid calls. */
const protectedState = () => psql(`select md5(coalesce((select string_agg(p::text,'|' order by id) from private.ai_pilots p),'')||coalesce((select string_agg(d::text,'|' order by provider_call_id) from private.ai_pilot_dispatches d),'')
  ||coalesce((select string_agg(l::text,'|' order by scope,scope_key,period) from private.provider_budget_limits l),'')||(select count(*)::text from private.provider_calls where settled_usd_micros>0))`)
const protectedBefore = protectedState()

const seed = spawnSync(process.execPath, ["--import", "tsx", "scripts/dev-db.ts", "--fixtures"], { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, STYLAI_DEV_DB_PASSWORD: password } })
if (seed.status !== 0) throw new Error(`db:dev failed: ${(seed.stderr ?? "").replaceAll(password, "***").slice(0, 300)}`)
const dbUrl = (role) => `postgres://${role}:${password}@127.0.0.1:54322/postgres`
const supabaseEnv = { SUPABASE_URL: status.API_URL, SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY, SUPABASE_SECRET_KEY: status.SECRET_KEY, STYLAI_OBJECT_STORE: "supabase" }
const clean = withoutAliExpressEnv(Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(STYLAI_|SUPABASE_|LANGFUSE_|SEGMIND_|ANTHROPIC_|GEMINI_|FAL_|TELEMETRY_|VITE_)/.test(k))))
function start(name, command, args, env, cwd = root) {
  const log = createWriteStream(join(OUT, `${name}.log`))
  const child = spawn(command, args, { cwd, env: { ...clean, ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  child.stdout.pipe(log); child.stderr.pipe(log)
  children.push(child)
}
async function waitHttp(url, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { try { const r = await fetch(url); if (r.status < 500) return } catch { /* not yet */ } await delay(300) }
  throw new Error(`timeout waiting for ${url}`)
}
const tsx = ["--conditions=development", "--import", "tsx"]
const simulated = { SEGMIND_MODEL: "flux-3-klein-image-edit" }
const stats = () => fetch(`${SIM}/__stats`).then((r) => r.json())
const fault = (mode) => fetch(`${SIM}/__next?mode=${mode}`, { method: "POST" })

try {
  for (const port of Object.values(PORTS)) if (await fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)) throw new Error(`port ${port} already in use`)
  start("simulator", process.execPath, [...tsx, "scripts/segmind-simulator.ts", String(PORTS.sim)], { SEGMIND_SIMULATOR_DELAY_MS: "1200" })
  start("pose-analyzer", "uv", ["run", "tools/pose-validator/analyzer.py", "serve", String(PORTS.pose)], {})
  start("api", process.execPath, [...tsx, "apps/api/src/server.ts"], {
    NODE_ENV: "development", API_PORT: String(PORTS.api), SERVICE_HOST: "127.0.0.1", APP_ORIGIN: ORIGIN, API_PUBLIC_BASE_URL: `${ORIGIN}/v1`, STYLAI_API_DATABASE_URL: dbUrl("stylai_api"),
    STYLAI_SESSION_KEY: randomBytes(32).toString("base64"), STYLAI_RATE_LIMIT_PER_MINUTE: "1200", STYLAI_POSE_ANALYZER_URL: `http://127.0.0.1:${PORTS.pose}`, STYLAI_GENERATION_MODE: "simulated",
    STYLAI_CATALOG_MODE: "test_catalog", ...supabaseEnv, ...simulated, ...aliexpressEnv,
  })
  start("worker", process.execPath, [...tsx, "apps/worker/src/server.ts"], {
    NODE_ENV: "development", STYLAI_ENVIRONMENT: "test", WORKER_PORT: String(PORTS.worker), SERVICE_HOST: "127.0.0.1", STYLAI_AI_WORKER_DATABASE_URL: dbUrl("stylai_ai_worker"),
    TELEMETRY_PSEUDONYM_KEY: randomBytes(32).toString("hex"), SEGMIND_BASE_URL: SIM, WORKER_POLL_IDLE_MS: "300", ...supabaseEnv, ...simulated,
  })
  start("web", process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "--port", String(PORTS.web), "--strictPort"], { VITE_API_BASE_URL: `${ORIGIN}/v1`, VITE_API_PROXY_TARGET: `http://127.0.0.1:${PORTS.api}`, VITE_GOOGLE_CLIENT_ID: "" }, resolve(root, "apps/web"))
  await waitHttp(`${SIM}/__stats`); await waitHttp(`http://127.0.0.1:${PORTS.pose}/health`, 180000)
  await waitHttp(`http://127.0.0.1:${PORTS.api}/health/live`); await waitHttp(`http://127.0.0.1:${PORTS.worker}/health/live`); await waitHttp(ORIGIN)
  t.check((await fetch(`http://127.0.0.1:${PORTS.api}/health/ready`)).status === 200, "API pronta com a fronteira nova")
  let workerReady = 0
  for (let i = 0; i < 40 && workerReady !== 200; i++) { workerReady = (await fetch(`http://127.0.0.1:${PORTS.worker}/health/ready`)).status; await delay(250) }
  t.check(workerReady === 200, "worker pronto e consumindo", String(workerReady))

  const api = (path, init = {}) => fetch(`${ORIGIN}/v1${path}`, { ...init, headers: { Origin: ORIGIN, ...(init.headers ?? {}) } })
  const json = (body, headers = {}) => ({ method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
  async function token(email) {
    for (let i = 0; i < 40; i++) {
      const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((r) => r.json())
      const id = search.messages?.[0]?.ID
      if (id) {
        const message = await fetch(`${MAILPIT}/api/v1/message/${id}`).then((r) => r.json())
        const found = /token_hash=([A-Za-z0-9_-]+)/.exec((message.HTML ?? "").replaceAll("&amp;", "&"))?.[1]
        if (found) return found
      }
      await delay(500)
    }
    throw new Error("confirmation e-mail not received")
  }
  const run = randomBytes(4).toString("hex")
  const emailA = `conj-a-${run}@example.com`, emailB = `conj-b-${run}@example.com`
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e)))
  const shot = (name, fullPage = true) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage })
  /** Conjuntos / Imagens / Peças of the work area. */
  const view = async (id) => { const tab = page.getByTestId(`stage-tab-${id}`); await tab.waitFor({ timeout: 20000 }); await tab.click() }
  const openPiece = async (root, slot) => { const tile = root.getByTestId(`outfit-swap-${slot}`); if (await tile.getAttribute("aria-expanded") !== "true") await tile.click() }
  const inSight = (selector) => page.$eval(selector, (el) => { const r = el.getBoundingClientRect(); return r.bottom > 80 && r.top < innerHeight - 80 }).catch(() => false)
  const card = (i) => page.getByTestId("outfit-card").nth(i)
  const until = async (read, ok, timeout = 60000) => { const end = Date.now() + timeout; let v = await read(); while (!ok(v) && Date.now() < end) { await delay(400); v = await read() } return v }

  // ------------------------------------------------------------------ account, term and photo (Perfil)
  await page.goto(`${ORIGIN}/#/criar-conta`)
  await page.getByLabel("Nome").fill("Conjuntos Teste")
  await page.getByLabel("E-mail").fill(emailA)
  await page.getByLabel("Senha", { exact: true }).fill("senhaTeste123")
  await page.getByRole("button", { name: "Criar conta" }).click()
  await page.getByRole("heading", { name: "Confira seu e-mail" }).waitFor({ timeout: 15000 })
  await page.goto(`${ORIGIN}/#/confirmar-email?token_hash=${await token(emailA)}&type=email`)
  await page.getByRole("heading", { name: "Estúdio" }).waitFor({ timeout: 15000 })
  const userA = psql(`select id from auth.users where email=${lit(emailA)}`)
  t.check(spawnSync(process.execPath, [...tsx, "scripts/dev-db.ts", "--plan", emailA, "paid"], { cwd: root, windowsHide: true }).status === 0, "plano de teste local (120 moedas)")
  await page.reload()

  // ------------------------------------------------------------------ search, with a reload in the middle
  const prompt = aliexpress ? "roupas italianas elegantes masculinas para jantar, camisa social e calça de alfaiataria" : "look com blusa e calça"
  await gotoTab(page, ORIGIN, "estudio")
  const field = page.getByLabel("O que você quer vestir?")
  await field.fill(prompt)
  t.check(/não gera imagem e não gasta moedas/.test(await page.locator(".sa-cta-dock").innerText()), "a busca avisa que não gera nem gasta")
  if (aliexpress) { await page.getByTestId("filter-audience-masculino").click(); await page.getByLabel("Peça até R$").fill("400") }
  await page.getByTestId("outfit-search-button").dblclick()
  if (aliexpress) {
    await page.getByTestId("outfit-progress").waitFor({ timeout: 15000 })
    await shot("01-progresso", false)
    await page.reload()
  }
  await page.getByTestId("outfit-card").first().waitFor({ timeout: 120000 })
  t.check(await inSight('[data-testid="outfit-card"]'), "os conjuntos aparecem na tela, sem rolar")
  if (aliexpress) {
    t.check(/Masculino/.test(await page.getByTestId("outfit-filters").innerText()), "filtros usados aparecem junto do resultado")
    t.check(psql(`select coalesce(bool_and((x->>'priceMinor')::int <= case when x->>'slot'='set' then 80000 else 40000 end),false) from private.outfit_set_revisions r, jsonb_array_elements(r.pieces) x where r.user_id=${lit(userA)}`) === "t", "nenhuma peça acima do preço filtrado")
  }
  t.check(psql(`select count(*) from private.outfit_searches where user_id=${lit(userA)}`) === "1", "clique duplo e recarregar no meio: uma única busca")
  const count = await page.getByTestId("outfit-card").count()
  t.check(count >= 2 && count <= 4, "de 2 a 4 conjuntos coordenados", String(count))
  t.check(await page.getByTestId("outfit-card").filter({ hasText: "Recomendado" }).count() === 1, "um conjunto recomendado")
  t.check(/regras/.test(await page.getByTestId("outfit-method").innerText()), "seleção por regras identificada como regras (sem agente)")
  if (aliexpress) {
    const names = (await page.getByTestId("outfit-board").innerText()).toLowerCase()
    t.check(!/moletom|pel[úu]cia|jogger|lazer|uso dom[ée]stico/.test(names.split("como esta busca foi feita")[0]), "nenhuma peça de lazer no pedido elegante")
    const stored = psql(`select string_agg(x->>'slot'||': '||left(x->>'name',110),chr(10)) from private.outfit_set_revisions r, jsonb_array_elements(r.pieces) x where r.user_id=${lit(userA)}`)
    console.log(stored)
    t.check(!/peruca|broche|abotoadura|fantasia|halloween|: gravata|: caixa/i.test(stored), "nenhum acessório ou fantasia no lugar de roupa")
    t.check(!stored.split("\n").some((l) => /feminin/i.test(l) && !/masculin/i.test(l)), "pedido masculino não recebe peça só feminina")
    t.check(psql(`select count(*) from private.source_reference_cache where verified_at>now()-interval '10 minutes'`) !== "0", "referências reais baixadas, validadas e guardadas automaticamente")
    await card(0).locator('[data-testid^="outfit-swap-"]').first().click()
    t.check(await card(0).locator("a[data-link-kind]").count() > 0, "links da loja por peça")
    await card(0).locator('[data-testid^="outfit-swap-"]').first().click()
    t.check(psql(`select bool_and(x->>'reference' is not null) from private.outfit_set_revisions r, jsonb_array_elements(r.pieces) x where r.user_id=${lit(userA)}`) === "t", "toda peça sugerida já tem referência autorizada pela política")
  }
  await shot("02-conjuntos")

  // ------------------------------------------------------------------ the photo blocks before any spend; term + photo in Perfil
  const prepareSizes = async (i) => {
    for (const select of await card(i).locator('[data-testid^="outfit-size-"]').all()) {
      const rev = Number(await card(i).getAttribute("data-revision"))
      const value = await select.locator("option:not([disabled])").first().getAttribute("value")
      await select.selectOption(value)
      await until(() => card(i).getAttribute("data-revision"), (v) => Number(v) > rev, 15000)
    }
  }
  if (!aliexpress) for (let i = 0; i < Math.min(count, 3); i++) await prepareSizes(i)
  await card(0).getByTestId("outfit-generate").click()
  await page.getByTestId("outfit-quote").waitFor({ timeout: 60000 })
  t.check(await page.locator('[data-code="consent_required"]').count() === 1 && await page.getByTestId("outfit-confirm").isDisabled(), "sem termo e foto: a conferência bloqueia e explica")
  await page.getByRole("button", { name: "Abrir meu Perfil" }).click()
  t.check(/dentro do próprio pedido, sem link/.test(await page.getByTestId("photo-consent").innerText()), "termo novo diz que o FLUX recebe a imagem dentro do pedido")
  await addProfilePhoto(page, ORIGIN, testPhoto("front"), t)
  await gotoTab(page, ORIGIN, "estudio")
  await page.getByTestId("outfit-card").first().waitFor({ timeout: 20000 })
  t.check(await page.getByTestId("outfit-card").count() === count, "conjuntos continuam lá depois de sair e voltar")

  // ------------------------------------------------------------------ swap, lock, reload, new combination, versions
  const assembled = (await page.getByTestId("outfit-card").evaluateAll((els) => els.findIndex((e) => e.getAttribute("data-kind") === "assembled")))
  const target = card(assembled)
  const ids = async () => Object.fromEntries(await target.locator('[data-testid^="outfit-piece-"]').evaluateAll((els) => els.map((e) => [e.getAttribute("data-testid").replace("outfit-piece-", ""), e.getAttribute("data-product-id")])))
  const before = await ids()
  const setId = await target.getAttribute("data-set-id")
  await target.getByTestId("outfit-swap-upper").click()
  await target.getByTestId("outfit-use-alternative").first().waitFor({ timeout: 15000 })
  const alternative = await target.getByTestId("outfit-use-alternative").first().getAttribute("data-product-id")
  await target.getByTestId("outfit-use-alternative").first().click()
  const swapped = await until(ids, (x) => x.upper === alternative, 40000)
  t.check(swapped.upper === alternative && swapped.lower === before.lower, "troca de uma peça preserva a outra")
  await openPiece(target, "lower")
  const bottomLock = target.getByTestId("outfit-lock-lower")
  await bottomLock.click()
  await until(() => bottomLock.getAttribute("aria-pressed"), (v) => v === "true", 10000)
  await page.reload()
  await target.waitFor({ timeout: 20000 })
  await openPiece(target, "lower")
  t.check((await ids()).upper === alternative && await target.getByTestId("outfit-lock-lower").getAttribute("aria-pressed") === "true", "troca e trava sobrevivem ao recarregar")
  await target.getByTestId("outfit-suggest").click()
  const suggested = await until(ids, (x) => x.upper !== alternative, 60000)
  t.check(suggested.lower === before.lower && suggested.upper !== alternative, "outra combinação mantém a peça travada")
  await target.getByTestId("outfit-history").click()
  await target.getByTestId("outfit-versions").locator("li").first().waitFor({ timeout: 10000 })
  const versions = await target.getByTestId("outfit-versions").locator("li").count()
  t.check(versions >= 3, "histórico de versões do conjunto", String(versions))
  await target.getByTestId("outfit-versions").getByRole("button", { name: "Voltar" }).last().click()
  t.check((await until(ids, (x) => x.upper === before.upper, 15000)).upper === before.upper, "voltar a uma versão anterior")
  if (!aliexpress) for (let i = 0; i < Math.min(count, 3); i++) await prepareSizes(i)
  await target.getByTestId("outfit-history").click()

  // ------------------------------------------------------------------ individual image, triple click on confirm
  await card(0).getByTestId("outfit-generate").click()
  await page.getByTestId("outfit-quote").waitFor({ timeout: 60000 })
  t.check(await page.getByTestId("outfit-quote").getAttribute("data-ready") === "true", "com foto e termo o pedido pode ser confirmado", await page.getByTestId("outfit-quote").innerText())
  const overlay = await page.locator(".sa-overlay").boundingBox()
  t.check(overlay && overlay.x === 0 && overlay.y === 0 && overlay.width >= 1340 && overlay.height >= 890, "confirmação cobre a tela inteira", JSON.stringify(overlay))
  await delay(500)
  t.check(/Simulação/.test(await page.getByTestId("quote-cost").innerText()), "simulação identificada antes de confirmar")
  await shot("03-confirmacao", false)
  await page.getByTestId("outfit-confirm").click({ clickCount: 3 })
  const single = page.locator('[data-testid="render-card"][data-mode="individual"]').first()
  await single.waitFor({ timeout: 20000 })
  t.check(await inSight('[data-testid="render-card"][data-mode="individual"]'), "a geração aparece na tela, sem rolar")
  t.check(await until(() => single.getAttribute("data-status"), (v) => v === "succeeded" || v === "failed", 60000) === "succeeded", "imagem individual pronta", await single.innerText())
  t.check(psql(`select count(*) from private.outfit_renders where user_id=${lit(userA)}`) === "1" && (await stats()).outfits === 1, "clique triplo: um pedido e uma chamada ao provador")

  // ------------------------------------------------------------------ comparison: partial failure -> only the failed panel again
  const pick = async (n) => { for (let i = 0; i < n; i++) await card(i).getByTestId("outfit-select").check() }
  const askComparison = async (n) => {
    await view("sets")
    await pick(n)
    await page.getByTestId("outfit-compare").click()
    await page.getByTestId("outfit-quote").waitFor({ timeout: 60000 })
    t.check(await page.getByTestId("outfit-quote").getAttribute("data-ready") === "true", `comparativo de ${n} pode ser confirmado`, await page.getByTestId("outfit-quote").innerText())
    await page.getByTestId("outfit-confirm").click()
  }
  const n = Math.min(count, 3)
  await fault("reject")
  await askComparison(n)
  const compare = page.locator('[data-testid="render-card"][data-mode="comparison"]').first()
  await compare.waitFor({ timeout: 20000 })
  await page.reload()
  await view("images")
  await compare.waitFor({ timeout: 20000 })
  t.check(await until(() => compare.getAttribute("data-status"), (v) => v === "partial", 90000) === "partial", "falha de um painel: comparativo parcial, sobrevive ao recarregar", await compare.innerText())
  t.check(await compare.locator('[data-state="ready"]').count() === n - 1 && await compare.locator('[data-state="failed"]').count() === 1, "os painéis prontos foram mantidos")
  await shot("04-parcial")
  const callsBefore = (await stats()).outfits
  await compare.getByTestId("render-retry").dblclick()
  t.check(await until(() => compare.getAttribute("data-status"), (v) => v === "succeeded", 90000) === "succeeded", "“gerar o que falta” completa o comparativo", await compare.innerText())
  t.check((await stats()).outfits === callsBefore + 1, "só o painel que falhou foi gerado de novo (uma chamada)", String((await stats()).outfits - callsBefore))
  const montage = compare.locator(".sa-render-comparison img")
  const size = await until(() => montage.evaluate((el) => [el.naturalWidth, el.naturalHeight]), ([w]) => w > 0, 15000)
  t.check(size[0] > 1000 && size[1] > 1000, "comparativo montado pelo servidor e exibido", size.join("x"))
  t.check(psql(`select count(distinct j.photo_id) from private.ai_jobs j where j.user_id=${lit(userA)} and render_id is not null`) === "1", "todos os painéis usam a mesma foto original")
  await compare.scrollIntoViewIfNeeded()
  await shot("05-comparativo")

  // ------------------------------------------------------------------ unknown outcome: never resent, explicit choices
  await fault("unknown")
  await askComparison(n)
  const doubtful = page.locator('[data-testid="render-card"][data-mode="comparison"]').first()
  await until(() => page.locator('[data-testid="render-card"][data-mode="comparison"]').count(), (v) => v === 2, 20000)
  await until(() => doubtful.getAttribute("data-status"), (v) => v === "partial" || v === "failed", 90000)
  t.check(await doubtful.locator('[data-state="needs_reconciliation"]').count() === 1 && await doubtful.getByTestId("render-retry").count() === 0, "resultado desconhecido: em conferência, sem botão de refazer", await doubtful.innerText())
  const unknownPanel = await doubtful.locator('[data-state="needs_reconciliation"]').getAttribute("data-panel")
  const doubtfulId = await doubtful.getAttribute("data-render-id")
  const held = (await stats()).outfits
  await delay(3000)
  t.check((await stats()).outfits === held, "nenhum reenvio automático do resultado desconhecido")
  // Operator evidence (simulator answered nothing and charged nothing) settles the call; only then the panel may run again.
  const call = psql(`select c.id from private.provider_calls c join private.ai_jobs j on j.id=c.job_id where j.render_id=${lit(doubtfulId)} and j.panel=${unknownPanel} and c.status='unknown'`)
  t.check(/^[0-9a-f-]{36}$/.test(call), "chamada desconhecida registrada no ledger")
  psql(`select private.reconcile_provider_call(${lit(call)},'failed',0,'provider_confirmed','{"simulated":true}'::jsonb)`)
  await page.reload()
  await view("images")
  await doubtful.getByTestId("render-retry").waitFor({ timeout: 20000 })
  t.check(true, "depois da conferência o painel volta a poder ser gerado")
  if (n > 2) {
    await doubtful.getByTestId("render-finalize").click()
    t.check(await until(() => doubtful.getAttribute("data-status"), (v) => v === "succeeded", 60000) === "succeeded", "“montar com as prontas” é uma escolha explícita e funciona", await doubtful.innerText())
  } else {
    await doubtful.getByTestId("render-retry").click()
    t.check(await until(() => doubtful.getAttribute("data-status"), (v) => v === "succeeded", 60000) === "succeeded", "painel refeito depois da conferência")
  }
  const ledger = psql(`select string_agg(distinct c.environment||':'||c.model,',')||' '||coalesce(sum(c.settled_usd_micros),0)||' '||count(*) filter (where c.status in ('reserved','dispatched','unknown')) from private.provider_calls c join private.ai_jobs j on j.id=c.job_id where j.user_id=${lit(userA)}`)
  t.check(ledger === "test:flux-3-klein-image-edit 0 0", "ledger: ambiente test, modelo FLUX, custo 0, nada pendente", ledger)
  t.check(psql(`select count(*) from private.outfit_budget_holds where user_id=${lit(userA)} and released_at is null`) === "0", "nenhuma retenção de orçamento ficou presa")

  // ------------------------------------------------------------------ another saved outfit later
  await field.fill(aliexpress ? "roupas de frio masculinas, casaco, suéter e calça" : "vestido")
  await page.getByTestId("outfit-search-button").click()
  await until(() => psql(`select count(*) from private.outfit_searches where user_id=${lit(userA)} and status in ('succeeded','empty')`), (v) => v === "2", 120000)
  await page.getByTestId("outfit-progress").waitFor({ state: "detached", timeout: 120000 }).catch(() => undefined)
  await shot("06-segunda-busca")
  if (aliexpress) console.log(psql(`select string_agg(x->>'slot'||': '||left(x->>'name',110),chr(10)) from private.outfit_set_revisions r join private.outfit_sets s on s.id=r.set_id and r.revision=1, jsonb_array_elements(r.pieces) x where r.user_id=${lit(userA)} and s.search_id=(select id from private.outfit_searches where user_id=${lit(userA)} order by created_at desc limit 1)`))
  t.check(await page.getByTestId("outfit-board").getAttribute("data-view") === "sets", "buscar de novo volta para os conjuntos")
  t.check(await page.getByTestId("outfit-card").count() > 0 || await page.getByTestId("outfit-message").count() > 0, "segunda busca: conjuntos ou explicação honesta", (await page.getByTestId("outfit-message").innerText().catch(() => "")).slice(0, 160))
  const options = await page.getByTestId("outfit-history-select").locator("option").count()
  t.check(options === 2, "histórico lista as duas buscas", String(options))
  await page.getByTestId("outfit-history-select").selectOption({ index: 1 })
  await page.locator(`[data-testid="outfit-card"][data-set-id="${setId}"]`).waitFor({ timeout: 15000 })
  const other = page.locator('[data-testid="outfit-card"]').nth(1)
  await other.getByTestId("outfit-generate").click()
  await page.getByTestId("outfit-quote").waitFor({ timeout: 60000 })
  await page.getByTestId("outfit-confirm").click()
  await until(() => page.locator('[data-testid="render-card"][data-mode="individual"]').count(), (v) => v === 2, 20000)
  const later = page.locator('[data-testid="render-card"][data-mode="individual"]').first()
  t.check(await until(() => later.getAttribute("data-status"), (v) => v === "succeeded", 60000) === "succeeded", "outro conjunto salvo gerado depois")

  // ------------------------------------------------------------------ every piece found, buscar outra, Match and Closet
  await view("pieces")
  await page.getByTestId("found-piece").first().waitFor({ timeout: 20000 })
  const foundCount = await page.getByTestId("found-piece").count()
  t.check(aliexpress ? foundCount >= 20 : foundCount >= 4, "todas as peças encontradas aparecem", String(foundCount))
  await shot("08-pecas")
  await view("sets")
  const searched = page.locator(`[data-testid="outfit-card"][data-kind="assembled"]`).first()
  await openPiece(searched, "upper")
  const revisionBefore = await searched.getAttribute("data-revision")
  await page.getByTestId("outfit-option-query").fill(aliexpress ? "camisa masculina" : "blusa")
  await page.keyboard.press("Enter")
  const note = await until(() => page.getByTestId("outfit-option-note").innerText(), (v) => v !== "" && !v.startsWith("Buscando"), 60000)
  t.check(/opç/.test(note) && await searched.getAttribute("data-revision") === revisionBefore, "“buscar outra” responde sem mudar o conjunto", note)
  const held2 = (await stats()).outfits
  await page.getByTestId("open-match").click()
  await page.getByRole("dialog", { name: "Match" }).waitFor({ timeout: 20000 })
  await page.getByRole("button", { name: /^Guardar/ }).waitFor({ timeout: 20000 })
  await shot("09-match", false)
  await page.keyboard.press("ArrowRight")
  await until(() => psql(`select count(*) from private.saved_looks where user_id=${lit(userA)}`), (v) => v === "1", 10000)
  await page.keyboard.press("ArrowLeft")
  await until(() => psql(`select count(*) from private.look_decisions where user_id=${lit(userA)}`), (v) => v === "2", 10000)
  t.check(psql(`select string_agg(decision,',' order by created_at) from private.look_decisions where user_id=${lit(userA)}`) === "save,pass", "Match: direita guarda, esquerda passa")
  t.check(psql(`select bool_and(a.expires_at is null) from private.saved_looks s join private.assets a on a.id=s.asset_id where s.user_id=${lit(userA)}`) === "t", "a imagem guardada não expira mais")
  t.check(Number(psql(`select count(*) from private.saved_look_products where user_id=${lit(userA)}`)) >= 1, "as roupas do look foram guardadas junto")
  t.check((await stats()).outfits === held2, "Match não gera imagem nem chama provador")
  await page.getByRole("button", { name: "Fechar match" }).click()
  await page.evaluate(() => { location.hash = "#/closet" })
  await page.getByRole("heading", { name: "Closet", exact: true }).waitFor({ timeout: 15000 })
  t.check(/1 look guardado · [1-9]/.test(await until(() => page.locator(".sa-page").last().innerText(), (v) => /look guardado/.test(v), 15000)), "Closet mostra a imagem e as peças")
  await page.reload()
  await page.locator(".sa-view:not([hidden]) .sa-grid img").first().waitFor({ timeout: 15000 })
  t.check(await until(() => page.locator(".sa-view:not([hidden]) .sa-grid img").first().evaluate((el) => el.naturalWidth), (v) => v > 0, 15000) > 0, "depois de recarregar, a imagem guardada abre no Closet")
  await shot("10-closet", false)
  await gotoTab(page, ORIGIN, "estudio")
  await page.getByTestId("outfit-board").waitFor({ timeout: 20000 })

  // ------------------------------------------------------------------ isolation, mobile and photo removal
  t.check((await api("/auth/sign-up", json({ name: "Outra", email: emailB, password: "senhaTeste456" }))).status === 202, "segunda conta")
  const sessionB = await (await api("/auth/email/verify", json({ tokenHash: await token(emailB) }))).json()
  const asB = (path, init = {}) => api(path, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${sessionB.accessToken}` } })
  const searchA = psql(`select id from private.outfit_searches where user_id=${lit(userA)} order by created_at limit 1`)
  const statuses = await Promise.all([asB(`/studio/outfit-searches/${searchA}`), asB(`/studio/outfit-sets/${setId}`), asB(`/studio/outfit-renders/${doubtfulId}`), asB(`/studio/outfit-renders/${doubtfulId}/retry`, json({ panel: 1 })),
    asB(`/studio/outfit-sets/${setId}/locks`, json({ locked: [], base: 1 })), asB("/studio/outfit-renders/quote", json({ mode: "individual", sets: [{ setId, revision: 1 }] }))])
  t.check(statuses.every((r) => r.status === 404), "outra conta não vê nem muda nada (404)", statuses.map((r) => r.status).join(","))
  await view("images")
  const finished = page.locator('[data-testid="render-card"][data-mode="comparison"][data-status="succeeded"]').last()
  if (!(await finished.getAttribute("data-open"))) await finished.getByTestId("render-open").click()
  const image = await finished.locator(".sa-render-comparison img").getAttribute("src")
  const forged = new URL(image); forged.searchParams.set("u", sessionB.user.id)
  t.check((await fetch(image)).status === 200 && (await fetch(forged)).status === 404, "imagem do comparativo só pelo link assinado do dono")
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(400)
  t.check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "celular (390 px): sem rolagem horizontal")
  await shot("07-celular")
  await page.setViewportSize({ width: 1360, height: 900 })
  const stored = psql(`select count(*) from private.assets where user_id=${lit(userA)} and kind='body_photo' and state='ready'`)
  await gotoTab(page, ORIGIN, "perfil")
  await page.evaluate(() => document.getElementById("fotos")?.scrollIntoView())
  await page.getByRole("button", { name: "Apagar foto Frente" }).click()
  await page.locator('[aria-label="Confirmar exclusão da foto Frente"]').click()
  const gone = await until(() => psql(`select count(*) from private.assets where user_id=${lit(userA)} and kind='body_photo' and state='ready'`), (v) => v === "0", 10000)
  t.check(stored === "1" && gone === "0", "foto apagada no Perfil")
  await gotoTab(page, ORIGIN, "estudio")
  await view("sets")
  await card(0).waitFor({ timeout: 20000 })
  await card(0).getByTestId("outfit-generate").click()
  await page.getByTestId("outfit-quote").waitFor({ timeout: 60000 })
  t.check(await page.locator('[data-code="photo_required"]').count() === 1 && await page.getByTestId("outfit-confirm").isDisabled(), "sem foto nada pode ser gerado")
  t.check(pageErrors.length === 0, "sem erros de JavaScript no navegador", pageErrors.join(" | "))
  t.check(protectedState() === protectedBefore, "piloto, limites e chamadas pagas intactos")
  console.log(JSON.stringify({ simulator: await stats(), conjuntos: count }))
  await browser.close()
} finally {
  for (const child of children) killTree(child)
}
const failed = t.failed()
console.log(`\n${t.results.length - failed.length}/${t.results.length} verificações ok (${aliexpress ? "AliExpress real, imagens simuladas" : "catálogo de teste, imagens simuladas"})`)
if (failed.length) process.exit(1)
