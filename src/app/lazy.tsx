/**
 * Code-split screens and heavy sheets. Explorar (the home) and the light overlays (product detail,
 * viewer) stay in the entry chunk; everything else loads on demand and is prefetched when the
 * browser is idle after the first paint, so switching tabs on a phone does not wait on the network.
 */
import { Component, lazy, Suspense, type ReactNode } from "react"

/** Retries a failed chunk once (flaky mobile network); a second failure reaches the error boundary. */
function load<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => {
    pending ??= factory().catch(() => factory()).catch((e: unknown) => {
      pending = null
      throw e
    })
    return pending
  }
}

const chunks = {
  studio: load(() => import("../screens/Studio")),
  closet: load(() => import("../screens/Closet")),
  profile: load(() => import("../screens/Profile")),
  auth: load(() => import("../screens/Auth")),
  studioSheets: load(() => import("../components/StudioSheets")),
  match: load(() => import("../components/Match")),
  settings: load(() => import("../components/SettingsSheet")),
}

export const StudioScreen = lazy(() => chunks.studio().then((m) => ({ default: m.StudioScreen })))
export const ClosetScreen = lazy(() => chunks.closet().then((m) => ({ default: m.ClosetScreen })))
export const ClosetLookSheet = lazy(() => chunks.closet().then((m) => ({ default: m.ClosetLookSheet })))
export const ProfileScreen = lazy(() => chunks.profile().then((m) => ({ default: m.ProfileScreen })))
export const AuthScreenView = lazy(() => chunks.auth().then((m) => ({ default: m.AuthScreenView })))
export const EditSheet = lazy(() => chunks.studioSheets().then((m) => ({ default: m.EditSheet })))
export const AcervoSheet = lazy(() => chunks.studioSheets().then((m) => ({ default: m.AcervoSheet })))
export const PreferencePickerSheet = lazy(() => chunks.studioSheets().then((m) => ({ default: m.PreferencePickerSheet })))
export const SearchPreferenceEditor = lazy(() => chunks.studioSheets().then((m) => ({ default: m.SearchPreferenceEditor })))
export const TokensSheet = lazy(() => chunks.studioSheets().then((m) => ({ default: m.TokensSheet })))
export const MatchDialog = lazy(() => chunks.match().then((m) => ({ default: m.MatchDialog })))
export const SettingsSheet = lazy(() => chunks.settings().then((m) => ({ default: m.SettingsSheet })))
export const PasswordSheet = lazy(() => chunks.settings().then((m) => ({ default: m.PasswordSheet })))
export const DeleteAccountSheet = lazy(() => chunks.settings().then((m) => ({ default: m.DeleteAccountSheet })))

interface BoundaryProps {
  children: ReactNode
  /** Rendered while the chunk downloads. */
  fallback: ReactNode
  /** Compact error (inside a sheet or a tab) instead of a full-page one. */
  compact?: boolean
}

/** Suspense + error boundary for a lazy chunk. A failed download offers a reload, never a blank screen. */
export class Deferred extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  render(): ReactNode {
    if (this.state.failed) {
      return (
        <div className={this.props.compact ? undefined : "sa-page"} role="alert">
          <div className={this.props.compact ? "sa-state sa-state-compact" : "sa-state"}>
            <p className="sa-title-sm">Não foi possível abrir esta parte do app</p>
            <p className="sa-body-sm sa-muted sa-pretty">Verifique a conexão. Se o app foi atualizado, recarregar traz a versão nova.</p>
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm mt-2" onClick={() => window.location.reload()}>
              Recarregar
            </button>
          </div>
        </div>
      )
    }
    return <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>
  }
}

/**
 * Warms the chunks a signed-in (or signed-out) person is likely to need next. Skipped on
 * Save-Data / 2G connections, where only what is opened gets downloaded.
 */
export function prefetchChunks(signedIn: boolean): () => void {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  if (nav.connection?.saveData || /(^|-)2g$/.test(nav.connection?.effectiveType ?? "")) return () => undefined
  const order = signedIn ? [chunks.studio, chunks.studioSheets, chunks.closet, chunks.profile, chunks.match, chunks.settings] : [chunks.auth, chunks.studio]
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  let cancelled = false
  const run = (): void => {
    if (cancelled) return
    const next = order.shift()
    if (!next) return
    void next()
      .catch(() => undefined)
      .then(schedule)
  }
  let handle = 0
  const schedule = (): void => {
    if (cancelled) return
    handle = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 4000 }) : window.setTimeout(run, 1200)
  }
  schedule()
  return () => {
    cancelled = true
    if (w.cancelIdleCallback) w.cancelIdleCallback(handle)
    else window.clearTimeout(handle)
  }
}
