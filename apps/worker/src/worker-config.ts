import { resolve } from "node:path"
import {
  FAL_FASHN_MODEL, findPrice, isSupportedFalModel,
  type FalFashnMode, type FalTryOnModel, type PerImagePrice, type SegmindCategory,
} from "@stylai/ai"
import { defaultLocalStoreDir } from "@stylai/supabase"
import { defaultEngineConfig, type EngineConfig } from "./engine.js"

export interface WorkerRuntimeConfig {
  engine: Omit<EngineConfig, "pseudonymKey"> & { pseudonymKey: string | null }
  /** Active server-side try-on provider ("segmind" default preserves existing integration). */
  provider: "segmind" | "fal" | "gemini"
  /** Paid provider dispatch requires an explicit opt-in, independent of the key. */
  paidCallsEnabled: boolean
  /** simulated: base URL is a loopback simulator (dev/test only); never a paid call. */
  segmind: { apiKey: string | null; model: string; baseUrl: string; simulated: boolean }
  gemini: { apiKey: string | null }
  fal: { apiKey: string | null; model: FalTryOnModel; baseUrl: string; simulated: boolean; fashnMode: FalFashnMode }
  objectStore: { kind: "local"; dir: string } | { kind: "supabase" }
  photoRelay: "none" | "cloudflared"
  pollIdleMs: number
}

/** Reads names only; values are never logged. Errors name the variable, not its content. */
export function readWorkerConfig(env: Record<string, string | undefined>, cwd = process.cwd()): WorkerRuntimeConfig {
  const environment = (env.STYLAI_ENVIRONMENT ?? (env.NODE_ENV === "production" ? "production" : env.NODE_ENV === "test" ? "test" : "development"))
  if (!["development", "test", "staging", "production"].includes(environment)) throw new Error("Invalid STYLAI_ENVIRONMENT")
  const providerRaw = env.STYLAI_TRYON_PROVIDER?.trim() || "segmind"
  if (providerRaw !== "segmind" && providerRaw !== "fal" && providerRaw !== "gemini") throw new Error("Invalid STYLAI_TRYON_PROVIDER")
  const provider: "segmind" | "fal" | "gemini" = providerRaw
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
  const segmindSimulated = base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname)
  if (!segmindSimulated && base.origin !== "https://api.segmind.com") throw new Error("SEGMIND_BASE_URL must be the official API or a loopback simulator")
  if (segmindSimulated && (environment === "production" || environment === "staging")) throw new Error("The Segmind simulator is only allowed in development/test")

  const falModelRaw = env.FAL_MODEL?.trim() || FAL_FASHN_MODEL
  if (!isSupportedFalModel(falModelRaw)) throw new Error("Invalid FAL_MODEL")
  const falBaseRaw = env.FAL_BASE_URL?.trim() || "https://queue.fal.run"
  let falBase: URL
  try { falBase = new URL(falBaseRaw) } catch { throw new Error("Invalid FAL_BASE_URL") }
  const falSimulated = falBase.protocol === "http:" && ["127.0.0.1", "localhost"].includes(falBase.hostname)
  if (!falSimulated && falBase.origin !== "https://queue.fal.run") throw new Error("FAL_BASE_URL must be the official queue API or a loopback simulator")
  if (falSimulated && (environment === "production" || environment === "staging")) throw new Error("The fal simulator is only allowed in development/test")
  const falFashnModeRaw = env.FAL_FASHN_MODE?.trim() || "balanced"
  if (falFashnModeRaw !== "performance" && falFashnModeRaw !== "balanced" && falFashnModeRaw !== "quality") throw new Error("Invalid FAL_FASHN_MODE")
  const falPrice = findPrice("fal", falModelRaw) as PerImagePrice | undefined
  const defaultFalReserve = falPrice ? Number(falPrice.perImageMicros) : 75_000
  const falReserve = BigInt(int("FAL_RESERVE_USD_MICROS", defaultFalReserve, 1, 5_000_000))

  const paidCallsEnabled = env.STYLAI_PAID_CALLS_ENABLED === "true"
  const segmindApiKey = env.SEGMIND_API_KEY?.trim() || null
  const falApiKey = env.FAL_API_KEY?.trim() || null
  const activeSimulated = provider === "gemini" ? false : provider === "fal" ? falSimulated : segmindSimulated
  const activeApiKey = provider === "gemini" ? env.GEMINI_API_KEY?.trim() : provider === "fal" ? falApiKey : segmindApiKey
  const pilotId = env.STYLAI_PILOT_ID?.trim() || null
  if (pilotId !== null && !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(pilotId)) throw new Error("Invalid STYLAI_PILOT_ID")
  if (paidCallsEnabled && !activeSimulated && activeApiKey && !pilotId) {
    throw new Error("STYLAI_PILOT_ID is required when STYLAI_PAID_CALLS_ENABLED=true with a real provider key")
  }
  const requestedRetries = int("SEGMIND_SUBMIT_RETRIES", 0, 0, 2)
  return {
    provider,
    engine: {
      ...defaultEngineConfig,
      provider,
      environment: environment as EngineConfig["environment"],
      pseudonymKey,
      telemetryEnvironment: env.LANGFUSE_TRACING_ENVIRONMENT?.trim() || environment,
      simulatedProvider: activeSimulated,
      pilotId,
      categoryMap,
      segmindReserveMicros: reserve,
      falReserveMicros: falReserve,
      preset: {
        numInferenceSteps: int("SEGMIND_STEPS", defaultEngineConfig.preset.numInferenceSteps, 20, 100),
        guidanceScale: Number(env.SEGMIND_GUIDANCE ?? defaultEngineConfig.preset.guidanceScale),
        seed: int("SEGMIND_SEED", defaultEngineConfig.preset.seed, -1, 999_999_999),
      },
      pollTimeoutMs: int("SEGMIND_POLL_TIMEOUT_MS", defaultEngineConfig.pollTimeoutMs, 10_000, 900_000),
      // Never retry paid submissions automatically (Segmind or fal) in real/pilot mode.
      submitRetries: pilotId || !activeSimulated ? 0 : requestedRetries,
    },
    paidCallsEnabled,
    gemini: { apiKey: env.GEMINI_API_KEY?.trim() || null },
    segmind: {
      apiKey: segmindApiKey,
      model: env.SEGMIND_MODEL?.trim() || (segmindSimulated ? "try-on-diffusion" : "flux-3-klein-image-edit"),
      baseUrl: base.origin,
      simulated: segmindSimulated,
    },
    fal: {
      apiKey: falApiKey,
      model: falModelRaw,
      baseUrl: falBase.origin,
      simulated: falSimulated,
      fashnMode: falFashnModeRaw,
    },
    objectStore: storeKind === "local" ? { kind: "local", dir: env.STYLAI_LOCAL_STORE_DIR ? resolve(cwd, env.STYLAI_LOCAL_STORE_DIR) : defaultLocalStoreDir(cwd) } : { kind: "supabase" },
    photoRelay: env.STYLAI_PHOTO_RELAY === "cloudflared" ? "cloudflared" : "none",
    pollIdleMs: int("WORKER_POLL_IDLE_MS", 2_000, 100, 60_000),
  }
}
