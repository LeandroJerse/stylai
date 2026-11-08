/**
 * Hash routes (works on any static host without rewrite rules, and inside a future
 * Capacitor/PWA shell). Shape: `#/<screen>[?k=v]`.
 * The reset-password email must link to `<app>/#/redefinir-senha?token=<token>`.
 */

export type MainTab = "explorar" | "estudio" | "closet" | "perfil"
export type AuthScreen = "entrar" | "criar-conta" | "recuperar-senha" | "redefinir-senha"

export type Route =
  | { kind: "tab"; tab: MainTab }
  | { kind: "auth"; screen: AuthScreen; next: MainTab | null; token: string | null }

const TABS: readonly MainTab[] = ["explorar", "estudio", "closet", "perfil"]
const AUTH: readonly AuthScreen[] = ["entrar", "criar-conta", "recuperar-senha", "redefinir-senha"]

export const DEFAULT_ROUTE: Route = { kind: "tab", tab: "explorar" }

export function parseRoute(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "")
  const [path = "", search = ""] = raw.split("?")
  const params = new URLSearchParams(search)
  const name = path.toLowerCase()
  if ((TABS as readonly string[]).includes(name)) return { kind: "tab", tab: name as MainTab }
  if ((AUTH as readonly string[]).includes(name)) {
    const next = params.get("next")
    return { kind: "auth", screen: name as AuthScreen, next: next && (TABS as readonly string[]).includes(next) ? (next as MainTab) : null, token: params.get("token") }
  }
  return DEFAULT_ROUTE
}

export function formatRoute(route: Route): string {
  if (route.kind === "tab") return `#/${route.tab}`
  const params = new URLSearchParams()
  if (route.next) params.set("next", route.next)
  if (route.token) params.set("token", route.token)
  const q = params.toString()
  return `#/${route.screen}${q ? `?${q}` : ""}`
}

/** Tabs that need an account. Explorar is public. */
export const needsAccount = (tab: MainTab): boolean => tab !== "explorar"
