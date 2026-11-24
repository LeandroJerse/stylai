/**
 * Estúdio > work area: one thing at a time, always next to the request (below it on phones).
 * Conjuntos (search progress, outfits) · Imagens (what was generated) · Peças (loose search). Everything is read from
 * the server, so a reload shows the same state. A new request or a confirmed generation brings its view into sight.
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CircleNotch } from "@phosphor-icons/react"
import type { OutfitQuote, OutfitSearch, OutfitSet } from "../../api/outfits"
import { useStore, type StageView } from "../../app/store"
import { outfitKeys, useOutfits, type Outfits } from "../../app/useOutfits"
import { filterLabels, filterReportText, filtersToSend, FILTER_IDS } from "../../lib/filters"
import { plural } from "../../lib/format"
import { EmptyState, ErrorState, LoadingState, Notice, useReducedMotion } from "../ui"
import { ConfirmSheet, usd } from "./ConfirmSheet"
import { OutfitCard } from "./OutfitCard"
import { isWorking, RenderCard } from "./RenderCard"

const MAX_COMPARE = 4
const STATUS: Record<string, string> = { running: "em andamento", interrupted: "interrompida", succeeded: "pronta", empty: "sem resultado", failed: "falhou", cancelled: "cancelada" }
const OUTCOME: Record<string, string> = { ok: "encontrou", empty: "loja sem resultado", filtered_out: "nada compatível", unavailable: "loja não respondeu", skipped: "não foi necessária" }
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "")

function SearchProgress({ search, outfits }: { search: OutfitSearch; outfits: Outfits }) {
  const { notify } = useStore()
  const { done, total, label } = search.stage
  const known = done !== null && total
  return (
    <div className="grid gap-4" data-testid="outfit-progress" data-stage={search.stage.id}>
      <div className="sa-panel grid gap-3 p-4 md:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="sa-title-sm flex min-w-0 items-center gap-2" role="status">
            <CircleNotch size={18} className="sa-spin flex-none" aria-hidden="true" /> {label || "Buscando"}{known ? ` (${done} de ${total} buscas)` : ""}…
          </p>
          <button type="button" className="sa-btn-quiet sa-body-sm flex-none" onClick={() => void outfits.cancelSearch(search.id).then((r) => { if (!r.ok) notify(r.message) })} data-testid="outfit-cancel-search">
            Cancelar
          </button>
        </div>
        <div className={`sa-progress ${known ? "" : "sa-progress-indeterminate"}`}>
          <span style={known ? { width: `${Math.round((done / total) * 100)}%` } : undefined} />
        </div>
        <p className="sa-caption sa-muted">Você pode sair ou recarregar a página: a busca continua no servidor.</p>
      </div>
      <div className="sa-outfit-grid" aria-hidden="true">
        {[0, 1, 2].map((i) => <div key={i} className="sa-skeleton sa-outfit-skeleton" />)}
      </div>
    </div>
  )
}

function Report({ search }: { search: OutfitSearch }) {
  const r = search.report
  if (!r) return null
  return (
    <details className="sa-caption sa-muted" data-testid="outfit-report">
      <summary className="sa-summaryline">Como esta busca foi feita</summary>
      <div className="mt-2 grid gap-1">
        <p>Interpretação: {r.interpretedBy === "agent" ? "agente" : "regras"} · planejamento da busca: {r.plannedBy === "agent" ? "agente" : "regras"} · seleção: {search.selection?.method === "agent" ? `agente (${search.selection.model ?? "IA"})` : search.selection ? "regras" : "não executada"}</p>
        {r.queries.map((q, i) => <p key={i}>{q.slot}: “{q.query}” · {OUTCOME[q.outcome] ?? q.outcome}{q.outcome === "ok" || q.outcome === "filtered_out" ? ` (${q.kept} de ${q.returned})` : ""}</p>)}
        {r.removed ? <p>{plural(r.removed, "anúncio removido", "anúncios removidos")} por não combinar com o pedido (ex.: roupa de lazer em look elegante, público ou estação errados).</p> : null}
        {r.missingSlots.length ? <p>Sem opção para: {r.missingSlots.join(", ")}.</p> : null}
        {r.agentCalls ? <p>Chamadas ao agente: {r.agentCalls}{r.agentUsd === null ? "" : ` (≈ ${usd(r.agentUsd)})`}.</p> : null}
      </div>
    </details>
  )
}

/** Searches of this account; only worth showing when there is another one to open. */
function HistorySelect({ outfits }: { outfits: Outfits }) {
  const history = outfits.searches.data ?? []
  if (history.length < 2) return null
  return (
    <label className="sa-caption flex min-w-0 items-center gap-2">
      <span className="sa-muted flex-none">Pedido</span>
      <select className="sa-field sa-field-sm min-w-0 flex-1" value={outfits.searchId ?? ""} onChange={(e) => outfits.open(e.target.value)} data-testid="outfit-history-select">
        {outfits.searchId && !history.some((h) => h.id === outfits.searchId) ? <option value={outfits.searchId}>{outfits.search.data?.prompt ?? "Pedido atual"}</option> : null}
        {history.map((h) => <option key={h.id} value={h.id}>{h.prompt.slice(0, 70)} · {day(h.createdAt)} ({STATUS[h.status] ?? h.status})</option>)}
      </select>
    </label>
  )
}

