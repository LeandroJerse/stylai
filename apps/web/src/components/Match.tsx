import { useCallback, useEffect, useRef, useState } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"
import { Archive, ArrowCounterClockwise, ArrowLeft, ArrowRight, X } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "../api/client"
import { messageOf } from "../api/errors"
import { keys, useMatchDeck } from "../api/queries"
import { useStore } from "../app/store"
import { priceText } from "./pieces"
import { ErrorState, Hint, LoadingState, Photo, useModal } from "./ui"

/** Horizontal distance (px) that confirms a decision on release. */
const THRESHOLD = 96
/** Movement before a press counts as a drag (keeps taps and vertical scroll free). */
const SLOP = 6
const MAX_ROTATION = 10
const EXIT_MS = 240
const EXIT_MS_REDUCED = 140
const RETURN_MS = 220

type Decision = "save" | "pass"

const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Match mode. Convention: drag right = save look + pieces, left = pass. Buttons and arrow keys
 * run the same decision. The deck comes from GET /studio/match/deck (looks the server already
 * has for this session): swiping never generates images. Each decision is sent to the API and
 * undo deletes it there.
 *
 * Motion: the card follows the pointer 1:1 (styles written directly, no re-render per move);
 * intent labels fade in with the distance; a confirmed card leaves in its direction while the
 * card behind grows into place, so the next one takes over without a remount or flash.
 */
