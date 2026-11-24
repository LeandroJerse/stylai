/**
 * Estúdio: results must be in sight. Official front + scripted API (studio-mock.mjs).
 * Account with 8 looks of very long titles: search progress, outfits, confirmation and images are checked by what is
 * really inside the viewport, not by presence in the DOM.
 * Run: node scripts/studio-layout.mjs [--size=mobile|tablet|small-desktop|desktop]   (screenshots: test-results/studio/)
 */
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createChecker } from "./tryon-journey.mjs"
import { createState, finishedRender, mockApi, startFront, visibleShare } from "./studio-mock.mjs"

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test-results", "studio")
mkdirSync(OUT, { recursive: true })
const t = createChecker("studio")
const front = await startFront(5297)
const browser = await chromium.launch()
const SIZES = [["mobile", 390, 844], ["tablet", 768, 1024], ["small-desktop", 1024, 720], ["desktop", 1360, 900]]
const only = process.argv.find((a) => a.startsWith("--size="))?.slice(7)

async function open(width, height, state, dark = false) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" })
  const errors = []
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
  page.on("pageerror", (e) => errors.push(String(e)))
  await page.addInitScript((d) => localStorage.setItem("stylai-theme", d ? "dark" : "light"), dark)
  await mockApi(page, state)
  await page.goto(`${front.base}/#/estudio`)
  await page.getByTestId("outfit-search-button").waitFor()
  await page.waitForTimeout(500)
  return { page, errors }
}
const shot = (page, name, fullPage = false) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage })
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)

