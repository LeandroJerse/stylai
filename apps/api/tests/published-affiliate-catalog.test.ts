import { expect, test } from "bun:test"
import { PrivateDatabaseError, type PrivateDatabase } from "@stylai/supabase"
import { buildApp } from "../src/app"
import { createPieceResolver } from "../src/modules/closet/routes"
import { item } from "./outfit-fixtures"

const recent = { ...item(101, "shirts", "Camisa de linho"), offerExpiresAt: new Date(Date.now() + 60_000).toISOString() }
const related = { ...item(102, "shirts", "Camisa de algodão", 9500), offerExpiresAt: recent.offerExpiresAt }
const collections = [{ id: "linho", label: "Linho", count: 2 }]

function readers(call: (name: string, args: unknown[]) => unknown) {
  return buildApp({
    appOrigin: "http://localhost:5190",
    catalog: {
      catalogMode: "aliexpress_affiliate",
      db: { call: async (name: string, ...args: unknown[]) => call(name, args) } as unknown as PrivateDatabase<"api">,
    },
  })
}

test("first visit reads real published offers, filters and hero without a live client", async () => {
  const app = await readers((name, args) => {
    switch (name) {
      case "list_affiliate_offers":
        if ((args[0] as { limit?: number }).limit === 1) return { items: [recent], nextCursor: null, total: 2 }
        expect(args[0]).toMatchObject({ collection: "linho", keyword: "camisa", maxPriceMinor: 10000, sort: "price_asc" })
        return { items: [recent], nextCursor: "9000/aliexpress:101", total: 2 }
      case "read_affiliate_facets":
        return { total: 2, categories: [], partners: [], collections, priceRange: { min: 90, max: 95, currency: "BRL" } }
      default: throw new Error("unexpected catalog operation")
    }
  })
  try {
    const list = await app.inject("/v1/catalog/products?collection=linho&q=camisa&priceMax=100&sort=price_asc")
    expect(list.statusCode).toBe(200)
    expect(list.json()).toMatchObject({ source: "aliexpress_affiliate", nextCursor: "9000/aliexpress:101", total: 2, items: [{
      id: "aliexpress:101", price: { amount: 90, currency: "BRL" }, offerExpiresAt: recent.offerExpiresAt,
      links: { affiliateUrl: "https://s.click.aliexpress.com/e/101" }, tryOnReady: false,
    }] })
    expect((await app.inject("/v1/catalog/facets")).json()).toMatchObject({ collections, priceRange: { min: 90, max: 95, currency: "BRL" } })
    expect((await app.inject("/v1/explore/hero")).json()).toMatchObject({ hero: { product: { id: "aliexpress:101" }, image: { url: recent.image } } })
  } finally { await app.close() }
})

test("detail and related suggestions read published metadata and exclude the current product", async () => {
  const app = await readers((name, args) => {
    if (name === "read_affiliate_offer") return args[0] === recent.canonicalKey ? recent : null
    expect(name).toBe("list_affiliate_offers")
    expect(args[0]).toMatchObject({ category: "shirts", exclude: "aliexpress:101", nearPriceMinor: 9000, sort: "price_near", limit: 6 })
    return { items: [related], total: 1, nextCursor: null }
  })
  try {
    expect((await app.inject("/v1/catalog/products/aliexpress:101")).json()).toMatchObject({ id: recent.canonicalKey, tryOnReady: false })
    expect((await app.inject("/v1/catalog/products/aliexpress:101/related?limit=6")).json()).toMatchObject({
      total: 1, items: [{ id: related.canonicalKey, links: { affiliateUrl: "https://s.click.aliexpress.com/e/102" } }],
    })
    expect((await app.inject("/v1/catalog/products/aliexpress:909")).statusCode).toBe(404)
    expect((await app.inject("/v1/catalog/products/aliexpress:909/related")).statusCode).toBe(404)
  } finally { await app.close() }
})

test("invalid cursor is a client error and read failure is reported as unavailable", async () => {
  const app = await readers((name) => {
    if (name === "list_affiliate_offers") throw new PrivateDatabaseError("rejected", "22023")
    throw new PrivateDatabaseError("not_dispatched")
  })
  try {
    expect((await app.inject("/v1/catalog/products?cursor=broken")).statusCode).toBe(400)
    expect((await app.inject("/v1/catalog/facets")).statusCode).toBe(503)
  } finally { await app.close() }
})

test("a published piece can be saved from the home without starting a store search", async () => {
  const db = { call: async (name: string) => name === "read_affiliate_offer" ? recent : [] } as unknown as PrivateDatabase<"api">
  const resolve = createPieceResolver({ db, keys: {} as never, publicBaseUrl: "http://localhost:5190/v1", publishedAffiliate: true })
  expect(await resolve("20000000-0000-4000-8000-000000000001", recent.canonicalKey)).toMatchObject({
    id: recent.canonicalKey, offerExpiresAt: recent.offerExpiresAt, links: { affiliateUrl: recent.affiliateUrl },
  })
})

test("favorite filtering takes an authenticated actor from the server", async () => {
  const actor = "20000000-0000-4000-8000-000000000001"
  const app = await buildApp({
    appOrigin: "http://localhost:5190",
    catalog: {
      db: { call: async (_name: string, query: { favoriteActor?: string }) => {
        expect(query.favoriteActor).toBe(actor)
        return { items: [recent], nextCursor: null, total: 1 }
      } } as unknown as PrivateDatabase<"api">,
      catalogMode: "aliexpress_affiliate",
      resolveActor: async (request) => request.headers["x-test-session"] ? actor : null,
    },
  })
  try {
    const url = "/v1/catalog/products?favorites=true&favoriteActor=untrusted"
    expect((await app.inject(url)).statusCode).toBe(401)
    const response = await app.inject({ url, headers: { "x-test-session": "signed-in" } })
    expect(response.statusCode).toBe(200)
    expect(response.json().items).toMatchObject([{ id: recent.canonicalKey, favorite: true }])
  } finally { await app.close() }
})
