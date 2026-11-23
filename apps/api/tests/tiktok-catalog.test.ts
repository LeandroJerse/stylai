import { describe, expect, test } from "bun:test"
import { createOAuthStateStore, createTikTokCatalogCache, createTikTokCreatorClient } from "@stylai/commerce"
import type { PrivateDatabase } from "@stylai/supabase"
import { buildApp } from "../src/app"
import { cookieHash } from "../src/modules/auth/session-crypto"

describe("TikTok Shop API integration & explicit source separation (zero paid calls)", () => {
  test("status endpoint reports sanitized readiness and OAuth callback validates single-use state", async () => {
    const stateStore = createOAuthStateStore()
    const issued = stateStore.issue("op-1", `${cookieHash("browser-binding")}:0:session-one`)
    const receivedCodes: string[] = []
    const app = await buildApp({
      appOrigin: "http://localhost:5200",
      tiktok: {
        appKey: "6lvudbnilidmd",
        appSecret: "super_secret_never_exposed",
        hasCreatorToken: false,
        stateStore,
        isSessionActive: async () => true,
        onAuthorizedCode: async ({ code }) => { receivedCodes.push(code); return { ok: true } },
      },
    })
    try {
      const statusRes = await app.inject({ method: "GET", url: "/v1/integrations/tiktok/status" })
      expect(statusRes.statusCode).toBe(200)
      const st = statusRes.json()
      expect(st.provider).toBe("tiktok_shop")
      expect(st.configured).toBe(false)
      expect(st.capabilities).toEqual({ displayAndLink: false, aiTryOn: false, aiTryOnBlockedReason: "ai_image_rights_unconfirmed" })
      expect(JSON.stringify(st)).not.toContain("super_secret_never_exposed")

      // Missing/invalid state rejected
      expect((await app.inject({ method: "GET", url: "/api/integrations/tiktok/callback?code=abc&state=bad" })).statusCode).toBe(400)
      // Valid single-use state succeeds once, replay is rejected
      const cb1 = await app.inject({ method: "GET", url: `/api/integrations/tiktok/callback?code=auth_code_1&state=${issued.state}`, headers: { cookie: "stylai_tiktok_oauth=browser-binding" } })
      expect(cb1.statusCode).toBe(200)
      expect(receivedCodes).toEqual(["auth_code_1"])
      const cb2 = await app.inject({ method: "GET", url: `/api/integrations/tiktok/callback?code=auth_code_1&state=${issued.state}` })
      expect(cb2.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })

  test("tiktok_shop mode exposes normalized BR items with links while blocking AI try-on, and NEVER falls back silently when unconfigured", async () => {
    // 1. Unconfigured tiktok_shop mode returns 503 (never falls back to curated or synthetic items)
    const unconfApp = await buildApp({
      appOrigin: "http://localhost:5200",
      catalog: { db: {} as PrivateDatabase<"api">, catalogMode: "tiktok_shop", tiktokCache: null },
      search: { db: {} as PrivateDatabase<"api">, resolveActor: async () => "20000000-0000-4000-8000-000000000001", catalogMode: "tiktok_shop", tiktokCache: null },
    })
    try {
      expect((await unconfApp.inject({ method: "GET", url: "/v1/catalog/source" })).json().id).toBe("tiktok_shop")
      expect((await unconfApp.inject({ method: "GET", url: "/v1/catalog/products" })).statusCode).toBe(503)
      expect((await unconfApp.inject({ method: "POST", url: "/v1/studio/searches", payload: { prompt: "camisa" } })).statusCode).toBe(503)
    } finally {
      await unconfApp.close()
    }

    // 2. Configured tiktok_shop mode returns real normalized items with display/link=true and aiTryOn=false
    const client = createTikTokCreatorClient({
      appKey: "6lvudbnilidmd", appSecret: "s", baseUrl: "https://open-api.tiktok.test",
      fetch: async () => Response.json({
        code: 0, request_id: "tt-live-sim-1",
        data: {
          total_count: 1,
          products: [{
            id: "17295929697122070089999",
            title: "Camisa Off-White Manga Longa",
            shop: { name: "Loja BR" },
            main_image_url: "https://p16-oec-va.ibyteimg.com/camisa.jpg",
            detail_link: "https://shop.tiktok.com/view/product/17295929697122070089999",
            sale_region: "BR",
            has_inventory: true,
            sales_price: { currency: "BRL", amount: "139.90" },
          }],
        },
      }),
    })
    const cache = createTikTokCatalogCache({ client, getAccessToken: async () => "creator_token_br" })
    const liveApp = await buildApp({
      appOrigin: "http://localhost:5200",
      catalog: { db: {} as PrivateDatabase<"api">, catalogMode: "tiktok_shop", tiktokCache: cache },
      search: { db: {} as PrivateDatabase<"api">, resolveActor: async () => "20000000-0000-4000-8000-000000000001", catalogMode: "tiktok_shop", tiktokCache: cache },
    })
    try {
      const sRes = await liveApp.inject({ method: "POST", url: "/v1/studio/searches", payload: { prompt: "camisa" } })
      expect(sRes.statusCode).toBe(200)
      const body = sRes.json()
      expect(body.source).toBe("tiktok_shop")
      expect(body.items).toHaveLength(1)
      const item = body.items[0]
      expect(item.product.links.productUrl).toBe("https://shop.tiktok.com/view/product/17295929697122070089999")
      expect(item.product.capabilities).toEqual({ displayAndLink: true, aiTryOn: false, aiTryOnBlockedReason: "ai_image_rights_unconfirmed" })
      expect(item.product.tryOnReady).toBe(false)
      expect(item.failed).toContain("Sem imagem liberada para prova")

      // Cached item is now readable from GET /v1/catalog/products without another remote call
      const listRes = await liveApp.inject({ method: "GET", url: "/v1/catalog/products" })
      expect(listRes.statusCode).toBe(200)
      expect(listRes.json().total).toBe(1)
    } finally {
      await liveApp.close()
    }
  })
})

test("integration status reflects durable authorization denial", async () => {
  const app = await buildApp({ appOrigin: "http://localhost:5200", tiktok: {
    appKey: "key", appSecret: "secret", hasCreatorToken: true, tokenAvailable: async () => false,
  } })
  try {
    const res = await app.inject({ method: "GET", url: "/v1/integrations/tiktok/status" })
    expect(res.statusCode).toBe(200)
    expect(res.json().configured).toBe(false)
    expect(res.json().capabilities.displayAndLink).toBe(false)
  } finally { await app.close() }
})
