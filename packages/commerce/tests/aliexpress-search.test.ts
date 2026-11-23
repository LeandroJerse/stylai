import { describe, expect, test } from "bun:test"
import { createAliExpressAffiliateClient, createAliExpressCatalogService, type AliExpressFetch } from "../src/index"

const SECRET = "synthetic-app-secret-value"
const product = (id: string, extra: Record<string, unknown> = {}) => ({
  product_id: id, product_title: `Vestido ${id}`, product_main_image_url: `https://ae01.alicdn.com/kf/${id}.jpg`,
  target_sale_price: "89.90", target_sale_price_currency: "BRL",
  product_detail_url: `https://pt.aliexpress.com/item/${id}.html`, promotion_link: `https://s.click.aliexpress.com/e/_query_${id}`,
  shop_name: "Loja X", shop_id: 42, ...extra,
})
const queryBody = (products: unknown[]) => ({ aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: { products: { product: products } } }, request_id: "q-1" } })
const linkBody = (links: { source_value: string; promotion_link: string }[], tracking = "stylai") =>
  ({ aliexpress_affiliate_link_generate_response: { resp_result: { resp_code: 200, result: { tracking_id: tracking, promotion_links: { promotion_link: links } } } } })

type Reply = { status?: number; body: unknown } | "throw"
function harness(replies: Record<string, Reply[]>, trackingId: string | null = "stylai", now = () => 1_000_000) {
  const calls: { method: string; form: URLSearchParams }[] = []
  const fetch: AliExpressFetch = async (_url, init) => {
    const form = new URLSearchParams(init.body)
    const method = form.get("method")!
    calls.push({ method, form })
    const reply = replies[method]?.shift()
    if (!reply || reply === "throw") throw new Error(`network ${SECRET}`)
    return { ok: (reply.status ?? 200) < 400, status: reply.status ?? 200, text: async () => JSON.stringify(reply.body) }
  }
  const client = createAliExpressAffiliateClient({ appKey: "500000", appSecret: SECRET, trackingId, fetch })
  const service = createAliExpressCatalogService({ client, trackingId, now, ttlMs: 60_000 })
  return { service, calls }
}
const QUERY = "aliexpress.affiliate.product.query"
const LINK = "aliexpress.affiliate.link.generate"

