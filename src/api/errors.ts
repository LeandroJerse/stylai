/**
 * Every failure of the API layer becomes an ApiError, so screens handle one shape.
 * Server errors follow the contract `{ "error": { "code", "message", "fields"? } }`
 * (docs/API-CONTRACT.md); anything else is mapped to a generic code by HTTP status.
 */

export type ApiErrorCode =
  | "not_configured"
  | "network"
  | "timeout"
  | "aborted"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "rate_limited"
  | "insufficient_tokens"
  | "server"
  | "bad_response"
  | (string & {})

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode
  /** Field-level messages from validation errors, keyed by request field name. */
  readonly fields: Record<string, string>
  /** Seconds to wait, from Retry-After (429/503). */
  readonly retryAfter: number | null

  constructor(init: { status: number; code: ApiErrorCode; message: string; fields?: Record<string, string>; retryAfter?: number | null }) {
    super(init.message)
    this.name = "ApiError"
    this.status = init.status
    this.code = init.code
    this.fields = init.fields ?? {}
    this.retryAfter = init.retryAfter ?? null
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError

function codeForStatus(status: number): ApiErrorCode {
  if (status === 400 || status === 422) return "validation"
  if (status === 401) return "unauthorized"
  if (status === 402) return "insufficient_tokens"
  if (status === 403) return "forbidden"
  if (status === 404) return "not_found"
  if (status === 409) return "conflict"
  if (status === 429) return "rate_limited"
  return status >= 500 ? "server" : "bad_response"
}

/** Builds an ApiError from a non-2xx response body (already parsed, or null when it was not JSON). */
export function errorFromResponse(status: number, body: unknown, retryAfterHeader: string | null): ApiError {
  const retryAfter = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? Number(retryAfterHeader) : null
  const err = typeof body === "object" && body !== null && "error" in body ? (body as { error: unknown }).error : null
  if (typeof err === "object" && err !== null) {
    const e = err as { code?: unknown; message?: unknown; fields?: unknown }
    const fields: Record<string, string> = {}
    if (typeof e.fields === "object" && e.fields !== null) {
      for (const [k, v] of Object.entries(e.fields)) if (typeof v === "string") fields[k] = v
    }
    return new ApiError({
      status,
      code: typeof e.code === "string" && e.code ? e.code : codeForStatus(status),
      message: typeof e.message === "string" && e.message ? e.message : defaultMessage(codeForStatus(status)),
      fields,
      retryAfter,
    })
  }
  const code = codeForStatus(status)
  return new ApiError({ status, code, message: defaultMessage(code), retryAfter })
}

/** Portuguese fallback copy when the server sends no message (or the request never reached it). */
export function defaultMessage(code: ApiErrorCode): string {
  switch (code) {
    case "not_configured":
      return "O app ainda não está conectado ao servidor."
    case "network":
      return "Sem conexão com o servidor. Verifique a internet e tente de novo."
    case "timeout":
      return "O servidor demorou para responder. Tente de novo."
    case "aborted":
      return "A solicitação foi cancelada."
    case "unauthorized":
      return "Sua sessão terminou. Entre de novo para continuar."
    case "forbidden":
      return "Você não tem permissão para isso."
    case "not_found":
      return "Não encontramos o que você procurou."
    case "conflict":
      return "Isso mudou enquanto você editava. Atualize e tente de novo."
    case "validation":
      return "Revise os campos destacados."
    case "rate_limited":
      return "Muitas tentativas seguidas. Aguarde um pouco e tente de novo."
    case "insufficient_tokens":
      return "Saldo de tokens insuficiente."
    case "server":
      return "O servidor teve um problema. Tente de novo em instantes."
    default:
      return "Algo deu errado. Tente de novo."
  }
}

/** User-facing message for any thrown value. */
export function messageOf(e: unknown): string {
  if (isApiError(e)) return e.message
  return defaultMessage("bad_response")
}
