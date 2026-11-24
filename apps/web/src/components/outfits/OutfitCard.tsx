/** One coordinated outfit: the pieces as photos (tap one to see, swap or lock it), the total and the actions. */
import { useId, useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, ArrowsClockwise, CaretDown, CircleNotch, ClockCounterClockwise, Lock, LockOpen, MagnifyingGlass } from "@phosphor-icons/react"
import { outfitsApi, type OptionsFound, type OutfitPiece, type OutfitSet, type OutfitSlotId } from "../../api/outfits"
import type { Money } from "../../api/types"
import { useStore } from "../../app/store"
import { outfitKeys, type Outfits } from "../../app/useOutfits"
import { resolvePartnerLink } from "../../lib/links"
import { shortPieceName } from "../../lib/titles"
import { Photo } from "../ui"

export const money = (m: Money | null): string => (m ? m.amount.toLocaleString("pt-BR", { style: "currency", currency: m.currency }) : "preço não informado")
type Result = { ok: true } | { ok: false; message: string }
type Run = (act: () => Promise<Result>) => void

/** Rating and sales as the store publishes them, or null when it says nothing. */
export const storeFacts = (p: OutfitPiece): string | null => {
  if (p.storeRating === null && p.storeSales === null) return null
  return [p.storeRating === null ? "Sem nota na loja" : `${p.storeRating.toLocaleString("pt-BR")}% de avaliações positivas`, p.storeSales === null ? null : `${p.storeSales} ${p.storeSales === 1 ? "venda recente" : "vendas recentes"}`].filter(Boolean).join(" · ")
}

export function StoreLink({ piece, label = false }: { piece: OutfitPiece; label?: boolean }) {
  const link = resolvePartnerLink(piece.product.links)
  if (link.kind === "none") return null
  return (
    <a href={link.href} target="_blank" rel={link.rel} data-link-kind={link.kind} className={label ? "sa-btn sa-btn-secondary sa-btn-sm" : "sa-iconbtn"} aria-label={`Ver ${piece.product.name} na loja (${link.kind === "affiliate" ? "link comissionado" : "link da loja"})`}>
      {label ? "Ver na loja" : null} <ArrowUpRight size={label ? 16 : 18} aria-hidden="true" />
    </a>
  )
}

/** A piece as a photo. Tapping opens its details below the photos of the outfit. */
function PieceTile({ piece, locked, open, panelId, onToggle }: { piece: OutfitPiece; locked: boolean; open: boolean; panelId: string; onToggle: () => void }) {
  return (
    <li className="min-w-0" data-testid={`outfit-piece-${piece.slot}`} data-product-id={piece.product.id}>
      <button type="button" className="sa-piecetile" aria-expanded={open} aria-controls={open ? panelId : undefined} aria-label={`${piece.label}: ${piece.product.name}, ${money(piece.product.price)}${locked ? ", travada" : ""}. Ver, trocar ou travar`} onClick={onToggle} data-testid={`outfit-swap-${piece.slot}`}>
        <span className="sa-piecetile-photo">
          <Photo image={piece.product.images[0] ?? null} alt="" className="h-full w-full" sizes="(min-width: 1024px) 14vw, 44vw" />
          <span className="sa-piecetile-mark" aria-hidden="true">
            {locked ? <Lock size={14} weight="fill" /> : <CaretDown size={14} weight="bold" style={open ? { transform: "rotate(180deg)" } : undefined} />}
          </span>
          {piece.tryOn.ready ? null : <span className="sa-badge sa-badge-photo sa-piecetile-flag">Sem prova</span>}
        </span>
        <span className="sa-caption sa-clamp2 mt-2 font-semibold">{shortPieceName(piece.product.name)}</span>
        <span className="sa-caption sa-muted sa-num block">{money(piece.product.price)}</span>
      </button>
    </li>
  )
}

