/** One coordinated outfit: pieces (lock, swap, size, store link), versions and the actions on it. */
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, ArrowsClockwise, CaretDown, CircleNotch, ClockCounterClockwise, Lock, LockOpen } from "@phosphor-icons/react"
import { outfitsApi, type OutfitPiece, type OutfitSet, type OutfitSlotId } from "../../api/outfits"
import type { Money } from "../../api/types"
import { useStore } from "../../app/store"
import { outfitKeys, type Outfits } from "../../app/useOutfits"
import { resolvePartnerLink } from "../../lib/links"
import { Photo } from "../ui"

export const money = (m: Money | null): string => (m ? m.amount.toLocaleString("pt-BR", { style: "currency", currency: m.currency }) : "preço não informado")

function StoreLink({ piece }: { piece: OutfitPiece }) {
  const link = resolvePartnerLink(piece.product.links)
  if (link.kind === "none") return null
  return (
    <a href={link.href} target="_blank" rel={link.rel} data-link-kind={link.kind} className="sa-iconbtn" aria-label={`Ver ${piece.product.name} na loja (${link.kind === "affiliate" ? "link comissionado" : "link da loja"})`}>
      <ArrowUpRight size={18} aria-hidden="true" />
    </a>
  )
}

function PieceRow({ set, piece, outfits, busy, run }: { set: OutfitSet; piece: OutfitPiece; outfits: Outfits; busy: boolean; run: (act: () => Promise<{ ok: true } | { ok: false; message: string }>) => void }) {
  const [open, setOpen] = useState(false)
  const locked = set.locked.includes(piece.slot)
  const detail = useQuery({ queryKey: outfitKeys.set(set.id), queryFn: ({ signal }) => outfitsApi.set(set.id, signal), enabled: open, staleTime: 0 })
  const alternatives = detail.data?.alternatives[piece.slot] ?? []
  const toggleLock = () => run(() => outfits.lock(set, locked ? set.locked.filter((s) => s !== piece.slot) : [...set.locked, piece.slot]))
  return (
    <li className="sa-outfit-piece" data-testid={`outfit-piece-${piece.slot}`} data-product-id={piece.product.id}>
      <div className="flex items-start gap-3">
        <Photo image={piece.product.images[0] ?? null} alt="" className="sa-outfit-thumb" />
        <div className="min-w-0 flex-1">
          <p className="sa-caption sa-muted">{piece.label}</p>
          <p className="sa-body-sm sa-clamp2">{piece.product.name}</p>
          <p className="sa-caption"><span className="sa-num font-semibold">{money(piece.product.price)}</span> <span className="sa-muted">· {piece.product.partner.name}</span></p>
          {piece.reason ? <p className="sa-caption sa-muted">{piece.reason}</p> : null}
          {!piece.tryOn.ready && piece.tryOn.message ? <p className="sa-caption sa-error-text" data-testid="piece-blocked">{piece.tryOn.message}</p> : null}
          {piece.product.variants.length > 1 ? (
            <label className="sa-caption mt-1 flex items-center gap-2">
              Tamanho
              <select className="sa-field sa-field-sm" disabled={busy} value={piece.variantId ?? ""} data-testid={`outfit-size-${piece.slot}`} onChange={(e) => run(() => outfits.swap(set, piece.slot, piece.product.id, e.target.value))}>
                <option value="" disabled>Escolha</option>
                {piece.product.variants.map((v) => <option key={v.id} value={v.id ?? ""}>{v.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <div className="flex flex-none flex-col">
          <StoreLink piece={piece} />
          <button type="button" className="sa-iconbtn" aria-pressed={locked} disabled={busy} onClick={toggleLock} aria-label={`${locked ? "Destravar" : "Travar"} ${piece.label}`} data-testid={`outfit-lock-${piece.slot}`}>
            {locked ? <Lock size={18} weight="fill" aria-hidden="true" /> : <LockOpen size={18} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <button type="button" className="sa-btn-quiet sa-caption flex items-center gap-1" aria-expanded={open} disabled={locked} onClick={() => setOpen((v) => !v)} data-testid={`outfit-swap-${piece.slot}`}>
        {locked ? "Peça travada" : "Trocar esta peça"} {locked ? null : <CaretDown size={14} aria-hidden="true" style={open ? { transform: "rotate(180deg)" } : undefined} />}
      </button>
      {open && !locked ? (
        <ul className="sa-outfit-alternatives" aria-label={`Outras opções para ${piece.label}`}>
          {detail.isPending ? <li className="sa-caption sa-muted">Carregando opções…</li> : null}
          {detail.isError ? <li className="sa-caption sa-error-text">Não foi possível carregar as opções.</li> : null}
          {detail.data && alternatives.length === 0 ? <li className="sa-caption sa-muted">A busca não trouxe outras opções compatíveis para esta parte.</li> : null}
          {alternatives.slice(0, 8).map((a) => (
            <li key={a.product.id} className="flex items-center gap-2">
              <Photo image={a.product.images[0] ?? null} alt="" className="sa-outfit-thumb-sm" />
              <div className="min-w-0 flex-1">
                <p className="sa-caption sa-clamp2">{a.product.name}</p>
                <p className="sa-caption sa-num">{money(a.product.price)}</p>
              </div>
              <StoreLink piece={a} />
              <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" disabled={busy} data-testid="outfit-use-alternative" data-product-id={a.product.id}
                onClick={() => run(async () => { const r = await outfits.swap(set, piece.slot, a.product.id); if (r.ok) setOpen(false); return r })}>
                Usar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Versions({ set, outfits, busy, run }: { set: OutfitSet; outfits: Outfits; busy: boolean; run: (act: () => Promise<{ ok: true } | { ok: false; message: string }>) => void }) {
  const detail = useQuery({ queryKey: outfitKeys.set(set.id), queryFn: ({ signal }) => outfitsApi.set(set.id, signal), staleTime: 0 })
  if (detail.isPending) return <p className="sa-caption sa-muted">Carregando versões…</p>
  return (
    <ol className="grid gap-2" aria-label="Versões deste conjunto" data-testid="outfit-versions">
      {[...(detail.data?.revisions ?? [])].reverse().map((r) => (
        <li key={r.revision} className="flex items-center gap-2 sa-caption">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Versão {r.revision}</span> · {r.label}
            <span className="sa-muted sa-clamp2">{r.pieces.map((p) => p.product.name).join(" + ")}</span>
          </span>
          {r.current ? <span className="sa-badge sa-badge-quiet">Atual</span> : (
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" disabled={busy} onClick={() => run(() => outfits.restore(set, r.revision))}>Voltar</button>
          )}
        </li>
      ))}
    </ol>
  )
}

export function OutfitCard({ set, outfits, selected, canSelect, onSelect, onGenerate, quoting }: {
  set: OutfitSet; outfits: Outfits; selected: boolean; canSelect: boolean; onSelect: (on: boolean) => void; onGenerate: () => void; quoting: boolean
}) {
  const { notify } = useStore()
  const [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState(false)
  const run = (act: () => Promise<{ ok: true } | { ok: false; message: string }>): void => {
    if (busy) return
    setBusy(true)
    void act().then((r) => { if (!r.ok) notify(r.message) }).finally(() => setBusy(false))
  }
  const allLocked = set.pieces.every((p) => set.locked.includes(p.slot as OutfitSlotId))
  return (
    <article className="sa-panel sa-outfit" aria-label={set.title} aria-busy={busy || undefined} data-testid="outfit-card" data-set-id={set.id} data-revision={set.revision} data-kind={set.kind}>
      <header className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          {set.recommended ? <span className="sa-badge sa-badge-success">Recomendado</span> : null}
          <span className="sa-badge sa-badge-quiet">{set.kind === "bundle" ? "Conjunto completo (um anúncio)" : "Peças combinadas"}</span>
        </div>
        <h3 className="sa-title-sm">{set.title}</h3>
        {set.rationale ? <p className="sa-body-sm sa-muted sa-pretty">{set.rationale}</p> : null}
      </header>
      <ul className="grid gap-4">
        {set.pieces.map((p) => <PieceRow key={`${p.slot}:${p.product.id}`} set={set} piece={p} outfits={outfits} busy={busy} run={run} />)}
      </ul>
      <div className="grid gap-1">
        <p className="sa-body-sm"><span className="sa-muted">Total das peças: </span><strong className="sa-num" data-testid="outfit-total">{money(set.total)}</strong></p>
        {set.overBudget === true ? <p className="sa-caption sa-error-text">Acima do orçamento pedido.</p> : null}
        {set.missingSlots.length ? <p className="sa-caption sa-muted">Sem opção encontrada para: {set.missingSlots.join(", ")}.</p> : null}
        {set.revision > 1 ? <p className="sa-caption sa-muted">Versão {set.revision} · {set.originLabel}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" disabled={busy || allLocked} onClick={() => run(() => outfits.suggest(set))} data-testid="outfit-suggest">
          {busy ? <CircleNotch size={16} className="sa-spin" aria-hidden="true" /> : <ArrowsClockwise size={16} aria-hidden="true" />} Outra combinação
        </button>
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" aria-expanded={versions} onClick={() => setVersions((v) => !v)} data-testid="outfit-history">
          <ClockCounterClockwise size={16} aria-hidden="true" /> Versões
        </button>
      </div>
      {versions ? <Versions set={set} outfits={outfits} busy={busy} run={run} /> : null}
      <div className="sa-rule" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 sa-body-sm">
          <input type="checkbox" checked={selected} disabled={!selected && !canSelect} onChange={(e) => onSelect(e.target.checked)} data-testid="outfit-select" />
          Comparar
        </label>
        <button type="button" className="sa-btn sa-btn-primary sa-btn-sm" disabled={busy || quoting} onClick={onGenerate} data-testid="outfit-generate">Gerar só este</button>
      </div>
    </article>
  )
}
