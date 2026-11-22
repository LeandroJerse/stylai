import { beforeEach, expect, setSystemTime, test } from "bun:test"
import { configureDemo, handle, resetDemo } from "./demo-api"
import { parseBalance, parseBodyPhotosState, parseJob, parseLook, parseLooks, parsePage, parseProduct, parseSearchResult, parseStudioConfig } from "../src/api/parse"
// Real MediaPipe measurements of authorized photos (see packages/contracts/tests): the demo applies the same rules.
import measured from "../../../packages/contracts/tests/fixtures/pose-eval-unsplash.json"

const pose = (name: string) => (measured as Record<string, unknown>)[name]

// Official contract (default demo): same routes and shapes as apps/api, parsed by the real client parsers.
const request = (method: string, path: string, body: Record<string, unknown> | null = null, key?: string) =>
  handle(method, path.split("?")[0]!, new URL(`http://localhost:5192/v1${path}`), body, key ? { "idempotency-key": key } : {})
const at = (s: number) => setSystemTime(new Date(Date.UTC(2026, 10, 17, 12, 0, s)))
beforeEach(() => { at(0); configureDemo({ contract: "tryon", catalog: "synthetic" }); resetDemo() })

function ready() {
  request("POST", "/privacy/consents", { version: "dev-v1", purpose: "body_photo_try_on" })
  request("PUT", "/me/body-photos/front", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/front", analysis: pose("front_a12") })
}
const firstProduct = () => parsePage(request("GET", "/catalog/products").body, parseProduct).items.find((p) => p.tryOnReady)!

test("unmapped store categories never create jobs or consume coins, even with a valid photo", () => {
  configureDemo({ contract: "tryon", catalog: "store" })
  ready()
  const items = parsePage(request("GET", "/catalog/products?limit=48").body, parseProduct).items
  const set = items.find(p => p.category?.id === "sets")!
  expect(set).toBeDefined()
  const before = parseBalance(request("GET", "/me/balance").body).tokens
  expect(request("POST", "/studio/generations", { productId: set.id }, "unmapped-category-01").status).toBe(422)
  expect(parsePage(request("GET", "/studio/jobs?active=true").body, parseJob).items).toHaveLength(0)
  expect(parseBalance(request("GET", "/me/balance").body).tokens).toBe(before)
  request("PUT", "/me/body-photos/front", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/knees", analysis: pose("front_t34") })
  expect(request("POST", "/studio/generations", { productId: set.id }, "unmapped-category-knees").status).toBe(422)
  expect(parseBalance(request("GET", "/me/balance").body).tokens).toBe(before)
})

test("store catalog uses real local photos and direct links throughout a simulated generation", () => {
  configureDemo({ contract: "tryon", catalog: "store" })
  const items = parsePage(request("GET", "/catalog/products?limit=48").body, parseProduct).items
  expect(items).toHaveLength(9)
  expect(items.every(p => p.images[0]?.url.includes("/store-garments/") && p.links.productUrl?.startsWith("https://br.shein.com/") && p.links.affiliateUrl === null)).toBe(true)
  expect(items.every(p => p.price === null && p.availability === "unknown" && p.tryOnReady)).toBe(true)
  ready()
  const job = parseJob(request("POST", "/studio/generations", { productId: items[0]!.id }, "store-demo-001").body)
  at(10)
  const done = parseJob(request("GET", `/studio/jobs/${job.id}`).body)
  expect(done.status).toBe("succeeded")
  const look = parseLook(request("GET", `/studio/looks/${done.lookId}`).body)
  expect(look.pieces[0]?.product.links.productUrl).toBe(items[0]!.links.productUrl)
  expect(look.image.url).toBe(items[0]!.images[0]!.url)
})

test("config advertises the single-piece try-on, like the real API", () => {
  const config = parseStudioConfig(request("GET", "/studio/config").body)
  expect(config.capabilities.mode).toBe("single_piece_try_on")
  expect(config.maxChosenPieces).toBe(1)
  expect(config.unit.plural).toBe("moedas")
  expect(config.costs).toEqual({ generate: 10, edit: null, tryOn: 10 })
  expect(config.plans.map((p) => [p.id, p.coinsPerPeriod])).toEqual([["free", 30], ["paid", 120]])
  expect(config.generationMode).toBe("simulated")
  expect(config.photoPolicyVersion).toBe("dev-v1")
})

test("photo needs consent first; products carry variant ids and the test flag", () => {
  expect(request("PUT", "/me/body-photos/front", {}).status).toBe(403)
  expect(parseBodyPhotosState(request("GET", "/me/body-photos").body).consent?.accepted).toBe(false)
  ready()
  const state = parseBodyPhotosState(request("GET", "/me/body-photos").body)
  expect(state.consent?.accepted).toBe(true)
  expect(state.items[0]?.status).toBe("ready")
  const p = firstProduct()
  expect(p.fixture).toBe(true)
  expect(p.variants.every((v) => v.id !== null)).toBe(true)
})

test("generation needs photo, key and a single piece; same key replays the same job", () => {
  const p = firstProduct()
  expect(request("POST", "/studio/generations", { productId: p.id }, "key-demo-0001").status).toBe(403)
  ready()
  expect(request("POST", "/studio/generations", { productId: p.id }).status).toBe(400)
  expect(request("POST", "/studio/generations", { productIds: [p.id, p.id] }, "key-demo-0002").status).toBe(422)
  const a = parseJob(request("POST", "/studio/generations", { productId: p.id }, "key-demo-0003").body)
  const b = parseJob(request("POST", "/studio/generations", { productId: p.id }, "key-demo-0003").body)
  expect(b.id).toBe(a.id)
  expect(request("POST", "/studio/generations", { productId: p.id }, "key-demo-0004").status).toBe(409)
  expect(parsePage(request("GET", "/studio/jobs?active=true").body, parseJob).items[0]?.id).toBe(a.id)
})

test("swap creates v2 linked to v1; v1 reopens unchanged; quota counts successes only", () => {
  ready()
  const [p1, p2] = parsePage(request("GET", "/catalog/products").body, parseProduct).items.filter((p) => p.tryOnReady)
  const before = parseBalance(request("GET", "/me/balance").body).tokens
  const j1 = parseJob(request("POST", "/studio/generations", { productId: p1!.id }, "key-demo-v1-01").body)
  at(10)
  const done1 = parseJob(request("GET", `/studio/jobs/${j1.id}`).body)
  expect(done1.status).toBe("succeeded")
  const v1 = parseLook(request("GET", `/studio/looks/${done1.lookId}`).body)
  configureDemo({ scenario: "failed" })
  const failed = parseJob(request("POST", "/studio/try-ons", { sourceLookId: v1.id, productIds: [p2!.id] }, "key-demo-fail-1").body)
  at(20)
  expect(parseJob(request("GET", `/studio/jobs/${failed.id}`).body).status).toBe("failed")
  const j2 = parseJob(request("POST", "/studio/try-ons", { sourceLookId: v1.id, productIds: [p2!.id] }, "key-demo-v2-01").body)
  at(30)
  const v2 = parseLook(request("GET", `/studio/looks/${parseJob(request("GET", `/studio/jobs/${j2.id}`).body).lookId}`).body)
  expect(v2.version).toBe(2)
  expect(v2.parentId).toBe(v1.id)
  expect(v2.lineageId).toBe(v1.lineageId)
  const versions = parseLooks(request("GET", `/studio/looks/${v1.id}/versions`).body)
  expect(versions.map((l) => l.version)).toEqual([1, 2])
  const reopened = parseLook(request("GET", `/studio/looks/${v1.id}`).body)
  expect(reopened.pieces[0]!.product.id).toBe(p1!.id)
  expect(reopened.image.url).toBe(v1.image.url)
  expect(before).toBe(120)
  expect(parseBalance(request("GET", "/me/balance").body).tokens).toBe(before - 20)
  expect(parseLooks(request("GET", "/studio/looks").body)).toHaveLength(1)
})

test("sign-up is pending until the confirmation link", () => {
  request("POST", "/auth/sign-out")
  expect(request("POST", "/auth/sign-up", { name: "Ana", email: "ana@example.com", password: "senha1234" }).status).toBe(202)
  expect(request("GET", "/me").status).toBe(401)
  expect(request("POST", "/auth/email/verify", { tokenHash: "demo-abcdefghijkl" }).status).toBe(200)
  expect(request("GET", "/me").status).toBe(200)
})

test("search comes before generation and only searches the catalog", () => {
  const found = parseSearchResult(request("POST", "/studio/searches", { prompt: "blazer" }).body)
  expect(found.source).toBe("curated_catalog")
  expect(found.items.length).toBeGreaterThan(0)
  expect(found.items.every((i) => /blazer/i.test(i.product.name) || i.product.category?.id === found.interpretation.category?.id)).toBe(true)
  expect(request("POST", "/studio/searches", { prompt: "   " }).status).toBe(422)
  expect(parseSearchResult(request("POST", "/studio/searches", { prompt: "blazer até R$ 1" }).body).items).toHaveLength(0)
})

test("the selected photo is shown from the local file and deleting it blocks generation", () => {
  request("POST", "/privacy/consents", { version: "dev-v1", purpose: "body_photo_try_on" })
  expect(request("PUT", "/me/body-photos/front", { sizeBytes: 100, mime: "image/gif", localUrl: "blob:x" }).status).toBe(422)
  expect(request("PUT", "/me/body-photos/front", { sizeBytes: 13 * 1024 * 1024, mime: "image/jpeg", localUrl: "blob:x" }).status).toBe(413)
  request("PUT", "/me/body-photos/front", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/minha-foto", analysis: pose("front_a13") })
  expect(parseBodyPhotosState(request("GET", "/me/body-photos").body).items[0]?.image.url).toBe("blob:http://localhost/minha-foto")
  expect(request("DELETE", "/me/body-photos/front").status).toBe(204)
  expect(parseBodyPhotosState(request("GET", "/me/body-photos").body).items).toHaveLength(0)
  expect(request("POST", "/studio/generations", { productId: firstProduct().id }, "key-demo-nophoto").status).toBe(409)
})

test("what the engine lacks answers like the API (not implemented), results are marked simulated", () => {
  for (const path of ["/closet", "/preferences", "/studio/match/deck", "/plans"]) expect(request("GET", path).status).toBe(503)
  ready()
  const j = parseJob(request("POST", "/studio/generations", { productId: firstProduct().id }, "key-demo-sim-1").body)
  at(10)
  const look = parseLook(request("GET", `/studio/looks/${parseJob(request("GET", `/studio/jobs/${j.id}`).body).lookId}`).body)
  expect(look.simulated).toBe(true)
})

test("coins: paid plan starts at 120, free plan at 30, and the balance never resets on reads", () => {
  expect(parseBalance(request("GET", "/me/balance").body).tokens).toBe(120)
  configureDemo({ plan: "free" })
  const free = parseBalance(request("GET", "/me/balance").body)
  expect([free.tokens, free.plan.id, free.plan.tokensPerPeriod]).toEqual([30, "free", 30])
  ready()
  const j = parseJob(request("POST", "/studio/generations", { productId: firstProduct().id }, "key-demo-coins-1").body)
  at(10)
  request("GET", `/studio/jobs/${j.id}`)
  for (let i = 0; i < 3; i++) expect(parseBalance(request("GET", "/me/balance").body).tokens).toBe(20)
})

test("three photo slots: each validated, replaced and deleted on its own; a failed candidate keeps the approved photo", () => {
  request("POST", "/privacy/consents", { version: "dev-v1", purpose: "body_photo_try_on" })
  request("PUT", "/me/body-photos/front", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/front", analysis: pose("front_a12") })
  request("PUT", "/me/body-photos/side", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/side", analysis: pose("tq_a08") })
  request("PUT", "/me/body-photos/profile", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/profile", analysis: pose("profile_t01") })
  let items = parseBodyPhotosState(request("GET", "/me/body-photos").body).items
  expect(items.filter((p) => p.inUse).map((p) => p.angle).sort()).toEqual(["front", "profile", "side"])
  // A close selfie as the new front: needs adjustment, the approved front stays in use.
  request("PUT", "/me/body-photos/front", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/selfie", analysis: pose("selfie_a03") })
  items = parseBodyPhotosState(request("GET", "/me/body-photos").body).items
  const front = items.filter((p) => p.angle === "front")
  expect(front.find((p) => p.inUse)?.image.url).toBe("blob:http://localhost/front")
  const candidate = front.find((p) => !p.inUse)!
  expect(candidate.validation?.status).toBe("needs_adjustment")
  expect(candidate.issues).toContain("Afaste a câmera para incluir as pernas.")
  // Two people / wrong angle get their specific messages.
  request("PUT", "/me/body-photos/side", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/two", analysis: pose("two_composite") })
  expect(parseBodyPhotosState(request("GET", "/me/body-photos").body).items.find((p) => p.angle === "side" && !p.inUse)?.issues).toContain("Use uma foto com apenas uma pessoa.")
  // Validator unavailable: technical error, not a rejection of the photo; retry is offered.
  request("PUT", "/me/body-photos/profile", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/p2", analysis: null })
  const profile = parseBodyPhotosState(request("GET", "/me/body-photos").body).items.find((p) => p.angle === "profile" && !p.inUse)!
  expect(profile.validation?.status).toBe("error")
  expect(request("POST", "/me/body-photos/profile/revalidate", { analysis: pose("profile_t01") }).status).toBe(200)
  expect(parseBodyPhotosState(request("GET", "/me/body-photos").body).items.find((p) => p.angle === "profile")?.image.url).toBe("blob:http://localhost/p2")
  // Deleting side and profile never blocks generation; deleting the front does.
  expect(request("DELETE", "/me/body-photos/side").status).toBe(204)
  expect(request("DELETE", "/me/body-photos/profile").status).toBe(204)
  expect(request("POST", "/studio/generations", { productId: firstProduct().id }, "key-demo-angles-1").status).toBe(202)
})

test("a front photo cut at the knees serves tops but not trousers", () => {
  request("POST", "/privacy/consents", { version: "dev-v1", purpose: "body_photo_try_on" })
  request("PUT", "/me/body-photos/front", { sizeBytes: 100, mime: "image/jpeg", localUrl: "blob:http://localhost/knees", analysis: pose("front_t34") })
  const items = parsePage(request("GET", "/catalog/products").body, parseProduct).items
  const pants = items.find((p) => p.category?.id === "pants" && p.tryOnReady)!
  const res = request("POST", "/studio/generations", { productId: pants.id }, "key-demo-knees-1")
  expect(res.status).toBe(409)
  expect(JSON.stringify(res.body)).toContain("photo_framing_insufficient")
})

test("test catalog: synthetic items with test prices, no links, no confirmed stock; edge cases flagged", () => {
  const items = parsePage(request("GET", "/catalog/products?limit=48").body, parseProduct).items
  expect(items.length).toBeGreaterThanOrEqual(20)
  expect(new Set(items.map((p) => p.category?.id))).toEqual(new Set(["tops", "shirts", "jackets", "pants", "bottoms", "dresses"]))
  expect(items.every((p) => p.fixture && p.links.productUrl === null && p.links.affiliateUrl === null && p.availability === "unknown")).toBe(true)
  expect(items.some((p) => p.price === null)).toBe(true)
  expect(items.some((p) => !p.tryOnReady)).toBe(true)
  const found = parseSearchResult(request("POST", "/studio/searches", { prompt: "calça preta até R$ 200" }).body)
  expect(found.items[0]?.product.name).toContain("Calça reta preta")
})

test("QA-013: same query on the same catalog gives the same filters as the API rules (colour is a hard filter)", async () => {
  const { searchCatalog: rules, TEST_CATALOG } = await import("../../../packages/contracts/src/index")
  configureDemo({ catalog: "synthetic" })
  for (const prompt of ["calça preta", "blusa rosa até R$ 60", "vestido verde", "jaqueta", "camisa azul até R$ 130"]) {
    const demo = parseSearchResult(request("POST", "/studio/searches", { prompt }).body)
    const api = rules(prompt, TEST_CATALOG.map((i) => ({
      id: i.externalProductId, name: i.name, category: { id: i.category, label: i.categoryLabel }, priceMinor: i.priceMinor,
      hasAvailableVariant: i.variants.some((v) => v.available === true), tryOnReady: i.rights.tryOnAllowed && i.variants.some((v) => v.available === true),
    })))
    expect([prompt, demo.items.map((x) => x.product.id)]).toEqual([prompt, api.items.map((x) => x.id)])
    expect(demo.interpretation.colors).toEqual(api.interpretation.colors)
  }
  const black = parseSearchResult(request("POST", "/studio/searches", { prompt: "calça preta" }).body)
  expect(black.items.length).toBeGreaterThan(0)
  expect(black.items.every((x) => /pret/i.test(x.product.name))).toBe(true)
  configureDemo({ catalog: "test" })
})

test("QA-013: the full prototype shows the approved amounts and no invented plan price", () => {
  configureDemo({ contract: "full" })
  const plans = request("GET", "/plans").body as { items: { name: string; tokensPerPeriod: number; price: unknown }[] }
  expect(plans.items.map((p) => [p.tokensPerPeriod, p.price])).toEqual([[30, null], [120, null]])
  const config = parseStudioConfig(request("GET", "/studio/config").body)
  expect([config.unit.plural, config.costs.generate, config.costs.edit]).toEqual(["moedas", 10, null])
  configureDemo({ contract: "tryon" })
})

test("default demo catalog = the shared main test catalog (same products as the official API), no edge cases, no store references", async () => {
  const { TEST_CATALOG_MAIN } = await import("../../../packages/contracts/src/index")
  configureDemo({ contract: "tryon", catalog: "test" })
  const items = parsePage(request("GET", "/catalog/products?limit=48").body, parseProduct).items
  expect(items.map((p) => p.id).sort()).toEqual(TEST_CATALOG_MAIN.map((i) => i.externalProductId).sort())
  expect(items.some((p) => /SHEIN|simula falha|sem preço|sem tamanho|só para exibição/i.test(p.name + p.partner.name))).toBe(false)
  expect((request("GET", "/catalog/source").body as { id: string }).id).toBe("test_catalog")
})