/** One line about what the search for another piece brought. */
export function optionsText(f: OptionsFound): string {
  const why = [f.otherPart ? `${f.otherPart} de outra parte do look` : "", f.filtered ? `${f.filtered} fora dos seus filtros` : "", f.unsuitable ? `${f.unsuitable} que não servem para este look ou repetidas` : ""].filter(Boolean)
  const rest = why.length ? ` Ficaram de fora: ${why.join(", ")}.` : ""
  if (f.added) return `${f.added === 1 ? "1 opção nova" : `${f.added} opções novas`}, na frente da lista.`
  if (!f.returned) return "A loja não devolveu nada para esta busca. Tente um nome mais curto, como “bermuda jeans”."
  return `Nenhuma opção nova.${rest}`
}

function OptionSearch({ set, piece, outfits, busy }: { set: OutfitSet; piece: OutfitPiece; outfits: Outfits; busy: boolean }) {
  const [query, setQuery] = useState("")
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null)
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const text = query.trim()
    if (sending || busy) return
    if (text.length < 2) { setNote({ tone: "error", text: "Diga a peça, por exemplo “bermuda jeans”." }); return }
    setSending(true)
    setNote(null)
    const r = await outfits.findOptions(set, piece.slot, text)
    setSending(false)
    setNote(r.ok ? { tone: "ok", text: optionsText(r.found) } : { tone: "error", text: r.message })
  }
  return (
    <form className="grid gap-1" onSubmit={(e) => void submit(e)} noValidate>
      <div className="flex items-center gap-2">
        <input className="sa-field sa-field-sm min-w-0 flex-1" type="search" name="query" autoComplete="off" maxLength={80} value={query} placeholder="Buscar outra…" aria-label={`Buscar outra opção para ${piece.label}`} onChange={(e) => setQuery(e.target.value)} data-testid="outfit-option-query" />
        <button type="submit" className="sa-iconbtn flex-none" aria-label="Buscar na loja" disabled={busy || sending} data-testid="outfit-option-search">
          {sending ? <CircleNotch size={20} className="sa-spin" aria-hidden="true" /> : <MagnifyingGlass size={20} aria-hidden="true" />}
        </button>
      </div>
      <p className={`sa-caption ${note?.tone === "error" ? "sa-error-text" : "sa-muted"}`} role="status" data-testid="outfit-option-note">{sending ? "Buscando na loja…" : (note?.text ?? "")}</p>
    </form>
  )
}

