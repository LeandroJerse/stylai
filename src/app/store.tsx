/**
 * Client-only UI state: route, theme, the single overlay, toasts, Explorar filters and the Estúdio
 * draft. Server data lives in TanStack Query (api/queries.ts); nothing here duplicates it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { ImageAsset, PreferenceRules, Product, UploadedImage } from "../api/types"
import type { CatalogSort } from "../api/client"
import type { ToastState } from "../components/ui"
import { DEFAULT_ROUTE, formatRoute, parseRoute, type MainTab, type Route } from "./routes"

export type ThemePref = "light" | "dark" | "system"

export type Overlay =
  | { kind: "product"; productId: string; back?: Overlay }
  | { kind: "goToPiece"; product: Product; back?: Overlay }
  | { kind: "viewer"; image: ImageAsset; alt: string; back?: Overlay }
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

export interface StudioDraft {
  prompt: string
  /** Catalog pieces carried from Explorar into the request (kept whole for display). */
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
  /** Pieces selected in the search pool for a try-on. */
  acervoSelection: string[]
}

export const EMPTY_DRAFT: StudioDraft = { prompt: "", chosen: [], references: [], preferenceId: null, sessionRules: null, composerOpen: true, lookId: null, jobId: null, acervoSelection: [] }

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
  const [prevTab, setPrevTab] = useState<MainTab>("explorar")
  const scrollByTab = useRef<Partial<Record<MainTab, number>>>({})
  const [theme, setThemeState] = useState<ThemePref>(readTheme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [explore, setExploreState] = useState<ExploreQuery>(DEFAULT_EXPLORE)
  const [draft, setDraftState] = useState<StudioDraft>(EMPTY_DRAFT)

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
      if (window.location.hash === hash) {
        setOverlay(null)
        if (next.kind === "tab") window.scrollTo({ top: 0 })
        return
      }
      window.history.pushState(null, "", hash)
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
    }),
    [route, prevTab, go, theme, systemDark, setTheme, overlay, open, close, toast, notify, dismissToast, explore, setExplore, draft, setDraft, resetDraft],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
