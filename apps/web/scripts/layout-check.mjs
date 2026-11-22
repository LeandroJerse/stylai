/**
 * QA-008 / QA-009: layout regression on the demo (same components as the official front).
 * Perfil photo slots and the Estúdio stage labels at 320, 390, 640 (≈ desktop at 200% zoom), 768 and 1280 px:
 *  - no two visible text/control boxes overlap inside a slot or on the stage label column;
 *  - no element overflows its slot horizontally (children checked, not only containers);
 *  - stage labels never cover the expand button; keyboard focus reaches every photo control.
 * Run: node demo/prepare-assets.mjs && node scripts/layout-check.mjs   (screenshots: test-results/layout/)
 */
import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createChecker, gotoTab, searchAndPick, testPhoto, uploadPhoto } from "./tryon-journey.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const PORT = 5199
const BASE = `http://localhost:${PORT}/`
const OUT = join(root, "test-results", "layout")
mkdirSync(OUT, { recursive: true })
const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js")
const server = spawn(process.execPath, [vite, "--config", "demo/vite.config.ts", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "pipe" })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("demo server did not start")), 30_000)
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && (clearTimeout(t), resolve()))
})

/** Overlaps between leaf boxes inside `selector` (each match checked separately) + horizontal overflow. */
const collisions = (page, selector) => page.$$eval(selector, (roots) => roots.flatMap((rootEl, ri) => {
  const leaves = [...rootEl.querySelectorAll("p, span.sa-badge, button, img, .sa-poseslot, h2, h3")]
    .filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest(".sa-sr") })
    // Only compare elements that are not ancestors of each other.
  const box = (el) => el.getBoundingClientRect()
  const out = []
  const outer = rootEl.getBoundingClientRect()
  for (const el of leaves) {
    const r = box(el)
    if (r.left < outer.left - 1 || r.right > outer.right + 1) out.push(`#${ri} overflow: ${el.tagName}.${el.className} "${(el.textContent ?? "").slice(0, 30)}"`)
    if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "visible" && el.tagName !== "IMG") out.push(`#${ri} text overflow: "${(el.textContent ?? "").slice(0, 30)}"`)
  }
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i], b = leaves[j]
    if (a.contains(b) || b.contains(a)) continue
    // The photo (img) sits under its own overlay controls by design inside .sa-photo.
    if (a.closest(".sa-photo") && b.closest(".sa-photo") && a.closest(".sa-photo") === b.closest(".sa-photo")) continue
    const p = box(a), q = box(b)
    const ix = Math.min(p.right, q.right) - Math.max(p.left, q.left), iy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top)
    if (ix > 1 && iy > 1) out.push(`#${ri} overlap: "${(a.textContent ?? a.tagName).trim().slice(0, 24)}" × "${(b.textContent ?? b.tagName).trim().slice(0, 24)}"`)
  }
  return out
}))

const t = createChecker("layout")
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  // Prepare: consent, three approved photos, one candidate needing adjustment (longest texts), two results.
  await page.goto(`${BASE}#/perfil`)
  await page.locator("#fotos").waitFor()
  await page.getByTestId("consent-checkbox").check()
  await page.getByTestId("consent-accept").click()
  await uploadPhoto(page, "front", testPhoto("front"), "approved")
  await uploadPhoto(page, "side", testPhoto("side"), "approved")
  await uploadPhoto(page, "profile", testPhoto("profile"), "approved")
  await uploadPhoto(page, "front", testPhoto("selfie"), "needs-adjustment")
  await gotoTab(page, BASE, "estudio")
  for (const [prompt, piece] of [["blusa branca", "Blusa básica branca (teste)"], ["jaqueta jeans", "Jaqueta jeans azul (teste)"]]) {
    await searchAndPick(page, prompt, piece).catch(async (e) => { await page.screenshot({ path: join(OUT, "debug-search.png"), fullPage: true }); throw e })
    await page.getByTestId("search-generate").click()
    await page.getByTestId("version-piece").waitFor({ timeout: 20000 })
    await page.waitForFunction((n) => document.querySelector('[data-testid="version-piece"]')?.textContent?.includes(n), piece, { timeout: 20000 })
  }

  for (const width of [320, 390, 640, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await gotoTab(page, BASE, "perfil")
    await page.getByTestId("photo-slot-profile").waitFor()
    await page.waitForTimeout(300)
    const slots = await collisions(page, '[data-testid^="photo-slot-"]')
    t.check(slots.length === 0, `Perfil ${width}px: sem sobreposição nem extravasamento nos espaços de foto`, slots.slice(0, 4).join(" | "))
    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    t.check(pageOverflow <= 0, `Perfil ${width}px: sem rolagem horizontal`, String(pageOverflow))
    await page.locator("#fotos").screenshot({ path: join(OUT, `perfil-${width}.png`) })

    await gotoTab(page, BASE, "estudio")
    await page.locator(".sa-stagebadges").first().waitFor()
    await page.waitForTimeout(300)
    const stage = await collisions(page, ".sa-stagebadges")
    const underButton = await page.evaluate(() => {
      const expand = document.querySelector('[aria-label="Ampliar imagem"]')?.getBoundingClientRect()
      return [...document.querySelectorAll(".sa-stagebadges .sa-badge")].filter((b) => {
        const r = b.getBoundingClientRect()
        return expand && Math.min(r.right, expand.right) - Math.max(r.left, expand.left) > 1 && Math.min(r.bottom, expand.bottom) - Math.max(r.top, expand.top) > 1
      }).map((b) => b.textContent)
    })
    const labels = await page.locator(".sa-stagebadges .sa-badge").allInnerTexts()
    t.check(stage.length === 0 && underButton.length === 0 && labels.some((l) => l.includes("Imagem demonstrativa")) && labels.some((l) => /\d de \d/.test(l)),
      `Estúdio ${width}px: selo de simulação, versão e “1 de 2” legíveis, sem sobreposição nem cobrir o botão de ampliar`, [...stage, ...underButton].slice(0, 4).join(" | "))
    await page.locator(".sa-stage-photo").first().screenshot({ path: join(OUT, `estudio-${width}.png`) })
  }

  // Keyboard: every photo control is reachable with Tab.
  await page.setViewportSize({ width: 390, height: 900 })
  await gotoTab(page, BASE, "perfil")
  const want = ["Apagar foto Frente", "Trocar foto Frente", "Apagar foto Três quartos", "Apagar foto Perfil"]
  const reached = new Set()
  await page.locator("#fotos").focus().catch(() => undefined)
  for (let i = 0; i < 80 && reached.size < want.length; i++) {
    await page.keyboard.press("Tab")
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))
    if (label && want.includes(label)) reached.add(label)
  }
  t.check(reached.size === want.length, "teclado alcança apagar/trocar de cada foto", [...reached].join(","))
} finally {
  await browser.close()
  server.kill()
}
if (t.failed().length) { console.error(`\n${t.failed().length} falha(s) de layout`); process.exit(1) }
console.log("\nLayout ok")
