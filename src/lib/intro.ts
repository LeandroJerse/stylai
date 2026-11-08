/**
 * Explorar opening: a full-screen layer that plays for ~3.6 s (3.2 s in the light variant) and
 * leads the eye to the catalog search. Principles studied on escape.cafe (one strong mask gesture
 * rising from the bottom, overlapping steps, media → message → controls); nothing is copied.
 * Spec and measurements: .reanimate/abertura/spec.md.
 *
 * Narrative (full): the ivory veil covers the screen → a hero-coloured panel rises from the
 * bottom edge → monogram and message → a champagne thread → the message leaves, the panel
 * shrinks into the real hero card while the veil fades (the background becomes the layout) →
 * the thread reappears under the search (or under "Explorar peças" when the search is below
 * the fold) and the layer is removed.
 *
 * Rules: the page is mounted and usable underneath from frame 0; the layer only uses tokens,
 * text and the monogram already shown in the header, so nothing waits for images, models or the
 * network. Any tap, key, wheel/scroll, focus or the skip button ends it at once; it plays at
 * most once per session, only when the app opens on Explorar, never with reduced motion.
 */

export const INTRO_KEY = "stylai-intro-seen"

export type IntroMode = "full" | "lite"

export interface IntroStep {
  /** Which layer part the step moves. */
  part: "panel" | "mark" | "words" | "title" | "thread" | "message" | "veil" | "seam"
  start: number
  duration: number
  /** Extra delay per item for staggered parts (title words). */
  stagger?: number
  /** Animated CSS properties, documented for tests and for the spec. */
  props: ("clip-path" | "opacity" | "transform")[]
}

const FULL: IntroStep[] = [
  { part: "panel", start: 0, duration: 1000, props: ["clip-path"] },
  { part: "mark", start: 250, duration: 800, props: ["opacity", "transform"] },
  { part: "words", start: 600, duration: 760, stagger: 90, props: ["opacity", "transform"] },
  { part: "thread", start: 900, duration: 800, props: ["transform"] },
  { part: "message", start: 1950, duration: 400, props: ["opacity", "transform"] },
  { part: "panel", start: 2000, duration: 900, props: ["clip-path"] },
  { part: "veil", start: 2400, duration: 600, props: ["opacity"] },
  { part: "panel", start: 2550, duration: 450, props: ["opacity"] },
  { part: "seam", start: 2850, duration: 750, props: ["transform", "opacity"] },
]

const LITE: IntroStep[] = [
  { part: "mark", start: 150, duration: 700, props: ["opacity", "transform"] },
  { part: "title", start: 450, duration: 750, props: ["opacity", "transform"] },
  { part: "thread", start: 800, duration: 700, props: ["transform"] },
  { part: "message", start: 1650, duration: 350, props: ["opacity", "transform"] },
  { part: "veil", start: 2050, duration: 650, props: ["opacity"] },
  { part: "seam", start: 2400, duration: 800, props: ["transform", "opacity"] },
]

/** Number of title words in the layer (stagger math). Kept in sync with INTRO_WORDS. */
export const INTRO_WORDS = ["Escolha", "a", "peça.", "O look", "vem", "junto."]

export function introTimeline(mode: IntroMode): IntroStep[] {
  return mode === "full" ? FULL : LITE
}

/** When the last step ends: the layer is removed at this time. */
export function introTotal(mode: IntroMode): number {
  return Math.max(
    ...introTimeline(mode).map((s) => s.start + (s.stagger ?? 0) * (s.part === "words" ? INTRO_WORDS.length - 1 : 0) + s.duration),
  )
}

/** Light variant for phones, data-saver and low-end devices: opacity/transform only. */
export function introMode(env: { width: number; cores?: number; memoryGb?: number; saveData?: boolean }): IntroMode {
  if (env.width < 640 || env.saveData) return "lite"
  if (env.cores !== undefined && env.cores <= 2) return "lite"
  if (env.memoryGb !== undefined && env.memoryGb <= 2) return "lite"
  return "full"
}

export function shouldRunIntro(opts: { reducedMotion: boolean; startTab: string; storage: Pick<Storage, "getItem"> | null }): boolean {
  if (opts.reducedMotion || opts.startTab !== "explorar") return false
  try {
    return opts.storage?.getItem(INTRO_KEY) !== "1"
  } catch {
    return true
  }
}

export function markIntroSeen(storage: Pick<Storage, "setItem"> | null): void {
  try {
    storage?.setItem(INTRO_KEY, "1")
  } catch {
    // Private mode or blocked storage: the opening may play again next load, which is harmless.
  }
}

/** A printable character without modifiers: it should land in the search, not be lost. */
export function isTypingKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** The thread lands under the search when it is fully on screen above the bottom bar; otherwise under the CTA that leads to it. */
export function pickTarget(search: Box | null, cta: Box | null, view: { top: number; bottom: number }): "search" | "cta" | null {
  if (search && search.y >= view.top && search.y + search.height <= view.bottom - 8) return "search"
  if (cta && cta.y >= view.top && cta.y + cta.height <= view.bottom) return "cta"
  return null
}

/** clip-path inset() that keeps exactly `box` of a full-viewport element. */
export function insetFor(box: Box, viewport: { width: number; height: number }, radius: number): string {
  const r = (n: number): string => `${Math.max(0, Math.round(n))}px`
  return `inset(${r(box.y)} ${r(viewport.width - box.x - box.width)} ${r(viewport.height - box.y - box.height)} ${r(box.x)} round ${r(radius)})`
}

