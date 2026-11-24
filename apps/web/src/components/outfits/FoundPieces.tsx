/** Everything the search found, by part of the look. A piece is put on by choosing which outfit receives it. */
import { useState } from "react"
import { createPortal } from "react-dom"
import { useQuery } from "@tanstack/react-query"
import { CircleNotch } from "@phosphor-icons/react"
import { outfitsApi, type FoundGroup, type OutfitPiece, type OutfitSlotId } from "../../api/outfits"
import { useStore } from "../../app/store"
import { outfitKeys, type Outfits } from "../../app/useOutfits"
import { plural } from "../../lib/format"
import { shortPieceName } from "../../lib/titles"
import { FavButton } from "../pieces"
import { ErrorState, LoadingState, Photo, Sheet } from "../ui"
import { money, StoreLink, storeFacts } from "./OutfitCard"

function PieceSheet({ piece, outfits, onClose }: { piece: OutfitPiece; outfits: Outfits; onClose: () => void }) {
  const { setDraft, notify } = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sets = (outfits.search.data?.sets ?? []).filter((s) => s.pieces.some((p) => p.slot === piece.slot))
  const facts = storeFacts(piece)
  const use = async (set: (typeof sets)[number]): Promise<void> => {
    if (busy) return
    setBusy(set.id)
    setError(null)
    const r = await outfits.swap(set, piece.slot, piece.product.id)
    setBusy(null)
    if (!r.ok) { setError(r.message); return }
    onClose()
    setDraft((d) => ({ stageView: "sets", stageNonce: d.stageNonce + 1 }))
    notify(`${shortPieceName(piece.product.name)} entrou em ${set.title}`)
  }
  return createPortal(
    <Sheet title={shortPieceName(piece.product.name)} onClose={onClose}>
      <div className="grid gap-4" data-testid="found-sheet">
        <div className="flex gap-4">
          <span className="sa-photo flex-none" style={{ width: 120, aspectRatio: "3 / 4" }}>
            <Photo image={piece.product.images[0] ?? null} alt="" className="h-full w-full" />
          </span>
          <div className="grid min-w-0 flex-1 content-start gap-1">
            <p className="sa-body-sm font-semibold">{piece.product.name}</p>
            <p className="sa-body-sm sa-num">{money(piece.product.price)}</p>
            <p className="sa-caption sa-muted">
              {piece.label} · {piece.product.partner.name}
            </p>
            {facts ? <p className="sa-caption sa-muted sa-num">{facts}</p> : null}
            <div className="mt-2 flex items-center gap-2">
              <StoreLink piece={piece} label />
              <FavButton product={piece.product} />
            </div>
          </div>
        </div>
        {sets.length ? (
          <div className="grid gap-2">
            <p className="sa-body-sm font-semibold">Usar em qual conjunto?</p>
            {sets.map((s) => {
              const here = s.pieces.some((p) => p.product.id === piece.product.id)
              const locked = s.locked.includes(piece.slot)
              return (
                <button key={s.id} type="button" className="sa-btn sa-btn-secondary sa-btn-block justify-between" disabled={here || locked || busy !== null} onClick={() => void use(s)} data-testid="found-use" data-set-id={s.id}>
                  <span className="sa-truncate min-w-0">{s.title}</span>
                  <span className="sa-caption sa-muted flex-none">{busy === s.id ? <CircleNotch size={16} className="sa-spin" aria-label="Preparando a peça" /> : here ? "já está neste" : locked ? "peça travada" : "usar"}</span>
                </button>
              )
            })}
            {error ? <p className="sa-caption sa-error-text" role="alert">{error}</p> : null}
          </div>
        ) : (
          <p className="sa-caption sa-muted">Nenhum conjunto desta busca usa esta parte do look.</p>
        )}
      </div>
    </Sheet>,
    document.querySelector(".sa-root") ?? document.body,
  )
}

export function FoundPieces({ outfits, searchId }: { outfits: Outfits; searchId: string }) {
  const found = useQuery({ queryKey: outfitKeys.pieces(searchId), queryFn: ({ signal }) => outfitsApi.pieces(searchId, signal), staleTime: 30_000 })
  const [slot, setSlot] = useState<OutfitSlotId | null>(null)
  const [open, setOpen] = useState<OutfitPiece | null>(null)
  if (found.isPending) return <LoadingState label="Abrindo as peças…" />
  if (found.isError) return <ErrorState error={found.error} onRetry={() => void found.refetch()} compact />
  const groups: FoundGroup[] = found.data
  const total = groups.reduce((a, g) => a + g.pieces.length, 0)
  const shown = groups.filter((g) => slot === null || g.slot === slot)
  return (
    <>
      <div className="grid gap-3">
        <div className="grid gap-1">
          <h2 className="sa-heading">{plural(total, "peça encontrada", "peças encontradas")}</h2>
          <p className="sa-caption sa-muted">Toque em uma peça para ver, comprar ou colocar em um conjunto.</p>
        </div>
        {groups.length > 1 ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Parte do look">
            <button type="button" className="sa-chip" aria-pressed={slot === null} onClick={() => setSlot(null)}>
              Todas <span className="sa-num">{total}</span>
            </button>
            {groups.map((g) => (
              <button key={g.slot} type="button" className="sa-chip" aria-pressed={slot === g.slot} onClick={() => setSlot(g.slot)} data-testid={`found-part-${g.slot}`}>
                {g.label} <span className="sa-num">{g.pieces.length}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {shown.map((g) => (
        <section key={g.slot} aria-label={g.label} className="grid gap-3">
          {shown.length > 1 ? <h3 className="sa-title-sm">{g.label}</h3> : null}
          <ul className="sa-foundgrid">
            {g.pieces.map((p) => (
              <li key={p.product.id} className="min-w-0">
                <button type="button" className="sa-piecetile" onClick={() => setOpen(p)} aria-label={`${p.product.name}, ${money(p.product.price)}. Ver e usar`} data-testid="found-piece">
                  <span className="sa-piecetile-photo">
                    <Photo image={p.product.images[0] ?? null} alt="" className="h-full w-full" sizes="(min-width: 1024px) 14vw, 30vw" />
                  </span>
                  <span className="sa-caption sa-clamp2 mt-2 font-semibold">{shortPieceName(p.product.name)}</span>
                  <span className="sa-caption sa-muted sa-num block">{money(p.product.price)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {open ? <PieceSheet key={open.product.id} piece={open} outfits={outfits} onClose={() => setOpen(null)} /> : null}
    </>
  )
}
