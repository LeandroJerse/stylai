/**
 * Helpers on preference rules (shape from the API). Pure UI logic: the search itself runs on the
 * server; this only summarises rules and builds the "relax one criterion" request.
 */
import type { PreferenceRules } from "../api/types"
import { formatMoney, formatRating, plural } from "./format"

export function summarizeRules(rules: PreferenceRules, currency = "BRL"): string {
  const parts: string[] = []
  if (rules.minRating.mode !== "off") parts.push(`${rules.minRating.mode === "require" ? "Exige" : "Prefere"} nota ★ ${formatRating(rules.minRating.value)} ou mais`)
  if (rules.minReviews.mode !== "off") parts.push(`≥ ${plural(rules.minReviews.value, "avaliação", "avaliações")}`)
  if (rules.budget.mode !== "off") parts.push(`até ${formatMoney(rules.budget.value, currency)}/${rules.budget.scope === "look" ? "look" : "peça"}`)
  if (rules.excludedPartners.length) parts.push(plural(rules.excludedPartners.length, "loja excluída", "lojas excluídas"))
  if (rules.onlyAvailableSize) parts.push("só meu tamanho")
  return parts.length ? parts.join(" · ") : "Sem exigências"
}

/**
 * Copy of the rules with one limiting criterion switched off. Criterion ids come from the API
 * (`Job.limiting[].id`, docs/API-CONTRACT.md). Unknown ids return null: the UI then offers no relax.
 */
export function relaxRule(rules: PreferenceRules, id: string): PreferenceRules | null {
  const next = structuredClone(rules)
  switch (id) {
    case "rating":
      next.minRating.mode = "off"
      next.missingRating = "warn"
      return next
    case "reviews":
      next.minReviews.mode = "off"
      return next
    case "partners":
      next.excludedPartners = []
      return next
    case "size":
      next.onlyAvailableSize = false
      return next
    case "budget":
      next.budget.mode = "off"
      return next
    case "sellerRating":
      next.advanced.sellerRating.mode = "off"
      return next
    case "delivery":
      next.advanced.maxDeliveryDays.mode = "off"
      return next
    case "colors":
      next.advanced.avoidColors = []
      return next
    case "fit":
      next.advanced.fit.mode = "off"
      return next
    default:
      return null
  }
}

export const sameRules = (a: PreferenceRules, b: PreferenceRules): boolean => JSON.stringify(a) === JSON.stringify(b)
