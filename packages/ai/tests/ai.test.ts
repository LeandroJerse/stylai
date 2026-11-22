import { expect, test } from "bun:test"
import {
  buildOtlpPayload, createInterpreter, createOtlpExporter, createSegmindClient, findPrice, formatUsd, gpuCostMicros, isAllowedOutputUrl,
  parseResult, pseudonymizeUser, rankCandidates, sanitizeAttributes, sniffImage, spanIdFor, tokenCostMicros, traceIdForJob,
  type GpuSecondPrice, type MessagesClient, type TokenPrice,
} from "../src/index"

test("prices are integer micros with documented provenance; unknown stays null", () => {
  const segmind = findPrice("segmind", "try-on-diffusion") as GpuSecondPrice
  expect(gpuCostMicros(segmind, 8.06)).toBe(58_032n)
  expect(gpuCostMicros(segmind, Number.NaN)).toBeNull()
  const haiku = findPrice("anthropic", "claude-haiku-5-5") as TokenPrice
  expect(tokenCostMicros(haiku, { inputTokens: 1200, outputTokens: 360 })).toBe(300n) // 120 + 180
  expect(tokenCostMicros(haiku, { inputTokens: 200_000, outputTokens: 1 })).toBeNull() // above the priced tier
  expect(formatUsd(58_032n)).toBe("US$0.058032")
  for (const entry of [segmind, haiku]) expect(entry.source.length).toBeGreaterThan(10)
})

test("image sniffing trusts bytes, not names", () => {
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 3, 0, 0, 0, 4, 0])
  expect(sniffImage(pngHeader)).toEqual({ mime: "image/png", width: 768, height: 1024 })
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x04, 0x00, 0x03, 0x00, 3, 0, 0, 0, 0, 0, 0, 0, 0])
  expect(sniffImage(jpeg)).toEqual({ mime: "image/jpeg", width: 768, height: 1024 })
  expect(sniffImage(new TextEncoder().encode("<html>not an image</html>"))).toBeNull()
})

test("Segmind output parsing and SSRF guard", () => {
  expect(parseResult({ images: [{ url: "https://images.segmind.com/a.png" }], metrics: { inference_time: 8.06, cost: 0.05 } }))
    .toEqual({ image: { kind: "url", url: "https://images.segmind.com/a.png" }, metrics: { cost: 0.05, inferenceTime: 8.06, remainingCredits: undefined, queueTime: undefined, totalTime: undefined } })
  expect(parseResult({ nothing: true })).toBeNull()
  expect(isAllowedOutputUrl("https://images.segmind.com/x.png")).toBe(true)
  for (const bad of ["http://images.segmind.com/x.png", "https://segmind.com.evil.io/x", "https://169.254.169.254/latest", "https://user:pw@images.segmind.com/x", "https://images.segmind.com:8443/x"]) {
    expect(isAllowedOutputUrl(bad)).toBe(false)
  }
})

test("Segmind submit classifies outcomes without re-sending unknown ones", async () => {
  const calls: string[] = []
  const make = (impl: () => Promise<Response>) => createSegmindClient({ apiKey: "SG_x", baseUrl: "https://api.test", fetch: async (url) => { calls.push(String(url)); return impl() } })
  const input = { requestKey: "gen_0123456789abcdef_1", modelImageUrl: "https://s/x", clothImageUrl: "https://s/y", category: "Upper body" as const, preset: { numInferenceSteps: 25, guidanceScale: 2, seed: -1 } }
  expect(await make(async () => Response.json({ request_id: "r1" })).submit(input)).toEqual({ kind: "accepted", requestId: "r1" })
  expect(await make(async () => new Response("{}", { status: 406 })).submit(input)).toEqual({ kind: "rejected", httpStatus: 406, code: "insufficient_credits" })
  expect(await make(async () => new Response("{}", { status: 502 })).submit(input)).toEqual({ kind: "retryable", httpStatus: 502, code: "provider_error" })
  expect(await make(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }) }).submit(input)).toEqual({ kind: "unknown", code: "timeout" })
  expect(await make(async () => Response.json({ ok: true })).submit(input)).toEqual({ kind: "unknown", code: "bad_response" })
  expect(calls.every((c) => c === "https://api.test/v2/try-on-diffusion")).toBe(true)
})

