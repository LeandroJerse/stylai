/**
 * Estúdio > conjuntos: real progress of the search, the coordinated outfits, the confirmation with cost and blockers,
 * and the images. Everything here is read from the server, so a reload shows the same state.
 */
import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { CircleNotch } from "@phosphor-icons/react"
import type { OutfitQuote, OutfitSearch, OutfitSet } from "../../api/outfits"
import { useStore } from "../../app/store"
import { useOutfits, type Outfits } from "../../app/useOutfits"
import { ErrorState, LoadingState, Notice, Sheet } from "../ui"
import { money, OutfitCard } from "./OutfitCard"
import { RenderCard } from "./RenderCard"

const MAX_COMPARE = 4
const STATUS: Record<string, string> = { running: "em andamento", interrupted: "interrompida", succeeded: "pronta", empty: "sem resultado", failed: "falhou", cancelled: "cancelada" }
const OUTCOME: Record<string, string> = { ok: "encontrou", empty: "loja sem resultado", filtered_out: "nada compatível", unavailable: "loja não respondeu", skipped: "não foi necessária" }
const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "")

function SearchProgress({ search, outfits }: { search: OutfitSearch; outfits: Outfits }) {
  const { notify } = useStore()
  const { done, total, label } = search.stage
  return (
    <div className="sa-panel grid gap-3 p-4" data-testid="outfit-progress" data-stage={search.stage.id}>
      <p className="sa-body-sm flex items-center gap-2" role="status">
        <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> {label || "Buscando"}{done !== null && total ? ` (${done} de ${total} buscas)` : ""}…
      </p>
      <div className={`sa-progress ${done !== null && total ? "" : "sa-progress-indeterminate"}`}><span style={done !== null && total ? { width: `${Math.round((done / total) * 100)}%` } : undefined} /></div>
      <p className="sa-caption sa-muted">Você pode sair ou recarregar a página: a busca continua no servidor. Nada é gerado nem cobrado aqui.</p>
      <button type="button" className="sa-btn-quiet sa-body-sm justify-self-start" onClick={() => void outfits.cancelSearch(search.id).then((r) => { if (!r.ok) notify(r.message) })} data-testid="outfit-cancel-search">Cancelar busca</button>
    </div>
  )
}

function Report({ search }: { search: OutfitSearch }) {
  const r = search.report
  if (!r) return null
  return (
    <details className="sa-caption sa-muted" data-testid="outfit-report">
      <summary className="cursor-pointer">Como esta busca foi feita</summary>
      <div className="mt-2 grid gap-1">
        <p>Interpretação: {r.interpretedBy === "agent" ? "agente" : "regras"} · planejamento da busca: {r.plannedBy === "agent" ? "agente" : "regras"} · seleção: {search.selection?.method === "agent" ? `agente (${search.selection.model ?? "IA"})` : search.selection ? "regras" : "não executada"}</p>
        {r.queries.map((q, i) => <p key={i}>{q.slot}: “{q.query}” · {OUTCOME[q.outcome] ?? q.outcome}{q.outcome === "ok" || q.outcome === "filtered_out" ? ` (${q.kept} de ${q.returned})` : ""}</p>)}
        {r.removed ? <p>{r.removed} {r.removed === 1 ? "anúncio removido" : "anúncios removidos"} por não combinar com o pedido (ex.: roupa de lazer em look elegante, público ou estação errados).</p> : null}
        {r.missingSlots.length ? <p>Sem opção para: {r.missingSlots.join(", ")}.</p> : null}
        {r.agentCalls ? <p>Chamadas ao agente: {r.agentCalls}{r.agentUsd === null ? "" : ` (≈ ${usd(r.agentUsd)})`}.</p> : null}
      </div>
    </details>
  )
}

