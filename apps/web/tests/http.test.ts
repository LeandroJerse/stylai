import { describe, expect, test } from "bun:test"
import { ApiError } from "../src/api/errors"
import { buildUrl, createHttpClient } from "../src/api/http"

type Call = { url: string; init: RequestInit }

/** Scripted fetch: each call takes the next response (or throws when it is an Error). */
function fakeFetch(responses: (Response | Error | ((c: Call) => Response))[]) {
  const calls: Call[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} }
    calls.push(call)
    const next = responses.shift()
    if (!next) throw new Error("unexpected request " + call.url)
    if (next instanceof Error) throw next
    return typeof next === "function" ? next(call) : next
  }) as typeof fetch
  return { impl, calls }
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
const header = (c: Call, name: string): string | undefined => (c.init.headers as Record<string, string> | undefined)?.[name]

describe("buildUrl", () => {
  test("joins base and path and drops empty query values", () => {
    expect(buildUrl("https://api.x/v1", "/catalog/products", { q: "blazer", category: null, partner: undefined, cursor: "", limit: 24, favorites: true })).toBe("https://api.x/v1/catalog/products?q=blazer&limit=24&favorites=true")
  })
  test("repeats array values", () => {
    expect(buildUrl("https://api.x/v1", "ids", { id: ["a", "b"] })).toBe("https://api.x/v1/ids?id=a&id=b")
  })
})

describe("http client", () => {
  test("without a base URL every request fails as not_configured, and nothing is fetched", async () => {
    const f = fakeFetch([])
    const http = createHttpClient({ baseUrl: null, fetchImpl: f.impl })
    expect(http.configured).toBe(false)
    const err = await http.request("/me").catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).code).toBe("not_configured")
    expect(f.calls.length).toBe(0)
  })

  test("sends JSON, credentials and the bearer token", async () => {
    const f = fakeFetch([json(200, { ok: true })])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    http.setAccessToken("t1")
    await http.request("/preferences/p1", { method: "PATCH", body: { a: 1 }, auth: "optional" })
    const c = f.calls[0]
    expect(c?.url).toBe("https://api.x/v1/preferences/p1")
    expect(c?.init.method).toBe("PATCH")
    expect(c?.init.credentials).toBe("include")
    expect(c && header(c, "Authorization")).toBe("Bearer t1")
    expect(c && header(c, "Content-Type")).toBe("application/json")
    expect(c?.init.body).toBe('{"a":1}')
  })

  test("auth: none never sends the token", async () => {
    const f = fakeFetch([json(200, {})])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    http.setAccessToken("t1")
    await http.request("/auth/sign-in", { method: "POST", body: {}, auth: "none" })
    expect(f.calls[0] && header(f.calls[0], "Authorization")).toBeUndefined()
  })

  test("a 401 refreshes once and retries with the new token", async () => {
    const f = fakeFetch([json(401, { error: { code: "unauthorized", message: "x" } }), json(200, { accessToken: "t2" }), json(200, { id: "u1" })])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    http.setAccessToken("t1")
    const body = await http.request<{ id: string }>("/me", { auth: "required" })
    expect(body.id).toBe("u1")
    expect(f.calls.map((c) => c.url.replace("https://api.x/v1", ""))).toEqual(["/me", "/auth/refresh", "/me"])
    expect(f.calls[2] && header(f.calls[2], "Authorization")).toBe("Bearer t2")
    expect(http.getAccessToken()).toBe("t2")
  })

  test("concurrent 401s share one refresh", async () => {
    let refreshes = 0
    const f = fakeFetch([
      json(401, {}),
      json(401, {}),
      () => {
        refreshes++
        return json(200, { accessToken: "t2" })
      },
      json(200, { n: 1 }),
      json(200, { n: 2 }),
    ])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    http.setAccessToken("t1")
    await Promise.all([http.request("/a", { auth: "required" }), http.request("/b", { auth: "required" })])
    expect(refreshes).toBe(1)
  })

  test("a failed refresh clears the token and notifies session expiry", async () => {
    const f = fakeFetch([json(401, { error: { code: "unauthorized", message: "Sessão expirada" } }), json(401, {})])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    let expired = 0
    http.onSessionExpired(() => expired++)
    http.setAccessToken("t1")
    const err = (await http.request("/me", { auth: "required" }).catch((e: unknown) => e)) as ApiError
    expect(err.code).toBe("unauthorized")
    expect(expired).toBe(1)
    expect(http.getAccessToken()).toBeNull()
  })

  test("auth: required without a token tries the refresh cookie first", async () => {
    const f = fakeFetch([json(200, { accessToken: "t9" }), json(200, { ok: 1 })])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    await http.request("/closet", { auth: "required" })
    expect(f.calls[1] && header(f.calls[1], "Authorization")).toBe("Bearer t9")
  })

  test("maps the error envelope, field messages and Retry-After", async () => {
    const f = fakeFetch([json(422, { error: { code: "validation", message: "Revise", fields: { email: "E-mail inválido", n: 3 } } }), json(429, { nope: true }, { "retry-after": "30" })])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    const a = (await http.request("/auth/sign-up", { method: "POST", body: {}, auth: "none" }).catch((e: unknown) => e)) as ApiError
    expect(a.code).toBe("validation")
    expect(a.fields).toEqual({ email: "E-mail inválido" })
    const b = (await http.request("/x", { auth: "none" }).catch((e: unknown) => e)) as ApiError
    expect(b.code).toBe("rate_limited")
    expect(b.retryAfter).toBe(30)
    expect(b.message.length).toBeGreaterThan(0)
  })

  test("network failures and timeouts become typed errors", async () => {
    const f = fakeFetch([new TypeError("Failed to fetch")])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    const a = (await http.request("/x", { auth: "none" }).catch((e: unknown) => e)) as ApiError
    expect(a.code).toBe("network")

    const slow = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch
    const http2 = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: slow })
    const b = (await http2.request("/x", { auth: "none", timeoutMs: 10 }).catch((e: unknown) => e)) as ApiError
    expect(b.code).toBe("timeout")
  })

  test("204 returns null; a non-JSON error body still maps by status", async () => {
    const f = fakeFetch([new Response(null, { status: 204 }), new Response("<html>oops</html>", { status: 503, headers: { "content-type": "text/html" } })])
    const http = createHttpClient({ baseUrl: "https://api.x/v1", fetchImpl: f.impl })
    expect(await http.request("/closet/pieces/1", { method: "PUT", auth: "none" })).toBeNull()
    const e = (await http.request("/x", { auth: "none" }).catch((er: unknown) => er)) as ApiError
    expect(e.code).toBe("server")
  })
})
