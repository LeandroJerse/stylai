import { describe, expect, test } from "bun:test"
import {
  createTikTokCatalogCache, createTikTokCreatorClient, normalizeTikTokProduct, parseBrlMinor,
  type TikTokOpenProductRaw,
} from "../src/index"

const baseRaw: TikTokOpenProductRaw = {
  id: "17295929697122070089999",
  title: "Camisa Linho Off-White",
  shopName: "Ateliê BR",
  mainImageUrl: "https://p16-oec-va.ibyteimg.com/camisa.jpg",
  detailLink: "https://shop.tiktok.com/view/product/17295929697122070089999",
  saleRegion: "BR",
  hasInventory: true,
  salesPrice: { currency: "BRL", amount: "149.90" },
  salesPriceMin: null,
  salesPriceMax: null,
  originalPrice: null,
  categoryId: "601226",
  categoryName: "Camisas",
  unitsSold: 120,
}

describe("TikTok Shop normalization, capability separation, cache TTL & deduplication", () => {
  test("parses exact BRL decimals, separates display/link from AI try-on, never invents variants or price from range", () => {
    expect(parseBrlMinor("149.90")).toBe(14990)
    expect(parseBrlMinor("89")).toBe(8900)
    expect(parseBrlMinor("-10")).toBeNull()

    const ok = normalizeTikTokProduct(baseRaw, "2026-11-22T00:00:00.000Z")
    expect(ok.accepted).toBe(true)
    if (ok.accepted) {
      expect(ok.item.externalProductId).toBe("17295929697122070089999")
      expect(ok.item.priceMinor).toBe(14990)
      expect(ok.item.variants).toEqual([])
      expect(ok.item.rights.basis).toBe("unconfirmed")
      expect(ok.item.rights.tryOnAllowed).toBe(false)
      expect(ok.item.capabilities).toEqual({
        displayAndLink: true,
        aiTryOn: false,
        aiTryOnBlockedReason: "ai_image_rights_unconfirmed",
      })
    }

    // Price range must NOT fabricate a single priceMinor
    const rangeNorm = normalizeTikTokProduct({
      ...baseRaw,
      salesPrice: null,
      salesPriceMin: { currency: "BRL", amount: "99.90" },
      salesPriceMax: { currency: "BRL", amount: "159.90" },
    }, "2026-11-22T00:00:00.000Z")
    expect(rangeNorm.accepted).toBe(true)
    if (rangeNorm.accepted) {
      expect(rangeNorm.item.priceMinor).toBeNull()
      expect(rangeNorm.item.priceRangeMinor).toEqual({ min: 9990, max: 15990 })
    }

    // Non-BR or non-BRL rejected cleanly (no silent currency conversion)
    expect(normalizeTikTokProduct({ ...baseRaw, saleRegion: "US" }, "2026-11-22T00:00:00.000Z")).toEqual({
      accepted: false, externalProductId: baseRaw.id, reason: "unsupported_region",
    })
    expect(normalizeTikTokProduct({ ...baseRaw, salesPrice: { currency: "USD", amount: "29.90" } }, "2026-11-22T00:00:00.000Z")).toEqual({
      accepted: false, externalProductId: baseRaw.id, reason: "unsupported_currency",
    })
  })

  test("enforces 5-min TTL cache, expiration, forceRefresh, cursor-query binding, deduplication, and revocation purge", async () => {
    let nowMs = 1_732_233_600_000
    let fetchCount = 0
    const client = createTikTokCreatorClient({
      appKey: "k", appSecret: "s", baseUrl: "https://open-api.tiktok.test", now: () => nowMs, sleep: async () => {},
      fetch: async () => {
        fetchCount++
        return Response.json({
          code: 0, request_id: `req-${fetchCount}`,
          data: {
            total_count: 2,
            next_page_token: "tok_page_2",
            products: [
              { id: "1001", title: "Camisa A", sale_region: "BR", main_image_url: "https://img.test/a.jpg", detail_link: "https://shop.tiktok.com/p/1001", sales_price: { currency: "BRL", amount: "100.00" } },
              // Duplicate ID inside same page must deduplicate cleanly
              { id: "1001", title: "Camisa A", sale_region: "BR", main_image_url: "https://img.test/a.jpg", detail_link: "https://shop.tiktok.com/p/1001", sales_price: { currency: "BRL", amount: "100.00" } },
              // Non-BR item filtered out without poisoning accepted items
              { id: "2002", title: "US Shirt", sale_region: "US", main_image_url: "https://img.test/u.jpg", sales_price: { currency: "USD", amount: "20.00" } },
            ],
          },
        })
      },
    })

    const cache = createTikTokCatalogCache({ client, getAccessToken: async () => "creator_tok", ttlMs: 300_000, now: () => nowMs })
    const r1 = await cache.search({ keywords: ["camisa"] })
    expect(r1.state).toBe("ready")
    expect(r1.fromCache).toBe(false)
    expect(r1.items).toHaveLength(1)
    expect(r1.rejectedCount).toBe(1)
    expect(fetchCount).toBe(1)

    // Within 5 min TTL: served from cache
    nowMs += 60_000
    const r2 = await cache.search({ keywords: ["camisa"] })
    expect(r2.fromCache).toBe(true)
    expect(fetchCount).toBe(1)

    // Reusing cursor from "camisa" with a different query ("vestido") is rejected!
    const badCursor = await cache.search({ keywords: ["vestido"], pageToken: "tok_page_2" })
    expect(badCursor.state).toBe("degraded")
    expect(badCursor.errorKind).toBe("cursor_query_mismatch")

    // After TTL expires: re-fetches fresh data and expires stale cached entries
    nowMs += 300_001
    expect(await cache.listFreshCached()).toHaveLength(0)
    const r3 = await cache.search({ keywords: ["camisa"] })
    expect(r3.fromCache).toBe(false)
    expect(fetchCount).toBe(2)

    // Purge on revocation clears all cached items immediately
    expect(await cache.listFreshCached()).toHaveLength(1)
    cache.purgeOnRevocation()
    expect(await cache.listFreshCached()).toHaveLength(0)
  })
})

 test("revocation blocks cached and in-flight responses", async () => {
   let token: string | null = "creator-token"
   let release: (() => void) | undefined
   let pause = false
   const client = createTikTokCreatorClient({ appKey: "k", appSecret: "s", baseUrl: "https://open-api.tiktok.test", sleep: async () => {}, fetch: async () => {
     if (pause) await new Promise<void>((resolve) => { release = resolve })
     return Response.json({ code: 0, data: { products: [{ id: "1001", title: "Camisa", sale_region: "BR", main_image_url: "https://img.test/a.jpg", sales_price: { currency: "BRL", amount: "10.00" } }] } })
   } })
   const cache = createTikTokCatalogCache({ client, getAccessToken: async () => token })
   expect((await cache.search({ keywords: ["camisa"] })).items).toHaveLength(1)
   token = null
   expect((await cache.search({ keywords: ["camisa"] })).state).toBe("authorization_required")
   expect(await cache.listFreshCached()).toHaveLength(0)
   token = "creator-token"
   pause = true
   const pending = cache.search({ keywords: ["outra"] })
   for (let i = 0; i < 20 && !release; i++) await new Promise((resolve) => setTimeout(resolve, 1))
   expect(release).toBeDefined()
   cache.purgeOnRevocation()
   release!()
   expect((await pending).items).toHaveLength(0)
   expect(await cache.listFreshCached()).toHaveLength(0)
 })