function ConfirmSheet({ quote, outfits, onClose, onDone }: { quote: OutfitQuote; outfits: Outfits; onClose: () => void; onDone: () => void }) {
  const { go } = useStore()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const g = quote.generation
  const photoBlocked = quote.blockers.some((b) => ["photo_required", "consent_required", "photo_framing_insufficient", "photo_revalidation_required"].includes(b.code))
  const confirm = async (): Promise<void> => {
    if (sending) return
    setSending(true); setError(null)
    const r = await outfits.confirm(quote)
    setSending(false)
    if (r.ok) onDone()
    else setError(r.message)
  }
  // Rendered at the app root: the page's entrance animation would otherwise trap a fixed overlay inside this section.
  return createPortal(
    <Sheet title={quote.mode === "comparison" ? `Comparar ${quote.panels.length} conjuntos` : "Gerar esta imagem"} onClose={onClose}
      footer={(
        <div className="grid gap-2">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {photoBlocked ? <button type="button" className="sa-btn sa-btn-secondary sa-btn-block" onClick={() => { onClose(); go("perfil") }}>Abrir meu Perfil</button> : null}
          <button type="button" className="sa-btn sa-btn-primary sa-btn-block" disabled={!quote.ready || sending} onClick={() => void confirm()} data-testid="outfit-confirm">
            {sending ? <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> : null} {g?.simulated ? "Confirmar (simulação, sem custo)" : `Confirmar ${quote.panels.length} ${quote.panels.length === 1 ? "imagem" : "imagens"}`}
          </button>
        </div>
      )}>
      <div className="grid gap-4" data-testid="outfit-quote" data-ready={quote.ready}>
        {quote.blockers.length ? (
          <Notice tone="warning">
            <ul className="grid gap-1" data-testid="quote-blockers">{quote.blockers.map((b) => <li key={b.code} data-code={b.code}>{b.message}</li>)}{quote.blockedPieces.map((b, i) => <li key={`p${i}`}>{b.name}: {b.message}</li>)}</ul>
          </Notice>
        ) : null}
        {quote.changes.length ? (
          <Notice tone="info">
            <p className="font-semibold">A loja mudou algo desde a busca</p>
            <ul className="mt-1 grid gap-1" data-testid="quote-changes">
              {quote.changes.map((c, i) => <li key={i}>{c.name}: {c.kind === "image" ? "imagem do anúncio atualizada" : `preço de ${c.before === null ? "não informado" : money({ amount: c.before, currency: "BRL" })} para ${c.after === null ? "não informado" : money({ amount: c.after, currency: "BRL" })}`}</li>)}
            </ul>
          </Notice>
        ) : null}
        <ul className="grid gap-3">
          {quote.panels.map((p) => (
            <li key={p.setId}>
              <p className="sa-body-sm font-semibold">{p.panel} · {p.title}</p>
              <p className="sa-caption sa-muted">{p.pieces.map((x) => x.product.name).join(" + ")}</p>
              <p className="sa-caption">Total das peças: <span className="sa-num">{money(p.total)}</span></p>
            </li>
          ))}
        </ul>
        {g ? (
          <div className="sa-well grid gap-1 p-4 sa-body-sm" data-testid="quote-cost">
            <p>{g.calls} {g.calls === 1 ? "imagem" : "imagens"}, uma chamada por conjunto, sempre a partir da sua foto aprovada{quote.mode === "comparison" ? "; o comparativo é montado pelo StylAI, sem IA" : ""}.</p>
            <p>Moedas: <strong className="sa-num">{quote.coins.cost}</strong> (você tem {quote.coins.available}).</p>
            {g.simulated
              ? <p><strong>Simulação:</strong> as imagens são sintéticas, feitas neste computador. Nenhum provador pago é chamado.</p>
              : <p>Provador: {g.provider} ({g.model}). Custo estimado {usd(g.estimatedUsd)}; reserva máxima {usd(g.maxUsd)}, feita para todas antes da primeira.</p>}
            {quote.pilot ? <p className="sa-caption sa-muted">Piloto: {quote.pilot.remainingAttempts} de {quote.pilot.maxAttempts} gerações restantes, saldo {usd(quote.pilot.remainingUsd)}.</p> : null}
          </div>
        ) : null}
      </div>
    </Sheet>,
    document.querySelector(".sa-root") ?? document.body,
  )
}

