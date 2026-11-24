/**
 * Was anything sent? A paid request whose connection never existed cost nothing and may be tried again by the person.
 * Everything else (reset, closed socket, deadline, redirect, unreadable answer) may have been processed: it stays
 * unknown until reconciled. When in doubt, it is "maybe sent".
 */
const CONNECT_CALLS = new Set(["connect", "getaddrinfo"])
const CONNECT_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL", "ETIMEDOUT"])

const field = (v: unknown, key: "code" | "syscall" | "cause" | "errors" | "name"): unknown => (typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined)

function connectionOnly(error: unknown): boolean {
  const errors = field(error, "errors")
  // Several addresses tried: all of them must have failed before connecting.
  if (Array.isArray(errors)) return errors.length > 0 && errors.every(connectionOnly)
  const code = field(error, "code")
  // undici's own connect deadline: the socket never opened.
  if (code === "UND_ERR_CONNECT_TIMEOUT") return true
  return typeof code === "string" && CONNECT_CODES.has(code) && CONNECT_CALLS.has(String(field(error, "syscall")))
}

/** True only for an error thrown by the request call itself, before any connection existed. */
export const neverSent = (error: unknown): boolean => connectionOnly(field(error, "cause") ?? error)

/** Short safe token for the ledger: never a message, URL or value. */
export function transportCode(error: unknown): string {
  const name = field(error, "name")
  if (name === "TimeoutError" || name === "AbortError") return "timeout"
  const code = field(field(error, "cause"), "code") ?? field(error, "code")
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,31}$/.test(code) ? code.toLowerCase() : "other"
}
