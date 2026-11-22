/**
 * Full-screen look: the image large, its title outside the image and the description below
 * (the page scrolls). Arrows, keys and a sideways swipe go through the generated looks of the
 * session history (GET /studio/looks) just to see and compare them; nothing is saved or changed.
 */
import { useEffect, useId, useRef, useState } from "react"
import { CaretLeft, CaretRight, X } from "@phosphor-icons/react"
import { useLook } from "../api/queries"
import { useStore } from "../app/store"
import { formatDay, plural } from "../lib/format"
import { ORIGIN_LABEL } from "../lib/looks"
import { sumLookWith, withOffer } from "../lib/offers"
import { priceText, ROLE_LABEL } from "./pieces"
import { CardSwap, useCardDrag, useLookDeck, type SwapDir } from "./LookDeck"
import { ErrorState, LoadingState, Photo, useModal, useReducedMotion } from "./ui"

export function LookViewer({ lookId }: { lookId: string }) {
  const { close, open, offerChoice } = useStore()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const reduced = useReducedMotion()
  useModal(panelRef, close, closeRef)

  const [currentId, setCurrentId] = useState(lookId)
  const [dir, setDir] = useState<SwapDir>("next")
  const start = useLook(lookId)
  // Same deck as the Estúdio photo: generated looks, then the search's other prepared looks.
  const cards = useLookDeck(start.data ?? null)
  const list = cards.map((c) => c.look)
  const index = list.findIndex((l) => l.id === currentId)
  const look = index >= 0 ? list[index] : null
  const isSuggestion = index >= 0 && cards[index]?.kind === "suggestion"
  const hasPrev = index > 0
  const hasNext = index >= 0 && index < list.length - 1

  const goTo = (i: number): void => {
    const next = list[i]
    if (!next) return
    setDir(i > index ? "next" : "prev")
    setCurrentId(next.id)
  }
  const drag = useCardDrag({ canPrev: hasPrev, canNext: hasNext, onPrev: () => goTo(index - 1), onNext: () => goTo(index + 1) })
  useEffect(() => drag.settle(), [look?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const neighbour = drag.peek ? (list[drag.peek === "next" ? index + 1 : index - 1] ?? null) : null

  // A new look starts at the image again.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" })
  }, [currentId, reduced])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      const target = e.target as HTMLElement | null
      // Arrow keys keep their own meaning inside radio groups (store tags) and fields.
      if (target?.closest("[role=radiogroup], input, textarea, select")) return
      e.preventDefault()
      if (e.key === "ArrowLeft" && hasPrev) goTo(index - 1)
      if (e.key === "ArrowRight" && hasNext) goTo(index + 1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const total = look ? sumLookWith({ ...look, pieces: look.pieces.filter((p) => p.role !== "similar") }, offerChoice) : null
  const day = look ? formatDay(look.createdAt) : null

  return (
    <div className="sa-overlay">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={look ? titleId : undefined} aria-label={look ? undefined : "Look ampliado"} className="sa-fullscreen sa-lookviewer">
        <div className="sa-lookviewer-bar">
          <p className="sa-body-sm sa-muted sa-num" aria-live="polite">
            {look && list.length > 1 ? `${index + 1} de ${list.length}` : ""}
          </p>
          <button ref={closeRef} type="button" className="sa-iconbtn" aria-label="Fechar" onClick={close}>
            <X size={24} />
          </button>
        </div>

        <div ref={scrollRef} className="sa-lookviewer-scroll">
          {look ? (
            <div className="sa-lookviewer-layout">
              <div className="sa-lookviewer-stage" {...drag.handlers}>
                <CardSwap
                  cardKey={look.id}
                  dir={dir}
                  instant={drag.flung}
                  topRef={drag.topRef}
                  under={neighbour ? <Photo image={neighbour.image} alt="" fit="contain" className="h-full w-full" /> : null}
                  className="absolute inset-0"
                >
                  <Photo image={look.image} alt={look.title} fit="contain" className="h-full w-full" eager />
                </CardSwap>
                {list.length > 1 ? (
                  <>
                    <button type="button" className="sa-iconbtn sa-photo-ctrl sa-lookviewer-nav" data-side="prev" aria-label="Look anterior" aria-disabled={!hasPrev || undefined} onClick={() => hasPrev && goTo(index - 1)}>
                      <CaretLeft size={16} weight="bold" />
                    </button>
                    <button type="button" className="sa-iconbtn sa-photo-ctrl sa-lookviewer-nav" data-side="next" aria-label="Próximo look" aria-disabled={!hasNext || undefined} onClick={() => hasNext && goTo(index + 1)}>
                      <CaretRight size={16} weight="bold" />
                    </button>
                  </>
                ) : null}
              </div>

              <article key={look.id} className="sa-lookviewer-text sa-appear">
                <h2 id={titleId} className="sa-lookviewer-title">
                  {look.title}
                </h2>
                <p className="sa-caption sa-muted mt-2">
                  {isSuggestion ? "Sugestão da busca, a mesma que aparece no Match" : `${ORIGIN_LABEL[look.origin]} · v${look.version}`}
                  {day ? ` · ${day}` : ""}
                </p>
                {look.note ? <p className="sa-body sa-pretty mt-4">{look.note}</p> : null}
                {look.prompt ? (
                  <div className="mt-5">
                    <p className="sa-fieldlabel">Pedido</p>
                    <p className="sa-body-sm sa-pretty">“{look.prompt}”</p>
                  </div>
                ) : null}
                {look.pieces.length > 0 ? (
                  <section className="mt-6" aria-labelledby={`${titleId}-pieces`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 id={`${titleId}-pieces`} className="sa-title-sm">
                        Peças deste look
                      </h3>
                      <span className="sa-caption sa-muted">
                        {plural(look.pieces.length, "peça", "peças")}
                        {total ? (
                          <>
                            {" "}
                            · somam <span className="sa-num">{total}</span>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <ul className="sa-divided mt-2">
                      {look.pieces.map(({ product, role }) => {
                        const p = withOffer(product, offerChoice[product.id])
                        return (
                          <li key={p.id}>
                            <button type="button" className="flex w-full items-center gap-3 py-3 text-left" onClick={() => open({ kind: "product", productId: p.id, back: { kind: "lookViewer", lookId: look.id } })} aria-label={`${p.name}, ${p.partner.name}, ${priceText(p)}. Ver detalhes`}>
                              <span className="sa-photo sa-thumb flex-none" style={{ width: 48, height: 60 }}>
                                <Photo image={p.images[0] ?? null} alt="" className="h-full w-full" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="sa-body-sm sa-truncate block font-semibold">{p.name}</span>
                                <span className="sa-caption sa-muted block">
                                  {look.origin !== "tryon" ? `${ROLE_LABEL[role]} · ` : ""}
                                  {p.partner.name} · <span className="sa-num">{priceText(p)}</span>
                                </span>
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                ) : null}
              </article>
            </div>
          ) : start.isError ? (
            <div className="p-4">
              <ErrorState error={start.error} onRetry={() => void start.refetch()} />
            </div>
          ) : (
            <LoadingState label="Carregando o look…" />
          )}
        </div>
      </div>
    </div>
  )
}
