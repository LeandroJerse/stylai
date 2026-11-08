/**
 * Compact, directly editable view of a shopping preference: product rating (★ + value) and a
 * small budget bar. Used by the Estúdio, where it edits only the current search (the Perfil
 * no longer lists preferences). It never opens the advanced editor; callers render their own "Editar".
 */
import { useEffect, useId, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { Star } from "@phosphor-icons/react"
import type { PreferenceRules, RuleMode, StudioConfig } from "../api/types"
import { formatRating } from "../lib/format"
import { plural } from "../lib/format"
import { StarThreshold } from "./controls"
import { Segmented } from "./ui"

const MODES: { id: RuleMode; label: string }[] = [
  { id: "require", label: "Exigir" },
  { id: "prefer", label: "Preferir" },
  { id: "off", label: "Desligado" },
]
const MODE_WORD: Record<RuleMode, string> = { require: "exige", prefer: "prefere", off: "desligado" }

/** Rules other than rating and budget, summarised under the quick controls. */
function summarizeOtherRules(rules: PreferenceRules): string {
  const parts: string[] = []
  if (rules.minReviews.mode !== "off") parts.push(`${rules.minReviews.mode === "require" ? "exige" : "prefere"} ≥ ${plural(rules.minReviews.value, "avaliação", "avaliações")}`)
  if (rules.excludedPartners.length) parts.push(plural(rules.excludedPartners.length, "loja excluída", "lojas excluídas"))
  if (rules.onlyAvailableSize) parts.push("só meu tamanho")
  return parts.join(" · ")
}

interface Props {
  rules: PreferenceRules
  onChange: (rules: PreferenceRules) => void
  /** Budget slider range and currency, from GET /studio/config. */
  limits: StudioConfig["budget"]
  /** Name used in accessible labels (e.g. "Dia a dia" or "esta busca"). */
  context: string
  /** Confirmation shown after each change (e.g. "Salvo em Dia a dia"). */
  confirmation: string
}

export function CriterionQuick({ rules, onChange, context, confirmation, limits }: Props) {
  const BUDGET_LIMITS = limits
  const brl0 = (v: number): string => v.toLocaleString("pt-BR", { style: "currency", currency: limits.currency, maximumFractionDigits: 0 })
  const ratingPanel = useId()
  const budgetFieldId = useId()
  const [ratingOpen, setRatingOpen] = useState(false)
  const [budgetEditing, setBudgetEditing] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const budgetInput = useRef<HTMLInputElement | null>(null)
  const ratingBtn = useRef<HTMLButtonElement | null>(null)

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])
  useEffect(() => {
    if (budgetEditing) budgetInput.current?.select()
  }, [budgetEditing])

  const update = (patch: (r: PreferenceRules) => void): void => {
    const next = structuredClone(rules)
    patch(next)
    onChange(next)
    setStatus(confirmation)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setStatus(null), 2600)
  }

  const rating = rules.minRating
  const budget = rules.budget
  const unit = budget.scope === "look" ? "look" : "peça"
  const clampBudget = (v: number): number => Math.min(BUDGET_LIMITS.max, Math.max(BUDGET_LIMITS.min, Math.round(v / BUDGET_LIMITS.step) * BUDGET_LIMITS.step))
  const value = clampBudget(budget.value)
  const pct = ((value - BUDGET_LIMITS.min) / (BUDGET_LIMITS.max - BUDGET_LIMITS.min)) * 100
  const commitDraft = (): void => {
    const n = Number(budgetDraft.replace(/\D/g, ""))
    if (budgetDraft.trim() !== "" && Number.isFinite(n)) update((r) => (r.budget.value = clampBudget(n)))
    setBudgetEditing(false)
  }
  const others = summarizeOtherRules(rules)

  return (
    <div className="sa-crit">
      <div className="sa-crit-row">
        <button
          ref={ratingBtn}
          type="button"
          className="sa-critchip"
          aria-expanded={ratingOpen}
          aria-controls={ratingPanel}
          aria-label={
            rating.mode === "off"
              ? `Nota mínima do produto desligada em ${context}. Ajustar`
              : `Nota mínima do produto: ${formatRating(rating.value)} estrelas ou mais, ${MODE_WORD[rating.mode]}, em ${context}. Ajustar`
          }
          onClick={() => setRatingOpen((o) => !o)}
        >
          <Star size={16} weight={rating.mode === "off" ? "regular" : "fill"} className="sa-critstar" aria-hidden="true" />
          {rating.mode === "off" ? (
            <span>sem nota mínima</span>
          ) : (
            <>
              <span className="sa-num font-semibold">{formatRating(rating.value)}</span>
              <span className="sa-muted">ou mais · {MODE_WORD[rating.mode]}</span>
            </>
          )}
        </button>

        <div className="sa-critbudget" role="group" aria-label={`Orçamento máximo por ${unit} em ${context}`}>
          {budget.mode === "off" ? (
            <>
              <span className="sa-caption sa-muted">Orçamento: sem limite</span>
              <button type="button" className="sa-btn-quiet sa-caption font-semibold" onClick={() => update((r) => (r.budget = { ...r.budget, value, mode: "prefer" }))}>
                Definir limite
              </button>
            </>
          ) : (
            <>
              <input
                type="range"
                className="sa-range sa-range-sm min-w-0 flex-1"
                min={BUDGET_LIMITS.min}
                max={BUDGET_LIMITS.max}
                step={BUDGET_LIMITS.step}
                value={value}
                aria-label={`Orçamento máximo por ${unit} (${context})`}
                aria-valuetext={`até ${brl0(value)} por ${unit}`}
                style={{ "--pct": `${pct}%` } as CSSProperties}
                onChange={(e) => update((r) => (r.budget.value = Number(e.target.value)))}
              />
              {budgetEditing ? (
                <span className="sa-critvalue-edit">
                  <label htmlFor={budgetFieldId} className="sa-sr">
                    Orçamento máximo por {unit} em reais ({context})
                  </label>
                  <span className="sa-caption sa-muted" aria-hidden="true">
                    R$
                  </span>
                  <input
                    ref={budgetInput}
                    id={budgetFieldId}
                    className="sa-field sa-num"
                    inputMode="numeric"
                    value={budgetDraft}
                    onChange={(e) => setBudgetDraft(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onBlur={commitDraft}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitDraft()
                      if (e.key === "Escape") {
                        e.stopPropagation()
                        setBudgetEditing(false)
                      }
                    }}
                  />
                  <span className="sa-caption sa-muted" aria-hidden="true">
                    /{unit}
                  </span>
                </span>
              ) : (
                <button
                  type="button"
                  className="sa-critvalue sa-num"
                  aria-label={`Orçamento: até ${brl0(value)} por ${unit}, ${MODE_WORD[budget.mode]}. Digitar valor`}
                  onClick={() => {
                    setBudgetDraft(String(value))
                    setBudgetEditing(true)
                  }}
                >
                  até {brl0(value)}
                  <span className="sa-muted">/{unit}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {ratingOpen ? (
        <div
          id={ratingPanel}
          className="sa-critpanel sa-enter"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation()
              setRatingOpen(false)
              ratingBtn.current?.focus()
            }
          }}
        >
          <Segmented label={`Nota mínima do produto: modo (${context})`} value={rating.mode} onChange={(m) => update((r) => (r.minRating.mode = m))} options={MODES} block />
          <StarThreshold label={`Nota mínima do produto (${context})`} value={rating.value} onChange={(v) => update((r) => (r.minRating.value = v))} disabled={rating.mode === "off"} />
          <p className="sa-caption sa-muted">Nota do produto, de 1 a 5. A nota do vendedor fica em Editar › Opções avançadas.</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="sa-caption sa-muted sa-pretty">
          {[others, budget.mode === "off" ? "" : `orçamento de ${brl0(BUDGET_LIMITS.min)} a ${brl0(BUDGET_LIMITS.max)} por ${unit}`].filter(Boolean).join(" · ")}
        </p>
        <p className="sa-caption sa-success-text" aria-live="polite">
          {status ?? ""}
        </p>
      </div>
    </div>
  )
}
