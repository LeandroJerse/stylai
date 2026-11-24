/**
 * Official front (no demo code) against a scripted in-browser API: page.route answers every /v1 call.
 * No backend, no database, no provider. Content is synthetic, with the long titles marketplaces really use.
 */
import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

export async function startFront(port) {
  const base = `http://localhost:${port}`
  const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin", "vite.js")
  const server = spawn(process.execPath, [vite, "--port", String(port), "--strictPort"], { cwd: root, stdio: "pipe", env: { ...process.env, VITE_API_BASE_URL: `${base}/v1`, VITE_GOOGLE_CLIENT_ID: "" } })
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("front did not start")), 40_000)
    server.stdout.on("data", (d) => String(d).includes(String(port)) && (clearTimeout(t), resolve()))
    server.stderr.on("data", (d) => process.stderr.write(d))
  })
  return { base, stop: () => server.kill() }
}

export const LONG = {
  lower: "Calça Pantalona Feminina Cintura Alta Wide Leg Social Elegante Alfaiataria Plus Size Casual Trabalho Nova Coleção 2026",
  upper: "2026 Novo Suéter Feminino de Tricô Gola Redonda Manga Comprida Outono Inverno Solto Confortável Pulôver Básico Coreano",
  outer: "Jaqueta Corta-Vento Masculina e Feminina Impermeável com Capuz Leve Esportiva Corrida Ciclismo Ao Ar Livre Secagem Rápida",
  jersey: "2026_27 Camisa de Futebol Colete La Coruña Torcedor Edição Especial Masculino Respirável",
  set: "Conjunto Feminino 2 Peças Verão Regata Cropped e Short Cintura Alta Casual Linho Praia Moda Elegante Roupas Femininas 2026",
}
const colors = ["#c9b79c", "#8fa39a", "#a77f6b", "#6f7f92", "#b9a3ad", "#7d7a58"]
const svg = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="${colors[n % colors.length]}"/><circle cx="300" cy="190" r="82" fill="#fff8"/><path d="M170 320h260l40 250H400l-20 210H220l-20-210h-70z" fill="#fff8"/></svg>`

const SLOT = { upper: "Parte de cima", lower: "Parte de baixo", outer: "Terceira peça", dress: "Vestido", set: "Conjunto" }
export const piece = (base, slot, name, price, over = {}) => ({
  storeRating: over.rating ?? 92.1, storeSales: 12, slot, label: SLOT[slot], reason: over.reason ?? "", variantId: null,
  tryOn: over.blocked ? { ready: false, code: "image_unsuitable", message: "A imagem desta peça não serve para a prova." } : { ready: true, code: null, message: null },
  product: {
    id: over.id ?? `p-${slot}-${name.length}-${price}`, name, category: { id: "tops", label: "Roupas" }, partner: { id: "aliexpress", name: over.store ?? "Shop1105895109 Store" }, price: { amount: price, currency: "BRL" },
    images: [{ url: `${base}/v1/mock/img/${(name.length + Math.round(price)) % 6}`, width: 600, height: 800, alt: name }], variants: [], availability: "unknown",
    links: { productUrl: "https://example.com/item", affiliateUrl: "https://example.com/aff" }, favorite: false, tryOnReady: !over.blocked,
  },
})

export function finishRender(r, base) {
  r.status = "succeeded"
  r.canCancel = false
  r.panels.forEach((p, i) => { p.state = "ready"; p.stateLabel = "Pronta"; p.image = { url: `${base}/v1/mock/img/${i + 2}`, width: 600, height: 800, alt: p.title } })
  if (r.comparison) r.comparison = { state: "ready", image: { url: `${base}/v1/mock/img/3`, width: 600, height: 800, alt: "Comparativo" }, error: null }
}
const panelOf = (i, title, setId = `set-${i + 1}`) => ({ panel: i + 1, setId, searchId: "search-1", title, state: i ? "queued" : "running", stateLabel: i ? "Na fila" : "Gerando", image: null, lookId: null, pieces: [], error: null, attempts: 1, canRetry: false, retryNeedsChargeAcceptance: false, retryBlockedReason: null })
export const finishedRender = (base, i, mode = "individual") => {
  const r = { id: `old-${i}`, mode, createdAt: `2026-11-2${i}T10:00:00Z`, model: "flux", status: "running", spentUsd: 0, canCancel: false, canFinalize: false, comparison: mode === "comparison" ? { state: "ready", image: null, error: null } : null, panels: Array.from({ length: mode === "comparison" ? 2 : 1 }, (_, k) => panelOf(k, "Leve de linho")) }
  finishRender(r, base)
  return r
}

export function createState(base, opts = {}) {
  const TITLES = ["Leve de linho", "Casual urbano", "Praia e passeio", "Noite fresca"]
  const WHY = ["Tons claros e tecido leve, para dias quentes.", "Camisa solta com base neutra.", "Conjunto pronto, com movimento.", "Sobreposição fina para o fim do dia."]
  const set = (i, over = {}) => ({
    id: `set-${i}`, searchId: "search-1", kind: over.kind ?? "assembled", recommended: i === 1, title: TITLES[i - 1], rationale: WHY[i - 1], missingSlots: over.missing ?? [], revision: 1, locked: [],
    pieces: over.pieces ?? [
      piece(base, "upper", LONG.upper, 59.9 + i, { id: `u${i}`, reason: "Cor neutra que combina com tudo." }),
      piece(base, "lower", LONG.lower, 89.9 + i, { id: `l${i}`, reason: "Cintura alta equilibra a parte de cima." }),
      ...(i === 2 ? [piece(base, "outer", LONG.outer, 129.9, { id: "o2" })] : []),
    ],
    total: { amount: 150 + i * 20, currency: "BRL" }, overBudget: null, origin: { label: "Original" },
  })
  const look = (i) => {
    const names = i % 3 === 0 ? [LONG.jersey] : i % 3 === 1 ? [LONG.lower, LONG.upper, LONG.outer] : [LONG.set]
    const pieces = names.map((n, k) => ({ product: piece(base, "upper", n, 79 + k, { id: `lk${i}-${k}` }).product, role: "look", warnings: [] }))
    return { id: `look-${i}`, title: names.join(" + "), note: null, image: { url: `${base}/v1/mock/img/${i}`, width: 600, height: 800, alt: "Prévia" }, pieces, prompt: null, origin: "generate", version: 1, parentId: null, createdAt: "2026-11-23T12:00:00Z", candidatesCount: 0, saved: false, simulated: false, lineageId: `lin-${i}` }
  }
  return {
    base, sets: [set(1), set(2), set(3, { kind: "bundle", missing: ["Parte de baixo"], pieces: [piece(base, "set", LONG.set, 119.9, { id: "s3" })] })],
    looks: Array.from({ length: opts.looks ?? 8 }, (_, i) => look(i + 1)), renders: opts.renders ?? [], searches: opts.searches ?? [], calls: [],
    polls: 0, runningPolls: opts.runningPolls ?? 2, searchStatus: opts.searchStatus ?? null, finalStatus: opts.finalStatus ?? "succeeded", stuck: false, lastSearch: null, balance: opts.balance ?? 40, renderPolls: 0, quoteReady: opts.quoteReady ?? true, config: opts.config ?? {},
    doc() {
      const running = this.searchStatus === "running"
      const empty = this.searchStatus === "empty"
      return {
        id: "search-1", prompt: this.lastSearch?.prompt ?? "me vista com roupas de verão", filters: this.lastSearch?.filters ?? null, source: "aliexpress", status: this.searchStatus ?? "succeeded", createdAt: "2026-11-24T18:08:22Z",
        stage: { id: running ? "search" : "done", label: running ? "Buscando peças na loja" : "Pronto", detail: { done: this.polls, total: 4 } }, selection: running || empty ? null : { method: "agent", model: "claude-haiku" },
        message: empty ? "Nenhuma combinação da loja atende a este pedido. Tente outras cores ou um orçamento maior." : null, sets: running || empty ? [] : this.sets,
        report: running ? null : { interpretedBy: "agent", plannedBy: "agent", queries: [{ slot: "Parte de cima", query: "camiseta leve", outcome: "ok", returned: 50, kept: 12 }, { slot: "Parte de baixo", query: "short", outcome: "filtered_out", returned: 49, kept: 0 }], filtered: { style: 9, ...(this.lastSearch?.filters ? { filter_price: 8, filter_rating_missing: 4 } : {}) }, missingSlots: ["Parte de baixo"], agent: { calls: 3, estimatedUsd: 0.0012 } },
      }
    },
  }
}

export async function mockApi(page, state) {
  const { base } = state
  await page.route(`${base}/v1/**`, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = url.pathname.slice(3)
    const method = req.method()
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) })
    const body = () => { try { return req.postDataJSON() } catch { return null } }
    if (path.startsWith("/mock/img/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(Number(path.split("/").pop()) || 0) })
    state.calls.push({ method, path, body: method === "POST" ? body() : null })
    if (path === "/auth/refresh") return json({ accessToken: "mock", user: { id: "u1", name: "Pessoa Teste", email: "teste@example.com", emailVerified: true, providers: ["password"] } })
    if (path === "/me/balance") return json({ tokens: state.balance, plan: { id: "paid", name: "Pago", tokensPerPeriod: 120, period: "day", price: null }, renewsAt: null })
    if (path === "/me/body-photos") return json({ items: [{ id: "b1", angle: "front", image: { url: `${base}/v1/mock/img/1`, width: 600, height: 800 }, status: "ready", issues: [], inUse: true, validation: { status: "approved", framing: "full_body", supports: { upper: true, lower: true, dress: true }, measuredAngle: "front", version: "1" } }], consent: { policyVersion: "2026-11-24-inline", accepted: true }, requiredAngles: ["front"], validator: { available: true } })
    if (path === "/catalog/source") return json({ id: "aliexpress_affiliate", label: "AliExpress" })
    if (path === "/catalog/facets") return json({ categories: [], partners: [], price: { min: 0, max: 500 } })
    if (path === "/catalog/products") return json({ items: ["upper", "lower", "outer", "set"].map((s, i) => piece(base, s, LONG[s], 59.9 + i * 30, { id: `cat${i}` }).product), nextCursor: null })
    if (path === "/studio/config") {
      return json({
        costs: { generate: 10, edit: null, tryOn: 10 }, unit: { singular: "moeda", plural: "moedas" }, quotaStatus: "provisional", plans: [], costGaps: [], generationMode: "real",
        realProvider: { provider: "Segmind", model: "flux-3-klein-image-edit", callsPerGeneration: 1, estimatedUsdPerCall: 0.01287, maxUsdPerCall: 0.02 }, maxReferences: 0, maxChosenPieces: 1, maxPromptLength: 500,
        budget: { min: 0, max: 0, step: 1, currency: "BRL" }, acceptedImageTypes: ["image/jpeg"], maxImageBytes: 1, minImageHeight: 1, sizes: {}, photoPolicyVersion: "2026-11-24-inline",
        capabilities: { mode: "single_piece_try_on", search: true, searchScope: "stores", dress: true, adjustments: false, bodyPhotoRequired: true, closet: false, generation: true, edits: false, match: false, references: false, preferences: false, measurements: false, plans: false, candidates: false, outfits: true, outfitFilters: ["audience", "price", "total", "rating", "sales"], composer: { mode: "agent", model: "claude-haiku" }, ...state.config },
      })
    }
    if (path === "/studio/looks") return json({ items: state.looks })
    let m = path.match(/^\/studio\/looks\/([^/]+)\/versions$/)
    if (m) return json({ items: state.looks.filter((l) => l.id === m[1]) })
    m = path.match(/^\/studio\/looks\/([^/]+)$/)
    if (m) return json(state.looks.find((l) => l.id === m[1]) ?? {})
    if (path === "/studio/searches" && method === "POST") return json({ items: [{ product: piece(base, "upper", LONG.jersey, 25.89, { id: "jersey", blocked: true }).product, usedInLook: false, failed: [] }] })
    if (path === "/studio/outfit-searches" && method === "POST") {
      state.lastSearch = body()
      state.searchStatus = "running"
      state.polls = 0
      state.searches = [{ id: "search-1", prompt: state.lastSearch.prompt, createdAt: "2026-11-24T18:08:22Z", status: "running", sets: 0 }, ...state.searches.filter((s) => s.id !== "search-1")]
      return json(state.doc(), 202)
    }
    if (path === "/studio/outfit-searches") return json({ items: state.searches })
    m = path.match(/^\/studio\/outfit-searches\/([^/]+)(\/cancel)?$/)
    if (m) {
      if (m[2]) state.searchStatus = "cancelled"
      else if (state.searchStatus === "running" && !state.stuck && ++state.polls > state.runningPolls) state.searchStatus = state.finalStatus
      return json(state.doc())
    }
    m = path.match(/^\/studio\/outfit-sets\/([^/]+)(?:\/(\w+))?$/)
    if (m) {
      const s = state.sets.find((x) => x.id === m[1])
      if (m[2]) s.revision += 1
      if (m[2] === "locks") s.locked = body().locked
      return json({ ...s, alternatives: Object.fromEntries(s.pieces.map((p) => [p.slot, [1, 2, 3].map((k) => piece(base, p.slot, p.product.name, 40 + k, { id: `alt-${p.slot}-${k}` }))])), revisions: [{ revision: 1, label: "Original", current: true, total: s.total, pieces: s.pieces }] })
    }
    if (path === "/studio/outfit-renders/quote") {
      const b = body()
      const panels = b.sets.map((x, i) => { const s = state.sets.find((y) => y.id === x.setId); return { panel: i + 1, setId: s.id, revision: s.revision, title: s.title, pieces: s.pieces, total: s.total } })
      return json({ mode: b.mode, ready: state.quoteReady, confirmation: "c1", blockers: state.quoteReady ? [] : [{ code: "insufficient_coins", message: "Moedas insuficientes hoje." }], blockedPieces: [], changes: [], panels, generation: { simulated: false, provider: "Segmind", model: "flux-3-klein-image-edit", calls: b.sets.length, estimatedUsd: 0.01287 * b.sets.length, maxUsd: 0.02 * b.sets.length }, coins: { cost: 10 * b.sets.length, available: state.balance }, budget: { pilot: { remainingAttempts: 3, maxAttempts: 15, remainingUsd: 1.7, paused: false } } })
    }
    if (path === "/studio/outfit-renders" && method === "POST") {
      const b = body()
      const render = { id: `render-${state.renders.length + 1}`, mode: b.mode, createdAt: "2026-11-24T18:10:52Z", model: "flux-3-klein-image-edit", status: "running", spentUsd: 0, canCancel: true, canFinalize: false, comparison: b.mode === "comparison" ? { state: "pending", image: null, error: null } : null, panels: b.sets.map((x, i) => panelOf(i, state.sets.find((s) => s.id === x.setId).title, x.setId)) }
      state.renders.unshift(render)
      state.renderPolls = 0
      return json(render, 202)
    }
    if (path === "/studio/outfit-renders") {
      if (!state.stuck && ++state.renderPolls > 2) for (const r of state.renders) if (r.status === "running") finishRender(r, base)
      return json({ items: state.renders })
    }
    return json({ items: [] })
  })
}

/** Pixels of the element that are really inside the viewport, below the app header. */
export const visibleShare = (page, selector) => page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect()
  const header = document.querySelector("header")?.getBoundingClientRect()
  const top = Math.max(r.top, header ? Math.max(0, header.bottom) : 0)
  return { top: Math.round(r.top), height: Math.round(r.height), visible: Math.max(0, Math.round(Math.min(r.bottom, innerHeight) - top)) }
}).catch(() => ({ top: null, height: 0, visible: 0 }))