export function MatchDialog() {
  const { draft, close, notify, go } = useStore()
  const qc = useQueryClient()
  const deckQuery = useMatchDeck(draft.lookId)
  const deck = deckQuery.data ?? []
  const [index, setIndex] = useState(0)
  const [history, setHistory] = useState<{ decisionId: string; lookId: string; decision: Decision }[]>([])
  const [undoing, setUndoing] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; dx: number; active: boolean } | null>(null)
  /** True while a decision animates; blocks double decisions and undo races. */
  const busy = useRef(false)
  const anim = useRef<Animation | null>(null)
  const mounted = useRef(true)
  const [leaving, setLeaving] = useState<Decision | null>(null)
  useModal(panelRef, close)

  useEffect(
    () => () => {
      mounted.current = false
      anim.current?.cancel()
    },
    [],
  )

  const look = deck[index]
  const nextLook = deck[index + 1]
  const saved = history.filter((h) => h.decision === "save").length

  /** Writes the drag position and the intent strength (-1 pass … 1 save) straight to the DOM. */
  const paint = useCallback((dx: number): void => {
    const card = cardRef.current
    const stage = stageRef.current
    if (!card || !stage) return
    const rot = Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, dx / 18))
    card.style.transform = dx === 0 ? "" : `translateX(${dx}px) rotate(${rot}deg)`
    const intent = Math.max(-1, Math.min(1, dx / THRESHOLD))
    stage.style.setProperty("--save", String(Math.max(0, intent)))
    stage.style.setProperty("--pass", String(Math.max(0, -intent)))
    stage.dataset.intent = intent >= 1 ? "save" : intent <= -1 ? "pass" : ""
  }, [])

  const settle = useCallback((): void => {
    const card = cardRef.current
    if (!card) return
    card.style.transition = `transform ${reducedMotion() ? 0 : RETURN_MS}ms var(--ease)`
    paint(0)
    window.setTimeout(() => {
      if (cardRef.current) cardRef.current.style.transition = ""
    }, RETURN_MS)
  }, [paint])

  const decide = (action: Decision): void => {
    if (!look || busy.current) return
    busy.current = true
    drag.current = null
    setLeaving(action)
    const card = cardRef.current
    const title = look.title
    const lookId = look.id
    const commit = (): void => {
      if (!mounted.current) return
      anim.current = null
      setIndex((i) => i + 1)
      paint(0)
      setLeaving(null)
      busy.current = false
      // The card already left; the server confirms (or the card comes back with the reason).
      api.studio
        .decide(lookId, action)
        .then((d) => {
          if (!mounted.current) return
          setHistory((h) => [...h, { decisionId: d.id, lookId, decision: action }])
          if (action === "save") void qc.invalidateQueries({ queryKey: keys.closet })
          notify(action === "save" ? `${title} guardado com as peças` : `${title} passou`)
        })
        .catch((e: unknown) => {
          if (!mounted.current) return
          setIndex((i) => Math.max(0, i - 1))
          notify(`Não foi possível registrar: ${messageOf(e)}`)
        })
    }
    if (!card || typeof card.animate !== "function") {
      commit()
      return
    }
    const reduced = reducedMotion()
    const dir = action === "save" ? 1 : -1
    const from = card.style.transform || "none"
    card.style.transition = ""
    const width = card.getBoundingClientRect().width
    const frames: Keyframe[] = reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { transform: from, opacity: 1 },
          { transform: `translateX(${dir * (width * 1.15)}px) rotate(${dir * MAX_ROTATION * 1.4}deg)`, opacity: 0 },
        ]
    paint(dir * THRESHOLD)
    card.style.transform = from === "none" ? "" : from
    anim.current = card.animate(frames, { duration: reduced ? EXIT_MS_REDUCED : EXIT_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" })
    anim.current.finished.then(commit, () => {
      // Cancelled (dialog closed mid-animation): nothing to commit.
      busy.current = false
    })
  }

  const undo = (): void => {
    const last = history[history.length - 1]
    if (!last || busy.current || undoing) return
    setUndoing(true)
    api.studio
      .undoDecision(last.decisionId)
      .then(() => {
        if (!mounted.current) return
        setHistory((h) => h.slice(0, -1))
        setIndex((i) => Math.max(0, i - 1))
        if (last.decision === "save") void qc.invalidateQueries({ queryKey: keys.closet })
        notify("Última decisão desfeita")
      })
      .catch((e: unknown) => {
        if (mounted.current) notify(messageOf(e))
      })
      .finally(() => {
        if (mounted.current) setUndoing(false)
      })
  }

  // The new top card reuses the element of the card that was behind (same key): clear the exit
  // animation left on the previous element and reset the drag styles.
  useEffect(() => {
    anim.current?.cancel()
    anim.current = null
    paint(0)
  }, [look?.id, paint])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (target && target.closest("button") && (e.key === "Enter" || e.key === " ")) return
      if (e.key === "ArrowRight") decide("save")
      else if (e.key === "ArrowLeft") decide("pass")
      else if ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey)) undo()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  })

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (busy.current || (e.pointerType === "mouse" && e.button !== 0)) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, active: false }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.active) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return
      // Mostly vertical: leave it to scrolling.
      if (Math.abs(dy) > Math.abs(dx)) {
        drag.current = null
        return
      }
      d.active = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    d.dx = dx
    paint(dx)
  }
  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d.active) return
    if (!cancelled && d.dx >= THRESHOLD) decide("save")
    else if (!cancelled && d.dx <= -THRESHOLD) decide("pass")
    else settle()
  }

  return (
    <div className="sa-overlay">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="match-title" className="sa-fullscreen" style={{ background: "var(--background)" }}>
        <div className="flex items-center gap-2 px-4 pt-3">
          <div className="min-w-0 flex-1">
            <h2 id="match-title" className="sa-heading">
              Match
            </h2>
            <p className="sa-caption sa-muted sa-num">
              {deck.length > 0 ? `${Math.min(index + 1, deck.length)} de ${deck.length} · ` : ""}
              {saved === 1 ? "1 guardado" : `${saved} guardados`}
            </p>
          </div>
          <button type="button" className="sa-iconbtn" aria-label="Fechar match" onClick={close}>
            <X size={24} />
          </button>
        </div>

        <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col px-4 pb-4 pt-3">
          {deckQuery.isPending ? (
            <LoadingState label="Carregando looks…" className="m-auto" />
          ) : deckQuery.isError ? (
            <ErrorState error={deckQuery.error} onRetry={() => void deckQuery.refetch()} className="m-auto" />
          ) : look ? (
            <>
              <div ref={stageRef} className="sa-matchstage" data-leaving={leaving ?? undefined}>
                <p className="sa-swipehint" aria-hidden="true">
                  <span className="sa-swipehint-pass">
                    <ArrowLeft size={16} weight="bold" /> Passar
                  </span>
                  <span className="sa-swipehint-sep">·</span>
                  <span className="sa-swipehint-save">
                    Guardar <ArrowRight size={16} weight="bold" />
                  </span>
                </p>
                <div className="relative min-h-0 flex-1" style={{ minHeight: 260 }}>
                  {[nextLook, look].map((l, i) => {
                    if (!l) return null
                    const top = i === 1
                    return (
                      <div
                        key={l.id}
                        ref={top ? cardRef : undefined}
                        className={`sa-matchcard ${top ? "sa-matchcard-top" : "sa-matchcard-next"}`}
                        aria-hidden={top ? undefined : true}
                        onPointerDown={top ? onDown : undefined}
                        onPointerMove={top ? onMove : undefined}
                        onPointerUp={top ? (e) => finish(e, false) : undefined}
                        onPointerCancel={top ? (e) => finish(e, true) : undefined}
                        onLostPointerCapture={top ? (e) => finish(e, true) : undefined}
                        role={top ? "group" : undefined}
                        aria-roledescription={top ? "cartão" : undefined}
                        aria-label={top ? `${l.title}. Arraste para a direita para guardar ou para a esquerda para passar, ou use os botões.` : undefined}
                      >
                        <Photo image={l.image} alt={top ? `Look ${l.title}` : ""} className="h-full w-full" eager={top} />
                        {top ? (
                          <>
                            <span className="sa-stamp sa-stamp-save" aria-hidden="true">
                              <Archive size={16} weight="bold" /> Guardar
                            </span>
                            <span className="sa-stamp sa-stamp-pass" aria-hidden="true">
                              <X size={16} weight="bold" /> Passar
                            </span>
                          </>
                        ) : null}
                        <div className="absolute inset-x-0 bottom-0 p-3">
                          <div className="sa-matchinfo">
                            <p className="sa-subheading">{l.title}</p>
                            <ul className="mt-2 grid gap-1">
                              {l.pieces.map((p) => (
                                <li key={p.product.id} className="flex min-w-0 justify-between gap-3 sa-caption">
                                  <span className="sa-truncate min-w-0">
                                    {p.product.name}
                                    <span className="sa-muted"> · {p.role === "similar" ? "alternativa" : "peça do look"}</span>
                                  </span>
                                  <span className="sa-num flex-none font-semibold">{priceText(p.product)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="sa-matchactions mt-4">
                <button type="button" className="sa-btn sa-btn-secondary sa-matchbtn" onClick={() => decide("pass")} aria-label={`Passar ${look.title}`} aria-disabled={leaving ? true : undefined}>
                  <X size={20} weight="bold" aria-hidden="true" /> Passar
                </button>
                <button type="button" className="sa-btn sa-btn-primary sa-matchbtn" onClick={() => decide("save")} aria-label={`Guardar ${look.title} e suas peças no Closet`} aria-disabled={leaving ? true : undefined}>
                  <Archive size={20} aria-hidden="true" /> Guardar
                </button>
              </div>
              <button type="button" className="sa-btn-quiet sa-body-sm mx-auto mt-1 flex items-center gap-2" onClick={undo} aria-disabled={history.length === 0 || leaving || undoing ? true : undefined} aria-label="Desfazer última decisão">
                <ArrowCounterClockwise size={18} aria-hidden="true" /> Desfazer
              </button>
              <Hint className="mt-2">Deslizar não gera imagens nem gasta tokens. Guardar leva o look e as peças ao Closet. Setas ← → também decidem.</Hint>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="sa-heading">{deck.length === 0 ? "Nenhum look para comparar" : "Fim dos looks desta sessão"}</p>
              <p className="sa-body-sm sa-muted max-w-xs sa-pretty">
                {deck.length === 0 ? "Gere mais looks no Estúdio para compará-los aqui." : `Você guardou ${saved} de ${deck.length}. Novos cartões exigem novas gerações, que não acontecem ao deslizar.`}
              </p>
              <div className="mt-2 grid w-full max-w-xs gap-2">
                <button
                  type="button"
                  className="sa-btn sa-btn-primary"
                  onClick={() => {
                    close()
                    go("closet")
                  }}
                >
                  Ver Closet
                </button>
                <button type="button" className="sa-btn sa-btn-secondary" onClick={close}>
                  Voltar ao Estúdio
                </button>
                <button type="button" className="sa-btn-quiet" onClick={undo} aria-disabled={history.length === 0 || undoing || undefined}>
                  Desfazer a última decisão
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
