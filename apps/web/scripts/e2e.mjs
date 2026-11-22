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
  // p1 is sold by two more stores: one cheaper, one pricier (grouped by the API as offers).
  products[0].offers = [
    { partner: { id: "loja-gama", name: "Loja Gama" }, price: { amount: 89, currency: "BRL" }, links: { productUrl: "https://gama.test/p/p1" } },
    { partner: { id: "loja-delta", name: "Loja Delta" }, price: { amount: 140, currency: "BRL" }, links: { affiliateUrl: "https://delta.test/aff/p1" } },
  ]
  const state = { signedIn: false, favorites: new Set(), tokens: 20, jobPolls: 0, looks: [], savedLooks: new Set(), generations: [] }
  const user = { id: "u1", name: "Ana Teste", email: "ana@exemplo.com", emailVerified: true, providers: ["password"], createdAt: "2026-01-02T10:00:00Z" }
  const rules = { minRating: { value: 4, mode: "prefer" }, minReviews: { value: 0, mode: "off" }, excludedPartners: [], sizes: { top: null, bottom: null, shoes: null }, onlyAvailableSize: false, budget: { value: 800, scope: "look", mode: "prefer" }, missingRating: "warn", advanced: {} }
  const withFav = (p) => ({ ...p, favorite: state.favorites.has(p.id) })
  const look = { id: "l1", title: "Look de teste", note: "Blazer com calça reta.", image: img("l1", 1000, 1250), pieces: [{ product: products[0], role: "look", warnings: [] }, { product: products[1], role: "similar", warnings: ["Prazo de 12 dias"] }], origin: "generate", version: 1, candidatesCount: 14, saved: false }

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
      if (url.searchParams.get("priceMax")) priceQueries.push(url.searchParams.get("priceMax"))
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
    if (method === "GET" && path === "/studio/config") return { status: 200, body: { costs: { generate: 6, edit: 2, tryOn: 4 }, maxReferences: 3, maxChosenPieces: 6, maxPromptLength: 280, budget: { min: 100, max: 3000, step: 50, currency: "BRL" }, acceptedImageTypes: ["image/jpeg", "image/png", "image/webp"], maxImageBytes: 12 * 1024 * 1024, minImageHeight: 600, sizes: { top: ["PP", "P", "M", "G", "GG"], bottom: ["36", "38", "40"], shoes: ["35", "36", "37"] } } }
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
      if (body?.mode === "dress" ? !body?.productIds?.length && !body?.referenceIds?.length : !body?.prompt && !body?.productIds?.length) return { status: 422, body: { error: { code: "validation", message: "Pedido vazio." } } }
      state.jobPolls = 0
      state.generations.push(body)
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
    if (method === "GET" && path === "/studio/looks/l1/candidates") {
      // 14 products returned by the search agent, plus a repeated p1 that the app must show once.
      const items = products.slice(0, 14).map((p, i) => ({ product: withFav(p), usedInLook: i < 2, failed: i === 5 ? ["Nota mínima"] : [] }))
      return { status: 200, body: { items: [...items, { product: withFav(products[0]), usedInLook: true, failed: [] }] } }
    }
    if (method === "GET" && path === "/studio/match/deck") {
      // Other looks prepared for the search (Match deck); the Estúdio photo pages through them too.
      const deck = [2, 3, 4].map((n) => ({ ...look, id: `m${n}`, title: `Sugestão ${n}`, note: `Outra opção ${n}.`, image: img(`m${n}`, 1000, 1250), candidatesCount: 0 }))
      return { status: 200, body: { items: deck } }
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
const priceQueries = []
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

  // 2b. Price filter is a slider (same control as the Estúdio budget); its value goes to the server.
  {
    await page.getByRole("button", { name: /^Filtros/ }).click()
    const slider = page.getByRole("slider", { name: /Preço máximo/ })
    await slider.waitFor()
    check((await slider.getAttribute("aria-valuetext")) === "qualquer preço", "preço começa sem limite")
    const before = priceQueries.length
    await slider.focus()
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft")
    await page.waitForTimeout(600)
    check(/^até R\$/.test((await slider.getAttribute("aria-valuetext")) ?? ""), "slider mostra o limite escolhido")
    check(priceQueries.length === before, `arrastar o slider não consulta a API (${priceQueries.slice(before).join(",")})`)
    await page.getByRole("button", { name: "Aplicar filtro" }).click()
    await page.waitForTimeout(600)
    check(priceQueries.slice(before).some((v) => v === "580"), `preço máximo enviado à API após Aplicar (${priceQueries.slice(before).join(",")})`)
    check(await page.getByRole("button", { name: "Aplicar filtro" }).isDisabled(), "botão Aplicar fica desabilitado depois de aplicar")
    await page.screenshot({ path: join(SHOTS, "explorar-filtros-390.png") })
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "Limpar filtros" }).first().click()
  }

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
  await page.getByRole("button", { name: /Saldo: 20 moedas/ }).first().waitFor()
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
  check((await page.getByRole("radio", { name: "Procurar" }).getAttribute("aria-checked")) === "true", "Estúdio abre no modo Procurar")
  check((await page.getByLabel("O que você quer vestir?").getAttribute("placeholder")) === "Me vista com roupas de verão", "exemplo realista no campo")
  await page.getByRole("radio", { name: "Vestir" }).click()
  await page.getByText("Fotos do seu celular", { exact: true }).waitFor()
  await page.getByRole("button", { name: /Vestir peças · 6 moedas/ }).click()
  await page.getByText(/Escolha uma peça no Explorar ou no Acervo/).waitFor()
  check(backend.state.generations.length === 0, "Vestir sem peças nem fotos não envia pedido")
  await page.getByRole("radio", { name: "Procurar" }).click()
  await page.getByLabel("O que você quer vestir?").fill("Reunião de manhã, sem parecer formal demais")
  await page.getByRole("button", { name: /Procurar e vestir · 6 moedas/ }).click()
  await page.getByText("Buscando peças nos parceiros").waitFor()
  check(true, "progresso do pedido vindo da API")
  check(backend.state.generations.at(-1)?.mode === "search", "Procurar envia mode search")
  await page.locator("#result-title").getByText("Look de teste").waitFor({ timeout: 15_000 })
  check(true, "look pronto exibido")
  await page.getByRole("button", { name: /Saldo: 14 moedas/ }).first().waitFor()
  check(true, "saldo atualizado após o débito")
  await page.screenshot({ path: join(SHOTS, "estudio-resultado-390.png"), fullPage: true })

  // 6b. Match sits inside the photo, at the bottom; tapping the photo hides it and tapping again restores it.
  {
    const photo = await page.locator(".sa-stage-photo").first().boundingBox()
    const m = await page.locator(".sa-matchcta").boundingBox()
    check(!!photo && !!m && m.y >= photo.y && m.y + m.height <= photo.y + photo.height && m.y > photo.y + photo.height * 0.75, "Match dentro da foto, na parte de baixo")
    check(!!m && m.height >= 44, "Match com alvo de 44 px")
    const t = await page.locator(".sa-phototitle-text").boundingBox()
    check(!!photo && !!t && !!m && t.y > photo.y && t.y + t.height <= m.y, "título dentro da foto, acima do Match")
    const tap = page.getByRole("button", { name: /ocultar título e Match/ })
    await tap.click()
    await page.waitForTimeout(250)
    check((await page.locator(".sa-matchcta-row[data-hidden]").count()) === 1 && (await page.locator(".sa-matchcta").getAttribute("tabindex")) === "-1" && (await page.getByRole("dialog").count()) === 0, "tocar na foto oculta o Match (sem abrir nada)")
    await tap.click()
    await page.waitForTimeout(250)
    check((await page.locator(".sa-matchcta-row[data-hidden]").count()) === 0, "tocar de novo mostra o Match")
    await page.getByRole("button", { name: "Ampliar imagem", exact: true }).click()
    check((await page.locator(".sa-matchcta").count()) === 0, "Match some com o visualizador aberto")
    const viewer = page.getByRole("dialog", { name: "Look de teste" })
    await viewer.waitFor()
    const img = await viewer.locator(".sa-lookviewer-stage").boundingBox()
    const h = await viewer.locator(".sa-lookviewer-title").boundingBox()
    check(!!img && !!h && h.y >= img.y + img.height, "visualizador: título fora e abaixo da imagem")
    await page.screenshot({ path: join(SHOTS, "estudio-visualizador-390.png") })
    await page.keyboard.press("Escape")
  }

  // 6b2. Cards: arrows and swipe on the photo page through the generated look and the search's other looks.
  {
    const title = async () => (await page.locator("#result-title").innerText()).trim()
    const next = page.locator(".sa-stagenav[data-side=next]")
    await next.waitFor()
    check((await page.locator(".sa-stagecount").innerText()).trim() === "1 de 4", "foto do resultado: 1 look gerado + 3 sugestões")
    await next.click()
    const dealing = await page.locator(".sa-stage-photo .sa-cardswap-out").count()
    await page.waitForTimeout(500)
    check((await title()) === "Sugestão 2" && (await page.getByText("Sugestão da busca").count()) === 1, "seta passa para a próxima carta")
    check(dealing === 1 && (await page.locator(".sa-stage-photo .sa-cardswap-out").count()) === 0, "carta anterior sai animada e some")
    const box = await page.locator(".sa-stage-photo").first().boundingBox()
    const y = box.y + box.height / 2
    const drag = async (from, to, steps, hold) => {
      await page.mouse.move(box.x + box.width * from, y)
      await page.mouse.down()
      for (let i = 1; i <= steps; i++) await page.mouse.move(box.x + box.width * (from + ((to - from) * i) / steps), y)
      if (hold) await hold()
      await page.mouse.up()
      await page.waitForTimeout(600)
    }
    const tBefore = await title()
    let mid = null
    await drag(0.3, 0.5, 6, async () => {
      mid = await page.evaluate(() => ({ t: document.querySelector(".sa-stage-photo .sa-cardswap-in")?.style.transform ?? "", under: !!document.querySelector(".sa-stage-photo .sa-cardswap-under") }))
    })
    check(/translateX\(\d/.test(mid?.t ?? "") && mid.under === true, "segurando, a carta acompanha o arrasto e mostra a próxima por baixo", JSON.stringify(mid))
    check((await title()) === tBefore && !((await page.locator(".sa-stage-photo .sa-cardswap-in").getAttribute("style")) ?? "").includes("translate"), "soltando antes do fim, a carta volta ao lugar")
    await drag(0.15, 0.9, 10)
    check((await title()) === "Look de teste", "arrastar para a direita volta à carta anterior")
    await page.getByRole("button", { name: "Ampliar imagem", exact: true }).click()
    const v = page.getByRole("dialog", { name: "Look de teste" })
    await v.waitFor()
    await v.getByRole("button", { name: "Próximo look", exact: true }).click()
    await page.waitForTimeout(500)
    check((await page.getByRole("dialog").last().locator(".sa-lookviewer-title").innerText()).trim() === "Sugestão 2", "imagem aberta também passa as cartas")
    await page.keyboard.press("Escape")
  }

  // 6c. Store tags: the same piece in other stores; choosing one switches price, total and link.
  {
    const card = page.locator("#pieces-title").locator("xpath=ancestor::section[1]")
    const gama = card.getByRole("radio", { name: /^Loja Gama, R\$\s89,00, menor preço$/ })
    const delta = card.getByRole("radio", { name: /^Loja Delta, R\$\s140,00, maior preço$/ })
    check((await gama.getAttribute("class")).includes("sa-price-low") && (await delta.getAttribute("class")).includes("sa-price-high"), "menor e maior preço marcados nas tags")
    const colors = await page.evaluate(() => [".sa-storetag.sa-price-low", ".sa-storetag.sa-price-high"].map((q) => getComputedStyle(document.querySelector(q)).color))
    check(colors[0] !== colors[1], `cores diferentes para menor e maior (${colors.join(" / ")})`)
    await gama.click()
    check((await gama.getAttribute("aria-checked")) === "true", "escolher a loja marca só aquela tag")
    await page.getByText(/somam\s*R\$\s89,00/).waitFor()
    check(true, "total do look usa o preço da loja escolhida")
    await gama.press("ArrowRight")
    check((await delta.getAttribute("aria-checked")) === "true", "setas do teclado trocam a loja")
    await card.getByRole("button", { name: /Peça de teste 1, .* Ver detalhes/ }).click()
    const cta = page.getByRole("dialog").getByRole("link", { name: /^Ver na Loja Delta/ })
    await cta.waitFor()
    check((await cta.getAttribute("href")) === "https://delta.test/aff/p1" && (await cta.getAttribute("rel")).includes("sponsored"), "link de saída é o da loja escolhida")
    await page.getByRole("dialog").getByRole("radio", { name: /^Loja Alfa/ }).click()
    check((await page.getByRole("dialog").getByRole("link", { name: /^Ver na Loja Alfa/ }).getAttribute("href")) === "https://loja.test/aff/p1", "trocar a loja no detalhe troca o link")
    await page.screenshot({ path: join(SHOTS, "estudio-lojas-390.png") })
    await page.keyboard.press("Escape")
  }

  // 6d. Search catalog: collapsible, paged, up to 6 base pieces sent to the generation.
  {
    const toggle = page.getByRole("button", { name: /Catálogo da busca/ })
    check((await toggle.getAttribute("aria-expanded")) === "false", "catálogo começa recolhido")
    await toggle.click()
    const tiles = page.locator(".sa-searchcat-body [role=checkbox]")
    await tiles.first().waitFor()
    check((await tiles.count()) === 6, "uma página com 6 produtos")
    check((await page.locator(".sa-pager-num").count()) === 3, "14 produtos (duplicata agrupada) em 3 páginas")
    await toggle.scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(SHOTS, "estudio-catalogo-390.png") })
    const first = await tiles.first().getAttribute("aria-label")
    await page.getByRole("button", { name: "Próxima página" }).click()
    check((await tiles.first().getAttribute("aria-label")) !== first && (await page.locator('.sa-pager-num[aria-current="page"]').innerText()) === "2", "próxima página troca os produtos")
    await page.getByRole("button", { name: "Página 1", exact: true }).click()
    for (let i = 0; i < 6; i++) await tiles.nth(i).click()
    await page.getByRole("button", { name: "Próxima página" }).click()
    check((await tiles.first().getAttribute("aria-disabled")) === "true", "7ª peça bloqueada no limite de 6")
    await tiles.first().click({ force: true })
    check((await page.getByText(/^6 de 6 na base/).count()) === 1, "limite de 6 respeitado")
    await page.getByRole("button", { name: /Vestir 6 peças · 6 moedas/ }).click()
    await page.waitForFunction(() => !document.querySelector(".sa-searchcat-foot .sa-spin"), null, { timeout: 15_000 })
    const sent = backend.state.generations.at(-1)
    check(sent?.mode === "dress" && (await page.getByRole("radio", { name: "Vestir" }).getAttribute("aria-checked")) === "true", "vestir peças da busca usa o modo Vestir")
    check(sent?.productIds?.length === 6 && sent.productIds[0] === "p1", `geração recebe as 6 peças base (${sent?.productIds?.join(",")})`)
    await page.screenshot({ path: join(SHOTS, "estudio-catalogo-6-390.png") })
    await toggle.click()
    check((await toggle.getAttribute("aria-expanded")) === "false", "catálogo recolhe de novo")
  }

  // 6e. No sideways scroll and 44 px targets on the Estúdio.
  {
    const audit = await page.evaluate(() => {
      const small = []
      document.querySelectorAll(".sa-studio button, .sa-studio a").forEach((el) => {
        const r = el.getBoundingClientRect()
        if (!r.width || el.closest("[hidden]") || el.closest(".sa-sr")) return
        const hit = el.classList.contains("sa-hit") ? 4 : 0
        if (r.width < 44 - hit - 0.5 || r.height < 44 - hit - 0.5) small.push(`${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)} ${Math.round(r.width)}x${Math.round(r.height)}`)
      })
      return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, small }
    })
    check(!audit.overflow, "Estúdio sem rolagem horizontal")
    check(audit.small.length === 0, `alvos de toque >= 44 px${audit.small.length ? `: ${audit.small.slice(0, 6).join(" | ")}` : ""}`)
  }

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
  {
    // Wide filter bar: price is the inline slider (no select), same pattern as the Estúdio budget.
    const bar = dp.locator(".sa-filterbar-full")
    await bar.scrollIntoViewIfNeeded()
    check((await bar.getByRole("slider", { name: /Preço máximo/ }).count()) === 1 && (await bar.locator("select").filter({ hasText: "Qualquer preço" }).count()) === 0, "desktop: preço é barra deslizante na linha de filtros")
    await bar.getByRole("button", { name: /Preço máximo.*Digitar valor/ }).click()
    await bar.getByLabel(/Preço máximo por peça em reais/).fill("300")
    await dp.keyboard.press("Enter")
    check(((await bar.getByRole("slider", { name: /Preço máximo/ }).getAttribute("aria-valuetext")) ?? "").match(/^até R\$\s300 por peça$/) !== null, "desktop: valor digitado move a barra")
    await dp.screenshot({ path: join(SHOTS, "explorar-filtros-1440.png"), clip: { x: 0, y: Math.max(0, ((await bar.boundingBox())?.y ?? 0) - 140), width: 1440, height: 320 } })
  }
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
