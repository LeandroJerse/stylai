import { expect, test } from "bun:test"
import type { AliExpressAffiliateClient } from "@stylai/commerce"
import { buildApp } from "../src/app"

const ORIGIN = "http://localhost:5200"
const SECRET = "synthetic-aliexpress-secret"
const TRACKING = "synthetic-tracking"

function fakeClient(outcome: "ok" | "fail" | "business") {
  let calls = 0
  const client = {
    async queryProducts() {
      calls++
      return outcome === "ok"
        ? { ok: true as const, products: [], pageNo: 1, totalRecordCount: 0, requestId: "req-ok" }
        : outcome === "business" ? { ok: false as const, kind: "business_error" as const, code: "405", requestId: "req-biz" }
        : { ok: false as const, kind: "provider_error" as const, code: "AppKeyNotAuthorized", requestId: "req-fail" }
    },
    async generateLinks() { throw new Error("unused") },
  } as unknown as AliExpressAffiliateClient
  return { client, calls: () => calls }
}

async function build(outcome: "ok" | "fail" | "business" | null, withTracking = true) {
  const fake = outcome ? fakeClient(outcome) : null
  const app = await buildApp({ appOrigin: ORIGIN, aliexpress: {
    appKey: outcome ? "500000" : null, appSecret: outcome ? SECRET : null, trackingId: outcome && withTracking ? TRACKING : null, client: fake?.client ?? null,
    operatorId: "operator", appOrigin: ORIGIN,
    resolveOperator: async (request) => request.headers.authorization === "Bearer operator" ? { userId: "operator", sessionId: "s" } : request.headers.authorization ? { userId: "other", sessionId: "s" } : null,
  } })
  return { app, calls: fake?.calls ?? (() => 0) }
}
const operator = { authorization: "Bearer operator", origin: ORIGIN }

test("status distinguishes missing configuration, unverified credentials, validated and failed calls", async () => {
  const missing = await build(null)
  try {
    const body = (await missing.app.inject("/v1/integrations/aliexpress/status")).json()
    expect(body).toMatchObject({ state: "not_configured", permissions: "unverified", authentication: { catalogRequiresOAuth: false, method: "app_key_signature" },
      missingPrerequisites: ["ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET"], missingForAffiliateLinks: ["ALIEXPRESS_TRACKING_ID"], capabilities: { displayAndLink: false, aiTryOn: false } })
    expect((await missing.app.inject({ method: "POST", url: "/v1/integrations/aliexpress/verify", headers: operator })).statusCode).toBe(503)
  } finally { await missing.app.close() }

  const good = await build("ok")
  try {
    expect((await good.app.inject("/v1/integrations/aliexpress/status")).json()).toMatchObject({ state: "configured_unverified", permissions: "unverified", missingPrerequisites: [] })
    const verified = await good.app.inject({ method: "POST", url: "/v1/integrations/aliexpress/verify", headers: operator })
    expect(verified.statusCode).toBe(200)
    expect(verified.json()).toMatchObject({ state: "validated", permissions: "verified_by_real_call", lastVerification: { ok: true, requestId: "req-ok" }, capabilities: { displayAndLink: true, aiTryOn: false } })
    for (const response of [verified, await good.app.inject("/v1/integrations/aliexpress/status")]) {
      expect(response.body).not.toContain(SECRET)
      expect(response.body).not.toContain(TRACKING)
      expect(response.headers["cache-control"]).toBe("no-store")
    }
  } finally { await good.app.close() }

  const untracked = await build("ok", false)
  try {
    expect((await untracked.app.inject("/v1/integrations/aliexpress/status")).json()).toMatchObject({ state: "configured_unverified", hasTrackingId: false, missingPrerequisites: [], missingForAffiliateLinks: ["ALIEXPRESS_TRACKING_ID"] })
    const verified = await untracked.app.inject({ method: "POST", url: "/v1/integrations/aliexpress/verify", headers: operator })
    expect(verified.statusCode).toBe(200)
    expect(verified.json()).toMatchObject({ state: "validated", lastVerification: { ok: true, productCount: 0 }, capabilities: { affiliateLinks: false } })
  } finally { await untracked.app.close() }

  // resp_result with a non-200 resp_code comes from the business API itself, not from the gateway's
  // signature/permission check, so it must not be reported as a provider rejection.
  const business = await build("business")
  try {
    const failed = await business.app.inject({ method: "POST", url: "/v1/integrations/aliexpress/verify", headers: operator })
    expect(failed.statusCode).toBe(502)
    expect(failed.json()).toMatchObject({ state: "verification_failed", permissions: "unverified", lastVerification: { ok: false, errorKind: "business_error", errorCode: "405" } })
  } finally { await business.app.close() }

  const bad = await build("fail")
  try {
    const failed = await bad.app.inject({ method: "POST", url: "/v1/integrations/aliexpress/verify", headers: operator })
    expect(failed.statusCode).toBe(502)
    expect(failed.json()).toMatchObject({ state: "verification_failed", permissions: "rejected_by_provider", lastVerification: { ok: false, errorKind: "provider_error", errorCode: "AppKeyNotAuthorized" }, capabilities: { displayAndLink: false } })
  } finally { await bad.app.close() }
})

