/**
 * Versioned published prices, in integer USD micros (1 USD = 1_000_000).
 * Each entry records where and when it was checked. A price is evidence for a
 * computed cost, never a provider confirmation. Update by adding a new version.
 */
export type Provider = "anthropic" | "gemini" | "segmind" | "fal"

export interface TokenPrice {
  kind: "tokens"
  provider: Provider
  model: string
  priceVersion: string
  /** USD micros per million tokens. */
  inputPerMTok: bigint
  outputPerMTok: bigint
  /** Only valid while the prompt stays within this many input tokens. */
  maxPromptTokens?: number
  source: string
  checkedAt: string
}

export interface GpuSecondPrice {
  kind: "gpu_seconds"
  provider: Provider
  model: string
  priceVersion: string
  /** USD micros per billed GPU-second. */
  perGpuSecond: bigint
  source: string
  checkedAt: string
}

export interface PerImagePrice {
  kind: "per_image"
  provider: Provider
  model: string
  priceVersion: string
  /** Fixed USD micros per generated output image. */
  perImageMicros: bigint
  source: string
  checkedAt: string
}

export type PriceEntry = TokenPrice | GpuSecondPrice | PerImagePrice

export const priceTable: readonly PriceEntry[] = [
  {
    kind: "tokens", provider: "anthropic", model: "claude-haiku-5-5", priceVersion: "anthropic-haiku-5-5-2026-11-20",
    inputPerMTok: 100_000n, outputPerMTok: 500_000n, maxPromptTokens: 100_000,
    source: "Anthropic models overview (claude-api skill models.md, 2026-11-20): $0.10/$0.50 per MTok up to 100K prompt tokens",
    checkedAt: "2026-11-20",
  },
  {
    kind: "tokens", provider: "anthropic", model: "claude-opus-5-5", priceVersion: "anthropic-opus-5-5-2026-11-23",
    inputPerMTok: 4_000_000n, outputPerMTok: 20_000_000n,
    source: "Anthropic models table (claude-api skill, cached 2026-11-03): $4/$20 per MTok",
    checkedAt: "2026-11-23",
  },
  {
    kind: "gpu_seconds", provider: "segmind", model: "try-on-diffusion", priceVersion: "segmind-try-on-diffusion-2026-11-20",
    perGpuSecond: 7_200n,
    source: "https://www.segmind.com/models/try-on-diffusion/pricing (serverless $0.0072 per GPU second, read 2026-11-20)",
    checkedAt: "2026-11-20",
  },
  {
    kind: "per_image", provider: "fal", model: "fal-ai/fashn/tryon/v1.6", priceVersion: "fal-fashn-tryon-v1.6-2026-11-21",
    perImageMicros: 75_000n,
    source: "https://fal.ai/models/fal-ai/fashn/tryon/v1.6 ($0.075 fixed per generation/output image, read 2026-11-21)",
    checkedAt: "2026-11-21",
  },
  {
    kind: "per_image", provider: "fal", model: "fal-ai/image-apps-v2/virtual-try-on", priceVersion: "fal-image-apps-v2-vton-2026-11-21",
    perImageMicros: 40_000n,
    source: "https://fal.ai/models/fal-ai/image-apps-v2/virtual-try-on ($0.04 fixed per output image, read 2026-11-21)",
    checkedAt: "2026-11-21",
  },
]

export function findPrice(provider: Provider, model: string): PriceEntry | undefined {
  return priceTable.find((entry) => entry.provider === provider && entry.model === model)
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

/** Returns null when the price does not apply (unknown stays unknown, not zero). */
export function tokenCostMicros(price: TokenPrice, usage: { inputTokens: number; outputTokens: number }): bigint | null {
  const { inputTokens, outputTokens } = usage
  if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens) || inputTokens < 0 || outputTokens < 0) return null
  if (price.maxPromptTokens !== undefined && inputTokens > price.maxPromptTokens) return null
  return ceilDiv(BigInt(inputTokens) * price.inputPerMTok + BigInt(outputTokens) * price.outputPerMTok, 1_000_000n)
}

/** GPU seconds may be fractional; rounded up to the next millisecond, then to a micro. */
export function gpuCostMicros(price: GpuSecondPrice, seconds: number): bigint | null {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86_400) return null
  // Round to whole microseconds first so float noise (8.06*1000=8060.000000000001) cannot add a millisecond.
  const millis = BigInt(Math.ceil(Math.round(seconds * 1_000_000) / 1000))
  return ceilDiv(millis * price.perGpuSecond, 1000n)
}

/** Fixed per-image billing (exact integer micros; unknown/invalid count stays null). */
export function perImageCostMicros(price: PerImagePrice, imageCount: number): bigint | null {
  if (!Number.isSafeInteger(imageCount) || imageCount < 0 || imageCount > 10) return null
  return BigInt(imageCount) * price.perImageMicros
}

/** Formats micros for humans; never use the result for arithmetic. */
export function formatUsd(micros: bigint): string {
  const negative = micros < 0n
  const abs = negative ? -micros : micros
  const whole = abs / 1_000_000n
  const frac = (abs % 1_000_000n).toString().padStart(6, "0")
  return `${negative ? "-" : ""}US$${whole}.${frac}`
}
