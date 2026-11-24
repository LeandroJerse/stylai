/** Purchase filters next to the request. They apply to the next search; the server says what each one removed. */
import { useEffect, useId, useState } from "react"
import { CaretDown, SlidersHorizontal } from "@phosphor-icons/react"
import { useStore } from "../../app/store"
import { useStudio } from "../../app/useStudio"
import { storeFilters } from "../../app/filterStorage"
import { filterLabels, filtersToSend, NO_FILTERS, parseAmount, type SearchFilters } from "../../lib/filters"
import { useNarrow } from "../ui"

const RATINGS = [80, 90, 95]
const SALES = [1, 5, 20]
const show = (n: number | null): string => (n === null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 2, useGrouping: false }))

function AmountField({ label, value, placeholder, onChange }: { label: string; value: number | null; placeholder: string; onChange: (n: number | null) => void }) {
  const [text, setText] = useState(show(value))
  const [invalid, setInvalid] = useState(false)
  const errorId = useId()
  // "Limpar" and a reopened request change the value from outside.
  useEffect(() => { if (parseAmount(text) !== value) setText(show(value)) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="grid min-w-0 gap-1">
      <span className="sa-caption">{label}</span>
      <input
        className="sa-field sa-field-sm sa-num w-full"
        inputMode="decimal"
        autoComplete="off"
        name={label}
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(e) => {
          setText(e.target.value)
          setInvalid(false)
          const n = parseAmount(e.target.value)
          if (n !== null || e.target.value.trim() === "") onChange(n)
        }}
        onBlur={() => {
          const bad = text.trim() !== "" && parseAmount(text) === null
          setInvalid(bad)
          if (bad) onChange(null)
        }}
      />
      {invalid ? <span id={errorId} className="sa-caption sa-error-text" role="alert">Use um valor em reais, como 80 ou 79,90.</span> : null}
    </label>
  )
}

export function FilterBar() {
  const { draft, setDraft } = useStore()
  const studio = useStudio()
  const narrow = useNarrow()
  const [toggled, setToggled] = useState<boolean | null>(null)
  const bodyId = useId()
  const offered = studio.caps?.outfitFilters ?? []
  if (offered.length === 0) return null
  const f = draft.filters
  const open = toggled ?? !narrow
  const labels = filterLabels(filtersToSend(f, offered))
  const set = (patch: Partial<SearchFilters>): void => {
    const next = { ...f, ...patch }
    storeFilters(next)
    setDraft({ filters: next })
  }
  return (
    <div className="sa-filters" data-testid="filters" data-open={open || undefined}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="sa-btn-quiet sa-body-sm -ml-2 flex min-w-0 items-center gap-2 font-semibold" aria-expanded={open} aria-controls={bodyId} onClick={() => setToggled(!open)} data-testid="filters-toggle">
          <SlidersHorizontal size={18} aria-hidden="true" className="flex-none" />
          Filtros{labels.length ? ` (${labels.length})` : ""}
          <CaretDown size={14} aria-hidden="true" className="flex-none" style={open ? { transform: "rotate(180deg)" } : undefined} />
        </button>
        {labels.length ? (
          <button type="button" className="sa-btn-quiet sa-caption flex-none" onClick={() => { storeFilters(NO_FILTERS); setDraft({ filters: NO_FILTERS }) }} data-testid="filters-clear">
            Limpar
          </button>
        ) : null}
      </div>
      {!open && labels.length ? <p className="sa-caption sa-muted" data-testid="filters-summary">{labels.join(" · ")}</p> : null}
      <div id={bodyId} hidden={!open} className="sa-filters-body">
        {offered.includes("audience") ? (
          <div role="radiogroup" aria-label="Público" className="sa-segmented sa-segmented-block">
            {([["Todos", null], ["Feminino", "feminino"], ["Masculino", "masculino"]] as const).map(([label, value]) => (
              <button key={label} type="button" role="radio" aria-checked={f.audience === value} onClick={() => set({ audience: value })} data-testid={`filter-audience-${value ?? "all"}`}>
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {offered.includes("price") || offered.includes("total") ? (
          <div className="grid grid-cols-3 gap-2">
            {offered.includes("price") ? (
              <>
                <AmountField label="Peça de R$" value={f.minPieceBrl} placeholder="mín." onChange={(n) => set({ minPieceBrl: n })} />
                <AmountField label="Peça até R$" value={f.maxPieceBrl} placeholder="máx." onChange={(n) => set({ maxPieceBrl: n })} />
              </>
            ) : null}
            {offered.includes("total") ? <AmountField label="Look até R$" value={f.maxTotalBrl} placeholder="total" onChange={(n) => set({ maxTotalBrl: n })} /> : null}
          </div>
        ) : null}
        {offered.includes("rating") || offered.includes("sales") ? (
          <div className="grid grid-cols-2 gap-2">
            {offered.includes("rating") ? (
              <label className="grid min-w-0 gap-1">
                <span className="sa-caption">Nota na loja</span>
                <select className="sa-field sa-field-sm w-full" name="Nota na loja" value={f.minRatingPercent ?? ""} onChange={(e) => set({ minRatingPercent: e.target.value ? Number(e.target.value) : null })} data-testid="filter-rating">
                  <option value="">Qualquer</option>
                  {RATINGS.map((n) => <option key={n} value={n}>{n}% ou mais</option>)}
                </select>
              </label>
            ) : null}
            {offered.includes("sales") ? (
              <label className="grid min-w-0 gap-1">
                <span className="sa-caption">Vendas recentes</span>
                <select className="sa-field sa-field-sm w-full" name="Vendas recentes" value={f.minSales ?? ""} onChange={(e) => set({ minSales: e.target.value ? Number(e.target.value) : null })} data-testid="filter-sales">
                  <option value="">Qualquer</option>
                  {SALES.map((n) => <option key={n} value={n}>{n} ou mais</option>)}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}
        {f.minRatingPercent !== null && offered.includes("rating") ? <p className="sa-caption sa-muted">Muitos anúncios não têm nota e ficam de fora com este filtro.</p> : null}
      </div>
    </div>
  )
}
