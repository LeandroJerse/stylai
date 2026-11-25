import { describe, expect, test } from "bun:test"
import { createAliExpressAffiliateClient, createAliExpressCatalogService, type AliExpressCatalogService, type AliExpressFetch } from "@stylai/commerce"
import type { PrivateDatabase } from "@stylai/supabase"
import { buildApp } from "../src/app"

const SECRET = "synthetic-aliexpress-secret"
const ACTOR = "20000000-0000-4000-8000-000000000001"
const db = { call: async (name: string) => name === "list_affiliate_offers" ? { items: [], total: 0, nextCursor: null } : null } as unknown as PrivateDatabase<"api">
const queryBody = { aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: { products: { product: [{
  product_id: "1005000000000001", product_title: "Vestido midi floral", product_main_image_url: "https://ae01.alicdn.com/kf/S1.jpg",
  target_sale_price: "89.90", target_sale_price_currency: "BRL", product_detail_url: "https://pt.aliexpress.com/item/1005000000000001.html",
  promotion_link: "https://s.click.aliexpress.com/e/_from_query", shop_name: "Loja X", shop_id: 7,
}] } } }, request_id: "q-1" } }
const linkBody = { aliexpress_affiliate_link_generate_response: { resp_result: { resp_code: 200, result: { tracking_id: "stylai", promotion_links: { promotion_link: [
  { source_value: "https://pt.aliexpress.com/item/1005000000000001.html", promotion_link: "https://s.click.aliexpress.com/e/_generated" },
] } } } } }

function service(opts: { trackingId?: string | null; fail?: boolean; empty?: boolean; business405?: boolean } = {}) {
  const methods: string[] = []
  const fetch: AliExpressFetch = async (_url, init) => {
    const method = new URLSearchParams(init.body).get("method")!
    methods.push(method)
    if (opts.fail) throw new Error(SECRET)
    const body = method === "aliexpress.affiliate.link.generate" ? linkBody
      : opts.business405 ? { resp_result: { resp_code: 405, resp_msg: "The result is empty" }, request_id: "r-405" }
      : opts.empty ? { resp_result: { resp_code: "200", result: { products: [] } } } : queryBody
    return { ok: true, status: 200, text: async () => JSON.stringify(body) }
  }
  const trackingId = opts.trackingId === undefined ? "stylai" : opts.trackingId
  const client = createAliExpressAffiliateClient({ appKey: "500000", appSecret: SECRET, trackingId, fetch })
  return { aliexpressCatalog: createAliExpressCatalogService({ client, trackingId }), methods }
}

async function build(aliexpressCatalog: ReturnType<typeof service>["aliexpressCatalog"] | null) {
  return buildApp({
    appOrigin: "http://localhost:5200",
    catalog: { db, catalogMode: "aliexpress_affiliate", aliexpressCatalog, resolveActor: async () => ACTOR },
    search: { db, resolveActor: async () => ACTOR, catalogMode: "aliexpress_affiliate", aliexpressCatalog },
  })
}
const search = (app: Awaited<ReturnType<typeof build>>, prompt = "vestido") => app.inject({ method: "POST", url: "/v1/studio/searches", payload: { prompt } })

