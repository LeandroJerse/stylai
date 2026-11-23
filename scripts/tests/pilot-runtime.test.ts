import { expect, test } from "bun:test"
import { planPilotRuntime } from "../pilot-runtime.mjs"

const rootEnv = { SEGMIND_API_KEY: "seg-secret-value", SEGMIND_MODEL: "try-on-diffusion", ANTHROPIC_API_KEY: "ant-secret-value", GEMINI_API_KEY: "g", UNRELATED: "x" }

test("real pilot plan: Segmind only to the worker, Haiku composer only to the API, no other names leak", () => {
  const plan = planPilotRuntime({ argv: ["--real", "--pilot=stylai-first-real-tryon-pilot", "--relay=cloudflared", "--composer", "--catalog=aliexpress_affiliate"], rootEnv })
  expect(plan.ok).toBe(true)
  expect(plan.worker).toMatchObject({ SEGMIND_API_KEY: "seg-secret-value", STYLAI_TRYON_PROVIDER: "segmind", STYLAI_PAID_CALLS_ENABLED: "true", STYLAI_PILOT_ID: "stylai-first-real-tryon-pilot", STYLAI_PHOTO_RELAY: "cloudflared", SEGMIND_SUBMIT_RETRIES: "0" })
  expect(plan.worker.ANTHROPIC_API_KEY).toBeUndefined()
  expect(plan.api).toMatchObject({ STYLAI_COMPOSER_ENABLED: "true", STYLAI_COMPOSER_MODEL: "claude-haiku-5-5", ANTHROPIC_API_KEY: "ant-secret-value", STYLAI_CATALOG_MODE: "aliexpress_affiliate", STYLAI_GENERATION_MODE: "real" })
  expect(plan.api.SEGMIND_API_KEY).toBeUndefined()
  expect([plan.api, plan.worker].some((e) => "GEMINI_API_KEY" in e || "UNRELATED" in e)).toBe(false)
  expect(plan.keepData).toBe(true)
  // The printable report has names and presence only.
  expect(JSON.stringify(plan.report)).not.toMatch(/secret-value/)
})

test("fails closed: real without pilot, unknown catalog, composer without key", () => {
  expect(planPilotRuntime({ argv: ["--real"], rootEnv }).errors).toContain("--real requires --pilot=<id>")
  expect(planPilotRuntime({ argv: ["--catalog=shein"], rootEnv }).errors).toContain("unknown catalog mode")
  expect(planPilotRuntime({ argv: ["--composer"], rootEnv: {} }).errors).toContain("ANTHROPIC_API_KEY missing for --composer")
  expect(planPilotRuntime({ argv: ["--real", "--pilot=p1"], rootEnv: {} }).errors).toContain("SEGMIND_API_KEY missing for --real")
})

test("simulation by default (no paid flag), composer model override allowed", () => {
  const plan = planPilotRuntime({ argv: ["--composer=claude-sonnet-5-5"], rootEnv })
  expect(plan.worker.STYLAI_PAID_CALLS_ENABLED).toBeUndefined()
  expect(plan.api).toMatchObject({ STYLAI_GENERATION_MODE: "simulated", STYLAI_COMPOSER_MODEL: "claude-sonnet-5-5" })
})
