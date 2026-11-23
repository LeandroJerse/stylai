import { describe, expect, test } from "bun:test"
import {
  buildCreatorAuthorizationUrl, createOAuthStateStore, exchangeCreatorAuthCode, refreshCreatorToken,
  REQUIRED_CREATOR_COLLAB_SCOPE,
} from "../src/index"

describe("TikTok Shop Creator OAuth", () => {
  test("issues single-use 10-minute state, blocks replay, expiry, and operator mismatch", () => {
    let nowMs = 1_000_000
    const store = createOAuthStateStore({ ttlMs: 600_000, now: () => nowMs })
    const issued = store.issue("op-1", "conn-1")
    const authUrl = buildCreatorAuthorizationUrl({ appKey: "6lvudbnilidmd", state: issued.state })
    expect(authUrl).toBe(`https://shop.tiktok.com/alliance/creator/auth?app_key=6lvudbnilidmd&state=${encodeURIComponent(issued.state)}`)

    expect(store.consume(issued.state, "op-1")).toEqual({ ok: true, record: issued })
    expect(store.consume(issued.state, "op-1")).toEqual({ ok: false, reason: "unknown_or_replayed" })

    const s2 = store.issue("op-1", "conn-2")
    nowMs += 600_001
    expect(store.consume(s2.state, "op-1")).toEqual({ ok: false, reason: "expired" })

    const s3 = store.issue("op-1", "conn-3")
    expect(store.consume(s3.state, "op-other")).toEqual({ ok: false, reason: "operator_mismatch" })
    expect(store.consume(s3.state, "op-1")).toEqual({ ok: false, reason: "unknown_or_replayed" })
  })

  test("token exchange accepts user_type=1 with required scope and rejects seller tokens or missing scope", async () => {
    const okGrant = await exchangeCreatorAuthCode({
      appKey: "k", appSecret: "s", authCode: "code123", tokenApiOrigin: "https://auth.test",
      fetch: async () => Response.json({
        code: 0, request_id: "req-tok-1",
        data: {
          access_token: "acc_1", refresh_token: "ref_1", access_token_expire_in: 3600, refresh_token_expire_in: 86400,
          open_id: "creator_open_1", user_type: 1, seller_base_region: "BR",
          granted_scopes: [REQUIRED_CREATOR_COLLAB_SCOPE, "creator.affiliate.info"],
        },
      }),
    })
    expect(okGrant.ok).toBe(true)
    if (okGrant.ok) expect(okGrant.grant.userType).toBe(1)

    const sellerToken = await exchangeCreatorAuthCode({
      appKey: "k", appSecret: "s", authCode: "code123", tokenApiOrigin: "https://auth.test",
      fetch: async () => Response.json({
        code: 0, request_id: "req-tok-2",
        data: {
          access_token: "acc_s", refresh_token: "ref_s", access_token_expire_in: 3600, refresh_token_expire_in: 86400,
          open_id: "seller_1", user_type: 0, granted_scopes: [REQUIRED_CREATOR_COLLAB_SCOPE],
        },
      }),
    })
    expect(sellerToken).toEqual({ ok: false, reason: "wrong_user_type", requestId: "req-tok-2" })

    const missingScope = await refreshCreatorToken({
      appKey: "k", appSecret: "s", refreshToken: "ref_1", tokenApiOrigin: "https://auth.test",
      fetch: async () => Response.json({
        code: 0, request_id: "req-tok-3",
        data: {
          access_token: "acc_2", refresh_token: "ref_2", access_token_expire_in: 3600, refresh_token_expire_in: 86400,
          open_id: "creator_open_1", user_type: 1, granted_scopes: ["creator.affiliate.info"],
        },
      }),
    })
    expect(missingScope).toEqual({ ok: false, reason: "missing_required_scope", requestId: "req-tok-3", missingScopes: [REQUIRED_CREATOR_COLLAB_SCOPE] })
  })
})