test("real verification is restricted to the operator and the app origin", async () => {
  const { app, calls } = await build("ok")
  try {
    const verify = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/v1/integrations/aliexpress/verify", headers })
    expect((await verify({ origin: ORIGIN })).statusCode).toBe(403)
    expect((await verify({ authorization: "Bearer operator" })).statusCode).toBe(403)
    expect((await verify({ authorization: "Bearer someone", origin: ORIGIN })).statusCode).toBe(403)
    expect((await verify({ ...operator, origin: "https://evil.test" })).statusCode).toBe(403)
    expect(calls()).toBe(0)
  } finally { await app.close() }
})

test("registration callback never exchanges, simulates a connection or reflects provider input", async () => {
  const { app, calls } = await build("ok")
  try {
    const plain = await app.inject("/api/integrations/aliexpress/callback")
    expect(plain.statusCode).toBe(200)
    expect(plain.json()).toEqual({ ok: true, provider: "aliexpress", purpose: "app_registration_only", oauthEnabled: false })
    expect(plain.headers["referrer-policy"]).toBe("no-referrer")
    expect(plain.headers["cache-control"]).toBe("no-store")
    expect((await app.inject({ method: "HEAD", url: "/api/integrations/aliexpress/callback" })).statusCode).toBe(200)

    const code = await app.inject("/api/integrations/aliexpress/callback?code=SYNTHETIC_CODE_123&state=abc")
    expect(code.statusCode).toBe(503)
    expect(code.json().error.code).toBe("oauth_not_enabled")
    const denied = await app.inject("/api/integrations/aliexpress/callback?error=access_denied&error_description=%3Cscript%3EINJECTED")
    expect(denied.statusCode).toBe(400)
    for (const response of [code, denied]) {
      expect(response.body).not.toContain("SYNTHETIC_CODE_123")
      expect(response.body).not.toContain("INJECTED")
      expect(response.body).not.toContain("access_denied")
    }
    expect((await app.inject("/api/integrations/aliexpress/callback?code=a&code=b")).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/api/integrations/aliexpress/callback" })).statusCode).toBe(404)
    expect(calls()).toBe(0)
  } finally { await app.close() }
})

test("request logs keep the callback path but drop the query string", async () => {
  const lines: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: string | Uint8Array) => { lines.push(String(chunk)); return true }) as typeof process.stdout.write
  const app = await buildApp({ appOrigin: ORIGIN, logger: true, aliexpress: { appKey: null, appSecret: null, trackingId: null } })
  try {
    await app.inject("/api/integrations/aliexpress/callback?code=LOGGED_CODE_SHOULD_NOT_APPEAR")
  } finally { await app.close(); process.stdout.write = original }
  const log = lines.join("")
  expect(log).toContain("/api/integrations/aliexpress/callback")
  expect(log).not.toContain("LOGGED_CODE_SHOULD_NOT_APPEAR")
})