try {
  for (const [name, w, h] of SIZES.filter(([n]) => !only || n === only)) {
    const state = createState(front.base, { renders: [finishedRender(front.base, 1), finishedRender(front.base, 2, "comparison")] })
    const { page, errors } = await open(w, h, state)
    await page.getByTestId("recent-look-title").first().waitFor()
    await shot(page, `${name}-1-start`)
    await shot(page, `${name}-1-start-full`, true)
    t.check(await noSideScroll(page), `${name}: no horizontal scroll on arrival`)
    const titles = await page.$$eval('[data-testid="recent-look-title"]', (els) => els.map((e) => e.textContent.trim()))
    t.check(titles.length > 0 && titles.every((x) => x.length <= 60), `${name}: recent looks use short titles`, JSON.stringify(titles.slice(0, 2)))

    await page.locator(".sa-composer textarea").fill("me vista com roupas de verão")
    state.stuck = true
    await page.getByTestId("outfit-search-button").click()
    await page.getByTestId("outfit-progress").waitFor()
    await page.waitForTimeout(700)
    const progress = await visibleShare(page, '[data-testid="outfit-progress"]')
    t.check(progress.height > 0 && progress.visible >= Math.min(progress.height, 90), `${name}: search progress in sight after the click`, JSON.stringify(progress))
    await shot(page, `${name}-2-progress`)

    state.stuck = false
    await page.getByTestId("outfit-card").first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(700)
    const card = await visibleShare(page, '[data-testid="outfit-card"]')
    t.check(card.visible >= 220, `${name}: first outfit in sight when ready`, JSON.stringify(card))
    await shot(page, `${name}-3-sets`)
    await shot(page, `${name}-3-sets-full`, true)
    t.check(await noSideScroll(page), `${name}: no horizontal scroll with outfits`)

    state.stuck = true
    await page.getByTestId("outfit-generate").first().click()
    await page.getByTestId("outfit-quote").waitFor()
    await page.waitForTimeout(400)
    const confirm = await visibleShare(page, '[data-testid="outfit-confirm"]')
    t.check(confirm.visible >= 40, `${name}: confirm button in sight`, JSON.stringify(confirm))
    await shot(page, `${name}-4-confirm`)
    await page.getByTestId("outfit-confirm").click()
    await page.locator('[data-testid="render-card"][data-status="running"]').waitFor()
    await page.waitForTimeout(700)
    const render = await visibleShare(page, '[data-testid="render-card"][data-status="running"]')
    t.check(render.visible >= 160, `${name}: generation progress in sight after confirming`, JSON.stringify(render))
    await shot(page, `${name}-5-generating`)

    state.stuck = false
    await page.locator('[data-render-id="render-3"][data-status="succeeded"]').waitFor({ timeout: 25000 })
    await page.waitForTimeout(700)
    const done = await visibleShare(page, '[data-render-id="render-3"] img')
    t.check(done.visible >= 220, `${name}: finished image in sight`, JSON.stringify(done))
    await shot(page, `${name}-6-image`)
    await shot(page, `${name}-6-image-full`, true)
    t.check(await noSideScroll(page), `${name}: no horizontal scroll at the end`)
    t.check(errors.length === 0, `${name}: no console errors`, errors.slice(0, 2).join(" | "))
    t.check(await page.getByTestId("outfit-board").evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${name}: work area does not overflow`)
    await page.close()
  }

  // The report that started this: first search ever, nothing saved before, long list of recent looks.
  for (const [name, w, h] of SIZES.filter(([n]) => !only || n === only)) {
    const state = createState(front.base)
    const { page, errors } = await open(w, h, state)
    await page.locator(".sa-composer textarea").fill("me vista com roupas de verão")
    if (await page.getByTestId("filters-toggle").getAttribute("aria-expanded") === "false") await page.getByTestId("filters-toggle").click()
    await page.getByTestId("filter-audience-feminino").click()
    await page.getByLabel("Peça até R$").fill("79,90")
    await page.getByTestId("filter-rating").selectOption("90")
    await shot(page, `${name}-0-filters`)
    t.check(await page.locator(".sa-filters").evaluate((el) => [...el.querySelectorAll("input, select, button")].every((c) => c.scrollWidth <= c.clientWidth + 1)), `${name}: no filter control is cut`)
    state.stuck = true
    await page.getByTestId("outfit-search-button").dblclick()
    await page.getByTestId("outfit-progress").waitFor()
    await page.waitForTimeout(500)
    t.check((await visibleShare(page, '[data-testid="outfit-progress"]')).visible >= 90, `${name}: first search ever, progress in sight`)
    t.check(state.calls.filter((c) => c.method === "POST" && c.path === "/studio/outfit-searches").length === 1, `${name}: double click starts one search`)
    state.stuck = false
    await page.getByTestId("outfit-card").first().waitFor({ timeout: 15000 })
    await page.waitForTimeout(500)
    t.check((await visibleShare(page, '[data-testid="outfit-card"]')).visible >= 220, `${name}: first search ever, outfits in sight`)
    t.check(JSON.stringify(state.lastSearch.filters) === JSON.stringify({ audience: "feminino", maxPieceBrl: 79.9, minRatingPercent: 90 }), `${name}: filters are sent`, JSON.stringify(state.lastSearch))
    t.check((await page.getByTestId("outfit-filter-report").innerText()).includes("12 anúncios"), `${name}: the page says what the filters removed`)

    // piece detail, lock and swap
    await page.getByTestId("outfit-swap-upper").first().click()
    await page.getByTestId("outfit-use-alternative").first().waitFor()
    await page.waitForTimeout(300)
    await shot(page, `${name}-7-piece`)
    await page.getByTestId("outfit-lock-upper").click()
    await page.locator('[data-testid="outfit-lock-upper"][aria-pressed="true"]').waitFor()
    t.check(await page.getByTestId("outfit-use-alternative").count() === 0, `${name}: a locked piece offers no swap`)
    await page.getByTestId("outfit-swap-upper").first().click()

    // comparison
    await page.getByTestId("outfit-select").nth(0).check()
    await page.waitForTimeout(200)
    t.check((await visibleShare(page, ".sa-outfit-bar")).visible >= 40, `${name}: compare bar in sight with one marked`)
    await page.getByTestId("outfit-select").nth(1).check()
    await shot(page, `${name}-8-compare-bar`)
    await page.getByTestId("outfit-compare").click()
    await page.getByTestId("outfit-confirm").click()
    await page.locator('[data-testid="render-card"][data-status="succeeded"]').waitFor({ timeout: 25000 })
    await page.waitForTimeout(600)
    t.check((await visibleShare(page, ".sa-render-comparison img")).visible >= 220, `${name}: comparison in sight`)
    await shot(page, `${name}-9-comparison`)
    await shot(page, `${name}-9-comparison-full`, true)

    // back to outfits, loose pieces, Vestir, an older look
    await page.getByTestId("stage-tab-sets").click()
    t.check(await page.getByTestId("outfit-card").count() === 3, `${name}: outfits are one tap away`)
    if (await page.locator(".sa-composer textarea").count() === 0) await page.getByRole("button", { name: "Editar pedido" }).click()
    await page.getByTestId("search-button").click()
    await page.getByTestId("search-item").first().waitFor()
    await page.waitForTimeout(600)
    t.check((await visibleShare(page, '[data-testid="search-item"]')).visible >= 160, `${name}: loose pieces in sight`)
    t.check(await page.getByTestId("search-generate").count() === 0 && await page.getByTestId("mode-note").count() === 0, `${name}: no price or provider text before a piece is chosen`)
    await shot(page, `${name}-10-loose`)
    await page.getByRole("radio", { name: "Vestir" }).click()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    await shot(page, `${name}-11-vestir`)
    await page.getByRole("radio", { name: "Procurar" }).click()
    await page.getByTestId("stage-tab-sets").click()
    await page.getByTestId("recent-look-title").first().click()
    await page.getByTestId("back-to-outfits").waitFor()
    await page.waitForTimeout(600)
    await shot(page, `${name}-12-look`)
    await page.getByTestId("back-to-outfits").click()
    t.check(await page.getByTestId("outfit-card").count() === 3, `${name}: back from a look to the outfits`)
    t.check(errors.length === 0, `${name}: no console errors on the whole path`, errors.slice(0, 2).join(" | "))
    await page.close()
  }

  if (!only) {
    // no result, new account, dark theme
    const empty = await open(390, 844, createState(front.base, { looks: 0, finalStatus: "empty", runningPolls: 0 }))
    await shot(empty.page, "state-new-account")
    await empty.page.locator(".sa-composer textarea").fill("fantasia de dragão")
    await empty.page.getByTestId("outfit-search-button").click()
    await empty.page.getByTestId("outfit-message").waitFor({ timeout: 15000 })
    await empty.page.waitForTimeout(400)
    t.check((await visibleShare(empty.page, '[data-testid="outfit-message"]')).visible > 20, "no result: the explanation is in sight")
    await shot(empty.page, "state-empty")
    await empty.page.close()
    const newDesktop = await open(1360, 900, createState(front.base, { looks: 0 }))
    await shot(newDesktop.page, "state-new-account-desktop")
    await newDesktop.page.close()
    const dark = await open(1360, 900, createState(front.base, { searchStatus: "succeeded", searches: [{ id: "search-1", prompt: "me vista com roupas de verão", createdAt: "2026-11-24T18:08:22Z", status: "succeeded", sets: 3 }, { id: "search-0", prompt: "jantar elegante", createdAt: "2026-11-23T18:08:22Z", status: "succeeded", sets: 2 }], renders: [finishedRender(front.base, 1)] }), true)
    await dark.page.getByTestId("outfit-card").first().waitFor()
    await dark.page.waitForTimeout(400)
    await shot(dark.page, "state-dark")
    // keyboard: the tile opens with Enter and shows focus
    await dark.page.getByTestId("outfit-swap-upper").first().focus()
    await dark.page.keyboard.press("Enter")
    await dark.page.getByTestId("outfit-piece-detail").waitFor()
    t.check(await dark.page.getByTestId("outfit-swap-upper").first().getAttribute("aria-expanded") === "true", "keyboard opens the piece")
    await dark.page.close()
  }
} finally {
  await browser.close()
  front.stop()
}
const failed = t.failed()
console.log(`\n${t.results.length - failed.length}/${t.results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
