import { useId, useState } from "react"
import { CaretDown } from "@phosphor-icons/react"
import type { Facet, PreferenceRules, RuleMode, StudioConfig } from "../api/types"
import { useStore } from "../app/store"
import { RangeField, StarThreshold } from "./controls"
import { Segmented, Sheet, Switch } from "./ui"

const MODES: { id: RuleMode; label: string }[] = [
  { id: "require", label: "Exigir" },
  { id: "prefer", label: "Preferir" },
  { id: "off", label: "Desligado" },
]


/** Minimum rating rule: mode (exigir/preferir/desligado) + star threshold. */
function RatingRow({ label, value, onChange, mode, onMode, help }: { label: string; value: number; onChange: (v: number) => void; mode: RuleMode; onMode: (m: RuleMode) => void; help: string }) {
  return (
    <div className="grid gap-3 py-4">
      <p className="sa-title-sm">{label}</p>
      <Segmented label={`${label}: modo`} value={mode} onChange={onMode} options={MODES} block />
      <StarThreshold label={label} value={value} onChange={onChange} disabled={mode === "off"} />
      <p className="sa-caption sa-muted">{help}</p>
    </div>
  )
}

/** Numeric rule with a slider and a synced field. */
function RangeRow({ label, value, onChange, step, min, max, unit, format, formatEdge, mode, onMode, help }: { label: string; value: number; onChange: (v: number) => void; step: number; min: number; max: number; unit: string; format: (v: number) => string; formatEdge: (v: number) => string; mode: RuleMode; onMode: (m: RuleMode) => void; help: string }) {
  return (
    <div className="grid gap-3 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="sa-title-sm">{label}</p>
        <p className="sa-body-sm sa-num font-semibold">{mode === "off" ? "sem restrição" : format(value)}</p>
      </div>
      <Segmented label={`${label}: modo`} value={mode} onChange={onMode} options={MODES} block />
      <RangeField label={label} value={value} min={min} max={max} step={step} onChange={onChange} format={format} formatEdge={formatEdge} unit={unit} disabled={mode === "off"} />
      <p className="sa-caption sa-muted">{help}</p>
    </div>
  )
}