const OUT = "cubic-bezier(0.16, 1, 0.3, 1)"
const IN_OUT = "cubic-bezier(0.7, 0, 0.2, 1)"
const FULL_SCREEN = "inset(0px 0px 0px 0px round 0px)"

export interface IntroController {
  /** Ends everything now (finished state) and clears pending timers. */
  finish: () => void
}

/**
 * Builds the opening on `layer` (the fixed full-screen element) over `page` (Explorar).
 * Steps whose target depends on the final layout (the hero rect, the thread's landing place)
 * are measured when they start, so late font or catalog loading cannot misplace them.
 */
export function playIntro(layer: HTMLElement, page: HTMLElement, mode: IntroMode): IntroController {
  const anims: Animation[] = []
  const timers: number[] = []
  const at = (ms: number, fn: () => void): void => {
    timers.push(window.setTimeout(fn, ms))
  }
  const run = (el: Element | null, frames: Keyframe[], delay: number, duration: number, easing: string, fill: FillMode = "both"): void => {
    if (!el || typeof (el as HTMLElement).animate !== "function") return
    anims.push((el as HTMLElement).animate(frames, { delay, duration, easing, fill }))
  }
  const q = (sel: string): HTMLElement | null => layer.querySelector<HTMLElement>(sel)
  const step = (part: IntroStep["part"], nth = 0): IntroStep => {
    const found = introTimeline(mode).filter((s) => s.part === part)[nth]
    if (!found) throw new Error(`intro timeline has no step ${part}#${nth} in ${mode}`)
    return found
  }

  const mark = q(".sa-intro-mark")
  const message = q(".sa-intro-message")
  const thread = q(".sa-intro-thread")
  const veil = q(".sa-intro-veil")
  const panel = q(".sa-intro-panel")

  const m = step("mark")
  run(mark, [{ opacity: 0, transform: `translateY(${mode === "full" ? 12 : 10}px)` }, { opacity: 1, transform: "none" }], m.start, m.duration, OUT, "backwards")
  const th = step("thread")
  run(thread, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], th.start, th.duration, IN_OUT, "backwards")

  if (mode === "full") {
    const rise = step("panel", 0)
    run(panel, [{ clipPath: "inset(100% 0px 0px 0px round 0px)" }, { clipPath: FULL_SCREEN }], rise.start, rise.duration, IN_OUT, "backwards")
    const w = step("words")
    layer.querySelectorAll(".sa-intro-word").forEach((word, i) => {
      run(word, [{ opacity: 0, transform: "translateY(0.45em)" }, { opacity: 1, transform: "none" }], w.start + i * (w.stagger ?? 0), w.duration, OUT, "backwards")
    })
    // The panel becomes the hero card: measured when the step starts.
    const compose = step("panel", 1)
    const land = step("panel", 2)
    at(compose.start, () => {
      const hero = page.querySelector(".sa-hero")
      if (!panel || !hero) return
      const b = hero.getBoundingClientRect()
      const vp = { width: window.innerWidth, height: window.innerHeight }
      run(panel, [{ clipPath: FULL_SCREEN }, { clipPath: insetFor({ x: b.x, y: b.y, width: b.width, height: b.height }, vp, 28) }], 0, compose.duration, IN_OUT, "forwards")
      run(panel, [{ opacity: 1 }, { opacity: 0 }], land.start - compose.start, land.duration, OUT, "forwards")
    })
  } else {
    const t = step("title")
    run(q(".sa-intro-title"), [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], t.start, t.duration, OUT, "backwards")
  }

  const out = step("message")
  run(message, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateY(${mode === "full" ? -10 : -8}px)` }], out.start, out.duration, IN_OUT, "forwards")
  const v = step("veil")
  run(veil, [{ opacity: 1 }, { opacity: 0 }], v.start, v.duration, OUT, "forwards")

  // The thread lands under the search (or the CTA that leads to it), measured when it starts.
  const s = step("seam")
  let seam: HTMLElement | null = null
  at(s.start, () => {
    const box = (sel: string): Box | null => {
      const el = page.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    const header = document.querySelector(".sa-header")?.getBoundingClientRect().bottom ?? 0
    const nav = document.querySelector<HTMLElement>(".sa-bottomnav")
    const navTop = nav && nav.offsetParent !== null ? nav.getBoundingClientRect().top : window.innerHeight
    const target = pickTarget(box(".sa-searchbar"), box(".sa-hero-actions .sa-btn-primary"), { top: header, bottom: Math.min(navTop, window.innerHeight) })
    seam = target ? page.querySelector<HTMLElement>(target === "search" ? ".sa-searchbar .sa-seam" : ".sa-hero-actions .sa-seam") : null
    if (!seam) return
    seam.dataset.active = target ?? ""
    run(
      seam,
      [
        // draw, hold the full line on the search, then let it go gently
        { transform: "scaleX(0)", opacity: 1, easing: IN_OUT },
        { transform: "scaleX(1)", opacity: 1, offset: 0.5 },
        { transform: "scaleX(1)", opacity: 1, offset: 0.75, easing: "ease-in" },
        { transform: "scaleX(1)", opacity: 0 },
      ],
      0,
      s.duration,
      "linear",
      "none",
    )
  })

  return {
    finish: () => {
      timers.forEach((t) => window.clearTimeout(t))
      timers.length = 0
      anims.forEach((a) => {
        try {
          a.finish()
        } catch {
          a.cancel()
        }
      })
      anims.length = 0
      if (seam) delete seam.dataset.active
    },
  }
}