function PieceDetail({ id, set, piece, outfits, busy, run, onClose }: { id: string; set: OutfitSet; piece: OutfitPiece; outfits: Outfits; busy: boolean; run: Run; onClose: () => void }) {
  const locked = set.locked.includes(piece.slot)
  const detail = useQuery({ queryKey: outfitKeys.set(set.id), queryFn: ({ signal }) => outfitsApi.set(set.id, signal), staleTime: 0 })
  const alternatives = detail.data?.alternatives[piece.slot] ?? []
  const toggleLock = () => run(() => outfits.lock(set, locked ? set.locked.filter((s) => s !== piece.slot) : [...set.locked, piece.slot]))
  return (
    <div id={id} className="sa-piecedetail" data-testid="outfit-piece-detail">
      <div className="grid gap-1">
        <p className="sa-body-sm font-semibold">{piece.product.name}</p>
        <p className="sa-caption sa-muted">
          {piece.label} · {piece.product.partner.name}
        </p>
        {storeFacts(piece) ? <p className="sa-caption sa-muted sa-num">{storeFacts(piece)}</p> : null}
        {piece.reason ? <p className="sa-caption sa-muted">{piece.reason}</p> : null}
        {!piece.tryOn.ready && piece.tryOn.message ? <p className="sa-caption sa-error-text" data-testid="piece-blocked">{piece.tryOn.message}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <StoreLink piece={piece} label />
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" aria-pressed={locked} disabled={busy} onClick={toggleLock} aria-label={`${locked ? "Destravar" : "Travar"} ${piece.label}`} data-testid={`outfit-lock-${piece.slot}`}>
          {locked ? <Lock size={16} weight="fill" aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />} {locked ? "Travada" : "Travar"}
        </button>
      </div>
      {locked ? (
        <p className="sa-caption sa-muted">Destrave para trocar esta peça.</p>
      ) : (
        <div className="grid gap-2">
          <p className="sa-caption font-semibold">Trocar por</p>
          <OptionSearch set={set} piece={piece} outfits={outfits} busy={busy} />
          {detail.isPending ? <p className="sa-caption sa-muted" role="status">Carregando opções…</p> : null}
          {detail.isError ? <p className="sa-caption sa-error-text">Não foi possível carregar as opções. Feche e abra a peça para tentar de novo.</p> : null}
          {detail.data && alternatives.length === 0 ? <p className="sa-caption sa-muted">Ainda não há outras opções para esta parte. Busque uma acima.</p> : null}
          {alternatives.length ? (
            <ul className="sa-altstrip" aria-label={`Outras opções para ${piece.label}`}>
              {alternatives.slice(0, 24).map((a) => (
                <li key={a.product.id}>
                  <button
                    type="button"
                    className="sa-alt"
                    disabled={busy}
                    data-testid="outfit-use-alternative"
                    data-product-id={a.product.id}
                    aria-label={`Usar ${a.product.name}, ${money(a.product.price)}`}
                    title={a.product.name}
                    onClick={() =>
                      run(async () => {
                        const r = await outfits.swap(set, piece.slot, a.product.id)
                        if (r.ok) onClose()
                        return r
                      })
                    }
                  >
                    <span className="sa-alt-photo">
                      <Photo image={a.product.images[0] ?? null} alt="" className="h-full w-full" />
                    </span>
                    <span className="sa-caption sa-num mt-1 block">{money(a.product.price)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  )
}

function Versions({ set, outfits, busy, run }: { set: OutfitSet; outfits: Outfits; busy: boolean; run: Run }) {
  const detail = useQuery({ queryKey: outfitKeys.set(set.id), queryFn: ({ signal }) => outfitsApi.set(set.id, signal), staleTime: 0 })
  if (detail.isPending) return <p className="sa-caption sa-muted" role="status">Carregando versões…</p>
  return (
    <ol className="sa-piecedetail" aria-label="Versões deste conjunto" data-testid="outfit-versions">
      {[...(detail.data?.revisions ?? [])].reverse().map((r) => (
        <li key={r.revision} className="flex items-center gap-2 sa-caption">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">Versão {r.revision}</span> · {r.label}
            <span className="sa-muted sa-clamp2">{r.pieces.map((p) => shortPieceName(p.product.name)).join(" + ")}</span>
          </span>
          {r.current ? (
            <span className="sa-badge sa-badge-quiet">Atual</span>
          ) : (
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" disabled={busy} onClick={() => run(() => outfits.restore(set, r.revision))}>
              Voltar
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}

export function OutfitCard({ set, outfits, selected, canSelect, onSelect, onGenerate, quoting }: {
  set: OutfitSet
  outfits: Outfits
  selected: boolean
  canSelect: boolean
  onSelect: (on: boolean) => void
  onGenerate: () => void
  quoting: boolean
}) {
  const { notify } = useStore()
  const [busy, setBusy] = useState(false)
  const [versions, setVersions] = useState(false)
  const [openSlot, setOpenSlot] = useState<OutfitSlotId | null>(null)
  const panelId = useId()
  const run: Run = (act) => {
    if (busy) return
    setBusy(true)
    void act().then((r) => { if (!r.ok) notify(r.message) }).finally(() => setBusy(false))
  }
  const allLocked = set.pieces.every((p) => set.locked.includes(p.slot))
  const openPiece = set.pieces.find((p) => p.slot === openSlot) ?? null
  const blocked = set.pieces.filter((p) => !p.tryOn.ready).length
  const sized = set.pieces.filter((p) => p.product.variants.length > 1)
  return (
    <article className="sa-panel sa-outfit" aria-label={set.title} aria-busy={busy || undefined} data-testid="outfit-card" data-set-id={set.id} data-revision={set.revision} data-kind={set.kind} data-selected={selected || undefined}>
      <header className="px-1 pt-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="sa-title-sm min-w-0">{set.title}</h3>
          <strong className="sa-body-sm sa-num flex-none" data-testid="outfit-total" aria-label={`Total das peças: ${money(set.total)}`}>
            {money(set.total)}
          </strong>
        </div>
      </header>
      <ul className="sa-piecetiles" data-count={set.pieces.length}>
        {set.pieces.map((p) => (
          <PieceTile key={`${p.slot}:${p.product.id}`} piece={p} locked={set.locked.includes(p.slot)} open={openSlot === p.slot} panelId={panelId} onToggle={() => setOpenSlot((s) => (s === p.slot ? null : p.slot))} />
        ))}
      </ul>
      {openPiece ? <PieceDetail key={openPiece.slot} id={panelId} set={set} piece={openPiece} outfits={outfits} busy={busy} run={run} onClose={() => setOpenSlot(null)} /> : null}
      <div className="grid gap-1 px-1">
        {set.recommended || set.kind === "bundle" || set.revision > 1 ? (
          <p className="flex flex-wrap gap-2">
            {set.recommended ? <span className="sa-badge sa-badge-success">Recomendado</span> : null}
            {set.kind === "bundle" ? <span className="sa-badge sa-badge-quiet">Tudo em um anúncio</span> : null}
            {set.revision > 1 ? <span className="sa-badge sa-badge-quiet">Versão {set.revision}</span> : null}
          </p>
        ) : null}
        {set.rationale ? <p className="sa-caption sa-muted sa-pretty">{set.rationale}</p> : null}
        {blocked ? <p className="sa-caption sa-warning-text">{blocked === 1 ? "1 peça não pode ser provada. Toque nela para trocar." : `${blocked} peças não podem ser provadas. Toque nelas para trocar.`}</p> : null}
        {set.overBudget === true ? <p className="sa-caption sa-error-text">Acima do orçamento pedido.</p> : null}
        {set.missingSlots.length ? <p className="sa-caption sa-muted">Sem opção para: {set.missingSlots.join(", ")}.</p> : null}
      </div>
      {sized.length ? (
        <div className="grid gap-2">
          {sized.map((p) => (
            <label key={p.slot} className="sa-caption flex items-center gap-2">
              <span className="min-w-0 flex-1">Tamanho · {p.label}</span>
              <select className="sa-field sa-field-sm" style={{ width: "auto" }} disabled={busy} value={p.variantId ?? ""} data-testid={`outfit-size-${p.slot}`} onChange={(e) => run(() => outfits.swap(set, p.slot, p.product.id, e.target.value))}>
                <option value="" disabled>Escolha</option>
                {p.product.variants.map((v) => <option key={v.id} value={v.id ?? ""}>{v.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      ) : null}
      {versions ? <Versions set={set} outfits={outfits} busy={busy} run={run} /> : null}
      <div className="sa-outfit-foot">
        <button type="button" className={`sa-btn ${set.recommended ? "sa-btn-primary" : "sa-btn-secondary"} sa-btn-block`} disabled={busy || quoting} onClick={onGenerate} data-testid="outfit-generate">
          Gerar imagem
        </button>
        <div className="flex items-center justify-between gap-2">
          <label className="sa-outfit-check sa-body-sm">
            <input type="checkbox" checked={selected} disabled={!selected && !canSelect} onChange={(e) => onSelect(e.target.checked)} data-testid="outfit-select" aria-label={`Comparar ${set.title}`} />
            Comparar
          </label>
          <span className="flex flex-none">
            <button type="button" className="sa-btn-quiet sa-body-sm flex items-center gap-1" disabled={busy || allLocked} onClick={() => run(() => outfits.suggest(set))} aria-label={`Variar ${set.title}: montar outra combinação`} data-testid="outfit-suggest">
              {busy ? <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> : <ArrowsClockwise size={18} aria-hidden="true" />} Variar
            </button>
            {set.revision > 1 ? (
              <button type="button" className="sa-iconbtn" aria-expanded={versions} onClick={() => setVersions((v) => !v)} aria-label={`Versões de ${set.title}`} title="Versões" data-testid="outfit-history">
                <ClockCounterClockwise size={20} aria-hidden="true" />
              </button>
            ) : null}
          </span>
        </div>
      </div>
    </article>
  )
}
