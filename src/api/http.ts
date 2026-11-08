/**
 * HTTP client for the StylAI REST API (contract: docs/API-CONTRACT.md).
 *
 * Session model: a short-lived access token kept only in memory (never in localStorage) and a
 * refresh token in an httpOnly, Secure cookie set by the API. Requests send `credentials: "include"`
 * so the cookie reaches `/auth/refresh`. A 401 on an authenticated request triggers one refresh
 * (shared by concurrent requests) and one retry; if the refresh fails the session is cleared.
 */
import { ApiError, defaultMessage, errorFromResponse } from "./errors"

export type AuthMode = "none" | "optional" | "required"
export type Query = Record<string, string | number | boolean | null | undefined | readonly string[]>

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  query?: Query
  /** JSON body. */
  body?: unknown
  /** Multipart body (uploads). Takes precedence over `body`. */
  form?: FormData
  /** none: never send the token; optional: send if present; required: fail fast without a session. */
  auth?: AuthMode
  signal?: AbortSignal
  timeoutMs?: number
}

export interface SessionTokens {
  accessToken: string
  /** Seconds until the access token expires (informative; the 401 path is what matters). */
  expiresIn?: number
}

export interface HttpClient {
  readonly configured: boolean
  request<T>(path: string, options?: RequestOptions): Promise<T>
  setAccessToken(token: string | null): void
  getAccessToken(): string | null
  /** Asks the API for a new access token using the refresh cookie. Returns the raw JSON body. */
  refresh(): Promise<unknown>
  /** Called when a refresh fails: the session is over. */
  onSessionExpired(listener: () => void): () => void
}

export interface HttpClientInit {
  baseUrl: string | null
  fetchImpl?: typeof fetch
  timeoutMs?: number
  refreshPath?: string
}

export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = new URL(baseUrl + (path.startsWith("/") ? path : `/${path}`))
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v))
      else url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 205) return null
  const text = await res.text()
  if (!text) return null
  const type = res.headers.get("content-type") ?? ""
  if (!type.includes("json")) return text
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ApiError({ status: res.status, code: "bad_response", message: defaultMessage("bad_response") })
  }
}

export function createHttpClient(init: HttpClientInit): HttpClient {
  const fetchImpl = init.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const baseUrl = init.baseUrl
  const refreshPath = init.refreshPath ?? "/auth/refresh"
  let accessToken: string | null = null
  let refreshing: Promise<unknown> | null = null
  const expiredListeners = new Set<() => void>()

  const notConfigured = (): ApiError => new ApiError({ status: 0, code: "not_configured", message: defaultMessage("not_configured") })

  async function send(path: string, options: RequestOptions, withToken: boolean): Promise<Response> {
    if (!baseUrl) throw notConfigured()
    const headers: Record<string, string> = { Accept: "application/json" }
    let body: BodyInit | undefined
    if (options.form) body = options.form
    else if (options.body !== undefined) {
      headers["Content-Type"] = "application/json"
      body = JSON.stringify(options.body)
    }
    if (withToken && accessToken) headers.Authorization = `Bearer ${accessToken}`

    const controller = new AbortController()
    const timeout = options.timeoutMs ?? init.timeoutMs ?? 20_000
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeout)
    const onAbort = (): void => controller.abort()
    options.signal?.addEventListener("abort", onAbort)
    try {
      return await fetchImpl(buildUrl(baseUrl, path, options.query), {
        method: options.method ?? (body ? "POST" : "GET"),
        headers,
        body,
        credentials: "include",
        signal: controller.signal,
      })
    } catch (e) {
      if (timedOut) throw new ApiError({ status: 0, code: "timeout", message: defaultMessage("timeout") })
      if (options.signal?.aborted) throw new ApiError({ status: 0, code: "aborted", message: defaultMessage("aborted") })
      if (e instanceof ApiError) throw e
      throw new ApiError({ status: 0, code: "network", message: defaultMessage("network") })
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
    }
  }

  async function refresh(): Promise<unknown> {
    if (!refreshing) {
      refreshing = (async () => {
        const res = await send(refreshPath, { method: "POST", auth: "none" }, false)
        const body = await readBody(res)
        if (!res.ok) throw errorFromResponse(res.status, body, res.headers.get("retry-after"))
        const token = typeof body === "object" && body !== null ? (body as { accessToken?: unknown }).accessToken : null
        if (typeof token !== "string" || !token) throw new ApiError({ status: res.status, code: "bad_response", message: defaultMessage("bad_response") })
        accessToken = token
        return body
      })().finally(() => {
        refreshing = null
      })
    }
    return refreshing
  }

  function expire(): void {
    accessToken = null
    expiredListeners.forEach((l) => l())
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const auth = options.auth ?? "optional"
    if (!baseUrl) throw notConfigured()
    if (auth === "required" && !accessToken) {
      // Maybe the page was reloaded: the refresh cookie can restore the session.
      try {
        await refresh()
      } catch {
        throw new ApiError({ status: 401, code: "unauthorized", message: defaultMessage("unauthorized") })
      }
    }
    const useToken = auth !== "none"
    let res = await send(path, options, useToken)
    if (res.status === 401 && useToken && accessToken) {
      try {
        await refresh()
      } catch {
        expire()
        const body = await readBody(res).catch(() => null)
        throw errorFromResponse(401, body, null)
      }
      res = await send(path, options, true)
      if (res.status === 401) expire()
    }
    const body = await readBody(res)
    if (!res.ok) throw errorFromResponse(res.status, body, res.headers.get("retry-after"))
    return body as T
  }

  return {
    configured: baseUrl !== null,
    request,
    refresh,
    setAccessToken: (t) => {
      accessToken = t
    },
    getAccessToken: () => accessToken,
    onSessionExpired: (listener) => {
      expiredListeners.add(listener)
      return () => expiredListeners.delete(listener)
    },
  }
}