describe("AliExpress catalog service", () => {
  test("binds each generated link to its own product and sends the tracking ID in link.generate", async () => {
    const { service, calls } = harness({
      [QUERY]: [{ body: queryBody([product("111"), product("222")]) }],
      // Out of order, one unknown source and one non-AliExpress link: only exact matches survive.
      [LINK]: [{ body: linkBody([
        { source_value: "https://pt.aliexpress.com/item/222.html", promotion_link: "https://s.click.aliexpress.com/e/_two" },
        { source_value: "https://pt.aliexpress.com/item/999.html", promotion_link: "https://s.click.aliexpress.com/e/_other" },
        { source_value: "https://pt.aliexpress.com/item/111.html", promotion_link: "https://evil.test/e/_one" },
      ]) }],
    })
    const result = await service.search({ keywords: "vestido", pageSize: 5 })
    expect(result).toMatchObject({ state: "ready", links: "generated", trackingIdEcho: "stylai", fromCache: false })
    expect(result.items.map((i) => [i.externalProductId, i.productUrl, i.affiliateUrl])).toEqual([
      ["111", "https://pt.aliexpress.com/item/111.html", null],
      ["222", "https://pt.aliexpress.com/item/222.html", "https://s.click.aliexpress.com/e/_two"],
    ])
    expect(calls.map((c) => c.method)).toEqual([QUERY, LINK])
    expect(Object.fromEntries(calls[1]!.form)).toMatchObject({ tracking_id: "stylai", source_values: "https://pt.aliexpress.com/item/111.html,https://pt.aliexpress.com/item/222.html" })
    expect(calls[0]!.form.get("page_size")).toBe("5")
    expect(result.items.every((i) => i.capabilities.aiTryOn === false)).toBe(true)
  })

  test("without a tracking ID it never calls link.generate and never keeps the query's promotion link", async () => {
    const { service, calls } = harness({ [QUERY]: [{ body: queryBody([product("111")]) }] }, null)
    const result = await service.search({ keywords: "vestido" })
    expect(result).toMatchObject({ state: "ready", links: "missing_tracking_id" })
    expect(result.items[0]).toMatchObject({ affiliateUrl: null, productUrl: "https://pt.aliexpress.com/item/111.html" })
    expect(calls.map((c) => c.method)).toEqual([QUERY])
  })

  test("a link.generate failure keeps the products with plain links only", async () => {
    const { service } = harness({ [QUERY]: [{ body: queryBody([product("111")]) }], [LINK]: [{ body: { error_response: { code: "InvalidTrackingId" } } }] })
    const result = await service.search({ keywords: "vestido" })
    expect(result).toMatchObject({ state: "ready", links: "failed", linkErrorCode: "InvalidTrackingId" })
    expect(result.items[0]!.affiliateUrl).toBeNull()
    expect(JSON.stringify(result)).not.toContain(SECRET)
  })

  test("repeats of the same search are served from cache until the TTL expires", async () => {
    let clock = 1_000_000
    const { service, calls } = harness({
      [QUERY]: [{ body: queryBody([product("111")]) }, { body: queryBody([product("111")]) }],
      [LINK]: [{ body: linkBody([{ source_value: "https://pt.aliexpress.com/item/111.html", promotion_link: "https://s.click.aliexpress.com/e/_a" }]) }, { body: linkBody([]) }],
    }, "stylai", () => clock)
    await service.search({ keywords: "Vestido " })
    const again = await service.search({ keywords: " vestido" })
    expect(again.fromCache).toBe(true)
    expect(calls).toHaveLength(2)
    expect((await service.findFresh("aliexpress:111"))?.affiliateUrl).toBe("https://s.click.aliexpress.com/e/_a")
    clock += 61_000
    expect(await service.findFresh("aliexpress:111")).toBeNull()
    expect(await service.listFreshCached("anyone")).toEqual([])
    await service.search({ keywords: "vestido" })
    expect(calls).toHaveLength(4)
  })

  test("query failures degrade without items, cache or secrets; empty results stay distinct", async () => {
    const failing = harness({ [QUERY]: ["throw"] })
    const failed = await failing.service.search({ keywords: "vestido" })
    expect(failed).toMatchObject({ state: "degraded", items: [], errorKind: "network", links: null })
    expect(JSON.stringify(failed)).not.toContain(SECRET)
    expect(failing.calls).toHaveLength(1)
    const empty = harness({ [QUERY]: [{ body: queryBody([]) }] })
    const none = await empty.service.search({ keywords: "vestido" })
    expect(none).toMatchObject({ state: "ready", items: [], links: null })
    expect(empty.calls).toHaveLength(1)
  })

  test("plain product links and link.generate sources are canonical (provider query parameters stripped)", async () => {
    const { service, calls } = harness({
      [QUERY]: [{ body: queryBody([product("333", { product_detail_url: "https://pt.aliexpress.com/item/333.html?pdp_npi=6%40dis%21BRL#reviews" })]) }],
      [LINK]: [{ body: linkBody([{ source_value: "https://pt.aliexpress.com/item/333.html", promotion_link: "https://s.click.aliexpress.com/e/_c" }]) }],
    })
    const result = await service.search({ keywords: "vestido" })
    expect(result.items[0]).toMatchObject({ productUrl: "https://pt.aliexpress.com/item/333.html", affiliateUrl: "https://s.click.aliexpress.com/e/_c" })
    expect(calls[1]!.form.get("source_values")).toBe("https://pt.aliexpress.com/item/333.html")
  })

  test("a tracking ID echo different from the configured one voids every affiliate link", async () => {
    const { service } = harness({
      [QUERY]: [{ body: queryBody([product("111")]) }],
      [LINK]: [{ body: linkBody([{ source_value: "https://pt.aliexpress.com/item/111.html", promotion_link: "https://s.click.aliexpress.com/e/_x" }], "someone_else") }],
    })
    const result = await service.search({ keywords: "vestido" })
    expect(result).toMatchObject({ links: "failed", linkErrorCode: "tracking_id_mismatch", trackingIdEcho: "someone_else" })
    expect(result.items[0]!.affiliateUrl).toBeNull()
  })

  test("link generation that matches no product is reported as unmatched, not generated", async () => {
    const { service } = harness({
      [QUERY]: [{ body: queryBody([product("111")]) }],
      [LINK]: [{ body: linkBody([{ source_value: "https://pt.aliexpress.com/item/999.html", promotion_link: "https://s.click.aliexpress.com/e/_x" }]) }],
    })
    expect(await service.search({ keywords: "vestido" })).toMatchObject({ links: "unmatched" })
  })

  test("not configured without a client", async () => {
    const service = createAliExpressCatalogService({ client: null, trackingId: null })
    expect(await service.search({ keywords: "vestido" })).toMatchObject({ state: "not_configured", items: [] })
  })
})

