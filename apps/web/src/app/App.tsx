/**
 * App shell. Providers (TanStack Query → Auth → UI store), header and navigation, the account
 * gate for private tabs, the auth screens, the single overlay and the job watcher.
 * Navigation: Explorar (home, public) · Estúdio (centre) · Perfil; Closet from the header button.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { Archive, Coins, Compass, Moon, PenNib, SignIn, Sun, User } from "@phosphor-icons/react"
import { IconContext } from "@phosphor-icons/react"
import { createQueryClient, useBalance, useCloset } from "../api/queries"
import { AuthProvider, useAuth } from "../auth/AuthProvider"
import { OverlayHost } from "../components/OverlayHost"
import { BrandLockup, EmptyState, LoadingState, Toast } from "../components/ui"
import { ExploreScreen } from "../screens/Explore"
import { AuthScreenView, ClosetScreen, Deferred, prefetchChunks, ProfileScreen, StudioScreen } from "./lazy"
import type { MainTab } from "./routes"
import { StoreProvider, useStore } from "./store"
import { JobWatcher } from "./useStudio"

type NavTab = Exclude<MainTab, "closet">
const NAV: { id: NavTab; label: string; Icon: typeof PenNib; center?: boolean }[] = [
  { id: "explorar", label: "Explorar", Icon: Compass },
  { id: "estudio", label: "Estúdio", Icon: PenNib, center: true },
  { id: "perfil", label: "Perfil", Icon: User },
]

const SURFACE = { light: "#F7F3ED", dark: "#242424" } as const

function BalanceChip({ compact = false }: { compact?: boolean }) {
  const { open } = useStore()
  const balance = useBalance(true)
  const tokens = balance.data?.tokens
  return (
    <button type="button" className="sa-headbtn" onClick={() => open({ kind: "tokens" })} aria-label={tokens !== undefined ? `Saldo: ${tokens} tokens. Ver planos` : "Ver saldo e planos"}>
      <Coins size={20} aria-hidden="true" />
      <span className="sa-num font-semibold">{tokens ?? "–"}</span>
      {compact ? null : <span className="sa-caption sa-muted">tokens</span>}
    </button>
  )
}

/** One-tap light/dark switch in the header; Configurações keeps Claro/Escuro/Sistema. */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useStore()
  const dark = resolvedTheme === "dark"
  return (
    <button type="button" className="sa-iconbtn" aria-label={dark ? "Mudar para tema claro" : "Mudar para tema escuro"} title={dark ? "Tema claro" : "Tema escuro"} onClick={() => setTheme(dark ? "light" : "dark")}>
      {dark ? <Sun size={20} /> : <Moon size={20} />}
    </button>
  )
}