function SizeSelect({ label, value, options, onChange }: { label: string; value: string | null; options: string[]; onChange: (v: string | null) => void }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="sa-caption sa-muted mb-1 block">
        {label}
      </label>
      <select id={id} className="sa-field" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Qualquer</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Advanced editor for the current search. Starts from the rules in effect (saved preference or
 * this search's adjustments) and applies only to this search: the saved preference is not touched.
 * Partners come from the catalog facets and limits/sizes from GET /studio/config.
 */
export function PreferenceEditorSheet({ initial, sourceName, partners, config, onApply }: { initial: PreferenceRules; sourceName: string; partners: Facet[]; config: StudioConfig; onApply: (rules: PreferenceRules) => void }) {
  const { close } = useStore()
  const [rules, setRules] = useState<PreferenceRules>(() => structuredClone(initial))
  const [advanced, setAdvanced] = useState(false)
  const budgetId = useId()
  const BUDGET_LIMITS = config.budget
  const brl = (v: number): string => v.toLocaleString("pt-BR", { style: "currency", currency: config.budget.currency, maximumFractionDigits: 0 })
  const TOP = config.sizes.top
  const BOTTOM = config.sizes.bottom
  const SHOES = config.sizes.shoes
  const set = (patch: (r: PreferenceRules) => void): void =>
    setRules((prev) => {
      const next = structuredClone(prev)
      patch(next)
      return next
    })
  const error: string | null = null
  const save = (): void => {
    onApply(rules)
    close()
  }
  const title = "Preferências desta busca"
  return (
    <Sheet
      title={title}
      description={`Partindo de ${sourceName}. Vale só para esta busca; a preferência salva não muda.`}
      onClose={close}
      footer={
        <div>
          {error ? (
            <p className="sa-caption sa-error-text mb-2" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="sa-btn sa-btn-primary sa-btn-block" onClick={save}>
            Aplicar nesta busca
          </button>
        </div>
      }
    >
      <div className="grid gap-2">
        <div className="sa-divided mt-2">
          <RatingRow label="Nota mínima do produto" value={rules.minRating.value} mode={rules.minRating.mode} onMode={(m) => set((r) => (r.minRating.mode = m))} onChange={(v) => set((r) => (r.minRating.value = v))} help="Filtro pela nota do produto (escala de 1 a 5), separada da nota do vendedor. Toque numa estrela ou digite com uma casa decimal." />
          <RangeRow label="Mínimo de avaliações" value={rules.minReviews.value} step={10} min={0} max={5000} unit="avaliações" format={(v) => `${v.toLocaleString("pt-BR")} avaliações ou mais`} formatEdge={(v) => v.toLocaleString("pt-BR")} mode={rules.minReviews.mode} onMode={(m) => set((r) => (r.minReviews.mode = m))} onChange={(v) => set((r) => (r.minReviews.value = Math.round(v)))} help="Quantidade de avaliações, independente da nota." />
          <div className="grid gap-2 py-4">
            <p className="sa-title-sm">Produto sem nota</p>
            <Segmented label="Produto sem nota" value={rules.missingRating} onChange={(v) => set((r) => (r.missingRating = v))} options={[{ id: "warn", label: "Mostrar com aviso" }, { id: "exclude", label: "Excluir" }]} block />
            <p className="sa-caption sa-muted">Nota ausente não é zero.</p>
          </div>
          <fieldset className="m-0 grid gap-2 border-0 p-0 py-4">
            <legend className="sa-title-sm mb-2">Lojas</legend>
            <div className="flex flex-wrap gap-2">
              {partners.map((p) => {
                const excluded = rules.excludedPartners.includes(p.id)
                return (
                  <button key={p.id} type="button" className="sa-chip" aria-pressed={!excluded} onClick={() => set((r) => (r.excludedPartners = excluded ? r.excludedPartners.filter((s) => s !== p.id) : [...r.excludedPartners, p.id]))}>
                    {p.label} · {excluded ? "excluída" : "permitida"}
                  </button>
                )
              })}
            </div>
            <p className="sa-caption sa-muted">Lojas parceiras ativas no catálogo. Toque para excluir ou permitir.</p>
          </fieldset>
          <div className="grid gap-3 py-4">
            <p className="sa-title-sm">Tamanho por categoria</p>
            <div className="grid grid-cols-3 gap-3">
              <SizeSelect label="Partes de cima" value={rules.sizes.top} options={TOP} onChange={(v) => set((r) => (r.sizes.top = v))} />
              <SizeSelect label="Calças" value={rules.sizes.bottom} options={BOTTOM} onChange={(v) => set((r) => (r.sizes.bottom = v))} />
              <SizeSelect label="Sapatos" value={rules.sizes.shoes} options={SHOES} onChange={(v) => set((r) => (r.sizes.shoes = v))} />
            </div>
            <Switch checked={rules.onlyAvailableSize} onChange={(v) => set((r) => (r.onlyAvailableSize = v))} label="Só variantes disponíveis no meu tamanho" description="Grades de lojas diferentes não são convertidas entre si." />
          </div>
          <div className="grid gap-3 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="sa-title-sm">Orçamento máximo</p>
              <p className="sa-body-sm sa-num font-semibold">{rules.budget.mode === "off" ? "sem limite" : `até ${brl(rules.budget.value)} por ${rules.budget.scope === "look" ? "look" : "peça"}`}</p>
            </div>
            <Segmented label="Orçamento: modo" value={rules.budget.mode} onChange={(m) => set((r) => (r.budget.mode = m))} options={MODES} block />
            <RangeField label="Orçamento máximo" value={rules.budget.value} min={BUDGET_LIMITS.min} max={BUDGET_LIMITS.max} step={BUDGET_LIMITS.step} onChange={(v) => set((r) => (r.budget.value = v))} format={brl} unit="R$" unitBefore disabled={rules.budget.mode === "off"} describedBy={`${budgetId}-h`} />
            <Segmented label="Escopo do orçamento" value={rules.budget.scope} onChange={(s) => set((r) => (r.budget.scope = s))} options={[{ id: "look", label: "Por look" }, { id: "piece", label: "Por peça" }]} block />
            <p id={`${budgetId}-h`} className="sa-caption sa-muted">
              Em reais, de {brl(BUDGET_LIMITS.min)} a {brl(BUDGET_LIMITS.max)}. Escopo por look ou por peça é provisório.
            </p>
          </div>
        </div>

        <button type="button" className="sa-btn sa-btn-secondary justify-between" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
          Opções avançadas <CaretDown size={18} aria-hidden="true" style={{ transform: advanced ? "rotate(180deg)" : undefined }} />
        </button>
        {advanced ? (
          <div className="sa-divided">
            <RatingRow label="Nota mínima do vendedor" value={rules.advanced.sellerRating.value} mode={rules.advanced.sellerRating.mode} onMode={(m) => set((r) => (r.advanced.sellerRating.mode = m))} onChange={(v) => set((r) => (r.advanced.sellerRating.value = v))} help="Separada da nota do produto." />
            <RangeRow label="Prazo máximo" value={rules.advanced.maxDeliveryDays.value} step={1} min={1} max={60} unit="dias" format={(v) => `até ${v} ${v === 1 ? "dia" : "dias"}`} formatEdge={(v) => `${v} ${v === 1 ? "dia" : "dias"}`} mode={rules.advanced.maxDeliveryDays.mode} onMode={(m) => set((r) => (r.advanced.maxDeliveryDays.mode = m))} onChange={(v) => set((r) => (r.advanced.maxDeliveryDays.value = Math.round(v)))} help="Só quando a loja informa prazo; sem estimativas." />
            <fieldset className="m-0 border-0 p-0 py-4">
              <legend className="sa-title-sm mb-2">Evitar cores</legend>
              <div className="flex flex-wrap gap-2">
                {["Preto", "Bege", "Branco", "Vinho", "Marrom"].map((c) => {
                  const on = rules.advanced.avoidColors.includes(c)
                  return (
                    <button key={c} type="button" className="sa-chip" aria-pressed={on} onClick={() => set((r) => (r.advanced.avoidColors = on ? r.advanced.avoidColors.filter((x) => x !== c) : [...r.advanced.avoidColors, c]))}>
                      {c}
                    </button>
                  )
                })}
              </div>
            </fieldset>
            <div className="grid gap-2 py-4">
              <p className="sa-title-sm">Caimento</p>
              <Segmented label="Caimento: modo" value={rules.advanced.fit.mode} onChange={(m) => set((r) => (r.advanced.fit.mode = m))} options={MODES} block />
              <Segmented label="Caimento" value={rules.advanced.fit.value} onChange={(v) => set((r) => (r.advanced.fit.value = v))} options={[{ id: "ajustado", label: "Ajustado" }, { id: "regular", label: "Regular" }, { id: "amplo", label: "Amplo" }]} block />
            </div>
          </div>
        ) : null}
      </div>
    </Sheet>
  )
}
