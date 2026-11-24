import { NO_FILTERS, type SearchFilters } from "../lib/filters"

const KEY = "stylai-search-filters"
/** Kept for this browser tab only. */
export function readFilters(): SearchFilters {
  try {
    const raw: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null")
    if (typeof raw !== "object" || raw === null) return NO_FILTERS
    const o = raw as Record<string, unknown>
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null)
    return { audience: o.audience === "feminino" || o.audience === "masculino" ? o.audience : null, minPieceBrl: n(o.minPieceBrl), maxPieceBrl: n(o.maxPieceBrl), maxTotalBrl: n(o.maxTotalBrl), minRatingPercent: n(o.minRatingPercent), minSales: n(o.minSales) }
  } catch {
    return NO_FILTERS
  }
}
export function storeFilters(f: SearchFilters): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify(f)) } catch { /* Storage blocked: they last for this visit. */ }
}