describe("AliExpress service hardening", () => {
  test("failures are cached briefly (no hammering during an outage), then retried after the window", async () => {
    let clock = 1_000_000
    const { service, calls } = harness({ [QUERY]: ["throw", { body: queryBody([product("111")]) }], [LINK]: [{ body: linkBody([]) }] }, "stylai", () => clock)
    expect((await service.search({ keywords: "vestido" })).state).toBe("degraded")
    expect((await service.search({ keywords: "vestido" })).state).toBe("degraded")
    expect(calls).toHaveLength(1)
    clock += 31_000
    expect((await service.search({ keywords: "vestido" })).state).toBe("ready")
    expect(calls).toHaveLength(3)
  })

  test("cached items are listed only to the person who searched them; index is bounded", async () => {
    const { service } = harness({ [QUERY]: [{ body: queryBody([product("111")]) }, { body: queryBody([product("222")]) }], [LINK]: [{ body: linkBody([]) }, { body: linkBody([]) }] })
    await service.search({ keywords: "vestido", viewer: "user-a" })
    await service.search({ keywords: "blusa", viewer: "user-b" })
    expect((await service.listFreshCached("user-a")).map((i) => i.externalProductId)).toEqual(["111"])
    expect((await service.listFreshCached("user-b")).map((i) => i.externalProductId)).toEqual(["222"])
    expect(await service.listFreshCached(null)).toEqual([])
  })

  test("a global call budget refusal blocks the provider call", async () => {
    const calls: string[] = []
    const fetch: AliExpressFetch = async (_url, init) => { calls.push(String(new URLSearchParams(init.body).get("method"))); return { ok: true, status: 200, text: async () => "{}" } }
    const client = createAliExpressAffiliateClient({ appKey: "500000", appSecret: SECRET, trackingId: "stylai", fetch, acquire: async () => false })
    expect(await client.queryProducts({ keywords: "vestido" })).toMatchObject({ ok: false, kind: "rate_limited" })
    expect(calls).toHaveLength(0)
  })
})

describe("AliExpress provider backoff (P06)", () => {
  test("after a business error, other keywords are not sent for a short bounded window; the reason is kept", async () => {
    let clock = 1_000_000
    const { service, calls } = harness({
      [QUERY]: [{ body: { resp_result: { resp_code: 405, resp_msg: "The result is empty" }, request_id: "r1" } }, { body: queryBody([product("111")]) }],
      [LINK]: [{ body: linkBody([]) }],
    }, "stylai", () => clock)
    const first = await service.search({ keywords: "calça chino" })
    expect(first).toMatchObject({ state: "degraded", errorKind: "business_error", errorCode: "405", errorMessage: "The result is empty", requestId: "r1" })
    const other = await service.search({ keywords: "camisa preta" })
    expect(other).toMatchObject({ state: "degraded", errorCode: "405", backoffUntil: expect.any(String) })
    expect(calls).toHaveLength(1)
    clock += 16_000
    expect((await service.search({ keywords: "camisa preta" })).state).toBe("ready")
    expect(calls.filter((c) => c.method === QUERY)).toHaveLength(2)
  })
})