function ClosetButton({ signedIn }: { signedIn: boolean }) {
  const { tab, route, go } = useStore()
  const closet = useCloset(signedIn)
  const count = closet.data ? closet.data.looks.length + closet.data.pieces.length : 0
  const active = route.kind === "tab" && tab === "closet"
  return (
    <button
      type="button"
      className="sa-headbtn sa-closetbtn"
      aria-current={active ? "page" : undefined}
      aria-label={`Closet${count > 0 ? `, ${count} ${count === 1 ? "item guardado" : "itens guardados"}` : ""}`}
      onClick={() => go("closet")}
    >
      <Archive size={20} weight={active ? "fill" : "regular"} aria-hidden="true" />
      <span className="font-semibold">Closet</span>
      {count > 0 ? (
        <span className="sa-countbadge sa-num" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </button>
  )
}

function SignInButton() {
  const { go, tab } = useStore()
  return (
    <button type="button" className="sa-headbtn sa-closetbtn" onClick={() => go({ kind: "auth", screen: "entrar", next: tab, token: null })}>
      <SignIn size={20} aria-hidden="true" />
      <span className="font-semibold">Entrar</span>
    </button>
  )
}

const GATE: Record<Exclude<MainTab, "explorar">, { title: string; text: string }> = {
  estudio: { title: "Entre para usar o Estúdio", text: "O Estúdio monta looks com peças das lojas parceiras e usa tokens da sua conta." },
  closet: { title: "Entre para ver seu Closet", text: "O Closet guarda as peças favoritas e os looks que você salvar, em qualquer aparelho." },
  perfil: { title: "Entre para ver seu Perfil", text: "No Perfil ficam suas fotos para a prova no corpo, medidas e configurações da conta." },
}

/** What a private tab shows to someone who is not signed in. */
function AccountGate({ tab }: { tab: Exclude<MainTab, "explorar"> }) {
  const { go } = useStore()
  const g = GATE[tab]
  return (
    <div className="sa-page">
      <EmptyState
        title={g.title}
        className="sa-gate"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="sa-btn sa-btn-primary" onClick={() => go({ kind: "auth", screen: "entrar", next: tab, token: null })}>
              Entrar
            </button>
            <button type="button" className="sa-btn sa-btn-secondary" onClick={() => go({ kind: "auth", screen: "criar-conta", next: tab, token: null })}>
              Criar conta
            </button>
          </div>
        }
      >
        {g.text}
      </EmptyState>
    </div>
  )
}

function Private({ tab, children }: { tab: Exclude<MainTab, "explorar">; children: ReactNode }) {
  const { status } = useAuth()
  if (status === "restoring") return <LoadingState label="Restaurando sua sessão…" className="sa-page" />
  if (status === "signed-out") return <AccountGate tab={tab} />
  return <Deferred fallback={<LoadingState className="sa-page" />}>{children}</Deferred>
}

/** Session side effects: expired notice, private draft reset on account change, auth redirects. */
function useSessionEffects(): void {
  const { status, user, expired, clearExpired } = useAuth()
  const { notify, resetDraft, route, go } = useStore()
  const lastUser = useRef<string | null>(null)

  useEffect(() => {
    if (!expired) return
    notify("Sua sessão terminou. Entre de novo para continuar.")
    clearExpired()
  }, [expired, clearExpired, notify])

  useEffect(() => {
    const id = user?.id ?? null
    if (lastUser.current !== null && lastUser.current !== id) resetDraft()
    lastUser.current = id
  }, [user, resetDraft])

  // Signed in on entrar/criar-conta/recuperar-senha (e.g. a bookmarked link): go where they meant to.
  useEffect(() => {
    if (status === "signed-in" && route.kind === "auth" && route.screen !== "redefinir-senha") go(route.next ?? "explorar")
  }, [status, route, go])
}

function Shell() {
  const { tab, route, go, toast, dismissToast, resolvedTheme, overlay } = useStore()
  const { status, connected } = useAuth()
  const signedIn = status === "signed-in"
  const inert = overlay !== null
  const dark = resolvedTheme === "dark"
  const [studioVisited, setStudioVisited] = useState(tab === "estudio")
  useSessionEffects()

  useEffect(() => {
    if (tab === "estudio" && route.kind === "tab") setStudioVisited(true)
  }, [tab, route.kind])

  // After the first paint, warm the chunks this person is likely to open next.
  useEffect(() => {
    if (status === "restoring") return
    return prefetchChunks(signedIn)
  }, [status, signedIn])

  useEffect(() => {
    document.documentElement.style.colorScheme = resolvedTheme
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", SURFACE[resolvedTheme])
    document.body.style.background = SURFACE[resolvedTheme]
  }, [resolvedTheme])

  if (route.kind === "auth") {
    return (
      <div className="sa-shell">
        <Deferred fallback={<LoadingState className="sa-page" />}>
          <AuthScreenView screen={route.screen} next={route.next} token={route.token} />
        </Deferred>
        <OverlayHost />
        <Toast toast={toast} onDismiss={dismissToast} top={overlay !== null} />
      </div>
    )
  }

  return (
    <div className="sa-shell">
      <a
        href="#conteudo"
        className="sa-skip"
        onClick={(e) => {
          // Keep the route hash intact: move focus to the content instead of navigating.
          e.preventDefault()
          document.getElementById("conteudo")?.focus()
        }}
      >
        Pular para o conteúdo
      </a>

      <header className="sa-header" inert={inert}>
        <button type="button" className="sa-brandbtn" onClick={() => go("explorar")} aria-label="StylAI, ir para Explorar">
          <BrandLockup dark={dark} compact />
        </button>
        <nav className="sa-topnav" aria-label="Seções">
          <ul>
            {NAV.map(({ id, label, Icon, center }) => (
              <li key={id}>
                <button type="button" className={`sa-topnav-btn ${center ? "sa-topnav-center" : ""}`} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
                  <Icon size={center ? 22 : 20} weight={tab === id ? "fill" : "regular"} aria-hidden="true" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sa-header-tools">
          <ThemeToggle />
          {status === "restoring" ? null : signedIn ? (
            <>
              <ClosetButton signedIn />
              <span className="sa-only-wide">
                <BalanceChip />
              </span>
              <span className="sa-only-narrow">
                <BalanceChip compact />
              </span>
            </>
          ) : (
            <SignInButton />
          )}
        </div>
      </header>

      <main id="conteudo" className="sa-main" inert={inert} tabIndex={-1}>
        {!connected ? (
          <p className="sa-offline" role="status">
            Servidor não conectado: nenhum dado é exibido até a API ser configurada (VITE_API_BASE_URL).
          </p>
        ) : null}
        <section className="sa-view" hidden={tab !== "explorar"} aria-label="Explorar">
          <ExploreScreen />
        </section>
        <section className="sa-view" hidden={tab !== "estudio"} aria-label="Estúdio">
          {/* Mounted on first visit, then kept (its scroll and focus survive tab switches). */}
          {studioVisited ? (
            <Private tab="estudio">
              <StudioScreen />
            </Private>
          ) : null}
        </section>
        <section className="sa-view" hidden={tab !== "closet"} aria-label="Closet">
          {/* Mounted only when visible: no private request is made for a tab nobody opened. */}
          {tab === "closet" ? (
            <Private tab="closet">
              <ClosetScreen />
            </Private>
          ) : null}
        </section>
        <section className="sa-view" hidden={tab !== "perfil"} aria-label="Perfil">
          {tab === "perfil" ? (
            <Private tab="perfil">
              <ProfileScreen />
            </Private>
          ) : null}
        </section>
      </main>

      {/* Mobile and tablet: bottom bar, Estúdio raised in the centre. */}
      <nav className="sa-bottomnav" aria-label="Seções" inert={inert}>
        <ul>
          {NAV.map(({ id, label, Icon, center }) => (
            <li key={id}>
              <button type="button" className={`sa-navbtn ${center ? "sa-navbtn-center" : ""}`} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
                {center ? (
                  <span className="sa-navbtn-disc" aria-hidden="true">
                    <Icon size={28} weight={tab === id ? "fill" : "regular"} />
                  </span>
                ) : (
                  <Icon size={24} weight={tab === id ? "fill" : "regular"} aria-hidden="true" />
                )}
                <span className="sa-navbtn-label">{label}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {signedIn ? <JobWatcher /> : null}
      <OverlayHost />
      <Toast toast={toast} onDismiss={dismissToast} top={overlay !== null} />
    </div>
  )
}

function ThemedRoot() {
  const { resolvedTheme } = useStore()
  return (
    <div className="sa-root" data-theme={resolvedTheme}>
      <IconContext.Provider value={{ size: 20, weight: "regular", mirrored: false }}>
        <Shell />
      </IconContext.Provider>
    </div>
  )
}

export function App() {
  const client = useMemo(createQueryClient, [])
  return (
    <QueryClientProvider client={client}>
      <AuthProvider>
        <StoreProvider>
          <ThemedRoot />
        </StoreProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

