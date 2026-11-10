/**
 * End-to-end check of the real frontend against a TEST-ONLY fake backend.
 *
 * The app is built with VITE_API_BASE_URL pointing at a fake host (set only in this process's
 * environment; no .env file). Every request to that host is answered by `page.route` below.
 * Nothing here ships in the app bundle: the fixtures exist only for this script.
 *
 * Run: bun run e2e   (builds into dist-e2e/, serves it, drives Chromium, writes screenshots)
 */
import { spawn, spawnSync } from "node:child_process"
import { mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"
import { chromium } from "playwright"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const API = "https://api.stylai.test/v1"
const CDN = "https://cdn.stylai.test"
const PORT = 5197
const ORIGIN = `http://localhost:${PORT}`
const SHOTS = join(root, "test-results", "e2e")
mkdirSync(SHOTS, { recursive: true })

/* ------------------------------------------------------------------ build + serve */

const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js")
const build = spawnSync(process.execPath, [vite, "build", "--outDir", "dist-e2e", "--emptyOutDir", "--logLevel", "warn"], { cwd: root, stdio: "inherit", env: { ...process.env, VITE_API_BASE_URL: API, VITE_GOOGLE_CLIENT_ID: "" } })
if (build.status !== 0) process.exit(build.status ?? 1)
const server = spawn(process.execPath, [vite, "preview", "--outDir", "dist-e2e", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "pipe" })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("preview did not start")), 20_000)
  server.stdout.on("data", (d) => String(d).includes(String(PORT)) && (clearTimeout(t), resolve()))
})

/* ------------------------------------------------------------------ test-only fake backend */

const img = (id, w = 900, h = 1200) => ({ url: `${CDN}/${id}.png`, width: w, height: h, alt: null, focus: "50% 30%" })
const product = (id, name, partner, amount, extra = {}) => ({
  id,
  name,
  partner: { id: partner.toLowerCase().replace(/\s/g, "-"), name: partner },
  category: { id: "blazers", label: "Blazers" },
  price: { amount, currency: "BRL" },
  images: [img(id)],
  rating: 4.6,
  reviewsCount: 87,
  variants: [
    { label: "P", available: true },
    { label: "M", available: false },
  ],
  availability: "available",
  links: { affiliateUrl: `https://loja.test/aff/${id}`, productUrl: `https://loja.test/p/${id}` },
  updatedAt: new Date().toISOString(),
  favorite: false,
  ...extra,
})

