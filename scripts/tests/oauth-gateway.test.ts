import { afterEach, expect, test } from "bun:test"
import { createServer, type Server } from "node:http"
import { startOAuthGateway } from "../oauth-gateway.mjs"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function fixture() {
  const calls: { path: string; origin: string | undefined; cookie: string | undefined }[] = []
  const backend: Server = createServer((req, res) => {
    calls.push({ path: req.url!, origin: req.headers.origin, cookie: req.headers.cookie })
    if (req.url === "/v1/auth/sign-in") res.setHeader("set-cookie", ["stylai_session=fake; HttpOnly; Path=/v1/auth; SameSite=Lax"])
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify({ ok: true }))
  })
  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise(resolve => { backend.closeAllConnections(); backend.close(() => resolve()) }))
  const address = backend.address() as { port: number }
  const gateway = await startOAuthGateway({ publicOrigin: "https://oauth.stylai.shop", backendOrigin: "http://localhost:5200", backendPort: address.port, port: 0 })
  cleanups.push(gateway.close)
  const request = (path: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${gateway.port}${path}`, { ...init, headers: { host: "oauth.stylai.shop", ...init.headers } })
  return { request, calls }
}
test("denies unrelated routes, alternate methods and foreign origins before backend", async () => {
  const { request, calls } = await fixture()
  for (const path of ["/v1/photos", "/v1/auth/sign-up", "/health/ready", "/.env", "/@vite/client"]) expect((await request(path)).status).toBe(404)
  expect((await request("/v1/integrations/tiktok/connect", { method: "POST", headers: { origin: "https://evil.example" } })).status).toBe(403)
  expect((await request("/v1/integrations/tiktok/connect", { method: "POST" })).status).toBe(403)
  expect((await request("/", { headers: { host: "evil.example" } })).status).toBe(421)
  expect(calls).toHaveLength(0)
})
test("forwards public OAuth callback and cookie without logging or caching; preserves query", async () => {
  const { request, calls } = await fixture()
  const response = await request("/api/integrations/tiktok/callback?state=synthetic&code=fake", { headers: { cookie: "stylai_tiktok_oauth=binding; unrelated=private" } })
  expect(response.status).toBe(200)
  expect(response.headers.get("cache-control")).toBe("no-store")
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(calls[0]).toEqual({ path: "/api/integrations/tiktok/callback?state=synthetic&code=fake", origin: undefined, cookie: "stylai_tiktok_oauth=binding" })
})
test("checks public origin, maps backend origin and hardens session cookie", async () => {
  const { request, calls } = await fixture()
  const response = await request("/v1/auth/sign-in", { method: "POST", headers: { origin: "https://oauth.stylai.shop", "content-type": "application/json" }, body: JSON.stringify({ email: "test@example.com", password: "synthetic" }) })
  expect(response.status).toBe(200)
  expect(calls[0]?.origin).toBe("http://localhost:5200")
  expect(response.headers.get("set-cookie")).toContain("Secure")
  expect(response.headers.get("set-cookie")).toContain("HttpOnly")
})
test("rejects oversized input and serves only its operator console", async () => {
  const { request, calls } = await fixture()
  expect((await request("/v1/auth/sign-in", { method: "POST", headers: { origin: "https://oauth.stylai.shop", "content-type": "application/json" }, body: "x".repeat(17000) })).status).toBe(413)
  const page = await request("/")
  expect(page.status).toBe(200)
  expect(page.headers.get("content-security-policy")).toContain("default-src 'none'")
  expect(calls).toHaveLength(0)
})
test("forwards the AliExpress registration callback with its query but never forwards cookies", async () => {
  const { request, calls } = await fixture()
  const response = await request("/api/integrations/aliexpress/callback?code=synthetic", { headers: { cookie: "stylai_session=s; stylai_tiktok_oauth=b", "sec-fetch-site": "cross-site" } })
  expect(response.status).toBe(200)
  expect(response.headers.get("referrer-policy")).toBe("no-referrer")
  expect(calls[0]).toEqual({ path: "/api/integrations/aliexpress/callback?code=synthetic", origin: undefined, cookie: undefined })
  expect((await request("/api/integrations/aliexpress/callback?code=a&code=b")).status).toBe(400)
  expect((await request("/api/integrations/aliexpress/callback", { method: "POST", headers: { origin: "https://oauth.stylai.shop", "content-type": "application/json" }, body: "{}" })).status).toBe(404)
  expect((await request("/v1/integrations/aliexpress/verify", { method: "POST", headers: { origin: "https://oauth.stylai.shop", "content-type": "application/json" }, body: "{}" })).status).toBe(404)
  expect(calls).toHaveLength(1)
})
