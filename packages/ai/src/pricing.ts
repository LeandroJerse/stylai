/**
 * Versioned published prices, in integer USD micros (1 USD = 1_000_000).
 * Each entry records where and when it was checked. A price is evidence for a
 * computed cost, never a provider confirmation. Update by adding a new version.
 */
export type Provider = "anthropic" | "gemini" | "segmind"

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

export type PriceEntry = TokenPrice | GpuSecondPrice

export const priceTable: readonly PriceEntry[] = [
  {
    kind: "tokens", provider: "anthropic", model: "claude-haiku-5-5", priceVersion: "anthropic-haiku-5-5-2026-11-20",
    inputPerMTok: 100_000n, outputPerMTok: 500_000n, maxPromptTokens: 100_000,
    source: "Anthropic models overview (claude-api skill models.md, 2026-11-20): $0.10/$0.50 per MTok up to 100K prompt tokens",
    checkedAt: "2026-11-20",
  },
  {
    kind: "gpu_seconds", provider: "segmind", model: "try-on-diffusion", priceVersion: "segmind-try-on-diffusion-2026-11-20",
    perGpuSecond: 7_200n,
    source: "https://www.segmind.com/models/try-on-diffusion/pricing (serverless $0.0072 per GPU second, read 2026-11-20)",
    checkedAt: "2026-11-20",
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

/** Formats micros for humans; never use the result for arithmetic. */
export function formatUsd(micros: bigint): string {
  const negative = micros < 0n
  const abs = negative ? -micros : micros
  const whole = abs / 1_000_000n
  const frac = (abs % 1_000_000n).toString().padStart(6, "0")
  return `${negative ? "-" : ""}US$${whole}.${frac}`
}
