/** Last check before spending: current prices, blockers, coins and provider cost of exactly what will be generated. */
import { useState } from "react"
import { createPortal } from "react-dom"
import { CircleNotch } from "@phosphor-icons/react"
import type { OutfitQuote } from "../../api/outfits"
import { useStore } from "../../app/store"
import type { Outfits } from "../../app/useOutfits"
import { shortPieceName } from "../../lib/titles"
import { Notice, Sheet } from "../ui"
import { money } from "./OutfitCard"

export const usd = (n: number) => `US$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
const PHOTO_CODES = ["photo_required", "consent_required", "photo_framing_insufficient", "photo_revalidation_required"]
const brl = (n: number | null) => (n === null ? "não informado" : money({ amount: n, currency: "BRL" }))

export function ConfirmSheet({ quote, outfits, onClose, onDone }: { quote: OutfitQuote; outfits: Outfits; onClose: () => void; onDone: () => void }) {
  const { go } = useStore()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const g = quote.generation
  const photoBlocked = quote.blockers.some((b) => PHOTO_CODES.includes(b.code))
  const confirm = async (): Promise<void> => {
    if (sending) return
    setSending(true)
    setError(null)
    const r = await outfits.confirm(quote)
    setSending(false)
    if (r.ok) onDone()
    else setError(r.message)
  }
  // Rendered at the app root: the page's entrance animation would otherwise trap a fixed overlay inside this section.
  return createPortal(
    <Sheet
      title={quote.mode === "comparison" ? `Comparar ${quote.panels.length} conjuntos` : "Gerar esta imagem"}
      onClose={onClose}
      footer={
        <div className="grid gap-2">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {photoBlocked ? (
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-block" onClick={() => { onClose(); go("perfil") }}>
              Abrir meu Perfil
            </button>
          ) : null}
          <button type="button" className="sa-btn sa-btn-primary sa-btn-block" disabled={!quote.ready || sending} onClick={() => void confirm()} data-testid="outfit-confirm">
            {sending ? <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> : null} {g?.simulated ? "Confirmar (simulação, sem custo)" : `Confirmar ${quote.panels.length} ${quote.panels.length === 1 ? "imagem" : "imagens"} · ${quote.coins.cost} moedas`}
          </button>
        </div>
      }
    >
      <div className="grid gap-4" data-testid="outfit-quote" data-ready={quote.ready}>
        {quote.blockers.length || quote.blockedPieces.length ? (
          <Notice tone="warning">
            <ul className="grid gap-1" data-testid="quote-blockers">
              {quote.blockers.map((b) => <li key={b.code} data-code={b.code}>{b.message}</li>)}
              {quote.blockedPieces.map((b, i) => <li key={`p${i}`}>{shortPieceName(b.name)}: {b.message}</li>)}
            </ul>
          </Notice>
        ) : null}
        {quote.changes.length ? (
          <Notice tone="info">
            <p className="font-semibold">A loja mudou algo desde a busca</p>
            <ul className="mt-1 grid gap-1" data-testid="quote-changes">
              {quote.changes.map((c, i) => <li key={i}>{shortPieceName(c.name)}: {c.kind === "image" ? "imagem do anúncio atualizada" : `preço de ${brl(c.before)} para ${brl(c.after)}`}</li>)}
            </ul>
          </Notice>
        ) : null}
        <ul className="grid gap-3">
          {quote.panels.map((p) => (
            <li key={p.setId}>
              <p className="sa-body-sm flex justify-between gap-3 font-semibold">
                <span className="min-w-0">{p.title}</span>
                <span className="sa-num flex-none">{money(p.total)}</span>
              </p>
              <p className="sa-caption sa-muted">{p.pieces.map((x) => shortPieceName(x.product.name)).join(" + ")}</p>
            </li>
          ))}
        </ul>
        {g ? (
          <div className="sa-well grid gap-1 p-4 sa-body-sm" data-testid="quote-cost">
            <p>Moedas: <strong className="sa-num">{quote.coins.cost}</strong> (você tem {quote.coins.available}).</p>
            {g.simulated ? (
              <p><strong>Simulação:</strong> as imagens são sintéticas, feitas neste computador. Nenhum provador pago é chamado.</p>
            ) : (
              <p>Provador: {g.provider} ({g.model}). Custo estimado {usd(g.estimatedUsd)}; reserva máxima {usd(g.maxUsd)}, feita para todas antes da primeira.</p>
            )}
            <p className="sa-caption sa-muted">{g.calls} {g.calls === 1 ? "imagem" : "imagens"}, uma chamada por conjunto, sempre a partir da sua foto aprovada{quote.mode === "comparison" ? "; o comparativo é montado pelo StylAI, sem IA" : ""}.</p>
            {quote.pilot ? <p className="sa-caption sa-muted">Piloto: {quote.pilot.remainingAttempts} de {quote.pilot.maxAttempts} gerações restantes, saldo {usd(quote.pilot.remainingUsd)}.</p> : null}
          </div>
        ) : null}
      </div>
    </Sheet>,
    document.querySelector(".sa-root") ?? document.body,
  )
}
