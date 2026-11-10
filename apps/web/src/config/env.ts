/**
 * Runtime configuration, read from Vite env variables at build time (put them in `.env.local`
 * or in the hosting provider's build settings). Neither value is a secret: both reach the browser.
 *
 * - VITE_API_BASE_URL: base URL of the StylAI REST API with its version prefix,
 *   e.g. https://api.stylai.app/v1. Without it the app runs, and every screen that needs
 *   data says that the server is not connected (no placeholder data is ever shown).
 * - VITE_GOOGLE_CLIENT_ID: OAuth 2.0 Web client ID (Google Identity Services). Without it the
 *   "Continuar com Google" button is hidden.
 */

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}

/** Normalises the API base URL: absolute http(s), no trailing slash. Invalid values count as missing. */
export function normalizeBaseUrl(raw: unknown): string | null {
  const value = clean(raw)
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.toString().replace(/\/+$/, "")
  } catch {
    return null
  }
}

export const env = {
  apiBaseUrl: normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL),
  googleClientId: clean(import.meta.env.VITE_GOOGLE_CLIENT_ID),
  isDev: import.meta.env.DEV,
} as const
