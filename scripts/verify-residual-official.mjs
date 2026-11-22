// Runs only against the already-running local simulation; no provider calls or env changes.
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { chromium } from "playwright"

const origin = "http://localhost:5198"
const mailpit = "http://127.0.0.1:54324"
const out = "test-results/residual-official"
mkdirSync(out, { recursive: true })
assert.equal((await fetch("http://127.0.0.1:3100/health/ready")).status, 200, "API must be ready")
const config = await fetch(`${origin}/v1/studio/config`).then(r => r.json())
assert.equal(config.generationMode, "simulated")
const browser = await chromium.launch()
const report = { origin, mode: config.generationMode, signupLink: false, resendLink: false, confirmed: false, routes: [], unsupported: [], unavailable: [], errors: [] }
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  page.on("request", r => {
    const path = new URL(r.url()).pathname
    if (/^\/v1\/(me\/measurements|closet|plans|studio\/match\/deck)(\/|$)/.test(path)) report.unsupported.push(path)
  })
  page.on("response", r => { if (r.status() === 503) report.unavailable.push(new URL(r.url()).pathname) })
  page.on("pageerror", () => report.errors.push("browser pageerror"))
  const email = `qa-residual-${randomUUID()}@example.com`
  await page.goto(`${origin}/#/criar-conta`)
  await page.getByLabel("Nome", { exact: true }).fill("QA Residual")
  await page.getByLabel("E-mail", { exact: true }).fill(email)
  await page.getByLabel("Senha", { exact: true }).fill("Local-QA-2026!")
  await page.getByRole("button", { name: "Criar conta", exact: true }).click()
  await page.getByRole("heading", { name: "Confira seu e-mail" }).waitFor({ timeout: 20000 })
  async function link(count) {
    for (let n = 0; n < 40; n++) {
      const found = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`).then(r => r.json())
      if (found.messages?.length >= count) {
        const message = await fetch(`${mailpit}/api/v1/message/${found.messages[0].ID}`).then(r => r.json())
        const href = /href="([^"]*token_hash=[^"]*)"/.exec(message.HTML ?? "")?.[1]?.replaceAll("&amp;", "&")
        assert.ok(href?.startsWith(`${origin}/#/confirmar-email?token_hash=`), "Email must link directly to 5198")
        return href
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error("Local confirmation email not received")
  }
  await link(1)
  report.signupLink = true
  await new Promise(resolve => setTimeout(resolve, 2100))
  const resend = await fetch(`${origin}/v1/auth/email/verify/resend`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email }) })
  assert.equal(resend.status, 204)
  const href = await link(2)
  report.resendLink = true
  await page.goto(href)
  await page.getByRole("heading", { name: "Estúdio", exact: true }).waitFor({ timeout: 20000 })
  assert.ok(!page.url().includes("token_hash"))
  report.confirmed = true
  for (const route of ["explorar", "perfil", "estudio", "closet"]) {
    await page.goto(`${origin}/#/${route}`)
    await page.waitForLoadState("networkidle")
    await page.screenshot({ path: `${out}/${route}.png`, fullPage: true })
    report.routes.push(route)
    if (route === "perfil") {
      await page.getByRole("button", { name: "Configurações: conta, plano, aparência e privacidade" }).click()
      await page.waitForLoadState("networkidle")
      await page.screenshot({ path: `${out}/settings.png` })
      await page.keyboard.press("Escape")
    }
  }
  assert.deepEqual(report.unsupported, [])
  assert.deepEqual(report.unavailable, [])
  assert.deepEqual(report.errors, [])
} finally {
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify(report, null, 2))
