/**
 * Rule-based reading of an Estúdio request and ranking over a catalog, with NO AI call.
 * Browser-safe and dependency-free so the API (POST /v1/studio/searches) and the demo adapter run the
 * exact same rules (QA-013: same query + same catalog = same category/colour/budget filters).
 * Moved from packages/ai/src/interpreter.ts, which re-exports these names for compatibility.
 */

export interface RuleIntent {
  category: string
  garment_type: string
  colors: string[]
  style_tags: string[]
  occasion: string | null
  max_price_brl: number | null
  avoid: string[]
}
export interface RuleInterpretation { intent: RuleIntent; terms: string[] }

const COLORS: Record<string, string[]> = {
  preto: ["preto", "preta", "black"], branco: ["branco", "branca", "off-white", "white"], azul: ["azul", "marinho", "jeans"],
  vermelho: ["vermelho", "vermelha"], verde: ["verde", "oliva"], bege: ["bege", "areia", "nude", "camelo", "caramelo"],
  cinza: ["cinza", "grafite", "chumbo"], rosa: ["rosa", "pink"], amarelo: ["amarelo", "amarela", "mostarda"], marrom: ["marrom", "chocolate", "café"],
}
const STOP = new Set(["de", "da", "do", "das", "dos", "e", "ou", "um", "uma", "com", "sem", "para", "pra", "por", "em", "no", "na", "me", "eu", "quero", "procuro", "vista", "algo", "look", "roupa", "roupas", "peça", "peças", "ate", "até", "r", "reais", "que", "o", "a", "os", "as"])

export const normalizeText = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
/** Singular-ish stem so "blusas" matches "blusa" and "jaquetas" matches "jaqueta". */
const stem = (w: string): string => w.replace(/(oes|aes)$/, "ao").replace(/(es|s)$/, "")

/** Category from the catalog's own ids/labels, colour words, an explicit budget ("até R$ 300") and keywords. */
export function interpretRequestRules(text: string, categories: ReadonlyArray<{ id: string; label: string }>): RuleInterpretation {
  const t = normalizeText(text.slice(0, 500))
  const words = t.split(/[^a-z0-9]+/).filter(Boolean)
  const stems = new Set(words.map(stem))
  const category = categories.find((c) => [c.id, c.label].some((k) => normalizeText(k).split(/[^a-z0-9]+/).filter(Boolean).some((w) => stems.has(stem(w)))))
  const colors = Object.entries(COLORS).filter(([, vs]) => vs.some((v) => stems.has(stem(normalizeText(v))))).map(([k]) => k)
  const budget = /(?:ate|max(?:imo)?|abaixo de|menos de)\s*(?:r\$)?\s*(\d{1,6}(?:[.,]\d{1,2})?)/.exec(t)
  const colourStems = new Set(Object.values(COLORS).flat().map((v) => stem(normalizeText(v))))
  const terms = [...new Set(words.filter((w) => w.length > 2 && !STOP.has(w) && !colourStems.has(stem(w)) && !/^\d/.test(w)).map(stem))]
  return {
    intent: {
      category: category?.id ?? "unknown", garment_type: category?.label ?? "", colors, style_tags: [], occasion: null,
      max_price_brl: budget ? Number(budget[1]!.replace(",", ".")) : null, avoid: [],
    },
    terms,
  }
}

/** Colour tags found in a product name (same vocabulary as the interpreter). */
export function colorTagsOf(name: string): string[] {
  const words = new Set(normalizeText(name).split(/[^a-z0-9-]+/).map(stem))
  return Object.entries(COLORS).filter(([, vs]) => vs.some((v) => words.has(stem(normalizeText(v))))).map(([k]) => k)
}

export interface SearchRow {
  id: string
  name: string
  category: { id: string; label: string } | null
  priceMinor: number | null
  hasAvailableVariant: boolean
  tryOnReady: boolean
}
export interface BudgetRule { value?: number; mode?: "require" | "prefer" | "off" }
export interface CatalogSearchResult {
  interpretation: { category: { id: string; label: string } | null; colors: string[]; maxPriceBrl: number | null; terms: string[] }
  /** Matching rows, best first; `failed` = shown but explained (not hidden). */
  items: { id: string; failed: string[] }[]
}

/** The ranking of POST /v1/studio/searches: category/colour/budget hard filters, then a transparent score. */
export function searchCatalog(prompt: string, rows: readonly SearchRow[], budgetRule?: BudgetRule | null): CatalogSearchResult {
  const categories = [...new Map(rows.filter((r) => r.category).map((r) => [r.category!.id, r.category!])).values()]
  const { intent, terms } = interpretRequestRules(prompt, categories)
  const budget = intent.max_price_brl ?? (budgetRule?.mode && budgetRule.mode !== "off" && typeof budgetRule.value === "number" ? budgetRule.value : null)
  const budgetStrict = intent.max_price_brl !== null || budgetRule?.mode === "require"
  const scored = rows.flatMap((row) => {
    if (intent.category !== "unknown" && row.category?.id !== intent.category) return []
    const haystack = new Set(normalizeText(`${row.name} ${row.category?.label ?? ""}`).split(/[^a-z0-9]+/).map((w) => w.replace(/(es|s)$/, "")))
    const termHits = terms.filter((term) => haystack.has(term)).length
    const colorHits = intent.colors.filter((c) => colorTagsOf(row.name).includes(c)).length
    const score = termHits + 2 * colorHits + (intent.category !== "unknown" ? 3 : 0)
    if (score === 0) return []
    if (intent.colors.length > 0 && colorHits === 0) return []
    const failed: string[] = []
    if (budget !== null) {
      if (row.priceMinor === null) failed.push("Preço não informado")
      else if (row.priceMinor > Math.round(budget * 100)) { if (budgetStrict) return []; failed.push("Acima do orçamento") }
    }
    if (!row.hasAvailableVariant) failed.push("Sem variante disponível")
    if (!row.tryOnReady) failed.push("Sem imagem liberada para prova")
    return [{ id: row.id, failed, score, name: row.name }]
  }).sort((a, b) => a.failed.length - b.failed.length || b.score - a.score || a.name.localeCompare(b.name))
  return {
    interpretation: {
      category: intent.category === "unknown" ? null : categories.find((c) => c.id === intent.category) ?? null,
      colors: intent.colors, maxPriceBrl: budget, terms,
    },
    items: scored.map(({ id, failed }) => ({ id, failed })),
  }
}
