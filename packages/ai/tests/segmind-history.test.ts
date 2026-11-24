import { describe, expect, test } from "bun:test"
import { createSegmindHistory, SEGMIND_HISTORY_ORIGIN } from "../src/segmind-history.js"
import { createSegmindOutfitClient } from "../src/segmind-outfit.js"

const MODEL = "flux-3-klein-image-edit"
const START = new Date("2026-11-24T21:07:33.340Z")
const END = new Date("2026-11-24T21:10:33.340Z")
// Field names and values as the real history answered on 2026-11-24 (ids shortened to synthetic ones).
const row = (id: string, created: string, over: Record<string, unknown> = {}) => ({ id: "x", user_email: "p@example.com", request_id: id.padEnd(32, "0"), model_name: MODEL, model_status: "COMPLETED", model_created: created, response_code: 200, credits_deduction: 0.01287, generation_url: "https://images.segmind.com/a/b/x.png", error: null, error_family: null, request_body: "{\"images\":[\"AAAA\"]}", ...over })
const FAILED = row("f9f4", "2026-11-24T21:07:36.805314+00:00", { model_status: "FAILED", response_code: 502, credits_deduction: 0, generation_url: null, error: "Service temporarily unavailable.", error_family: "upstream_5xx" })
const OK = row("d0f9", "2026-11-24T20:46:51.675873+00:00")
const make = (pages: unknown[] | ((url: URL) => Response)) => {
  const urls: URL[] = [], inits: RequestInit[] = []
  const history = createSegmindHistory({ apiKey: "secret-key", fetch: (async (u: string, i: RequestInit) => {
    const url = new URL(u); urls.push(url); inits.push(i)
    return typeof pages === "function" ? pages(url) : Response.json(pages[Number(url.searchParams.get("page")) - 1] ?? { data: [] })
  }) as never })
  const find = (over: Partial<Parameters<typeof history.find>[0]> = {}) => history.find({ model: MODEL, startedAt: START, endAt: END, requestId: null, taken: [OK.request_id], ...over })
  return { find, urls, inits }
}

describe("one certain answer", () => {
  test("the real 502 of 2026-11-24: found, not charged", async () => {
    const t = make([{ data: [FAILED, OK], has_next: false }])
    expect(await t.find()).toEqual({ kind: "found", requestId: FAILED.request_id, httpStatus: 502, costMicros: 0n, hasOutput: false, outputUrl: null, errorFamily: "upstream_5xx" })
    expect(t.urls[0]!.origin).toBe(SEGMIND_HISTORY_ORIGIN)
    expect(Object.fromEntries(t.urls[0]!.searchParams)).toMatchObject({ model_name: MODEL, from_date: "2026-11-18", to_date: "2026-11-25" })
    // The key travels only in the header.
    expect(t.urls[0]!.toString()).not.toContain("secret")
    expect([t.inits[0]!.method, t.inits[0]!.redirect, new Headers(t.inits[0]!.headers).get("x-api-key")]).toEqual(["GET", "error", "secret-key"])
  })
  test("charged: the exact cost in micro-dollars, and whether an image exists", async () =>
    expect(await make([{ data: [row("aaaa", "2026-11-24T21:07:36Z"), OK] }]).find()).toMatchObject({ kind: "found", httpStatus: 200, costMicros: 12870n, hasOutput: true }))
  test("a request with several outputs is one request, charged once", async () =>
    expect(await make([{ data: [row("aaaa", "2026-11-24T21:07:36Z"), row("aaaa", "2026-11-24T21:07:36Z"), OK] }]).find()).toMatchObject({ kind: "found", costMicros: 12870n }))
  test("a known id wins over the time window", async () =>
    expect(await make([{ data: [FAILED, OK] }]).find({ requestId: OK.request_id, taken: [] })).toMatchObject({ kind: "found", requestId: OK.request_id }))
})

