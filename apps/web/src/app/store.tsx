/**
 * Client-only UI state: route, theme, the single overlay, toasts, Explorar filters and the Estúdio
 * draft. Server data lives in TanStack Query (api/queries.ts); nothing here duplicates it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { ImageAsset, PreferenceRules, Product, UploadedImage, SearchResult, Composition } from "../api/types"
import type { CatalogSort } from "../api/client"
import type { ToastState } from "../components/ui"
import { NO_FILTERS, type SearchFilters } from "../lib/filters"
import { readFilters } from "./filterStorage"
import { DEFAULT_ROUTE, formatRoute, parseRoute, type MainTab, type Route } from "./routes"

export type ThemePref = "light" | "dark" | "system"

export type Overlay =
  | { kind: "product"; productId: string; back?: Overlay }
  | { kind: "goToPiece"; product: Product; back?: Overlay }
  | { kind: "viewer"; image: ImageAsset; alt: string; back?: Overlay }
  /** Full-screen look: image, title and description, with arrows through the generated looks. */
  | { kind: "lookViewer"; lookId: string }
  | { kind: "edit" }
  | { kind: "match" }
  | { kind: "acervo" }
  | { kind: "preferencePicker" }
  | { kind: "preferenceEditor" }
  | { kind: "tokens"; back?: Overlay }
  | { kind: "settings" }
  | { kind: "password"; back?: Overlay }
  | { kind: "deleteAccount"; back?: Overlay }
  | { kind: "closetLook"; lookId: string }
  | { kind: "exploreFilters" }

export interface ExploreQuery {
  text: string
  category: string | null
  partner: string | null
  price: { min: number | null; max: number | null }
  favoritesOnly: boolean
  sort: CatalogSort
}

export const DEFAULT_EXPLORE: ExploreQuery = { text: "", category: null, partner: null, price: { min: null, max: null }, favoritesOnly: false, sort: "relevance" }

/**
 * Estúdio modes. "procurar": the prompt drives a catalog search and the person is shown wearing the
 * result. "vestir": no search; the chosen pieces and uploaded references are worn exactly as picked.
 */
export type StudioMode = "procurar" | "vestir"
/** What the Estúdio work area shows: outfits, generated images, or the loose pieces of the last search. */
export type StageView = "sets" | "images" | "pieces"

export interface StudioDraft {
  mode: StudioMode
  prompt: string
  /** Base pieces of the request, from Explorar or the search catalog (kept whole for display). */
  chosen: Product[]
  references: UploadedImage[]
  preferenceId: string | null
  /** Rules for this search only; null = the saved preference as is. */
  sessionRules: PreferenceRules | null
  composerOpen: boolean
  /** Look on screen (result of the last job or picked from the session history). */
  lookId: string | null
  /** Job being followed (generation, edit or try-on). */
  jobId: string | null
  /**
   * Look whose search pool is the Acervo. Kept across modes, edits and try-ons; only a new search
   * result (a generated look with candidates) replaces it.
   */
  acervoLookId: string | null
  /** Pieces selected in the Acervo for a try-on (kept while the Acervo stays the same). */
  acervoSelection: string[]
  /** Size/variant chosen per product id, when a piece has more than one available variant. */
  variantChoice: Record<string, string>
  /** Last search step result (Procurar on the curated catalog); selection happens on top of it. */
  searchResult: SearchResult | null
  /** Outfit search open on the board (null = the last one; the search itself lives on the server). */
  outfitSearchId: string | null
  /** Purchase filters of the next search. */
  filters: SearchFilters
  /** View chosen for the work area (null = the screen decides). */
  stageView: StageView | null
  /** Grows when the person asks for something: the work area comes into sight. */
  stageNonce: number
  /** Outfit proposed by the composer (durable on the server; reopened by id). */
  composition: Composition | null
}

/** Draft patch that shows a look; it becomes the Acervo only when it is a search result. */
export function showLookPatch(d: StudioDraft, look: { id: string; origin?: string; candidatesCount: number }): Partial<StudioDraft> {
  const isSearch = (look.origin === undefined || look.origin === "generate") && look.candidatesCount > 0
  if (!isSearch || look.id === d.acervoLookId) return { lookId: look.id }
  return { lookId: look.id, acervoLookId: look.id, acervoSelection: [] }
}

export const EMPTY_DRAFT: StudioDraft = { mode: "procurar", prompt: "", chosen: [], references: [], preferenceId: null, sessionRules: null, composerOpen: true, lookId: null, jobId: null, outfitSearchId: null, filters: NO_FILTERS, stageView: null, stageNonce: 0, acervoLookId: null, acervoSelection: [], variantChoice: {}, searchResult: null, composition: null }

interface Store {
  route: Route
  tab: MainTab
  prevTab: MainTab
  go: (route: Route | MainTab) => void
  theme: ThemePref
  resolvedTheme: "light" | "dark"
  setTheme: (t: ThemePref) => void
  overlay: Overlay | null
  open: (o: Overlay) => void
  close: () => void
  toast: ToastState | null
  notify: (message: string, action?: ToastState["action"]) => void
  dismissToast: () => void
  explore: ExploreQuery
  setExplore: (patch: Partial<ExploreQuery>) => void
  draft: StudioDraft
  setDraft: (patch: Partial<StudioDraft> | ((d: StudioDraft) => Partial<StudioDraft>)) => void
  resetDraft: () => void
  /** Store chosen per product (productId -> partnerId). Absent = the product's own store. */
  offerChoice: Record<string, string>
  chooseOffer: (productId: string, partnerId: string) => void
}

