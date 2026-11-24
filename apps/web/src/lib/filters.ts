/** Purchase filters of the Estúdio search: what is typed, what is sent, and how it reads on screen. */
export interface SearchFilters {
  audience: "feminino" | "masculino" | null
  minPieceBrl: number | null
  maxPieceBrl: number | null
  maxTotalBrl: number | null
  /** Positive feedback as the store publishes it (percentage, never stars). */
  minRatingPercent: number | null
  minSales: number | null
}
export const NO_FILTERS: SearchFilters = { audience: null, minPieceBrl: null, maxPieceBrl: null, maxTotalBrl: null, minRatingPercent: null, minSales: null }
export type FilterId = "audience" | "price" | "total" | "rating" | "sales"
export const FILTER_IDS: readonly FilterId[] = ["audience", "price", "total", "rating", "sales"]
const MAX_BRL = 100_000

/** "1.234,56", "R$ 80", "79.9" -> number; anything else is null. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/r\$|\s/gi, "")
  if (!/^\d[\d.,]*$/.test(t)) return null
  const comma = t.includes(",")
  const thousands = !comma && /^\d{1,3}(\.\d{3})+$/.test(t)
  const n = Number(comma ? t.replace(/\./g, "").replace(",", ".") : thousands ? t.replace(/\./g, "") : t)
  return Number.isFinite(n) && n > 0 && n <= MAX_BRL ? Math.round(n * 100) / 100 : null
}

/** Only what this server offers and what is really set; null when there is nothing to send. */
export function filtersToSend(f: SearchFilters, offered: readonly FilterId[]): Partial<SearchFilters> | null {
  const out: Partial<SearchFilters> = {}
  if (offered.includes("audience") && f.audience) out.audience = f.audience
  if (offered.includes("price")) {
    const [a, b] = [f.minPieceBrl, f.maxPieceBrl]
    if (a !== null && b !== null) { out.minPieceBrl = Math.min(a, b); out.maxPieceBrl = Math.max(a, b) }
    else if (a !== null) out.minPieceBrl = a
    else if (b !== null) out.maxPieceBrl = b
  }
  if (offered.includes("total") && f.maxTotalBrl !== null) out.maxTotalBrl = f.maxTotalBrl
  if (offered.includes("rating") && f.minRatingPercent !== null) out.minRatingPercent = f.minRatingPercent
  if (offered.includes("sales") && f.minSales !== null) out.minSales = f.minSales
  return Object.keys(out).length ? out : null
}

const brl = (n: number): string => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`
/** Short labels of the active filters, in a fixed order. */
export function filterLabels(f: Partial<SearchFilters> | null): string[] {
  if (!f) return []
  const out: string[] = []
  if (f.audience) out.push(f.audience === "feminino" ? "Feminino" : "Masculino")
  const min = f.minPieceBrl ?? null, max = f.maxPieceBrl ?? null
  if (min !== null && max !== null) out.push(`${brl(min)} a ${brl(max)} por peça`)
  else if (max !== null) out.push(`até ${brl(max)} por peça`)
  else if (min !== null) out.push(`a partir de ${brl(min)} por peça`)
  if (f.maxTotalBrl) out.push(`look até ${brl(f.maxTotalBrl)}`)
  if (f.minRatingPercent) out.push(`nota ${f.minRatingPercent}%+`)
  if (f.minSales) out.push(`${f.minSales}+ vendas`)
  return out
}

export interface FilterReport { price: number; rating: number; ratingMissing: number; sales: number; audience: number }
/** "Seus filtros tiraram 12 anúncios: 8 pelo preço e 4 sem nota." */
export function filterReportText(r: FilterReport): string | null {
  const parts = [
    [r.price, "pelo preço"], [r.ratingMissing, "sem nota na loja"], [r.rating, "pela nota"], [r.sales, "pelas vendas"], [r.audience, "pelo público"],
  ].filter(([n]) => (n as number) > 0).map(([n, why]) => `${n} ${why}`)
  const total = r.price + r.rating + r.ratingMissing + r.sales + r.audience
  if (!total) return null
  return `Seus filtros tiraram ${total} ${total === 1 ? "anúncio" : "anúncios"}: ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}` : parts[0]}.`
}