function createBackend() {
  const products = Array.from({ length: 30 }, (_, i) => product(`p${i + 1}`, `Peça de teste ${i + 1}`, i % 2 ? "Loja Beta" : "Loja Alfa", 100 + i * 20))
  const state = { signedIn: false, favorites: new Set(), tokens: 20, jobPolls: 0, looks: [], savedLooks: new Set() }
  const user = { id: "u1", name: "Ana Teste", email: "ana@exemplo.com", emailVerified: true, providers: ["password"], createdAt: "2026-01-02T10:00:00Z" }
  const rules = { minRating: { value: 4, mode: "prefer" }, minReviews: { value: 0, mode: "off" }, excludedPartners: [], sizes: { top: null, bottom: null, shoes: null }, onlyAvailableSize: false, budget: { value: 800, scope: "look", mode: "prefer" }, missingRating: "warn", advanced: {} }
  const withFav = (p) => ({ ...p, favorite: state.favorites.has(p.id) })
  const look = { id: "l1", title: "Look de teste", note: "Blazer com calça reta.", image: img("l1", 1000, 1250), pieces: [{ product: products[0], role: "look", warnings: [] }, { product: products[1], role: "similar", warnings: ["Prazo de 12 dias"] }], origin: "generate", version: 1, candidatesCount: 6, saved: false }

  /** @returns {{ status: number, body?: unknown }} */
  function handle(method, path, url, body) {
    const authed = state.signedIn
    const needAuth = () => (authed ? null : { status: 401, body: { error: { code: "unauthorized", message: "Entre de novo." } } })
    if (method === "POST" && path === "/auth/refresh") return authed ? { status: 200, body: { accessToken: "tok", user } } : { status: 401, body: { error: { code: "unauthorized", message: "Sem sessão" } } }
    if (method === "POST" && path === "/auth/sign-in") {
      if (body?.password !== "senha1234") return { status: 401, body: { error: { code: "invalid_credentials", message: "E-mail ou senha incorretos." } } }
      state.signedIn = true
      return { status: 200, body: { accessToken: "tok", user } }
    }
    if (method === "POST" && path === "/auth/sign-out") {
      state.signedIn = false
      return { status: 204 }
    }
    if (method === "GET" && path === "/explore/hero") return { status: 200, body: { hero: { product: withFav(products[0]), image: img("hero", 1400, 1800) } } }
    if (method === "GET" && path === "/catalog/facets") return { status: 200, body: { categories: [{ id: "blazers", label: "Blazers", count: 30 }], partners: [{ id: "loja-alfa", label: "Loja Alfa", count: 15 }, { id: "loja-beta", label: "Loja Beta", count: 15 }], priceRange: { min: 100, max: 680, currency: "BRL" }, total: products.length } }
    if (method === "GET" && path === "/catalog/products") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase()
      const partner = url.searchParams.get("partner")
      let list = products.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!partner || p.partner.id === partner))
      if (url.searchParams.get("favorites")) list = list.filter((p) => state.favorites.has(p.id))
      const start = Number(url.searchParams.get("cursor") ?? 0)
      const limit = Number(url.searchParams.get("limit") ?? 24)
      const items = list.slice(start, start + limit).map(withFav)
      return { status: 200, body: { items, nextCursor: start + limit < list.length ? String(start + limit) : null, total: list.length } }
    }
    const pm = path.match(/^\/catalog\/products\/(.+)$/)
    if (method === "GET" && pm) {
      const p = products.find((x) => x.id === pm[1])
      return p ? { status: 200, body: withFav(p) } : { status: 404, body: { error: { code: "not_found", message: "Peça não encontrada." } } }
    }
    if (method === "GET" && path === "/studio/config") return { status: 200, body: { costs: { generate: 6, edit: 2, tryOn: 4 }, maxReferences: 3, maxChosenPieces: 4, maxPromptLength: 280, budget: { min: 100, max: 3000, step: 50, currency: "BRL" }, acceptedImageTypes: ["image/jpeg", "image/png", "image/webp"], maxImageBytes: 12 * 1024 * 1024, minImageHeight: 600, sizes: { top: ["PP", "P", "M", "G", "GG"], bottom: ["36", "38", "40"], shoes: ["35", "36", "37"] } } }
    if (method === "GET" && path === "/plans") return { status: 200, body: { items: [{ id: "free", name: "Free", tokensPerPeriod: 20, period: "day", price: null }] } }

    const denied = needAuth()
    if (denied) return denied
    if (method === "GET" && path === "/me") return { status: 200, body: user }
    if (method === "GET" && path === "/me/balance") return { status: 200, body: { tokens: state.tokens, plan: { id: "free", name: "Free", tokensPerPeriod: 20, period: "day" }, renewsAt: null } }
    if (method === "GET" && path === "/me/measurements") return { status: 200, body: { size: null, useInSearch: true } }
    if (method === "GET" && path === "/me/body-photos") return { status: 200, body: { items: [] } }
    if (method === "GET" && path === "/preferences") return { status: 200, body: { items: [{ id: "pref1", name: "Dia a dia", rules }], defaultId: "pref1" } }
    if (method === "GET" && path === "/closet") return { status: 200, body: { pieces: products.filter((p) => state.favorites.has(p.id)).map((p) => ({ product: withFav(p), via: "favorite" })), looks: state.savedLooks.has("l1") ? [{ ...look, saved: true }] : [] } }
    const cp = path.match(/^\/closet\/pieces\/(.+)$/)
    if (cp) {
      if (method === "PUT") state.favorites.add(cp[1])
      else state.favorites.delete(cp[1])
      return { status: 204 }
    }
    const cl = path.match(/^\/closet\/looks\/(.+)$/)
    if (cl) {
      if (method === "PUT") state.savedLooks.add(cl[1])
      else state.savedLooks.delete(cl[1])
      return { status: 204 }
    }
    if (method === "GET" && path === "/studio/looks") return { status: 200, body: { items: state.looks } }
    if (method === "POST" && path === "/studio/generations") {
      if (!body?.prompt && !body?.productIds?.length) return { status: 422, body: { error: { code: "validation", message: "Pedido vazio." } } }
      state.jobPolls = 0
      return { status: 202, body: { id: "j1", kind: "generate", status: "queued", cost: 6, charged: false } }
    }
    if (method === "GET" && path === "/studio/jobs/j1") {
      state.jobPolls++
      if (state.jobPolls < 3) return { status: 200, body: { id: "j1", kind: "generate", status: "running", step: "Buscando peças nos parceiros", progress: state.jobPolls / 3, cost: 6, charged: false } }
      if (!state.looks.length) {
        state.tokens -= 6
        state.looks = [look]
      }
      return { status: 200, body: { id: "j1", kind: "generate", status: "succeeded", progress: 1, cost: 6, charged: true, lookId: "l1" } }
    }
    if (method === "GET" && path === "/studio/looks/l1") return { status: 200, body: { ...look, saved: state.savedLooks.has("l1") } }
    return { status: 404, body: { error: { code: "not_found", message: `Rota de teste ausente: ${method} ${path}` } } }
  }
  return { handle, state }
}

