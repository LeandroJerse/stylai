import { describe, expect, test } from "bun:test"
import { createTikTokCreatorClient, signTikTokRequest, TIKTOK_SEARCH_OPEN_PRODUCTS_PATH } from "../src/index"

describe("TikTok Shop Creator Affiliate read-only client", () => {
  test("sends signed POST with x-tts-access-token header, preserves large string IDs, and parses pagination", async () => {
    const requests: Array<{ url: string; token: string | null; body: string }> = []
    const client = createTikTokCreatorClient({
      appKey: "6lvudbnilidmd",
      appSecret: "fake_secret",
      baseUrl: "https://open-api.tiktok.test",
      now: () => 1_732_233_600_000,
      sleep: async () => {},
      fetch: async (url, init) => {
        const hdrs = new Headers(init?.headers)
        requests.push({ url: String(url), token: hdrs.get("x-tts-access-token"), body: String(init?.body ?? "") })
        return Response.json({
          code: 0,
          message: "Success",
          request_id: "tt-req-001",
          data: {
            total_count: 1,
            next_page_token: "cursor_page_2",
            products: [
              {
                id: "17295929697122070089999",
                title: "Camisa Social Slim Off-White",
                shop: { name: "Moda BR Oficial" },
                main_image_url: "https://p16-oec-va.ibyteimg.com/shirt.jpg",
                detail_link: "https://shop.tiktok.com/view/product/17295929697122070089999",
                sale_region: "BR",
                has_inventory: true,
                sales_price: { currency: "BRL", amount: "129.90" },
              },
            ],
          },
        })
      },
    })

    const out = await client.searchOpenProducts({ keywords: ["camisa"], pageSize: 20 }, "creator_tok_1")
    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.products).toHaveLength(1)
      expect(out.products[0]?.id).toBe("17295929697122070089999")
      expect(out.nextPageToken).toBe("cursor_page_2")
      expect(out.requestId).toBe("tt-req-001")
    }

    const req = requests[0]!
    expect(req.token).toBe("creator_tok_1")
    const parsedUrl = new URL(req.url)
    expect(parsedUrl.pathname).toBe(TIKTOK_SEARCH_OPEN_PRODUCTS_PATH)
    expect(parsedUrl.searchParams.has("access_token")).toBe(false)
    const expectedSign = signTikTokRequest({
      path: TIKTOK_SEARCH_OPEN_PRODUCTS_PATH,
      query: { page_size: 20, app_key: "6lvudbnilidmd", timestamp: 1732233600 },
      rawBody: req.body,
      contentType: "application/json",
    }, "fake_secret")
    expect(parsedUrl.searchParams.get("sign")).toBe(expectedSign)
  })

  test("handles business errors (36009004, token expired, scope missing) without retrying auth errors, and retries 429 once", async () => {
    let attempts = 0
    const retryClient = createTikTokCreatorClient({
      appKey: "k", appSecret: "s", baseUrl: "https://open-api.tiktok.test", sleep: async () => {},
      fetch: async () => {
        attempts++
        if (attempts === 1) return new Response("{}", { status: 429, headers: { "retry-after": "1" } })
        return Response.json({ code: 0, request_id: "req-ok-after-429", data: { products: [] } })
      },
    })
    const after429 = await retryClient.searchOpenProducts({ keywords: ["camisa"] }, "tok")
    expect(after429.ok).toBe(true)
    expect(attempts).toBe(2)

    let errAttempts = 0
    const errClient = createTikTokCreatorClient({
      appKey: "k", appSecret: "s", baseUrl: "https://open-api.tiktok.test", sleep: async () => {},
      fetch: async () => {
        errAttempts++
        return Response.json({ code: 36009004, message: "invalid request context", request_id: "req-ambig-1" })
      },
    })
    const ambig = await errClient.searchOpenProducts({ keywords: ["camisa"] }, "tok")
    expect(ambig).toEqual({ ok: false, kind: "ambiguous_36009004", code: 36009004, requestId: "req-ambig-1", message: "invalid request context" })
    expect(errAttempts).toBe(1)
  })
})