test("telemetry ids are deterministic; sanitizer drops secrets, PII and unknown keys", () => {
  expect(traceIdForJob("8f0c4a8e-0000-4000-8000-000000000001")).toBe("8f0c4a8e000040008000000000000001")
  expect(spanIdFor("a")).toBe(spanIdFor("a"))
  expect(spanIdFor("a")).toMatch(/^[0-9a-f]{16}$/)
  const user = pseudonymizeUser("10000000-0000-4000-8000-0000000000a1", "k".repeat(32))
  expect(user).toMatch(/^u_[0-9a-f]{32}$/)
  expect(user).not.toContain("10000000")
  const clean = sanitizeAttributes({
    "langfuse.user.id": user,
    "langfuse.observation.metadata.note": "contato maria@example.com",
    "langfuse.observation.metadata.url": "https://x.supabase.co/storage/v1/object/sign/a?token=abc",
    "langfuse.observation.metadata.key": "SG_0123456789abcdef",
    "langfuse.observation.metadata.ok": "fine",
    "http.request.header.authorization": "Bearer abc",
    "langfuse.observation.cost_details": JSON.stringify({ total: 0.058032 }),
  })
  expect(clean).toEqual({ "langfuse.user.id": user, "langfuse.observation.metadata.ok": "fine", "langfuse.observation.cost_details": "{\"total\":0.058032}" })
  const payload = buildOtlpPayload([{ traceId: "a".repeat(32), spanId: "b".repeat(16), name: "x", startMs: 1, endMs: 2, attributes: { "langfuse.observation.type": "generation" } }], { name: "t", version: "0" })
  expect(payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.startTimeUnixNano).toBe("1000000")
})

test("OTLP exporter maps delivery outcomes conservatively", async () => {
  const cfg = { publicKey: "pk-lf-a", secretKey: "sk-lf-b", baseUrl: "https://cloud.langfuse.test", environment: "test" }
  const span = [{ traceId: "a".repeat(32), spanId: "b".repeat(16), name: "x", startMs: 1, endMs: 2, attributes: {} }]
  const run = (impl: () => Promise<Response>) => createOtlpExporter(cfg, { fetch: impl })(span)
  expect(await run(async () => new Response("{}", { status: 200 }))).toBe("sent")
  expect(await run(async () => new Response("{}", { status: 429 }))).toBe("retry")
  expect(await run(async () => new Response("{}", { status: 400 }))).toBe("dead")
  expect(await run(async () => new Response("{}", { status: 500 }))).toBe("unknown")
  expect(await run(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }) })).toBe("retry")
  expect(await run(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }) })).toBe("unknown")
})

test("interpreter validates the structured intent and reports usage; ranking is rule-based", async () => {
  let sent: Record<string, unknown> = {}
  const client = { messages: { parse: async (params: Record<string, unknown>) => {
    sent = params
    return { parsed_output: { category: "jackets", garment_type: "jaqueta", colors: ["preta"], style_tags: ["casual"], occasion: null, max_price_brl: 250, avoid: [] },
      usage: { input_tokens: 1200, output_tokens: 360, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: "end_turn", _request_id: "req_1" }
  } } } as unknown as MessagesClient
  const interpreter = createInterpreter({ client, model: "claude-haiku-5-5" })
  const out = await interpreter.interpret("quero uma jaqueta preta casual até 250 reais", ["jackets", "pants"])
  expect(out.intent.category).toBe("jackets")
  expect(out.requestId).toBe("req_1")
  expect(out.usage.inputTokens).toBe(1200)
  expect(sent.model).toBe("claude-haiku-5-5")
  expect(sent.thinking).toEqual({ type: "disabled" })
  const ranked = rankCandidates(out.intent, [
    { productId: "b", variantId: "b1", categoryId: "jackets", name: "Jaqueta azul", colorTags: ["azul"], styleTags: ["casual"], priceMinor: 19990, available: true, rightsCleared: true },
    { productId: "a", variantId: "a1", categoryId: "jackets", name: "Jaqueta preta", colorTags: ["preta"], styleTags: ["casual"], priceMinor: 24990, available: true, rightsCleared: true },
    { productId: "c", variantId: "c1", categoryId: "jackets", name: "Jaqueta cara", colorTags: ["preta"], styleTags: [], priceMinor: 99990, available: true, rightsCleared: true },
    { productId: "d", variantId: "d1", categoryId: "jackets", name: "Sem direitos", colorTags: ["preta"], styleTags: [], priceMinor: 100, available: true, rightsCleared: false },
  ])
  expect(ranked.map((r) => r.candidate.productId)).toEqual(["a", "b"])
  expect(ranked[0]!.reasons).toEqual(["color:preta", "style:casual"])
  const refusing = createInterpreter({ client: { messages: { parse: async () => ({ parsed_output: null, usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: "refusal" }) } } as unknown as MessagesClient, model: "m" })
  await expect(refusing.interpret("x", ["jackets"])).rejects.toThrow("interpretation_refusal")
})
