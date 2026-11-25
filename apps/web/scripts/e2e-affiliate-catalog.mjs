/** Browser acceptance for the public catalog and the Estúdio purchase flow, with a fake StylAI API. */
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const web = join(dirname(fileURLToPath(import.meta.url)), "..")
const api = "https://affiliate-fixture.stylai.test/v1"
const cdn = "https://affiliate-fixture-cdn.stylai.test"
const port = Number(process.env.STYLAI_AFFILIATE_E2E_PORT ?? 5198)
const origin = `http://127.0.0.1:${port}`
const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js")
const output = join(web, "test-results", "affiliate-catalog-build")
const build = spawnSync(process.execPath, [vite, "build", "--outDir", output, "--emptyOutDir", "--logLevel", "warn"], {
  cwd: web, stdio: "inherit", env: { ...process.env, VITE_API_BASE_URL: api, VITE_GOOGLE_CLIENT_ID: "" },
})
if (build.status !== 0) process.exit(build.status ?? 1)
const server = spawn(process.execPath, [vite, "preview", "--outDir", output, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: web, stdio: ["ignore", "inherit", "inherit"],
})
const picture = readFileSync(join(web, "src", "assets", "brand", "monogram.png"))
const now = new Date("2026-11-25T12:00:00Z")
const product = (id, name, amount, days) => ({
  id: `aliexpress:${id}`, name, partner: { id: "atelier", name: "Ateliê BR" },
  category: { id: "tops", label: "Camisas" }, price: { amount, currency: "BRL" },
  images: [{ url: `${cdn}/${id}.png`, width: 600, height: 800 }], availability: "unknown",
  offerExpiresAt: new Date(+now + days * 86_400_000).toISOString(),
  catalogPublished: true,
  links: { affiliateUrl: `https://s.click.aliexpress.com/e/_fixture${id}`, productUrl: `https://pt.aliexpress.com/item/${id}.html` },
})
const linen = product("1001", "Camisa de linho", 125, 7)
const related = product("1002", "Camisa de viscose", 98, 1)
const other = product("1003", "Camisa de algodão", 145, 7)
const expired = product("1004", "Camisa de oferta vencida", 444, 0)
const outfitPiece = (p) => ({ slot: "upper", label: "Parte de cima", product: p, tryOn: { ready: false, code: "ai_image_rights_unconfirmed", message: "Sem autorização para provar." } })
const set = { id: "set-one", searchId: "search-one", title: "Look de linho", pieces: [outfitPiece(linen)], total: linen.price }
const list = (items) => ({ items, nextCursor: null, total: items.length })

let signedIn = false
let relatedError = false
let lastOptions = []
let swaps = 0
const collectionRequests = []
function respond(method, url, body) {
  const path = url.pathname.replace(/^\/v1/, "")
  const failure = (status, code, message) => [status, { error: { code, message } }]
  if (path === "/auth/refresh") return signedIn ? [200, { accessToken: "only-for-test", user: { id: "visitor", name: "Ana", email: "ana@stylai.test" } }] : failure(401, "unauthorized", "Entre para continuar.")
  if (path === "/explore/hero") return [200, { hero: { product: linen, image: linen.images[0] } }]
  if (path === "/catalog/source") return [200, { id: "aliexpress_affiliate", label: "AliExpress", configured: true, capabilities: { affiliateLinks: true } }]
  if (path === "/catalog/facets") return [200, { collections: [{ id: "linho", label: "Linho", count: 2 }], categories: [], partners: [], total: 4 }]
  if (path === "/catalog/products") {
    const choice = url.searchParams.get("collection")
    collectionRequests.push(choice)
    return [200, list(choice === "linho" ? [linen, related] : [linen, related, other, expired])]
  }
  if (path === "/catalog/products/aliexpress%3A1001/related") {
    assert.equal(url.searchParams.get("limit"), "6")
    return relatedError ? failure(503, "catalog_unavailable", "Catálogo indisponível.") : [200, list([related])]
  }
  if (path.startsWith("/catalog/products/")) {
    const id = decodeURIComponent(path.slice("/catalog/products/".length))
    const found = [linen, related, other, expired].find((p) => p.id === id)
    if (found) return [200, found]
  }
  if (path === "/studio/config") return [200, { costs: { generate: 10, edit: null, tryOn: 10 }, budget: { min: 0, max: 500 }, capabilities: { outfits: true, searchScope: "stores" } }]
  if (path === "/studio/outfit-searches") return [200, list([{ id: set.searchId, prompt: "Look de linho", status: "succeeded", sets: 1 }])]
  if (path === `/studio/outfit-searches/${set.searchId}`) return [200, { id: set.searchId, source: "aliexpress_affiliate", status: "succeeded", sets: [set], stage: { id: "done", label: "Pronto" } }]
  if (path === `/studio/outfit-searches/${set.searchId}/pieces`) return [200, { groups: [] }]
  if (path === "/studio/outfit-renders" || path === "/studio/looks") return [200, list([])]
  if (path === "/me/balance") return [200, { tokens: 10, plan: { id: "free", name: "Gratuito" } }]
  if (path === "/me/body-photos" || path === "/preferences") return [200, list([])]
  if (path === "/closet") return [200, { pieces: [], looks: [] }]
  if (path === `/studio/outfit-sets/${set.id}`) return [200, { ...set, alternatives: { upper: lastOptions } }]
  if (method === "POST" && path === `/studio/outfit-sets/${set.id}/options`) {
    if (body.query === "limite") return failure(429, "source_rate_limited", "Limite de consultas da loja atingido.")
    if (body.query === "indisponível") return failure(503, "source_unavailable", "A loja não respondeu agora.")
    lastOptions = body.query === "sem resultado" ? [] : [outfitPiece(other)]
    return [200, { ...set, alternatives: { upper: lastOptions }, found: { returned: lastOptions.length, added: lastOptions.length } }]
  }
  if (method === "POST" && path === `/studio/outfit-sets/${set.id}/piece`) swaps++
  return failure(404, "not_found", "Rota fora do cenário de teste.")
}

