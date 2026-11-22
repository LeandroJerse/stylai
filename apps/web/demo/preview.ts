import { configureDemo, handle, PREVIEW_API, revalidationSource } from "./demo-api"
import { analyzeInBrowser } from "./pose-browser"

// The demo never transmits credentials, uploaded photos or API calls to a backend.
const realFetch = window.fetch.bind(window)
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : null
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, document.baseURI)
  // @mediapipe/tasks-vision posts usage counters (no image) to Google every minute and has no public
  // opt-out. The demo promises that nothing leaves the browser: answer locally with an error, which
  // makes the library stop its logger.
  if (url.hostname === "odml.pa.googleapis.com") return new Response(null, { status: 403 })
  if (!url.href.startsWith(PREVIEW_API + "/")) return realFetch(input, init)
  const signal = init?.signal ?? request?.signal
  signal?.throwIfAborted()
  const payload = init?.body ?? (request ? await request.clone().text() : null)
  let body: Record<string, unknown> | null = null
  if (typeof payload === "string" && payload) body = JSON.parse(payload) as Record<string, unknown>
  if (payload instanceof FormData) {
    const file = payload.get("file")
    // The selected file stays in this browser: only a local object URL is kept for display.
    body = file instanceof File ? { sizeBytes: file.size, mime: file.type, localUrl: URL.createObjectURL(file) } : null
    // Body photos are measured here, in the browser (MediaPipe), then judged by the shared rules.
    if (body && file instanceof File && /\/me\/body-photos\/(front|side|profile)$/.test(url.pathname)) body.analysis = await analyzeInBrowser(file)
  }
  const revalidate = /\/me\/body-photos\/(front|side|profile)\/revalidate$/.exec(url.pathname)
  if (revalidate) {
    const source = revalidationSource(revalidate[1]!)
    body = { analysis: source ? await analyzeInBrowser(await (await realFetch(source)).blob()) : null }
  }
  await new Promise(resolve => setTimeout(resolve, 160))
  signal?.throwIfAborted()
  const headers: Record<string, string> = {}
  new Headers(init?.headers ?? request?.headers ?? undefined).forEach((value, key) => { headers[key.toLowerCase()] = value })
  const res = handle(init?.method ?? request?.method ?? "GET", url.pathname.replace(/^\/v1/, ""), url, body, headers)
  return new Response(res.status === 204 ? null : JSON.stringify(res.body), { status: res.status, headers: { "content-type": "application/json" } })
}) as typeof window.fetch

const params = new URLSearchParams(location.search)
// Official contract by default (same screens as the real API); ?demo=full keeps the earlier prototype.
configureDemo({ contract: params.get("demo") === "full" ? "full" : "tryon" })
if (params.get("demo") === "visitor") configureDemo({signedIn:false})
if (params.get("demo") === "empty-balance") configureDemo({tokens:0})
// Catalog: the shared test catalog by default; ?casos=teste adds the synthetic edge cases (automated tests);
// ?catalogo=referencias shows the SHEIN listing references (rights unconfirmed; explicit opt-in only).
if (params.get("catalogo") === "referencias") configureDemo({ catalog: "store" })
else if (params.get("casos") === "teste") configureDemo({ catalog: "synthetic" })
// QA-011: the chosen plan lives in the URL, so it survives a reload; "Reiniciar demo" clears it (paid, 120).
const plan = params.get("plano")
if (plan === "gratuito" || plan === "pago") configureDemo({ plan: plan === "gratuito" ? "free" : "paid" })
const bar = document.createElement("aside")
bar.className = "sa-preview-bar"
bar.setAttribute("aria-label", "Controles da demonstração")
const label = document.createElement("span")
label.textContent = "Demo · conta fictícia e catálogo de teste. Geração simulada (imagem demonstrativa, sem chamada de IA paga); a validação de pose roda no seu navegador. Sua foto não sai do navegador."
bar.append(label)
const controls = document.createElement("details")
const summary = document.createElement("summary")
summary.textContent = "Testar cenários"
controls.append(summary)
const action = (text: string, run: () => void): void => {
  const button = document.createElement("button")
  button.type = "button"; button.textContent = text; button.addEventListener("click", run); controls.append(button)
}
const reload = (mode: string): void => { const url=new URL(location.href); url.searchParams.set("demo",mode); location.assign(url) }
// A plan scenario opens the signed-in demo account on that plan (visitor/empty-balance scenarios are left).
const choosePlan = (p: "gratuito" | "pago"): void => {
  const url = new URL(location.href)
  url.searchParams.set("plano", p)
  if (url.searchParams.get("demo") !== "full") url.searchParams.delete("demo")
  location.assign(url)
}
action("Reiniciar demo", () => { const url = new URL(location.href); url.searchParams.set("demo", "normal"); url.searchParams.delete("plano"); location.assign(url) })
action("Testar sem login", () => reload("visitor"))
action("Testar saldo zero", () => reload("empty-balance"))
// Choosing a plan restarts the demo session on that plan (dados da demo ficam só na memória desta aba).
action("Plano gratuito (30 moedas)", () => choosePlan("gratuito"))
action("Plano pago (120 moedas)", () => choosePlan("pago"))
action("Abrir link de confirmação do cadastro", () => { location.hash = "#/confirmar-email?token_hash=demo-" + Math.random().toString(36).slice(2, 14) + "&type=email" })
action("Ver protótipo completo (Procurar/Vestir)", () => reload("full"))
action("Falhar próximo pedido", () => { configureDemo({scenario:"failed"}); status.textContent="O próximo pedido falhará sem cobrança." })
action("Próxima busca sem resultados", () => { configureDemo({scenario:"no_results"}); status.textContent="A próxima busca terminará sem resultados e sem cobrança." })
const status = document.createElement("span")
status.setAttribute("role","status")
controls.append(status); bar.append(controls); document.body.prepend(bar)
