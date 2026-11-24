/**
 * Purchase filters of a search (browser-safe, deterministic). Hard limits chosen by the person: a listing that does not
 * state the value (price, rating, sales) does not satisfy a filter on it, and the reason is always counted.
 */
import type { CompositionIntent } from "./composition.js"
import type { OutfitSlot } from "./outfits.js"
import { audienceOfName } from "./outfits.js"

export interface OutfitFilters {
  audience: "feminino" | "masculino" | null
  /** BRL per piece. */
  minPieceBrl: number | null
  maxPieceBrl: number | null
  /** BRL for the whole outfit. */
  maxTotalBrl: number | null
  /** Positive feedback as the store publishes it (percentage, never stars). */
  minRatingPercent: number | null
  minSales: number | null
}
export const NO_FILTERS: OutfitFilters = { audience: null, minPieceBrl: null, maxPieceBrl: null, maxTotalBrl: null, minRatingPercent: null, minSales: null }
export const MAX_FILTER_BRL = 100_000
export const FILTER_REASONS = ["filter_audience", "filter_price", "filter_rating", "filter_rating_missing", "filter_sales"] as const
export type FilterReason = (typeof FILTER_REASONS)[number]
export interface FilterableListing { slot: OutfitSlot | null; name: string; priceMinor: number | null; ratingPercent?: number | null; recentSales?: number | null }

const amount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_FILTER_BRL ? Math.round(v * 100) / 100 : null)
/** Anything malformed is dropped (never widened into another filter); an inverted range is read in order. */
export function normalizeFilters(raw: unknown): OutfitFilters {
  const o = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
  const a = amount(o.minPieceBrl), b = amount(o.maxPieceBrl)
  const rating = typeof o.minRatingPercent === "number" && o.minRatingPercent > 0 && o.minRatingPercent <= 100 ? o.minRatingPercent : null
  const sales = typeof o.minSales === "number" && Number.isSafeInteger(o.minSales) && o.minSales > 0 && o.minSales <= 1_000_000 ? o.minSales : null
  return {
    audience: o.audience === "feminino" || o.audience === "masculino" ? o.audience : null,
    minPieceBrl: a !== null && b !== null ? Math.min(a, b) : a, maxPieceBrl: a !== null && b !== null ? Math.max(a, b) : b,
    maxTotalBrl: amount(o.maxTotalBrl), minRatingPercent: rating, minSales: sales,
  }
}
export const countFilters = (f: OutfitFilters): number =>
  (f.audience ? 1 : 0) + (f.minPieceBrl !== null || f.maxPieceBrl !== null ? 1 : 0) + (f.maxTotalBrl !== null ? 1 : 0) + (f.minRatingPercent !== null ? 1 : 0) + (f.minSales !== null ? 1 : 0)

/** Audience and total budget are understood by the whole flow (queries, agent, validation). */
export function applyFiltersToIntent(intent: CompositionIntent, f: OutfitFilters): CompositionIntent {
  const total = f.maxTotalBrl === null ? intent.budgetTotalBrl : intent.budgetTotalBrl === null || intent.budgetMode !== "require" ? f.maxTotalBrl : Math.min(intent.budgetTotalBrl, f.maxTotalBrl)
  return { ...intent, audience: f.audience ?? intent.audience, budgetTotalBrl: total, budgetMode: f.maxTotalBrl === null ? intent.budgetMode : "require" }
}

/** Why a listing is outside the filters (null = inside). A complete set sold in one listing counts as two pieces. */
export function filterConflict(f: OutfitFilters, x: FilterableListing): FilterReason | null {
  if (f.audience) { const named = audienceOfName(x.name); if (named !== null && named !== f.audience) return "filter_audience" }
  if (f.minPieceBrl !== null || f.maxPieceBrl !== null) {
    const pieces = x.slot === "set" ? 2 : 1
    if (x.priceMinor === null) return "filter_price"
    if (f.maxPieceBrl !== null && x.priceMinor > Math.round(f.maxPieceBrl * 100) * pieces) return "filter_price"
    if (f.minPieceBrl !== null && x.priceMinor < Math.round(f.minPieceBrl * 100) * pieces) return "filter_price"
  }
  if (f.minRatingPercent !== null) {
    if (x.ratingPercent === null || x.ratingPercent === undefined) return "filter_rating_missing"
    if (x.ratingPercent < f.minRatingPercent) return "filter_rating"
  }
  if (f.minSales !== null && (x.recentSales ?? 0) < f.minSales) return "filter_sales"
  return null
}