let browser
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Vite encerrou antes do teste")
    if (await fetch(origin).then((response) => response.ok, () => false)) { ready = true; break }
    await sleep(250)
  }
  assert(ready, "Vite não iniciou")
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })
  page.setDefaultTimeout(8000)
  await page.clock.install({ time: now })
  const outbound = []
  page.on("request", (request) => {
    const host = new URL(request.url()).hostname
    if (host === "aliexpress.com" || host.endsWith(".aliexpress.com")) outbound.push(request.url())
  })
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort())
  await page.route(`${cdn}/**`, (route) => route.fulfill({ contentType: "image/png", body: picture }))
  await page.route(`${api}/**`, async (route) => {
    const request = route.request()
    const headers = { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, OPTIONS" }
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    const [status, json] = respond(request.method(), new URL(request.url()), request.postDataJSON())
    await route.fulfill({ status, headers, json })
  })

  await page.goto(`${origin}/#/explorar`, { waitUntil: "commit" })
  await page.getByRole("button", { name: "Linho", exact: true }).click()
  await page.getByText("2 peças com estes filtros").waitFor()
  assert(collectionRequests.includes("linho"))
  assert.equal(await page.getByRole("button", { name: /Camisa de algodão.+Ver detalhes/ }).count(), 0)
  const homeLink = page.getByRole("link", { name: /Camisa de linho.+comissionado/ })
  assert.equal(await homeLink.getAttribute("href"), linen.links.affiliateUrl)
  assert.match(await homeLink.getAttribute("rel"), /\bsponsored\b/)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Explorar should fit a mobile viewport")

  await page.getByRole("button", { name: /Camisa de linho.+Ver detalhes/ }).click()
  const dialog = page.getByRole("dialog")
  const suggestions = dialog.getByRole("region", { name: "Peças relacionadas" })
  const sponsored = suggestions.getByRole("link", { name: /Camisa de viscose.+comissionado/ })
  await sponsored.waitFor()
  assert.equal(await sponsored.getAttribute("href"), related.links.affiliateUrl)
  assert.match(await sponsored.getAttribute("rel"), /\bsponsored\b/)
  await page.clock.fastForward(86_400_000)
  await sponsored.waitFor({ state: "detached" })
  assert.equal(await suggestions.getByText(/98,00/).count(), 0)
  await page.keyboard.press("Escape")

  relatedError = true
  await page.clock.setSystemTime(now)
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: /Camisa de linho.+Ver detalhes/ }).click()
  await dialog.getByText(/Não foi possível carregar as peças relacionadas/).waitFor()
  relatedError = false
  await dialog.getByRole("button", { name: "Tentar novamente" }).click()
  await suggestions.getByText("Camisa de viscose", { exact: true }).waitFor()
  await page.keyboard.press("Escape")

  signedIn = true
  await page.goto(`${origin}/#/estudio`, { waitUntil: "domcontentloaded" })
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.getByTestId("outfit-swap-upper").click()
  const field = page.getByTestId("outfit-option-query")
  const go = page.getByTestId("outfit-option-search")
  const note = page.getByTestId("outfit-option-note")
  for (const [value, message] of [["limite", /limite de consultas/i], ["indisponível", /loja não respondeu/i], ["sem resultado", /nenhuma opção|não (devolveu|encontrou)/i], ["algodão", /1 opção nova/i]]) {
    await field.fill(value)
    await go.click()
    await note.filter({ hasText: message }).waitFor()
  }
  const buy = page.getByRole("link", { name: /Camisa de algodão.+comissionado/ })
  await buy.waitFor()
  assert.equal(await buy.getAttribute("href"), other.links.affiliateUrl)
  assert.match(await buy.getAttribute("rel"), /\bsponsored\b/)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Estúdio should fit a mobile viewport")
  assert.equal(await page.getByRole("button", { name: /Usar Camisa de algodão/ }).isDisabled(), true)
  assert.equal(swaps, 0)
  await page.clock.fastForward(7 * 86_400_000)
  await page.getByTestId("outfit-total").filter({ hasText: "Total indisponível" }).waitFor()
  assert.deepEqual(outbound, [], "As telas não consultam a API do parceiro nem abrem links automaticamente")
  console.log("Catálogo afiliado: coleções públicas, relacionados, validade, busca e compra no Estúdio verificados.")
} finally {
  await browser?.close()
  server.kill()
}
