import { expect, test } from "bun:test"
import { buildApp } from "../src/app"
import { createDevActorResolver } from "../src/modules/studio/routes"
import { readWorkerConfig } from "../../worker/src/worker-config"

test("dev actor is refused outside development/test", () => {
  expect(() => createDevActorResolver({ nodeEnv: "production", devActorId: "10000000-0000-4000-8000-000000000001" })).toThrow()
  expect(() => createDevActorResolver({ nodeEnv: "development", devActorId: "not-a-uuid" })).toThrow()
  expect(createDevActorResolver({ nodeEnv: "development", devActorId: undefined })).toBeNull()
})

test("studio routes stay 503 when the slice is not configured", async () => {
  const app = await buildApp({ appOrigin: "http://localhost:5190" })
  try {
    expect((await app.inject({ method: "POST", url: "/v1/studio/generations", payload: {} })).statusCode).toBe(503)
  } finally { await app.close() }
})

test("worker never enables paid calls implicitly and refuses a local store in production", () => {
  const dev = readWorkerConfig({ SEGMIND_API_KEY: "SG_x" })
  expect(dev.paidCallsEnabled).toBe(false)
  expect(readWorkerConfig({ STYLAI_PAID_CALLS_ENABLED: "true" }).paidCallsEnabled).toBe(true)
  expect(() => readWorkerConfig({ NODE_ENV: "production" })).toThrow()
  expect(() => readWorkerConfig({ TELEMETRY_PSEUDONYM_KEY: "short" })).toThrow()
  expect(() => readWorkerConfig({ STYLAI_TRYON_CATEGORY_MAP: JSON.stringify({ tops: "Full body" }) })).toThrow()
})