export function OutfitBoard() {
  const outfits = useOutfits()
  const { notify } = useStore()
  const [picked, setPicked] = useState<string[]>([])
  const [quote, setQuote] = useState<OutfitQuote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const search = outfits.search.data ?? null
  useEffect(() => setPicked([]), [outfits.searchId])
  if (!outfits.enabled) return null

  const sets = search?.sets ?? []
  const chosen = sets.filter((s) => picked.includes(s.id))
  const askQuote = async (list: OutfitSet[]): Promise<void> => {
    if (quoting) return
    setQuoting(true)
    const r = await outfits.quote(list)
    setQuoting(false)
    if (r.ok) setQuote(r.quote)
    else notify(r.message)
  }
  const history = outfits.searches.data ?? []
  const renders = outfits.renders.data ?? []
  return (
    <section id="conjuntos" className="sa-outfits" aria-label="Conjuntos" data-testid="outfit-board">
      {history.length ? (
        <label className="sa-body-sm flex flex-wrap items-center gap-2">
          <span className="sa-muted">Pedido</span>
          <select className="sa-field sa-field-sm min-w-0 flex-1" value={outfits.searchId ?? ""} onChange={(e) => outfits.open(e.target.value)} data-testid="outfit-history-select">
            {outfits.searchId && !history.some((h) => h.id === outfits.searchId) ? <option value={outfits.searchId}>{search?.prompt ?? "Pedido atual"}</option> : null}
            {history.map((h) => <option key={h.id} value={h.id}>{day(h.createdAt)} · {h.prompt.slice(0, 70)} ({STATUS[h.status] ?? h.status})</option>)}
          </select>
        </label>
      ) : null}
      {outfits.search.isError ? <ErrorState error={outfits.search.error} onRetry={() => void outfits.search.refetch()} compact /> : null}
      {outfits.searchId && outfits.search.isPending ? <LoadingState label="Abrindo seus conjuntos…" /> : null}
      {search?.status === "running" ? <SearchProgress search={search} outfits={outfits} /> : null}
      {search?.message ? (
        <Notice tone={search.status === "failed" ? "error" : "warning"}>
          <p data-testid="outfit-message" data-status={search.status}>{search.message}</p>
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm mt-3" disabled={outfits.starting} onClick={() => void outfits.start(search.prompt).then((r) => { if (!r.ok) notify(r.message) })} data-testid="outfit-search-again">Buscar de novo</button>
        </Notice>
      ) : null}
      {sets.length ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="sa-heading">{sets.length === 1 ? "1 conjunto" : `${sets.length} conjuntos`}</h2>
            <span className="sa-caption sa-muted" data-testid="outfit-method">{search?.selection?.method === "agent" ? `Escolhidos pelo agente (${search.selection.model ?? "IA"}) e conferidos pelo servidor` : "Seleção por regras (sem agente)"}</span>
          </div>
          <div className="sa-outfit-grid" data-count={sets.length}>
            {sets.map((s) => (
              <OutfitCard key={s.id} set={s} outfits={outfits} selected={picked.includes(s.id)} canSelect={picked.length < MAX_COMPARE} quoting={quoting}
                onSelect={(on) => setPicked((p) => (on ? [...p, s.id] : p.filter((x) => x !== s.id)))} onGenerate={() => void askQuote([s])} />
            ))}
          </div>
          {sets.length > 1 ? (
            <div className="sa-outfit-bar">
              <p className="sa-body-sm" role="status">{chosen.length === 0 ? "Marque de 2 a 4 conjuntos para ver lado a lado." : chosen.length === 1 ? "Marque mais um conjunto para comparar." : `${chosen.length} conjuntos marcados.`}</p>
              <button type="button" className="sa-btn sa-btn-primary" disabled={chosen.length < 2 || quoting} onClick={() => void askQuote(chosen)} data-testid="outfit-compare">
                {quoting ? <><CircleNotch size={18} className="sa-spin" aria-hidden="true" /> Conferindo preços e imagens…</> : "Comparar lado a lado"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {search && search.status !== "running" ? <Report search={search} /> : null}
      {renders.length ? (
        <>
          <h2 className="sa-heading">Imagens geradas</h2>
          <div className="grid gap-5">{renders.map((r) => <RenderCard key={r.id} render={r} outfits={outfits} />)}</div>
        </>
      ) : null}
      {quote ? <ConfirmSheet quote={quote} outfits={outfits} onClose={() => setQuote(null)} onDone={() => { setQuote(null); setPicked([]); notify("Pedido enviado. As imagens aparecem aqui conforme ficam prontas.") }} /> : null}
    </section>
  )
}