/* ------------------------------------------------------------------ run */

const png = readFileSync(join(root, "src", "assets", "brand", "monogram.png"))
const cors = { "access-control-allow-origin": ORIGIN, "access-control-allow-credentials": "true", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS" }
const failures = []
const check = (cond, label) => {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`)
  if (!cond) failures.push(label)
}

let browser
try {
  browser = await chromium.launch()
  const backend = createBackend()
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: "reduce" })
  const page = await context.newPage()
  const pageErrors = []
  page.on("pageerror", (e) => pageErrors.push(String(e)))
  await page.route(`${CDN}/**`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }))
  await page.route(`${API}/**`, async (route) => {
    const req = route.request()
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    const path = url.pathname.replace(/^\/v1/, "")
    let body = null
    try {
      body = req.postDataJSON()
    } catch {
      body = null
    }
    const res = backend.handle(req.method(), path, url, body)
    await route.fulfill({ status: res.status, headers: { ...cors, "content-type": "application/json" }, body: res.body === undefined ? "" : JSON.stringify(res.body) })
  })

  // 1. Explorar is public and renders what the API returned.
  await page.goto(`${ORIGIN}/#/explorar`)
  await page.getByText("Peça de teste 1", { exact: true }).first().waitFor()
  check((await page.locator(".sa-grid > li").count()) >= 24, "Explorar lista a primeira página do catálogo (24)")
  check(await page.getByText("30 peças").first().isVisible(), "total vem da API")
  await page.screenshot({ path: join(SHOTS, "explorar-390.png") })

  // 2. Search goes to the server.
  await page.locator("#explorar-busca").fill("teste 7")
  await page.getByText("1 peça com estes filtros").waitFor()
  check(true, "busca filtrada no servidor")
  await page.getByRole("button", { name: "Limpar filtros" }).first().click()

  // 3. Favourite while signed out sends to sign-in, with next.
  await page.getByRole("button", { name: "Favoritar Peça de teste 2", exact: true }).click()
  await page.waitForURL(/#\/entrar\?next=explorar/)
  check(true, "favoritar sem conta leva a Entrar com retorno")
  await page.screenshot({ path: join(SHOTS, "entrar-390.png") })

  // 4. Wrong password shows the server message; right password signs in.
  await page.getByLabel("E-mail").fill("ana@exemplo.com")
  await page.getByLabel("Senha", { exact: true }).fill("errada")
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await page.getByText("E-mail ou senha incorretos.").waitFor()
  check(true, "erro de credencial vindo da API")
  await page.getByLabel("Senha", { exact: true }).fill("senha1234")
  await page.getByRole("button", { name: "Entrar", exact: true }).click()
  await page.waitForURL(/#\/explorar$/)
  await page.getByRole("button", { name: /Saldo: 20 tokens/ }).first().waitFor()
  check(true, "login e saldo no cabeçalho")

  // 5. Favourite now works and shows in the Closet.
  await page.getByRole("button", { name: "Favoritar Peça de teste 2", exact: true }).click()
  await page.getByRole("button", { name: "Remover Peça de teste 2 do Closet", exact: true }).waitFor()
  check(backend.state.favorites.has("p2"), "favorito gravado na API")
  await page.getByRole("button", { name: /^Closet/ }).click()
  await page.getByRole("radio", { name: /Peças 1/ }).click()
  await page.locator('section[aria-label="Closet"]').getByText("Peça de teste 2", { exact: true }).waitFor()
  check(true, "Closet mostra a peça favoritada")

  // 6. Estúdio: generate, follow the job, show the look.
  await page.getByRole("button", { name: "Estúdio" }).last().click()
  await page.getByLabel("O que você quer vestir?").fill("Reunião de manhã, sem parecer formal demais")
  await page.getByRole("button", { name: /Gerar look · 6 tokens/ }).click()
  await page.getByText("Buscando peças nos parceiros").waitFor()
  check(true, "progresso do pedido vindo da API")
  await page.locator("#result-title").getByText("Look de teste").waitFor({ timeout: 15_000 })
  check(true, "look pronto exibido")
  await page.getByRole("button", { name: /Saldo: 14 tokens/ }).first().waitFor()
  check(true, "saldo atualizado após o débito")
  await page.screenshot({ path: join(SHOTS, "estudio-resultado-390.png"), fullPage: true })

  // 7. Save look → Closet.
  await page.getByRole("button", { name: "Guardar look" }).click()
  await page.getByRole("button", { name: "Ver no Closet" }).waitFor()
  check(backend.state.savedLooks.has("l1"), "look guardado na API")

  // 8. Perfil + Configurações, then sign out.
  await page.getByRole("button", { name: "Perfil" }).last().click()
  await page.getByText(/Ana Teste · plano Free/).waitFor()
  check(true, "Perfil com dados da conta")
  await page.getByRole("button", { name: /Configurações/ }).click()
  await page.getByRole("button", { name: /Sair da conta/ }).click()
  await page.waitForURL(/#\/explorar$/)
  await page.getByRole("button", { name: "Entrar" }).first().waitFor()
  check(!backend.state.signedIn, "logout encerra a sessão")

  // 9. Private tab while signed out shows the gate.
  await page.getByRole("button", { name: "Estúdio" }).last().click()
  check(await page.getByText("Entre para usar o Estúdio").isVisible(), "Estúdio pede conta quando deslogado")

  check(pageErrors.length === 0, `sem erros de JavaScript na página${pageErrors.length ? `: ${pageErrors.join(" | ")}` : ""}`)
  await context.close()

  // 10. Desktop + dark snapshot of Explorar.
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", reducedMotion: "reduce" })
  const dp = await desk.newPage()
  await dp.route(`${CDN}/**`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: png }))
  const b2 = createBackend()
  await dp.route(`${API}/**`, async (route) => {
    const req = route.request()
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    const url = new URL(req.url())
    const res = b2.handle(req.method(), url.pathname.replace(/^\/v1/, ""), url, null)
    await route.fulfill({ status: res.status, headers: { ...cors, "content-type": "application/json" }, body: res.body === undefined ? "" : JSON.stringify(res.body) })
  })
  await dp.goto(`${ORIGIN}/#/explorar`)
  await dp.getByText("Peça de teste 1", { exact: true }).first().waitFor()
  await dp.screenshot({ path: join(SHOTS, "explorar-1440.png") })
  await desk.close()
} catch (e) {
  failures.push(String(e))
  console.error(e)
} finally {
  await browser?.close()
  server.kill()
}

console.log(failures.length ? `\n${failures.length} falha(s)` : "\nE2E ok")
process.exit(failures.length ? 1 : 0)
