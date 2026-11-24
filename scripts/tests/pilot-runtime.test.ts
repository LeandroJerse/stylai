import { expect, test } from "bun:test"
import { planPilotRuntime } from "../pilot-runtime.mjs"

const rootEnv = { SEGMIND_API_KEY: "seg-secret-value", SEGMIND_MODEL: "try-on-diffusion", ANTHROPIC_API_KEY: "ant-secret-value", GEMINI_API_KEY: "g", UNRELATED: "x" }
test("native Gemini uses only its worker key and informs the API of the same provider", () => {
  const plan=planPilotRuntime({argv:["--real","--provider=gemini","--pilot=existing-pilot"],rootEnv})
  expect(plan.ok).toBe(true)
  expect(plan.worker.GEMINI_API_KEY).toBe("g")
  expect(plan.worker.SEGMIND_API_KEY).toBeUndefined()
  expect(plan.api.STYLAI_TRYON_PROVIDER).toBe("gemini")
  expect(plan.api.GEMINI_API_KEY).toBeUndefined()
  expect(planPilotRuntime({argv:["--provider=gemini"],rootEnv}).ok).toBe(false)
})

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

test("Segmind Pro model is consistent between API and worker without leaking its key",()=>{
 const plan=planPilotRuntime({argv:["--real","--provider=segmind","--segmind-model=nano-banana-pro","--pilot=existing-pilot","--relay=cloudflared"],rootEnv})
 expect(plan.ok).toBe(true)
 expect(plan.api.SEGMIND_MODEL).toBe("nano-banana-pro")
 expect(plan.worker.SEGMIND_MODEL).toBe("nano-banana-pro")
 expect(plan.api.SEGMIND_API_KEY).toBeUndefined()
 expect(planPilotRuntime({argv:["--segmind-model=nano-banana-pro"],rootEnv}).ok).toBe(false)
})

test("Vertex mode requires project and isolated credential, sends public config to both processes",()=>{
 const argv=["--real","--provider=gemini","--google-backend=vertex","--google-project=stylai-test","--pilot=existing-pilot"]
 const plan=planPilotRuntime({argv,rootEnv:{...rootEnv,VERTEX_API_KEY:"vertex-secret"}})
 expect(plan.ok).toBe(true)
 expect(plan.worker.GEMINI_API_KEY).toBe("vertex-secret")
 expect(plan.api.GOOGLE_CLOUD_PROJECT).toBe("stylai-test")
 expect(plan.worker.GOOGLE_CLOUD_PROJECT).toBe("stylai-test")
 expect(plan.worker.STYLAI_GOOGLE_BACKEND).toBe("vertex")
 expect(JSON.stringify(plan.api)).not.toContain("vertex-secret")
 expect(JSON.stringify(plan.report)).not.toContain("vertex-secret")
 expect(planPilotRuntime({argv,rootEnv}).ok).toBe(false)
 expect(planPilotRuntime({argv:argv.filter(a=>!a.startsWith("--google-project")),rootEnv:{VERTEX_API_KEY:"v"}}).ok).toBe(false)
})

test("real default selects FLUX consistently while simulation stays local", () => {
  const plan = planPilotRuntime({ argv: ["--real", "--pilot=existing-pilot"], rootEnv })
  expect(plan.ok).toBe(true)
  expect(plan.api.SEGMIND_MODEL).toBe("flux-3-klein-image-edit")
  expect(plan.worker.SEGMIND_MODEL).toBe("flux-3-klein-image-edit")
  expect(planPilotRuntime({ argv: [], rootEnv }).api.SEGMIND_MODEL).toBe("try-on-diffusion")
})
