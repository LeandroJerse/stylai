/**
 * The deck of looks the Estúdio photo and the opened look page through, like cards (brief
 * 2026-11-12): the session's generated looks (GET /studio/looks, newest first) followed by the
 * other looks prepared for the last search (GET /studio/match/deck, the same cards Match shows).
 * Generated looks can be selected; suggestions are only previewed.
 */
import { useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react"
import { useLooks, useMatchDeck, useStudioConfig } from "../api/queries"
import type { Look } from "../api/types"
import { useStore } from "../app/store"
import { useReducedMotion } from "./ui"

export interface DeckCard {
  key: string
  kind: "result" | "suggestion"
  look: Look
}

export function useLookDeck(current: Look | null = null): DeckCard[] {
  const { draft } = useStore()
  const history = useLooks(true)
  // The suggestions follow the last search (the Acervo), so they do not change while browsing.
  // Outfits engine: the match deck is the generated looks themselves, never extra suggestions.
  const prepared = useStudioConfig().data?.capabilities.outfits !== true
  const origin = draft.acervoLookId ?? draft.lookId
  const suggestions = useMatchDeck(origin, prepared && origin !== null)
  const results = [...(history.data ?? [])]
  if (current && !results.some((l) => l.id === current.id)) results.unshift(current)
  const cards: DeckCard[] = results.map((look) => ({ key: look.id, kind: "result", look }))
  const seen = new Set(cards.map((c) => c.key))
  for (const look of prepared ? (suggestions.data ?? []) : []) {
    if (seen.has(look.id)) continue
    seen.add(look.id)
    cards.push({ key: look.id, kind: "suggestion", look })
  }
  return cards
}

export type SwapDir = "next" | "prev"

/** Controls that sit on top of a card and must keep their own click (never start a drag). */
const NO_DRAG = ".sa-stagenav, .sa-matchcta, .sa-photo-ctrl, .sa-lookviewer-nav, .sa-badge"

interface DragOptions {
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
}

/**
 * Hold-and-drag paging, like a deck of cards (brief 2026-11-12): the top card follows the finger or
 * the mouse 1:1 with a slight turn, the neighbour card shows underneath, and on release it is thrown
 * off the side (past ~22% of the width) or springs back. At the ends of the deck the card resists.
 * Moves are written straight to the element's style, so dragging does not re-render per frame.
 */
export function useCardDrag({ canPrev, canNext, onPrev, onNext }: DragOptions) {
  const reduced = useReducedMotion()
  const topRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; dx: number; width: number; active: boolean } | null>(null)
  const justDragged = useRef(false)
  const [peek, setPeek] = useState<SwapDir | null>(null)
  const [flung, setFlung] = useState(false)
  const opts = useRef({ canPrev, canNext, onPrev, onNext })
  opts.current = { canPrev, canNext, onPrev, onNext }

  const place = (dx: number, transition: string): void => {
    const el = topRef.current
    if (!el) return
    el.style.transition = transition
    el.style.transform = dx === 0 ? "" : `translateX(${dx}px) rotate(${dx * 0.025}deg)`
  }
  const release = (host: HTMLElement): void => {
    const d = drag.current
    drag.current = null
    host.style.cursor = ""
    if (!d || !d.active) return
    justDragged.current = true
    window.setTimeout(() => (justDragged.current = false), 350)
    const dir: SwapDir = d.dx < 0 ? "next" : "prev"
    const allowed = dir === "next" ? opts.current.canNext : opts.current.canPrev
    if (allowed && Math.abs(d.dx) > Math.max(64, d.width * 0.22)) {
      const out = (d.dx < 0 ? -1 : 1) * d.width * 1.25
      place(out, reduced ? "none" : "transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1)")
      window.setTimeout(
        () => {
          setFlung(true)
          setPeek(null)
          if (dir === "next") opts.current.onNext()
          else opts.current.onPrev()
        },
        reduced ? 0 : 200,
      )
    } else {
      place(0, reduced ? "none" : "transform 280ms cubic-bezier(0.16, 1, 0.3, 1)")
      window.setTimeout(() => setPeek(null), reduced ? 0 : 260)
    }
  }

  return {
    topRef,
    peek,
    /** True for the render right after a thrown card: the swap then needs no extra animation. */
    flung,
    settle: (): void => setFlung(false),
    /** True right after a drag, so the photo's own click (show/hide title) is skipped. */
    dragged: (): boolean => justDragged.current,
    handlers: {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>): void => {
        if (e.button !== 0 || (e.target as HTMLElement).closest(NO_DRAG)) return
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, width: e.currentTarget.getBoundingClientRect().width, active: false }
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>): void => {
        const d = drag.current
        if (!d || d.id !== e.pointerId) return
        let dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (!d.active) {
          // Vertical intent stays a page scroll.
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
            drag.current = null
            return
          }
          if (Math.abs(dx) < 8) return
          d.active = true
          e.currentTarget.setPointerCapture(e.pointerId)
          e.currentTarget.style.cursor = "grabbing"
        }
        const dir: SwapDir = dx < 0 ? "next" : "prev"
        const allowed = dir === "next" ? opts.current.canNext : opts.current.canPrev
        if (!allowed) dx *= 0.25
        d.dx = dx
        setPeek(allowed ? dir : null)
        place(dx, "none")
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>): void => release(e.currentTarget),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>): void => {
        if (drag.current) drag.current.dx = 0
        release(e.currentTarget)
      },
    },
  }
}

/**
 * Card swap: when `cardKey` changes, the old card is thrown to the side with a slight turn while the
 * new one rises from underneath, like dealing cards (arrows and keys). After a card was thrown by
 * hand (`instant`) the new card is already in place, so nothing else animates. `under` is the
 * neighbour card shown beneath while dragging. Reduced motion: a plain cross-fade.
 */
export function CardSwap({ cardKey, dir, children, under = null, instant = false, topRef, className = "" }: { cardKey: string; dir: SwapDir; children: ReactNode; under?: ReactNode; instant?: boolean; topRef?: RefObject<HTMLDivElement | null>; className?: string }) {
  const reduced = useReducedMotion()
  // The node of the card on screen, kept after each commit so the outgoing card can be drawn.
  const lastNode = useRef<ReactNode>(children)
  const [prevKey, setPrevKey] = useState(cardKey)
  const [ghost, setGhost] = useState<{ key: string; node: ReactNode; dir: SwapDir } | null>(null)
  // Derived during render, so the old card is in the same frame as the new one (no flash).
  if (prevKey !== cardKey) {
    setPrevKey(cardKey)
    setGhost(instant ? null : { key: prevKey, node: lastNode.current, dir })
  }
  useEffect(() => {
    lastNode.current = children
  })
  useEffect(() => {
    if (!ghost) return undefined
    const t = window.setTimeout(() => setGhost(null), reduced ? 200 : 460)
    return () => window.clearTimeout(t)
  }, [ghost, reduced])
  return (
    <div className={`sa-cardswap ${className}`}>
      {under ? (
        <div className="sa-cardswap-card sa-cardswap-under" aria-hidden="true">
          {under}
        </div>
      ) : null}
      {ghost ? (
        <div key={`out-${ghost.key}`} className="sa-cardswap-card sa-cardswap-out" data-dir={ghost.dir} aria-hidden="true">
          {ghost.node}
        </div>
      ) : null}
      <div key={`in-${cardKey}`} ref={topRef} className="sa-cardswap-card sa-cardswap-in" data-dir={dir} data-animate={ghost ? "" : undefined}>
        {children}
      </div>
    </div>
  )
}
