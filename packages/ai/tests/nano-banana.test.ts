import { expect, test } from "bun:test"
import { createGeminiOutfitClient } from "../src/gemini-outfit.js"
import { readWorkerConfig } from "../../../apps/worker/src/worker-config.js"

test("Gemini key stays server-side and paid mode requires the existing pilot", () => {
  expect(()=>readWorkerConfig({STYLAI_TRYON_PROVIDER:"gemini",GEMINI_API_KEY:"test",STYLAI_PAID_CALLS_ENABLED:"true"})).toThrow()
  expect(readWorkerConfig({STYLAI_TRYON_PROVIDER:"gemini",GEMINI_API_KEY:"test",STYLAI_PAID_CALLS_ENABLED:"true",STYLAI_PILOT_ID:"test-pilot"}).provider).toBe("gemini")
})

test("native Gemini composes original person and both garments in one private 2K request", async () => {
  let calls = 0
  const client = createGeminiOutfitClient({ apiKey: "test", fetch: async (url, init) => {
    calls++
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent")
    const body = JSON.parse(String(init?.body))
    expect(body.contents[0].parts.filter((p: {inlineData?: unknown}) => p.inlineData)).toHaveLength(3)
    expect(body.generationConfig.imageConfig).toEqual({ imageSize: "2K", aspectRatio: "3:4" })
    expect(body.contents[0].parts[0].text).toContain("identity")
    return Response.json({ responseId: "test-response", candidates: [{ finishReason: "STOP", content: { parts: [{ inlineData: { mimeType: "image/png", data: "aGVsbG8=" } }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 1120, thoughtsTokenCount: 100 } })
  } })
  const photo = { bytes: new Uint8Array([1,2,3]), mime: "image/jpeg" }
  const result = await client.generate({ person: photo, garments: [{ ...photo, category: "Lower body" }, { ...photo, category: "Upper body" }] })
  expect(calls).toBe(1)
  expect(result.kind).toBe("completed")
  if(result.kind === "completed") expect(result.computedMicros).toBe(137600n)
})
test("uncertain native request is never retried", async () => {
  let calls = 0
  const client = createGeminiOutfitClient({ apiKey: "test", fetch: async () => { calls++; throw new Error("network") } })
  const photo = { bytes: new Uint8Array([1]), mime: "image/png" }
  expect((await client.generate({ person: photo, garments: [{ ...photo, category: "Upper body" }] })).kind).toBe("unknown")
  expect(calls).toBe(1)
})
test("shorts are not forced to trouser length and an outer jacket is distinct from a shirt", async () => {
  let prompt=""
  const client=createGeminiOutfitClient({apiKey:"test",fetch:async (_url,init)=>{prompt=JSON.parse(String(init?.body)).contents[0].parts[0].text;return new Response(null,{status:400})}})
  const photo={bytes:new Uint8Array([1]),mime:"image/png"}
  await client.generate({person:photo,garments:[{...photo,category:"Lower body",garmentType:"bottoms",slot:"lower"},{...photo,category:"Upper body",garmentType:"jackets",slot:"outer"}]})
  expect(prompt).not.toContain("full trouser length")
  expect(prompt).not.toContain("For trousers preserve")
  expect(prompt).toContain("worn over the inner shirt/top")
})

test("quota diagnostics preserve only allowlisted fields without retrying", async () => {
  let calls=0
  const client=createGeminiOutfitClient({apiKey:"secret",fetch:async()=>{calls++;return Response.json({error:{message:"private secret",status:"RESOURCE_EXHAUSTED",details:[{"@type":"type.googleapis.com/google.rpc.QuotaFailure",violations:[{quotaMetric:"generativelanguage.googleapis.com/generate_content_free_tier_requests",quotaId:"GenerateRequestsPerDayPerProjectPerModel-FreeTier",quotaValue:"0",description:"private",quotaDimensions:{project:"private"}}]},{"@type":"type.googleapis.com/google.rpc.RetryInfo",retryDelay:"42s"}]}},{status:429})}})
  const photo={bytes:new Uint8Array([1]),mime:"image/png"}
  const result=await client.generate({person:photo,garments:[{...photo,category:"Upper body"}]})
  expect(result).toMatchObject({kind:"rejected",diagnostic:{status:"RESOURCE_EXHAUSTED",retryDelay:"42s",quotas:[{metric:"generativelanguage.googleapis.com/generate_content_free_tier_requests",id:"GenerateRequestsPerDayPerProjectPerModel-FreeTier",value:"0"}]}})
  expect(JSON.stringify(result)).not.toContain("private")
  expect(calls).toBe(1)
})