describe("aliexpress_affiliate catalog mode", () => {
  test("store search prepares tracked links and its cache is readable without adding items to the home", async () => {
    const { aliexpressCatalog, methods } = service()
    const app = await build(aliexpressCatalog)
    try {
      const res = await search(app)
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body).toMatchObject({ source: "aliexpress_affiliate", catalog: "aliexpress_affiliate", links: "generated", total: 1, fromCache: false })
      const product = body.items[0].product
      expect(product).toMatchObject({
        id: "aliexpress:1005000000000001", externalId: "1005000000000001", source: "aliexpress", name: "Vestido midi floral",
        price: { amount: 89.9, currency: "BRL" }, variants: [], availability: "unknown", tryOnReady: false, fixture: false,
        links: { productUrl: "https://pt.aliexpress.com/item/1005000000000001.html", affiliateUrl: "https://s.click.aliexpress.com/e/_generated" },
        capabilities: { displayAndLink: true, aiTryOn: false },
      })
      expect(body.items[0].failed).toContain("Sem imagem liberada para prova")
      expect(res.body).not.toContain(SECRET)
      expect(res.body).not.toContain("_from_query")

      expect((await search(app, " Vestido ")).json().fromCache).toBe(true)
      expect((await app.inject("/v1/catalog/products")).json()).toMatchObject({ total: 0, source: "aliexpress_affiliate" })
      expect((await app.inject("/v1/catalog/products/aliexpress:1005000000000001")).json().links.affiliateUrl).toBe("https://s.click.aliexpress.com/e/_generated")
      expect((await app.inject("/v1/catalog/products/aliexpress:999")).statusCode).toBe(404)
      expect((await app.inject("/v1/catalog/source")).json()).toMatchObject({ id: "aliexpress_affiliate", configured: true, capabilities: { affiliateLinks: true, variants: "none", pagination: "cursor", stock: "unknown" } })
      expect(methods).toEqual(["aliexpress.affiliate.product.query", "aliexpress.affiliate.link.generate"])
    } finally { await app.close() }
  })

  test("without tracking ID the card gets only the plain product link", async () => {
    const { aliexpressCatalog, methods } = service({ trackingId: null })
    const app = await build(aliexpressCatalog)
    try {
      const body = (await search(app)).json()
      expect(body.links).toBe("missing_tracking_id")
      expect(body.items[0].product.links).toEqual({ productUrl: "https://pt.aliexpress.com/item/1005000000000001.html", affiliateUrl: null })
      expect((await app.inject("/v1/catalog/source")).json().capabilities.affiliateLinks).toBe(true)
      expect(methods).toEqual(["aliexpress.affiliate.product.query"])
    } finally { await app.close() }
  })

  test("unconfigured and failing providers answer 503 without synthetic fallback; empty results stay 200", async () => {
    const missing = await build(null)
    try {
      expect((await search(missing)).statusCode).toBe(503)
      expect((await missing.inject("/v1/catalog/products")).json()).toMatchObject({ total: 0, items: [] })
    } finally { await missing.close() }

    const failing = await build(service({ fail: true }).aliexpressCatalog)
    try {
      const res = await search(failing)
      expect(res.statusCode).toBe(503)
      expect(res.body).not.toContain(SECRET)
    } finally { await failing.close() }

    const empty = await build(service({ empty: true }).aliexpressCatalog)
    try {
      const res = await search(empty)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ total: 0, items: [] })
    } finally { await empty.close() }
  })
})

test("resp_code 405 'The result is empty' answers 200 with an honest empty result, not an outage (P06)", async () => {
  const app = await build(service({ business405: true }).aliexpressCatalog)
  try {
    const res = await search(app)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ source: "aliexpress_affiliate", total: 0, items: [], emptyReason: "provider_reported_empty", provider: { code: "405", requestId: "r-405" } })
    expect(res.body).not.toContain(SECRET)
  } finally { await app.close() }
})

test("Estúdio config declares a live store search (not the curated catalog) when the source is a provider API", async () => {
  const { randomBytes } = await import("node:crypto")
  const { readSessionKeys } = await import("../src/modules/auth/session-crypto")
  const keys = readSessionKeys({ STYLAI_SESSION_KEY: randomBytes(32).toString("base64") })!
  const studio = { db, keys, resolveActor: async () => ACTOR, photoPolicyVersion: "t", publicBaseUrl: "http://x/v1", generationEnabled: false }
  const live = await buildApp({ appOrigin: "http://localhost:5200", studio: { ...studio, searchScope: "stores", composer: { mode: "agent", model: "claude-haiku-5-5" } } })
  const curated = await buildApp({ appOrigin: "http://localhost:5200", studio })
  try {
    expect((await live.inject("/v1/studio/config")).json().capabilities).toMatchObject({ searchScope: "stores", composer: { mode: "agent", model: "claude-haiku-5-5" } })
    expect((await curated.inject("/v1/studio/config")).json().capabilities.searchScope).toBe("curated_catalog")
    // P05: who selects is declared; rules are never presented as an agent.
    expect((await curated.inject("/v1/studio/config")).json().capabilities.composer).toEqual({ mode: "rules", model: null })
  } finally { await live.close(); await curated.close() }
})

