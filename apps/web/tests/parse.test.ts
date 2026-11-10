import { describe, expect, test } from "bun:test"
import { ApiError } from "../src/api/errors"
import { parseCloset, parseFacets, parseHero, parseJob, parseLook, parsePage, parseProduct, parseRules, parseSession, parseStudioConfig, safeExternalUrl, safeUrl } from "../src/api/parse"

const product = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  name: "Blazer de lã",
  partner: { id: "loja-a", name: "Loja A" },
  price: { amount: 389.9, currency: "BRL" },
  images: [{ url: "https://cdn.x/p1.jpg", width: 900, height: 1200 }],
  links: { affiliateUrl: "https://aff.x/p1", productUrl: "https://loja-a.x/p1" },
  ...over,
})

describe("url safety", () => {
  test("accepts only absolute http(s) without credentials", () => {
    expect(safeUrl("https://cdn.x/a.jpg")).toBe("https://cdn.x/a.jpg")
    expect(safeUrl("javascript:alert(1)")).toBeNull()
    expect(safeUrl("data:image/png;base64,AAA")).toBeNull()
    expect(safeUrl("/relative.jpg")).toBeNull()
    expect(safeUrl("https://user:pw@cdn.x/a.jpg")).toBeNull()
    expect(safeUrl(42)).toBeNull()
  })
  test("links that leave the app must be https", () => {
    expect(safeExternalUrl("http://loja.x/p")).toBeNull()
    expect(safeExternalUrl("https://loja.x/p")).toBe("https://loja.x/p")
  })
})

describe("parseProduct", () => {
  test("keeps valid data", () => {
    const p = parseProduct(product({ rating: 4.6, reviewsCount: 120, availability: "available", fit: "amplo" }))
    expect(p.price).toEqual({ amount: 389.9, currency: "BRL" })
    expect(p.images).toHaveLength(1)
    expect(p.links.affiliateUrl).toBe("https://aff.x/p1")
    expect(p.rating).toBe(4.6)
    expect(p.fit).toBe("amplo")
    expect(p.favorite).toBe(false)
  })
  test("drops unsafe links and images, never invents a rating", () => {
    const p = parseProduct(product({ images: [{ url: "javascript:x" }, { url: "https://ok.x/i.jpg" }], links: { affiliateUrl: "javascript:x", productUrl: "http://plain.x" }, rating: 7, availability: "weird", fit: "slim" }))
    expect(p.images.map((i) => i.url)).toEqual(["https://ok.x/i.jpg"])
    expect(p.links).toEqual({ affiliateUrl: null, productUrl: null })
    expect(p.rating).toBeNull()
    expect(p.availability).toBe("unknown")
    expect(p.fit).toBeNull()
  })
  test("negative or missing price becomes null (shown as 'Preço não informado')", () => {
    expect(parseProduct(product({ price: { amount: -1 } })).price).toBeNull()
    expect(parseProduct(product({ price: undefined })).price).toBeNull()
  })
  test("missing required fields throw bad_response", () => {
    expect(() => parseProduct({ name: "x", partner: { id: "a" } })).toThrow(ApiError)
    expect(() => parseProduct(product({ partner: null }))).toThrow(ApiError)
  })
})

describe("collections", () => {
  test("page keeps cursor and total", () => {
    const page = parsePage({ items: [product()], nextCursor: "c2", total: 40 }, parseProduct)
    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe("c2")
    expect(page.total).toBe(40)
  })
  test("facets ignore an inverted price range", () => {
    const f = parseFacets({ categories: [{ id: "blazer", label: "Blazers", count: 3 }, { label: "sem id" }], partners: [], priceRange: { min: 500, max: 100 } })
    expect(f.categories).toEqual([{ id: "blazer", label: "Blazers", count: 3 }])
    expect(f.priceRange).toBeNull()
  })
  test("hero: null when the server has none, falls back to the product photo", () => {
    expect(parseHero({ hero: null })).toBeNull()
    expect(parseHero({ hero: { product: product() } })?.image.url).toBe("https://cdn.x/p1.jpg")
  })
  test("closet parses pieces and looks", () => {
    const c = parseCloset({ pieces: [{ product: product(), via: "look" }], looks: [{ id: "l1", image: { url: "https://cdn.x/l1.jpg" }, pieces: [{ product: product(), role: "chosen" }] }] })
    expect(c.pieces[0]?.via).toBe("look")
    expect(c.looks[0]?.pieces[0]?.role).toBe("chosen")
  })
})

describe("studio", () => {
  test("look requires an image", () => {
    expect(() => parseLook({ id: "l1" })).toThrow(ApiError)
  })
  test("job clamps progress and normalises unknown status", () => {
    const j = parseJob({ id: "j1", kind: "edit", status: "running", progress: 1.7, cost: 4 })
    expect(j.progress).toBe(1)
    expect(j.kind).toBe("edit")
    expect(parseJob({ id: "j2", status: "???" }).status).toBe("queued")
    const failed = parseJob({ id: "j3", status: "failed", error: { code: "model_error" } })
    expect(failed.error?.code).toBe("model_error")
    expect(failed.error?.message.length).toBeGreaterThan(0)
  })
  test("studio config requires costs and budget", () => {
    expect(() => parseStudioConfig({ costs: { generate: 6 }, budget: { min: 0, max: 1 } })).toThrow(ApiError)
    const c = parseStudioConfig({ costs: { generate: 6, edit: 2, tryOn: 4 }, budget: { min: 100, max: 3000 }, acceptedImageTypes: ["image/jpeg"], sizes: { top: ["P", "M"] } })
    expect(c.costs.tryOn).toBe(4)
    expect(c.budget.step).toBe(1)
    expect(c.sizes.top).toEqual(["P", "M"])
    expect(c.sizes.shoes).toEqual([])
  })
  test("rules fill missing parts with switched-off defaults", () => {
    const r = parseRules({ minRating: { value: 4.5, mode: "require" } })
    expect(r.minRating).toEqual({ value: 4.5, mode: "require" })
    expect(r.budget.mode).toBe("off")
    expect(r.advanced.fit.mode).toBe("off")
  })
})

describe("session", () => {
  test("needs a token and a user with id and e-mail", () => {
    const s = parseSession({ accessToken: "t", user: { id: "u1", email: "a@b.co", providers: ["google", "facebook"] } })
    expect(s.user.providers).toEqual(["google"])
    expect(() => parseSession({ user: { id: "u1", email: "a@b.co" } })).toThrow(ApiError)
  })
})