const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useStore outside StoreProvider")
  return ctx
}

const THEME_KEY = "stylai-theme"

function readTheme(): ThemePref {
  try {
    const v = window.localStorage.getItem(THEME_KEY)
    return v === "dark" || v === "system" ? v : "light"
  } catch {
    return "light"
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  const lastTab = useRef<MainTab>(route.kind === "tab" ? route.tab : "explorar")
  const routeRef = useRef<Route>(route)
  routeRef.current = route
  const [prevTab, setPrevTab] = useState<MainTab>("explorar")
  const scrollByTab = useRef<Partial<Record<MainTab, number>>>({})
  const [theme, setThemeState] = useState<ThemePref>(readTheme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [explore, setExploreState] = useState<ExploreQuery>(DEFAULT_EXPLORE)
  const [draft, setDraftState] = useState<StudioDraft>(() => ({ ...EMPTY_DRAFT, filters: readFilters() }))
  const [offerChoice, setOfferChoice] = useState<Record<string, string>>({})
  const chooseOffer = useCallback((productId: string, partnerId: string) => setOfferChoice((c) => (c[productId] === partnerId ? c : { ...c, [productId]: partnerId })), [])

  useEffect(() => {
    const q = window.matchMedia("(prefers-color-scheme: dark)")
    const update = (): void => setSystemDark(q.matches)
    q.addEventListener("change", update)
    return () => q.removeEventListener("change", update)
  }, [])

  const applyRoute = useCallback((next: Route) => {
    if (next.kind === "tab") {
      const from = lastTab.current
      if (from !== next.tab) {
        scrollByTab.current[from] = window.scrollY
        setPrevTab(from)
        lastTab.current = next.tab
        const y = scrollByTab.current[next.tab] ?? 0
        window.requestAnimationFrame(() => window.scrollTo({ top: y }))
      }
    } else {
      window.requestAnimationFrame(() => window.scrollTo({ top: 0 }))
    }
    setOverlay(null)
    setRoute(next)
  }, [])

  useEffect(() => {
    const onHash = (): void => applyRoute(parseRoute(window.location.hash))
    window.addEventListener("hashchange", onHash)
    if (!window.location.hash) window.history.replaceState(null, "", formatRoute(DEFAULT_ROUTE))
    return () => window.removeEventListener("hashchange", onHash)
  }, [applyRoute])

  const go = useCallback(
    (target: Route | MainTab) => {
      const next: Route = typeof target === "string" ? { kind: "tab", tab: target } : target
      const hash = formatRoute(next)
      // P01: compare with the RENDERED route too. A history.replaceState elsewhere (e.g. password reset) changes the
      // URL without a hashchange; comparing only the URL made go() a silent no-op while the screen stayed stale.
      if (window.location.hash === hash && formatRoute(routeRef.current) === hash) {
        setOverlay(null)
        if (next.kind === "tab") window.scrollTo({ top: 0 })
        return
      }
      if (window.location.hash !== hash) window.history.pushState(null, "", hash)
      applyRoute(next)
    },
    [applyRoute],
  )

  const setTheme = useCallback((t: ThemePref) => {
    setThemeState(t)
    try {
      window.localStorage.setItem(THEME_KEY, t)
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }, [])

  const notify = useCallback((message: string, action?: ToastState["action"]) => setToast({ id: Date.now(), message, action }), [])
  const dismissToast = useCallback(() => setToast(null), [])

  // Focus returns to the element that opened the first overlay when the last one closes.
  const opener = useRef<HTMLElement | null>(null)
  const open = useCallback((o: Overlay) => {
    setOverlay((cur) => {
      if (!cur) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      return o
    })
  }, [])
  useEffect(() => {
    if (overlay !== null) return
    const el = opener.current
    opener.current = null
    if (el) window.requestAnimationFrame(() => document.contains(el) && el.focus())
  }, [overlay])
  const close = useCallback(() => setOverlay((cur) => (cur && "back" in cur && cur.back ? cur.back : null)), [])

  const setExplore = useCallback((patch: Partial<ExploreQuery>) => setExploreState((q) => ({ ...q, ...patch })), [])
  const setDraft = useCallback((patch: Partial<StudioDraft> | ((d: StudioDraft) => Partial<StudioDraft>)) => setDraftState((d) => ({ ...d, ...(typeof patch === "function" ? patch(d) : patch) })), [])
  const resetDraft = useCallback(() => setDraftState(EMPTY_DRAFT), [])

  const value = useMemo<Store>(
    () => ({
      route,
      tab: route.kind === "tab" ? route.tab : lastTab.current,
      prevTab,
      go,
      theme,
      resolvedTheme: theme === "system" ? (systemDark ? "dark" : "light") : theme,
      setTheme,
      overlay,
      open,
      close,
      toast,
      notify,
      dismissToast,
      explore,
      setExplore,
      draft,
      setDraft,
      resetDraft,
      offerChoice,
      chooseOffer,
    }),
    [route, prevTab, go, theme, systemDark, setTheme, overlay, open, close, toast, notify, dismissToast, explore, setExplore, draft, setDraft, resetDraft, offerChoice, chooseOffer],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