describe("store search query building (P10 + Haiku interpretation)", () => {
  const spyService = () => {
    const keywords: string[] = []
    const svc = { hasTrackingId: true, findFresh: async () => null, listFreshCached: async () => [],
      search: async (q: { keywords: string }) => { keywords.push(q.keywords); return {
        state: "ready", items: [], rejectedCount: 0, links: null, trackingIdEcho: null, linkErrorCode: null, observedAt: "t", expiresAt: null, fromCache: false,
        requestId: null, errorKind: null, errorCode: null, errorMessage: null, backoffUntil: null, emptyReason: null } } } as unknown as AliExpressCatalogService
    return { svc, keywords }
  }
  test("without an agent the rules build an audience/garment/colour-correct query (never a fixed feminine term)", async () => {
    const { svc, keywords } = spyService()
    const app = await buildApp({ appOrigin: "http://localhost:5200", search: { db, resolveActor: async () => ACTOR, catalogMode: "aliexpress_affiliate", aliexpressCatalog: svc } })
    try {
      const body = (await search(app, "Quero uma calça chino masculina azul marinho")).json()
      expect(keywords[0]).toBe("calça masculina chino azul marinho")
      expect(body.query).toMatchObject({ keywords: "calça masculina chino azul marinho", interpretedBy: "rules", model: null })
    } finally { await app.close() }
  })

  test("with the Haiku agent: its sanitized slot query is used, cached on repeat, tokens and cost reported", async () => {
    const { svc, keywords } = spyService()
    const { createInterpretationCache } = await import("@stylai/ai")
    let calls = 0
    const agent = { model: "claude-haiku-5-5", select: async () => { throw new Error("unused") }, interpret: async () => {
      calls++
      return { intent: { audience: "masculino", slots: [{ slot: "upper", required: true, query: "camisa masculina linho branca", color: "branco" }], colors: ["branco"], terms: [], occasion: null, budgetTotalBrl: null, budgetMode: "prefer", avoid: [] },
        usage: { inputTokens: 300, outputTokens: 50 }, requestId: null, promptVersion: "interpret/x" } } }
    const app = await buildApp({ appOrigin: "http://localhost:5200", search: { db, resolveActor: async () => ACTOR, catalogMode: "aliexpress_affiliate", aliexpressCatalog: svc,
      agent: agent as never, interpretationCache: createInterpretationCache(), agentPrice: { inputPerMTok: 100_000n, outputPerMTok: 500_000n } } })
    try {
      const first = (await search(app, "camisa de linho branca pra homem")).json()
      expect(keywords[0]).toBe("camisa masculina linho branca")
      expect(first.query).toMatchObject({ interpretedBy: "agent", model: "claude-haiku-5-5", cached: false, usage: { inputTokens: 300, outputTokens: 50 }, estimatedUsd: 0.000055 })
      const second = (await search(app, "Camisa de linho branca  pra homem")).json()
      expect(second.query).toMatchObject({ interpretedBy: "agent", cached: true, usage: null, estimatedUsd: 0 })
      expect(calls).toBe(1)
    } finally { await app.close() }
  })

  test("a cached interpretation is served even with the agent quota exhausted (quota only on miss)", async () => {
    const { svc } = spyService()
    const { createInterpretationCache } = await import("@stylai/ai")
    let quota = 1, calls = 0
    const agent = { model: "claude-haiku-5-5", select: async () => { throw new Error("unused") }, interpret: async () => { calls++; return {
      intent: { audience: null, slots: [{ slot: "upper", required: true, query: "camisa branca", color: "branco" }], colors: [], terms: [], occasion: null, budgetTotalBrl: null, budgetMode: "prefer", avoid: [] },
      usage: { inputTokens: 1, outputTokens: 1 }, requestId: null, promptVersion: "v" } } }
    const app = await buildApp({ appOrigin: "http://localhost:5200", search: { db, resolveActor: async () => ACTOR, catalogMode: "aliexpress_affiliate", aliexpressCatalog: svc,
      agent: agent as never, interpretationCache: createInterpretationCache(), acquireAgentCall: async () => quota-- > 0 } })
    try {
      expect((await search(app, "camisa branca")).json().query.interpretedBy).toBe("agent")
      expect((await search(app, "camisa branca")).json().query).toMatchObject({ interpretedBy: "agent", cached: true })
      expect((await search(app, "calça preta")).json().query.interpretedBy).toBe("rules")
      expect(calls).toBe(1)
    } finally { await app.close() }
  })
})
