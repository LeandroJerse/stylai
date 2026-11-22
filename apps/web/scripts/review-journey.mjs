/**
 * Records the review journey (choose piece -> generate -> swap -> reopen v1) against servers that
 * are ALREADY running locally: official front (+ API, worker, Segmind simulator) and the demo.
 * Output: one video (.webm) and screenshots per mode in test-results/review/<mode>/.
 * Usage: node scripts/review-journey.mjs --official http://localhost:5193 --demo http://127.0.0.1:5192
 *        [--mailpit http://127.0.0.1:54324] [--email revisao@example.com --password ...]
 * Creates a LOCAL test account in the official mode (local Supabase only). Never targets hosted URLs.
 */
import { mkdirSync, readdirSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { syntheticPng } from "./tryon-journey.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : fallback }
const official = arg("--official", null)
const demo = arg("--demo", null)
const mailpit = arg("--mailpit", "http://127.0.0.1:54324")
const email = arg("--email", `revisao-${Date.now().toString(36)}@example.com`)
const password = arg("--password", "Revisao2026")
for (const u of [official, demo, mailpit]) if (u && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(u)) throw new Error(`local URLs only: ${u}`)

async function slow(page, ms = 900) { await page.waitForTimeout(ms) }
async function pick(page, name) {
  await page.getByTestId("open-picker").click(); await slow(page, 700)
  await page.getByTestId("picker-item").filter({ hasText: name }).first().click()
  await page.getByTestId("chosen-name").filter({ hasText: name }).waitFor()
  const select = page.locator('[data-testid="piece-panel"] select')
  if (await select.count()) await select.selectOption({ index: 1 })
  await slow(page)
}
async function journey(page, shot, a, b) {
  await page.getByRole("heading", { name: "Estúdio" }).waitFor(); await slow(page)
  if (await page.getByTestId("consent-checkbox").count()) {
    await page.getByTestId("consent-checkbox").check(); await slow(page, 500)
    await page.getByRole("button", { name: "Autorizar e continuar" }).click()
  }
  await page.getByTestId("photo-input").waitFor({ state: "attached" })
  await page.getByTestId("photo-input").setInputFiles({ name: "frente.png", mimeType: "image/png", buffer: syntheticPng(480, 800, [210, 190, 170]) })
  await page.getByText("Trocar foto").waitFor({ timeout: 15000 }); await shot("1-foto")
  await pick(page, a); await shot("2-peca-escolhida")
  await page.getByTestId("start-tryon").click()
  await page.getByTestId("job-running").waitFor({ timeout: 10000 }); await shot("3-processando")
  await page.getByRole("heading", { name: /Versão 1/ }).waitFor({ timeout: 45000 }); await slow(page, 1500); await shot("4-resultado-v1")
  await pick(page, b); await shot("5-trocar-peca")
  await page.getByTestId("start-tryon").click()
  await page.getByRole("heading", { name: /Versão 2/ }).waitFor({ timeout: 45000 }); await slow(page, 1500); await shot("6-resultado-v2")
  await page.getByTestId("version-strip").getByRole("radio", { name: "v1" }).click()
  await page.getByRole("heading", { name: /Versão 1/ }).waitFor(); await slow(page, 1500); await shot("7-v1-reaberta")
}

async function record(mode, run) {
  const dir = join(root, "test-results", "review", mode)
  mkdirSync(dir, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, recordVideo: { dir, size: { width: 1280, height: 860 } } })
  // Fixture garment images exist only as test data: served locally, never fetched from the internet.
  await context.route("https://fixtures.stylai.test/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: syntheticPng(300, 400, route.request().url().includes("jaqueta") ? [40, 90, 160] : [180, 60, 80]) }))
  const page = await context.newPage()
  const shot = (name) => page.screenshot({ path: join(dir, `${name}.png`) })
  try { await run(page, shot) } finally {
    await context.close(); await browser.close()
    for (const f of readdirSync(dir)) if (f.endsWith(".webm") && f !== "jornada.webm") renameSync(join(dir, f), join(dir, "jornada.webm"))
  }
  console.log(`${mode}: ${dir}`)
}

if (official) await record("oficial", async (page, shot) => {
  await page.goto(`${official}/#/criar-conta`)
  await page.getByLabel("Nome").fill("Revisão StylAI"); await page.getByLabel("E-mail").fill(email)
  await page.getByLabel("Senha", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Criar conta" }).click()
  await page.getByRole("heading", { name: "Confira seu e-mail" }).waitFor(); await shot("0-confirme-email")
  let token = null
  for (let i = 0; i < 40 && !token; i++) {
    const s = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then((r) => r.json())
    const id = s.messages?.[0]?.ID
    if (id) token = /token_hash=([A-Za-z0-9_-]+)/.exec((await fetch(`${mailpit}/api/v1/message/${id}`).then((r) => r.json())).HTML ?? "")?.[1] ?? null
    if (!token) await page.waitForTimeout(500)
  }
  if (!token) throw new Error("confirmation e-mail not found in Mailpit")
  await page.goto(`${official}/#/confirmar-email?token_hash=${token}&type=email`)
  await journey(page, shot, "Blusa de teste A", "Jaqueta de teste B")
  console.log(`conta local de revisão: ${email}`)
})
if (demo) await record("demo", async (page, shot) => {
  await page.goto(`${demo}/#/estudio`)
  await journey(page, shot, "Blazer oversized de lã fria", "Trench de gabardine com faixa")
})
