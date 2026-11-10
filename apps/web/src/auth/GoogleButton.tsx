/**
 * "Continuar com Google" through Google Identity Services: Google renders its own button (brand
 * rules), returns an ID token, and the API verifies it at POST /auth/google.
 * Hidden when VITE_GOOGLE_CLIENT_ID is not configured; shows an inline message if the script fails.
 */
import { useEffect, useRef, useState } from "react"
import { env } from "../config/env"

interface GsiCredentialResponse {
  credential?: string
}

interface GoogleAccountsId {
  initialize(config: { client_id: string; callback: (r: GsiCredentialResponse) => void; ux_mode?: "popup"; use_fedcm_for_prompt?: boolean; context?: "signin" | "signup" }): void
  renderButton(el: HTMLElement, options: { type?: "standard"; theme?: "outline" | "filled_black"; size?: "large"; text?: "continue_with" | "signup_with"; shape?: "pill"; width?: number; locale?: string; logo_alignment?: "left" | "center" }): void
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } }
  }
}

const SRC = "https://accounts.google.com/gsi/client"
let loader: Promise<GoogleAccountsId> | null = null

function loadGsi(): Promise<GoogleAccountsId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (!loader) {
    loader = new Promise<GoogleAccountsId>((resolve, reject) => {
      const script = document.createElement("script")
      script.src = SRC
      script.async = true
      script.defer = true
      script.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error("gsi")))
      script.onerror = () => {
        loader = null
        reject(new Error("gsi"))
      }
      document.head.appendChild(script)
    })
  }
  return loader
}

export const googleEnabled = (): boolean => env.googleClientId !== null

export function GoogleButton({ mode, dark, onCredential, disabled = false }: { mode: "signin" | "signup"; dark: boolean; onCredential: (idToken: string) => void; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const callback = useRef(onCredential)
  callback.current = onCredential
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const clientId = env.googleClientId
    const el = ref.current
    if (!clientId || !el) return
    let alive = true
    loadGsi()
      .then((gsi) => {
        if (!alive) return
        gsi.initialize({
          client_id: clientId,
          ux_mode: "popup",
          context: mode,
          callback: (r) => {
            if (r.credential) callback.current(r.credential)
          },
        })
        el.innerHTML = ""
        gsi.renderButton(el, { type: "standard", theme: dark ? "filled_black" : "outline", size: "large", text: mode === "signup" ? "signup_with" : "continue_with", shape: "pill", width: Math.min(400, Math.max(200, Math.round(el.clientWidth))), locale: "pt-BR", logo_alignment: "center" })
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [mode, dark])

  if (!googleEnabled()) return null
  if (failed) return <p className="sa-caption sa-muted text-center">Não foi possível carregar o acesso com Google. Use e-mail e senha ou tente de novo mais tarde.</p>
  return <div ref={ref} className="sa-google" aria-busy={disabled || undefined} style={{ pointerEvents: disabled ? "none" : undefined, opacity: disabled ? 0.6 : undefined }} />
}
