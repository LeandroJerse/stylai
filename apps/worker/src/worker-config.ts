import { resolve } from "node:path"
import type { SegmindCategory } from "@stylai/ai"
import { defaultLocalStoreDir } from "@stylai/supabase"
import { defaultEngineConfig, type EngineConfig } from "./engine.js"

export interface WorkerRuntimeConfig {
  engine: Omit<EngineConfig, "pseudonymKey"> & { pseudonymKey: string | null }
  /** Paid provider dispatch requires an explicit opt-in, independent of the key. */
  paidCallsEnabled: boolean
  /** simulated: base URL is a loopback simulator (dev/test only); never a paid call. */
  segmind: { apiKey: string | null; model: string; baseUrl: string; simulated: boolean }
  objectStore: { kind: "local"; dir: string } | { kind: "supabase" }
  pollIdleMs: number
}

/** Reads names only; values are never logged. Errors name the variable, not its content. */
export function readWorkerConfig(env: Record<string, string | undefined>, cwd = process.cwd()): WorkerRuntimeConfig {
  const environment = (env.STYLAI_ENVIRONMENT ?? (env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development"))
  if (!["development", "test", "staging", "production"].includes(environment)) throw new Error("Invalid STYLAI_ENVIRONMENT")
  const int = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(env[name] ?? fallback)
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`)
    return value
  }
  let categoryMap = defaultEngineConfig.categoryMap
  if (env.STYLAI_TRYON_CATEGORY_MAP) {
    const parsed: unknown = JSON.parse(env.STYLAI_TRYON_CATEGORY_MAP)
    const allowed = new Set(["Upper body", "Lower body", "Dress"])
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Object.values(parsed).every((v) => typeof v === "string" && allowed.has(v))) {
      throw new Error("Invalid STYLAI_TRYON_CATEGORY_MAP")
    }
    categoryMap = parsed as Record<string, SegmindCategory>
  }
  const reserve = BigInt(int("SEGMIND_RESERVE_USD_MICROS", Number(defaultEngineConfig.segmindReserveMicros), 1, 5_000_000))
  const pseudonymKey = env.TELEMETRY_PSEUDONYM_KEY ?? null
  if (pseudonymKey !== null && pseudonymKey.length < 32) throw new Error("TELEMETRY_PSEUDONYM_KEY must have at least 32 characters")
  const storeKind = env.STYLAI_OBJECT_STORE ?? "local"
  if (storeKind !== "local" && storeKind !== "supabase") throw new Error("Invalid STYLAI_OBJECT_STORE")
  if (storeKind === "local" && environment === "production") throw new Error("Local object store is not allowed in production")
  const segmindBase = env.SEGMIND_BASE_URL?.trim() || "https://api.segmind.com"
  let base: URL
  try { base = new URL(segmindBase) } catch { throw new Error("Invalid SEGMIND_BASE_URL") }
  const simulated = base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname)
  if (!simulated && base.origin !== "https://api.segmind.com") throw new Error("SEGMIND_BASE_URL must be the official API or a loopback simulator")
  if (simulated && (environment === "production" || environment === "staging")) throw new Error("The Segmind simulator is only allowed in development/test")
  return {
    engine: {
      ...defaultEngineConfig,
      environment: environment as EngineConfig["environment"],
      pseudonymKey,
      telemetryEnvironment: env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || environment,
      simulatedProvider: simulated,
      categoryMap,
      segmindReserveMicros: reserve,
      preset: {
        numInferenceSteps: int("SEGMIND_STEPS", defaultEngineConfig.preset.numInferenceSteps, 20, 100),
        guidanceScale: Number(env.SEGMIND_GUIDANCE ?? defaultEngineConfig.preset.guidanceScale),
        seed: int("SEGMIND_SEED", defaultEngineConfig.preset.seed, -1, 999_999_999),
      },
      pollTimeoutMs: int("SEGMIND_POLL_TIMEOUT_MS", defaultEngineConfig.pollTimeoutMs, 10_000, 900_000),
      // Segmind documents no request deduplication: a re-sent submit after a 5xx could be billed
      // twice. Default 0; raise only with explicit authorization for a batch.
      submitRetries: int("SEGMIND_SUBMIT_RETRIES", 0, 0, 2),
    },
    paidCallsEnabled: env.STYLAI_PAID_CALLS_ENABLED === "true",
    segmind: {
      apiKey: env.SEGMIND_API_KEY?.trim() || null,
      model: env.SEGMIND_MODEL?.trim() || "try-on-diffusion",
      baseUrl: base.origin,
      simulated,
    },
    objectStore: storeKind === "local" ? { kind: "local", dir: env.STYLAI_LOCAL_STORE_DIR ? resolve(cwd, env.STYLAI_LOCAL_STORE_DIR) : defaultLocalStoreDir(cwd) } : { kind: "supabase" },
    pollIdleMs: int("WORKER_POLL_IDLE_MS", 2_000, 100, 60_000),
  }
}
