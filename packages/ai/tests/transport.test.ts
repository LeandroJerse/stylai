import { describe, expect, test } from "bun:test"
import { createGeminiOutfitClient } from "../src/gemini-outfit.js"
import { createSegmindOutfitClient } from "../src/segmind-outfit.js"
import { neverSent, transportCode } from "../src/transport.js"

// Shapes measured on Node 22.23 (fetch/undici): the reason is in `cause`, with the failing system call.
const failed = (cause: unknown) => Object.assign(new TypeError("fetch failed"), { cause })
const sys = (code: string, syscall?: string) => Object.assign(new Error(code), { code, ...(syscall ? { syscall } : {}) })
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })

const BEFORE: [string, unknown][] = [
  ["no DNS answer", failed(sys("ENOTFOUND", "getaddrinfo"))], ["DNS temporarily down", failed(sys("EAI_AGAIN", "getaddrinfo"))],
  ["connection refused", failed(sys("ECONNREFUSED", "connect"))], ["no route", failed(sys("ENETUNREACH", "connect"))],
  ["connect timed out", failed(sys("UND_ERR_CONNECT_TIMEOUT"))], ["system connect timeout", failed(sys("ETIMEDOUT", "connect"))],
  ["every address refused", failed(Object.assign(new AggregateError([sys("ECONNREFUSED", "connect"), sys("ENETUNREACH", "connect")]), { code: "ECONNREFUSED" }))],
]
const MAYBE_SENT: [string, unknown][] = [
  ["reset after connecting", failed(sys("ECONNRESET", "read"))], ["socket closed by the other side", failed(sys("UND_ERR_SOCKET"))],
  ["route lost while sending", failed(sys("EHOSTUNREACH", "write"))], ["timeout while waiting", failed(sys("ETIMEDOUT", "read"))],
  ["headers timeout", failed(sys("UND_ERR_HEADERS_TIMEOUT"))], ["our own deadline", timeout()], ["redirect refused", failed(new Error("unexpected redirect"))],
  ["one address may have answered", failed(new AggregateError([sys("ECONNREFUSED", "connect"), sys("ECONNRESET", "read")]))],
  ["empty aggregate", failed(new AggregateError([]))], ["no details", new Error("network")], ["not an error", "x"],
]

describe("was anything sent?", () => {
  for (const [name, error] of BEFORE) test(`nothing: ${name}`, () => expect(neverSent(error)).toBe(true))
  for (const [name, error] of MAYBE_SENT) test(`maybe: ${name}`, () => expect(neverSent(error)).toBe(false))
  test("codes are short safe tokens", () => {
    expect(transportCode(failed(sys("ECONNRESET", "read")))).toBe("econnreset")
    expect(transportCode(timeout())).toBe("timeout")
    expect(transportCode(failed(sys("https://secret/?key=1")))).toBe("other")
    expect(transportCode(null)).toBe("other")
  })
})

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"))
const input = { person: { bytes: png, mime: "image/png" }, garments: [{ bytes: png, mime: "image/png", category: "Upper body" as const, garmentType: "tops", slot: "upper" }] }
const flux = (fetch: (...a: never[]) => Promise<Response>) => createSegmindOutfitClient({ apiKey: "test", model: "flux-3-klein-image-edit", fetch: fetch as never })

describe("providers", () => {
  test("FLUX: nothing sent is a definite failure, with no charge to reconcile; one call only", async () => {
    let calls = 0
    const r = await flux(async () => { calls++; throw failed(sys("ENOTFOUND", "getaddrinfo")) }).generate(input)
    expect([r, calls]).toEqual([{ kind: "rejected", code: "provider_unreachable" }, 1])
  })
  test("FLUX: maybe sent stays unknown, now with the reason, and is never sent again", async () => {
    let calls = 0
    const r = await flux(async () => { calls++; throw failed(sys("ECONNRESET", "read")) }).generate(input)
    expect([r, calls]).toEqual([{ kind: "unknown", code: "segmind_transport_econnreset" }, 1])
  })
  test("FLUX: a failure while reading the answer is unknown even with a connection code (the answer had started)", async () => {
    const body = new ReadableStream({ pull(c) { c.error(sys("ECONNREFUSED", "connect")) } })
    const r = await flux(async () => new Response(body, { headers: { "content-type": "image/png" } })).generate(input)
    expect(r.kind).toBe("unknown")
  })
  test("FLUX: server errors stay unknown", async () => expect(await flux(async () => new Response("x", { status: 503 })).generate(input)).toEqual({ kind: "unknown", code: "segmind_http_503", requestId: null }))
  test("Gemini follows the same rule", async () => {
    const gemini = (error: unknown) => createGeminiOutfitClient({ apiKey: "test", fetch: (async () => { throw error }) as never }).generate(input)
    expect(await gemini(failed(sys("ECONNREFUSED", "connect")))).toEqual({ kind: "rejected", code: "provider_unreachable" })
    expect(await gemini(failed(sys("UND_ERR_SOCKET")))).toEqual({ kind: "unknown", code: "gemini_transport_und_err_socket" })
  })
  test("reachability probe: any HTTP answer counts, carries no key or image, and never throws", async () => {
    const seen: RequestInit[] = []
    expect(await flux((async (_u: string, i: RequestInit) => { seen.push(i); return new Response(null, { status: 404 }) }) as never).reachable()).toBe(true)
    expect(seen[0]!.method).toBe("HEAD")
    expect(JSON.stringify(seen[0])).not.toContain("test")
    expect(seen[0]!.body).toBeUndefined()
    expect(await flux(async () => { throw failed(sys("ENOTFOUND", "getaddrinfo")) }).reachable()).toBe(false)
  })
})
