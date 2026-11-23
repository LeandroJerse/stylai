import { test, expect } from "bun:test"
import { buildApp } from "../src/app"

test("creator OAuth binds authenticated operator, origin and callback browser, consumes state once", async () => {
  let exchanges = 0
  let disconnected = false
  let sessionActive = true
  const app = await buildApp({ appOrigin: "http://localhost:5200", tiktok: {
    appKey: "key", appSecret: "secret", hasCreatorToken: false,
    operatorId: "operator", resolveOperator: async (request) => request.headers.authorization === "Bearer operator" ? { userId: "operator", sessionId: "session-one" } : null,
    isSessionActive: async () => sessionActive,
    appOrigin: "http://localhost:5200", secureCookie: false,
    onAuthorizedCode: async () => { exchanges++; return { ok: true } },
    onDisconnect: async () => { disconnected = true },
  } })
  const start = (headers: Record<string, string>) => app.inject({ method: "POST", url: "/v1/integrations/tiktok/connect", headers })
  const headers = { authorization: "Bearer operator", origin: "http://localhost:5200" }
  try {
    expect((await start({ origin: headers.origin })).statusCode).toBe(403)
    expect((await start({ authorization: headers.authorization })).statusCode).toBe(403)
    expect((await start({ ...headers, origin: "https://evil.test" })).statusCode).toBe(403)
    let response = await start(headers)
    expect(response.statusCode).toBe(200)
    let state = new URL(response.json().authorizationUrl).searchParams.get("state")
    expect((await app.inject(`/api/integrations/tiktok/callback?state=${state}&code=secret-code`)).statusCode).toBe(400)
    expect(exchanges).toBe(0)
    response = await start(headers)
    state = new URL(response.json().authorizationUrl).searchParams.get("state")
    const cookie = String(response.headers["set-cookie"]).split(";")[0]!
    const callback = `/api/integrations/tiktok/callback?state=${state}&code=secret-code`
    const success = await app.inject({ url: callback, headers: { cookie } })
    expect(success.statusCode).toBe(200)
    expect(success.body).not.toContain("secret-code")
    expect(success.body).not.toContain("secret")
    expect(exchanges).toBe(1)
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/v1/integrations/tiktok/disconnect", headers })).statusCode).toBe(200)
    expect(disconnected).toBe(true)
    response = await start(headers)
    state = new URL(response.json().authorizationUrl).searchParams.get("state")
    const revokedCookie = String(response.headers["set-cookie"]).split(";")[0]!
    sessionActive = false
    expect((await app.inject({ url: `/api/integrations/tiktok/callback?state=${state}&code=new-code`, headers: { cookie: revokedCookie } })).statusCode).toBe(400)
    expect(exchanges).toBe(1)
  } finally { await app.close() }
})