describe("the paid image", () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"))
  test("only an https Segmind address is offered for download", async () => {
    const url = async (u: string) => { const r = await make([{ data: [row("aaaa", "2026-11-24T21:07:36Z", { generation_url: u }), OK] }]).find(); return r.kind === "found" ? [r.hasOutput, r.outputUrl] : r }
    expect(await url("https://images.segmind.com/a/b/x.png")).toEqual([true, "https://images.segmind.com/a/b/x.png"])
    for (const bad of ["http://images.segmind.com/x.png", "https://images.segmind.com.evil.test/x.png", "https://evil.test/x.png", "https://u:p@images.segmind.com/x.png", "https://127.0.0.1/x.png", "x"]) expect([bad, await url(bad)]).toEqual([bad, [true, null]])
  })
  test("download sends no key, follows no redirect, is size capped and must be an image", async () => {
    const inits: RequestInit[] = []
    const get = (answer: () => Response) => createSegmindHistory({ apiKey: "secret-key", fetch: (async (_u: string, i: RequestInit) => { inits.push(i); return answer() }) as never }).output("https://images.segmind.com/a/b/x.png")
    expect((await get(() => new Response(png)))?.info.mime).toBe("image/png")
    expect([inits[0]!.redirect, JSON.stringify(inits[0] ?? {}).includes("secret")]).toEqual(["error", false])
    expect(await get(() => new Response("<html>", { headers: { "content-type": "image/png" } }))).toBeNull()
    expect(await get(() => new Response(png, { status: 404 }))).toBeNull()
    expect(await get(() => new Response(png, { headers: { "content-length": "99999999" } }))).toBeNull()
    expect(await get(() => { throw new Error("x") })).toBeNull()
    expect(await createSegmindHistory({ apiKey: "k", fetch: (async () => { throw new Error("must not be called") }) as never }).output("https://evil.test/x.png")).toBeNull()
  })
})

describe("when in doubt, no answer", () => {
  test("two unclaimed rows in the window", async () => expect(await make([{ data: [FAILED, row("bbbb", "2026-11-24T21:08:10Z"), OK] }]).find()).toEqual({ kind: "ambiguous" }))
  test("a row that belongs to another call is never reused", async () => expect(await make([{ data: [FAILED, OK] }]).find({ taken: [OK.request_id, FAILED.request_id] })).toEqual({ kind: "absent" }))
  test("another model in the same minute is not ours", async () => expect(await make([{ data: [{ ...FAILED, model_name: "flux-3-klein-image-edit-turbo" }, OK] }]).find()).toEqual({ kind: "absent" }))
  test("still running", async () => {
    expect(await make([{ data: [{ ...FAILED, model_status: "PENDING", response_code: null }, OK] }]).find()).toEqual({ kind: "pending" })
    expect(await make([{ data: [{ ...FAILED, credits_deduction: null }, OK] }]).find()).toEqual({ kind: "pending" })
  })
  test("an empty history is not proof of absence", async () => expect(await make([{ data: [] }]).find()).toEqual({ kind: "unavailable", code: "no_control" }))
  test("an unreadable row could be ours", async () => {
    expect(await make([{ data: [{ ...FAILED, credits_deduction: "0" }, OK] }]).find()).toEqual({ kind: "unavailable", code: "bad_row" })
    expect(await make([{ data: [{ ...FAILED, model_created: "ontem" }, OK] }]).find()).toEqual({ kind: "unavailable", code: "bad_row" })
    expect(await make([{ rows: [] }]).find()).toEqual({ kind: "unavailable", code: "bad_response" })
  })
  test("refused key, server error and network", async () => {
    expect(await make(() => new Response("", { status: 403 })).find()).toEqual({ kind: "unavailable", code: "http_403" })
    expect(await make(() => { throw new Error("boom secret-key") }).find()).toEqual({ kind: "unavailable", code: "network" })
  })
  test("pages until the window is covered; too many rows is no answer", async () => {
    const later = Array.from({ length: 100 }, (_, i) => row(`l${i}`, "2026-11-25T10:00:00Z"))
    const paged = make([{ data: later, has_next: true }, { data: [FAILED, OK], has_next: false }])
    expect([await paged.find(), paged.urls.length]).toEqual([expect.objectContaining({ kind: "found", httpStatus: 502 }), 2])
    expect(await make([1, 2, 3, 4].map((p) => ({ data: later.map((r) => ({ ...r, request_id: `${p}${r.request_id}` })), has_next: true }))).find()).toEqual({ kind: "unavailable", code: "too_many_rows" })
  })
})

test("the provider id of an error answer is kept for an exact match later", async () => {
  const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64"))
  const call = (headers: Record<string, string>) => createSegmindOutfitClient({ apiKey: "t", model: MODEL, fetch: (async () => new Response("{}", { status: 502, headers })) as never })
    .generate({ person: { bytes: png, mime: "image/png" }, garments: [{ bytes: png, mime: "image/png", category: "Upper body", garmentType: "tops", slot: "upper" }] })
  expect(await call({ "x-request-id": "f9f4f21a8957f9f4f21a8957f9f4f21a" })).toEqual({ kind: "unknown", code: "segmind_http_502", requestId: "f9f4f21a8957f9f4f21a8957f9f4f21a" })
  expect(await call({ "x-request-id": "bad idé".replace("é", "!") })).toEqual({ kind: "unknown", code: "segmind_http_502", requestId: null })
})