function SetsView({ outfits, recents, onDone }: { outfits: Outfits; recents: ReactNode; onDone: () => void }) {
  const { notify } = useStore()
  const [picked, setPicked] = useState<string[]>([])
  const [quote, setQuote] = useState<OutfitQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  useEffect(() => setPicked([]), [outfits.searchId])
  const search = outfits.search.data ?? null
  const sets = search?.sets ?? []
  const chosen = sets.filter((s) => picked.includes(s.id))
  const labels = filterLabels(search?.filters ?? null)
  const filtered = search?.report ? filterReportText(search.report.filters) : null
  const askQuote = async (list: OutfitSet[]): Promise<void> => {
    if (quoting) return
    setQuoting(true)
    const r = await outfits.quote(list)
    setQuoting(false)
    if (r.ok) setQuote(r.quote)
    else notify(r.message)
  }
  return (
    <>
      <HistorySelect outfits={outfits} />
      {outfits.search.isError ? <ErrorState error={outfits.search.error} onRetry={() => void outfits.search.refetch()} compact /> : null}
      {outfits.searchId && outfits.search.isPending ? <LoadingState label="Abrindo seus conjuntos…" /> : null}
      {!outfits.searchId && !outfits.searches.isPending ? <EmptyState title="Seus conjuntos aparecem aqui">Descreva o look e toque em “Montar conjuntos”. Você escolhe, troca peças e só gera a imagem se quiser.</EmptyState> : null}
      {search?.status === "running" ? <SearchProgress search={search} outfits={outfits} /> : null}
      {search?.message ? (
        <Notice tone={search.status === "failed" ? "error" : "warning"}>
          <p data-testid="outfit-message" data-status={search.status}>{search.message}</p>
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm mt-3" disabled={outfits.starting} onClick={() => void outfits.start(search.prompt, search.filters ? filtersToSend(search.filters, FILTER_IDS) : undefined).then((r) => { if (!r.ok) notify(r.message) })} data-testid="outfit-search-again">
            Buscar de novo
          </button>
        </Notice>
      ) : null}
      {sets.length ? (
        <>
          <div className="grid gap-1">
            <h2 className="sa-heading">{plural(sets.length, "conjunto", "conjuntos")}</h2>
            <p className="sa-caption sa-muted">
              <span className="sa-truncate inline-block max-w-full align-bottom">“{search?.prompt}”</span>
              <br />
              {labels.length ? <span data-testid="outfit-filters">{labels.join(" · ")}<br /></span> : null}
              <span data-testid="outfit-method">{search?.selection?.method === "agent" ? `Escolhidos pelo agente (${search.selection.model ?? "IA"}) e conferidos pelo servidor` : "Seleção por regras (sem agente)"}</span>
            </p>
          </div>
          <div className="sa-outfit-grid" data-count={sets.length}>
            {sets.map((s) => (
              <OutfitCard key={s.id} set={s} outfits={outfits} selected={picked.includes(s.id)} canSelect={picked.length < MAX_COMPARE} quoting={quoting}
                onSelect={(on) => setPicked((p) => (on ? [...p, s.id] : p.filter((x) => x !== s.id)))} onGenerate={() => void askQuote([s])} />
            ))}
          </div>
          {filtered ? <p className="sa-caption sa-muted" data-testid="outfit-filter-report">{filtered}</p> : null}
          {chosen.length ? (
            <div className="sa-outfit-bar">
              <p className="sa-body-sm min-w-0" role="status">{chosen.length === 1 ? "Marque mais um para comparar" : `${chosen.length} conjuntos marcados`}</p>
              <button type="button" className="sa-btn sa-btn-primary sa-btn-sm" disabled={chosen.length < 2 || quoting} onClick={() => void askQuote(chosen)} data-testid="outfit-compare">
                {quoting ? <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> : null} {quoting ? "Conferindo…" : "Comparar lado a lado"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {search && search.status !== "running" ? <Report search={search} /> : null}
      {search?.status === "running" ? null : recents}
      {quote ? <ConfirmSheet quote={quote} outfits={outfits} onClose={() => setQuote(null)} onDone={() => { setQuote(null); setPicked([]); onDone() }} /> : null}
    </>
  )
}

function ImagesView({ outfits, onOpenSearch }: { outfits: Outfits; onOpenSearch: (id: string) => void }) {
  const renders = outfits.renders.data ?? []
  // Newest first; the newest one, whatever is being made and whatever needs a decision start open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  return (
    <div className="grid gap-4">
      {renders.map((r, i) => {
        const expanded = toggled[r.id] ?? (i === 0 || isWorking(r) || r.status === "partial")
        return <RenderCard key={r.id} render={r} outfits={outfits} expanded={expanded} onToggle={() => setToggled((t) => ({ ...t, [r.id]: !expanded }))} onOpenSearch={onOpenSearch} />
      })}
    </div>
  )
}

export function OutfitStage({ loose, recents, job }: { loose: ReactNode | null; recents: ReactNode; job: ReactNode }) {
  const outfits = useOutfits()
  const { draft, setDraft } = useStore()
  const reduced = useReducedMotion()
  const qc = useQueryClient()
  const ref = useRef<HTMLElement | null>(null)
  const status = outfits.search.data?.status
  // The list of requests shows the state of each one: it follows the search on screen.
  useEffect(() => { if (status && status !== "running") void qc.invalidateQueries({ queryKey: outfitKeys.searches }) }, [status, outfits.searchId, qc])

  const renders = outfits.renders.data ?? []
  const working = renders.some(isWorking)
  // After a reload in the middle of a generation, the generation is what the person came back for.
  const fallback: StageView = working ? "images" : "sets"
  const wanted = draft.stageView ?? fallback
  const view: StageView = (wanted === "pieces" && !loose) || (wanted === "images" && !renders.length) ? "sets" : wanted

  // Bring the work area into sight when something was just asked (never while the person is only reading).
  const revealed = useRef(draft.stageNonce)
  useEffect(() => {
    if (revealed.current === draft.stageNonce) return
    revealed.current = draft.stageNonce
    const frame = window.requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus({ preventScroll: true })
      const header = window.innerWidth < 1024 ? 64 : 88
      const top = el.getBoundingClientRect().top
      if (top >= header - 4 && top < window.innerHeight * 0.35) return
      window.scrollTo({ top: Math.max(0, top + window.scrollY - header - 8), behavior: reduced ? "auto" : "smooth" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [draft.stageNonce, reduced])

  const tabs: { id: StageView; label: string; count: number | null; busy: boolean }[] = [
    { id: "sets", label: "Conjuntos", count: outfits.search.data?.sets.length || null, busy: status === "running" },
    ...(renders.length ? [{ id: "images" as const, label: "Imagens", count: renders.length, busy: working }] : []),
    ...(loose ? [{ id: "pieces" as const, label: "Peças", count: null, busy: false }] : []),
  ]
  return (
    <section ref={ref} id="conjuntos" tabIndex={-1} className="sa-work" aria-label="Conjuntos e imagens" data-testid="outfit-board" data-view={view}>
      {job}
      {tabs.length > 1 ? (
        <div className="sa-segmented sa-work-tabs" role="group" aria-label="O que mostrar">
          {tabs.map((t) => (
            <button key={t.id} type="button" aria-pressed={view === t.id} onClick={() => setDraft({ stageView: t.id })} data-testid={`stage-tab-${t.id}`}>
              {t.busy ? <CircleNotch size={14} className="sa-spin" aria-hidden="true" /> : null} {t.label}
              {t.count !== null && !t.busy ? <span className="sa-muted sa-num">{t.count}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {view === "sets" ? <SetsView outfits={outfits} recents={recents} onDone={() => setDraft((d) => ({ stageView: "images", stageNonce: d.stageNonce + 1 }))} /> : null}
      {view === "images" ? <ImagesView outfits={outfits} onOpenSearch={(id) => { outfits.open(id); setDraft({ stageView: "sets" }) }} /> : null}
      {view === "pieces" ? loose : null}
    </section>
  )
}
