import { describe, expect, test } from "bun:test"
import {
  buildFalPayload, createFalClient, FAL_FASHN_MODEL, FAL_IMAGE_APPS_MODEL, falCost, falQueueAppBase,
  findPrice, isAllowedFalOutputUrl, mapCategoryToFashn, parseFalResult, perImageCostMicros,
  type PerImagePrice,
} from "../src/index"

describe("fal.ai virtual try-on adapters (zero paid calls)", () => {
  test("published fixed per-image prices for both fal models are exact integer micros", () => {
    const fashn = findPrice("fal", FAL_FASHN_MODEL) as PerImagePrice
    const imageApps = findPrice("fal", FAL_IMAGE_APPS_MODEL) as PerImagePrice
    expect(fashn.kind).toBe("per_image")
    expect(fashn.perImageMicros).toBe(75_000n)
    expect(perImageCostMicros(fashn, 1)).toBe(75_000n)
    expect(perImageCostMicros(fashn, 5)).toBe(375_000n)
    expect(falCost(fashn, "completed", 1)).toEqual({ computed: 75_000n, source: "computed_from_usage" })
    expect(falCost(fashn, "failed", 0)).toEqual({ computed: 0n, source: "computed_from_usage" })

    expect(imageApps.kind).toBe("per_image")
    expect(imageApps.perImageMicros).toBe(40_000n)
    expect(perImageCostMicros(imageApps, 1)).toBe(40_000n)
    expect(perImageCostMicros(imageApps, 5)).toBe(200_000n)
    expect(falCost(imageApps, "completed", 1)).toEqual({ computed: 40_000n, source: "computed_from_usage" })
    expect(perImageCostMicros(imageApps, -1)).toBeNull()
  })

  test("payloads strictly match official schemas and fix 1 image per call", () => {
    expect(mapCategoryToFashn("Upper body")).toBe("tops")
    expect(mapCategoryToFashn("Lower body")).toBe("bottoms")
    expect(mapCategoryToFashn("Dress")).toBe("one-pieces")

    const fashnBody = buildFalPayload(
      { model: FAL_FASHN_MODEL, fashnMode: "balanced" },
      { requestKey: "gen_0123456789abcdef_1", modelImageUrl: "https://relay.example/m.jpg", clothImageUrl: "https://cat.example/c.jpg", category: "Upper body" },
    )
    expect(fashnBody).toEqual({
      model_image: "https://relay.example/m.jpg",
      garment_image: "https://cat.example/c.jpg",
      category: "tops",
      garment_photo_type: "auto",
      mode: "balanced",
      num_samples: 1,
    })

    const imageAppsBody = buildFalPayload(
      { model: FAL_IMAGE_APPS_MODEL },
      { requestKey: "gen_0123456789abcdef_2", modelImageUrl: "https://relay.example/m.jpg", clothImageUrl: "https://cat.example/c.jpg", category: "Upper body" },
    )
    expect(imageAppsBody).toEqual({
      person_image_url: "https://relay.example/m.jpg",
      clothing_image_url: "https://cat.example/c.jpg",
      preserve_pose: true,
      aspect_ratio: "3:4",
    })
    expect("num_samples" in imageAppsBody).toBe(false)
    expect("num_images" in imageAppsBody).toBe(false)
  })

  test("queue subpath stripping, auth header, submit classification, and poll lifecycle", async () => {
    expect(falQueueAppBase(FAL_FASHN_MODEL)).toBe("fal-ai/fashn")
    expect(falQueueAppBase(FAL_IMAGE_APPS_MODEL)).toBe("fal-ai/image-apps-v2")

    const calls: Array<{ url: string; method: string; auth: string | null; body?: unknown }> = []
    let pollStep = 0
    const client = createFalClient({
      apiKey: "fal_secret_test",
      model: FAL_FASHN_MODEL,
      baseUrl: "https://queue.fal.test",
      fetch: async (url, init) => {
        const hdrs = new Headers(init?.headers)
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          auth: hdrs.get("authorization"),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })
        if (init?.method === "POST") {
          return Response.json({
            status: "IN_QUEUE",
            request_id: "req-fal-001",
            status_url: "https://queue.fal.test/fal-ai/fashn/requests/req-fal-001/status",
            response_url: "https://queue.fal.test/fal-ai/fashn/requests/req-fal-001",
          })
        }
        if (String(url).endsWith("/status")) {
          pollStep++
          if (pollStep === 1) return Response.json({ status: "IN_QUEUE", queue_position: 2 })
          if (pollStep === 2) return Response.json({ status: "IN_PROGRESS" })
          return Response.json({ status: "COMPLETED" })
        }
        return Response.json({ images: [{ url: "https://v3b.fal.media/files/out.png", width: 768, height: 1024 }] })
      },
    })

    const sub = await client.submit({
      requestKey: "gen_0123456789abcdef_1",
      modelImageUrl: "https://relay.example/person.jpg",
      clothImageUrl: "https://cat.example/shirt.jpg",
      category: "Upper body",
    })
    expect(sub).toEqual({ kind: "accepted", requestId: "req-fal-001" })
    expect(calls[0]?.url).toBe("https://queue.fal.test/fal-ai/fashn/tryon/v1.6")
    expect(calls[0]?.auth).toBe("Key fal_secret_test")
    expect((calls[0]?.body as Record<string, unknown>)?.num_samples).toBe(1)

    expect(await client.poll("req-fal-001")).toEqual({ kind: "pending", status: "QUEUED" })
    expect(await client.poll("req-fal-001")).toEqual({ kind: "pending", status: "PROCESSING" })
    const done = await client.poll("req-fal-001")
    expect(done).toEqual({
      kind: "completed",
      result: { image: { kind: "url", url: "https://v3b.fal.media/files/out.png" }, metrics: { inferenceTime: undefined } },
    })

    // Cold poll without cached submit URLs uses canonical subpath-stripped route for ImageApps too.
    const coldUrls: string[] = []
    const coldImageApps = createFalClient({
      apiKey: "fal_secret_test",
      model: FAL_IMAGE_APPS_MODEL,
      baseUrl: "https://queue.fal.test",
      fetch: async (url) => {
        coldUrls.push(String(url))
        return Response.json({ status: "FAILED" })
      },
    })
    expect(await coldImageApps.poll("req-cold-99")).toEqual({ kind: "failed", metrics: {} })
    expect(coldUrls).toEqual(["https://queue.fal.test/fal-ai/image-apps-v2/requests/req-cold-99/status"])
  })

  test("submit error mapping and SSRF guards", async () => {
    const make = (impl: () => Promise<Response>) => createFalClient({
      apiKey: "k",
      model: FAL_IMAGE_APPS_MODEL,
      baseUrl: "https://queue.fal.test",
      fetch: impl,
    })
    const input = { requestKey: "gen_0123456789abcdef_3", modelImageUrl: "https://s/x", clothImageUrl: "https://s/y", category: "Upper body" as const }
    expect(await make(async () => new Response("{}", { status: 402 })).submit(input)).toEqual({ kind: "rejected", httpStatus: 402, code: "insufficient_credits" })
    expect(await make(async () => new Response("{}", { status: 422 })).submit(input)).toEqual({ kind: "rejected", httpStatus: 422, code: "invalid_request" })
    expect(await make(async () => new Response("{}", { status: 429 })).submit(input)).toEqual({ kind: "retryable", httpStatus: 429, code: "rate_limited" })
    expect(await make(async () => new Response("{}", { status: 503 })).submit(input)).toEqual({ kind: "retryable", httpStatus: 503, code: "provider_error" })
    expect(await make(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }) }).submit(input)).toEqual({ kind: "unknown", code: "timeout" })
    expect(await make(async () => Response.json({ ok: true })).submit(input)).toEqual({ kind: "unknown", code: "bad_response" })

    expect(parseFalResult({ images: [{ url: "https://v3.fal.media/files/a.png" }] })?.imageCount).toBe(1)
    expect(parseFalResult({ images: [] })).toBeNull()
    expect(isAllowedFalOutputUrl("https://v3.fal.media/files/a.png")).toBe(true)
    expect(isAllowedFalOutputUrl("https://v3b.fal.media/files/b.png")).toBe(true)
    expect(isAllowedFalOutputUrl("https://fal.media/files/c.png")).toBe(true)
    for (const bad of ["http://v3.fal.media/a.png", "https://fal.media.evil.io/a.png", "https://127.0.0.1/a.png", "https://u:p@v3.fal.media/a.png", "https://v3.fal.media:8443/a.png"]) {
      expect(isAllowedFalOutputUrl(bad)).toBe(false)
    }
  })
})
