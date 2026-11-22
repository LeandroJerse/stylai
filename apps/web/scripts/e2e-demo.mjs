/**
 * Demo mode in a real browser: the production screens over the in-memory adapter (demo/).
 * No API, worker, database or provider runs. Covers sign-up confirmation, the ORIGINAL Estúdio
 * journey (shared with the official test), the person's own photo shown locally, the generation
 * block without a photo, and that ?demo=full still opens the complete prototype.
 * Run: bun run e2e:demo   (screenshots in test-results/e2e-demo/)
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createChecker, gotoTab, PARITY_QUERIES, runStudioJourney, searchResultNames, syntheticPng, testPhoto } from "./tryon-journey.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const PORT = 5196
const BASE = `http://localhost:${PORT}/`
const SHOTS = join(root, "test-results", "e2e-demo")
mkdirSync(SHOTS, { recursive: true })
const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js")
const server = spawn(process.execPath, [vite, "--config", "demo/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "pipe" })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("demo dev server did not start")), 30_000)
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && (clearTimeout(t), resolve()))
})

const t = createChecker("demo")
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  const outbound = []
  page.on("pageerror", (e) => errors.push(String(e)))
  // The demo must never send the selected photo (or anything) to a backend.
  page.on("request", (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith("blob:") && !r.url().startsWith("data:") && !/fonts\.(googleapis|gstatic)\.com/.test(r.url())) outbound.push(r.url()) })
  const shots = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) })
  const openBar = () => page.$eval(".sa-preview-bar details", (d) => { d.open = true })
  const closeBar = () => page.$eval(".sa-preview-bar details", (d) => { d.open = false })

  // Sign-up never signs in by itself; the (demo) confirmation link does.
  // ?casos=teste adds the synthetic edge cases (simulated failure) used by the shared journey, as in the official e2e.
  await page.goto(`${BASE}?demo=visitor&casos=teste#/criar-conta`)
  await page.getByLabel("Nome").fill("Pessoa Demo")
  await page.getByLabel("E-mail").fill("demo@example.com")
  await page.getByLabel("Senha", { exact: true }).fill("senha1234")
  await page.getByRole("button", { name: "Criar conta" }).click()
  await page.getByRole("heading", { name: "Confira seu e-mail" }).waitFor()
  t.check(true, "cadastro pede confirmação de e-mail (sem sessão)")
  await openBar()
  await page.getByRole("button", { name: "Abrir link de confirmação do cadastro" }).click()
  await closeBar()
  await page.getByRole("heading", { name: "Estúdio" }).waitFor({ timeout: 10000 })
  t.check(page.url().includes("#/estudio"), "link de confirmação entra na conta e abre o Estúdio")

  const own = syntheticPng(480, 800, [30, 140, 90])
  await runStudioJourney(page, t, {
    // Same test catalog and same authorized photos as the official journey; validation runs in this browser.
    base: BASE, pieceA: "Blusa básica branca (teste)", pieceB: "Jaqueta jeans azul (teste)", promptA: "blusa branca", promptB: "jaqueta jeans",
    startCoins: 120, // the demo starts on the paid plan
    photos: { front: testPhoto("front"), side: testPhoto("side"), profile: testPhoto("profile"), selfie: testPhoto("selfie"), twoPeople: testPhoto("two-people"), tightTop: testPhoto("front-tight-top"), headCut: testPhoto("profile-head-cut") },
    jobTimeout: 15000, shots,
    prepareFailure: async () => ({ prompt: "blusa coral", piece: "Blusa coral (simula falha do provador) (teste)" }),
  })
  // Catalog parity: the same queries are recorded here and in the official e2e, then compared.
  const parity = {}
  for (const q of PARITY_QUERIES) parity[q] = await searchResultNames(page, q)
  writeFileSync(join(root, "..", "..", "test-results", "catalog-parity-demo.json"), JSON.stringify(parity, null, 2))
  t.check(Object.values(parity).every((names) => names.length > 0), "buscas de paridade retornam peças na demo")
  t.check(await page.locator(".sa-stage-photo img").count() === 0 || !(await page.$eval(".sa-stage-photo img", (i) => /unsplash|try-front|media\//.test(i.src)).catch(() => false)), "resultado da demo não usa foto de pessoa pré-definida")

  // The photo shown in the Perfil is the selected file itself (local object URL), not a stock photo.
  await gotoTab(page, BASE, "perfil")
  await page.getByTestId("photo-input-front").setInputFiles(testPhoto("front"))
  await page.getByRole("button", { name: "Trocar foto Frente" }).waitFor({ timeout: 30000 })
  const src = await page.$eval('[data-testid="photo-slot-front"] img', (i) => i.src)
  t.check(src.startsWith("blob:"), "demo mostra a própria foto escolhida (URL local), não a foto fixa", src.slice(0, 40))
  // A file without a person is never approved by the in-browser validator.
  await page.getByTestId("photo-input-front").setInputFiles({ name: "minha.png", mimeType: "image/png", buffer: own })
  await page.waitForFunction(() => document.querySelector('[data-testid="photo-state-front"]')?.getAttribute("data-state") === "needs-adjustment", null, { timeout: 30000 }).catch(() => undefined)
  t.check(await page.getByTestId("photo-state-front").getAttribute("data-state") === "needs-adjustment", "imagem sem pessoa: “Precisa de ajuste” também na demo")
  await page.getByTestId("photo-input-front").setInputFiles({ name: "x.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") })
  await page.waitForTimeout(500)
  t.check((await page.locator("#fotos [role=alert]").allInnerTexts()).join(" ").length > 0, "formato inválido tem mensagem clara")
  await shots("10-perfil-foto-propria")

  // QA-011: plan scenarios show the right balance and survive a reload; "Reiniciar demo" goes back to paid.
  const coinsLabel = () => page.locator('button[aria-label^="Saldo:"]').first().getAttribute("aria-label")
  await openBar(); await page.getByRole("button", { name: "Plano gratuito (30 moedas)" }).click()
  await page.waitForURL(/plano=gratuito/)
  await page.locator('button[aria-label^="Saldo:"]').first().waitFor()
  t.check((await coinsLabel())?.includes("Saldo: 30 moedas"), "cenário gratuito mostra 30 moedas", String(await coinsLabel()))
  await page.locator('button[aria-label^="Saldo:"]').first().click()
  await page.getByTestId("plan-list").getByText("Atual").waitFor({ timeout: 10000 }).catch(() => undefined)
  t.check(await page.getByTestId("plan-list").getByText("Atual").count() === 1 && (await page.getByTestId("plan-list").innerText()).match(/Gratuito\s*Atual/) !== null, "plano atual = Gratuito na folha de saldo")
  await page.keyboard.press("Escape")
  await page.reload(); await page.locator('button[aria-label^="Saldo:"]').first().waitFor()
  t.check((await coinsLabel())?.includes("Saldo: 30 moedas"), "depois de recarregar, continua no gratuito (30)", String(await coinsLabel()))
  await openBar(); await page.getByRole("button", { name: "Plano pago (120 moedas)" }).click()
  await page.waitForURL(/plano=pago/); await page.locator('button[aria-label^="Saldo:"]').first().waitFor()
  t.check((await coinsLabel())?.includes("Saldo: 120 moedas"), "cenário pago mostra 120 moedas", String(await coinsLabel()))
  await openBar(); await page.getByRole("button", { name: "Plano gratuito (30 moedas)" }).click(); await page.waitForURL(/plano=gratuito/)
  await openBar(); await page.getByRole("button", { name: "Reiniciar demo" }).click()
  await page.waitForURL((u) => !u.searchParams.has("plano")); await page.locator('button[aria-label^="Saldo:"]').first().waitFor()
  t.check((await coinsLabel())?.includes("Saldo: 120 moedas"), "reiniciar a demo volta ao padrão (pago, 120) e limpa a escolha de plano", String(await coinsLabel()))

  // Navigation across tabs with the same adapter.
  await gotoTab(page, BASE, "explorar")
  t.check(await page.getByText("Blusa básica branca (teste)").first().waitFor({ timeout: 10000 }).then(() => true, () => false), "Explorar lista o mesmo catálogo de teste do oficial")
  t.check(await page.locator('section[aria-label="Explorar"] [data-testid="catalog-notice"]').isVisible(), "Explorar identifica “Catálogo de teste”")
  t.check(await page.getByText("SHEIN").count() === 0 && await page.getByText(/lojas parceiras/i).count() === 0, "sem SHEIN nem “lojas parceiras” na experiência padrão")

  // The complete prototype remains reachable.
  await page.goto(`${BASE}?demo=full#/estudio`)
  await page.getByRole("heading", { name: "Estúdio" }).waitFor()
  t.check(await page.getByTestId("search-button").count() === 0 && await page.getByRole("radio", { name: "Procurar" }).count() > 0, "?demo=full abre o protótipo completo (busca e Match simulados)")
  await shots("11-prototipo-completo")
  t.check(errors.length === 0, "sem erros de JavaScript", errors.join(" | "))
  t.check(outbound.length === 0, "nada foi enviado para fora do navegador", outbound.slice(0, 3).join(" | "))
} finally {
  await browser.close()
  server.kill()
}
if (t.failed().length) { console.error(`\n${t.failed().length} falha(s) no modo demo`); process.exit(1) }
console.log("\nE2E demo ok")
