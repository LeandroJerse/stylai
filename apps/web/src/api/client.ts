/**
 * Endpoint functions, one per row of docs/API-CONTRACT.md. Screens never call `fetch` directly.
 * Each function returns parsed domain types (parse.ts) or throws ApiError (errors.ts).
 */
import { env } from "../config/env"
import { ApiError, defaultMessage } from "./errors"
import { createHttpClient, type HttpClient } from "./http"
import {
  parseBalance,
  parseBodyPhoto,
  parseBodyPhotos,
  parseCandidates,
  parseCloset,
  parseDecision,
  parseFacets,
  parseHero,
  parseJob,
  parseLook,
  parseLooks,
  parseMeasurements,
  parsePage,
  parsePlans,
  parsePreference,
  parsePreferences,
  parseProduct,
  parseSession,
  parseStudioConfig,
  parseUpload,
  parseUser,
} from "./parse"
import type { BodyAngle, Measurements, PreferenceRules } from "./types"

export const http: HttpClient = createHttpClient({ baseUrl: env.apiBaseUrl })

export type CatalogSort = "relevance" | "price_asc" | "price_desc" | "newest"

export interface CatalogQuery {
  q?: string
  category?: string | null
  partner?: string | null
  priceMin?: number | null
  priceMax?: number | null
  favorites?: boolean
  sort?: CatalogSort
  cursor?: string | null
  limit?: number
}

export interface GenerateInput {
  prompt: string
  productIds: string[]
  referenceIds: string[]
  preferenceId: string | null
  /** Rules for this search only; null = use the saved preference as is. */
  rules: PreferenceRules | null
}

const get = <T>(path: string, parse: (raw: unknown) => T, opts: Parameters<HttpClient["request"]>[1] = {}) => http.request<unknown>(path, { ...opts, method: "GET" }).then(parse)

export const api = {
  auth: {
    signIn: (email: string, password: string) => http.request<unknown>("/auth/sign-in", { method: "POST", body: { email, password }, auth: "none" }).then(parseSession),
    signUp: (input: { name: string; email: string; password: string }) => http.request<unknown>("/auth/sign-up", { method: "POST", body: input, auth: "none" }).then(parseSession),
    google: (idToken: string) => http.request<unknown>("/auth/google", { method: "POST", body: { idToken }, auth: "none" }).then(parseSession),
    refresh: () => http.refresh().then(parseSession),
    signOut: () => http.request<null>("/auth/sign-out", { method: "POST", auth: "optional" }),
    forgotPassword: (email: string) => http.request<null>("/auth/password/forgot", { method: "POST", body: { email }, auth: "none" }),
    resetPassword: (token: string, password: string) => http.request<null>("/auth/password/reset", { method: "POST", body: { token, password }, auth: "none" }),
    changePassword: (currentPassword: string, newPassword: string) => http.request<null>("/auth/password/change", { method: "POST", body: { currentPassword, newPassword }, auth: "required" }),
    resendVerification: () => http.request<null>("/auth/email/verify/resend", { method: "POST", auth: "required" }),
  },
  me: {
    get: () => get("/me", parseUser, { auth: "required" }),
    update: (patch: { name?: string }) => http.request<unknown>("/me", { method: "PATCH", body: patch, auth: "required" }).then(parseUser),
    delete: () => http.request<null>("/me", { method: "DELETE", auth: "required" }),
    balance: () => get("/me/balance", parseBalance, { auth: "required" }),
    measurements: () => get("/me/measurements", parseMeasurements, { auth: "required" }),
    saveMeasurements: (m: Measurements) => http.request<unknown>("/me/measurements", { method: "PUT", body: m, auth: "required" }).then(parseMeasurements),
    bodyPhotos: () => get("/me/body-photos", parseBodyPhotos, { auth: "required" }),
    uploadBodyPhoto: (angle: BodyAngle, file: File) => {
      const form = new FormData()
      form.append("file", file)
      return http.request<unknown>(`/me/body-photos/${angle}`, { method: "PUT", form, auth: "required", timeoutMs: 120_000 }).then((raw) => {
        const photo = parseBodyPhoto(raw)
        if (!photo) throw new ApiError({ status: 200, code: "bad_response", message: defaultMessage("bad_response") })
        return photo
      })
    },
    deleteBodyPhoto: (angle: BodyAngle) => http.request<null>(`/me/body-photos/${angle}`, { method: "DELETE", auth: "required" }),
    deleteAllBodyData: () => http.request<null>("/me/body-data", { method: "DELETE", auth: "required" }),
  },
  billing: {
    plans: () => get("/plans", parsePlans, { auth: "optional" }),
  },
  catalog: {
    hero: () => get("/explore/hero", parseHero, { auth: "optional" }),
    facets: () => get("/catalog/facets", parseFacets, { auth: "optional" }),
    products: (q: CatalogQuery, signal?: AbortSignal) =>
      get("/catalog/products", (raw) => parsePage(raw, parseProduct), {
        auth: q.favorites ? "required" : "optional",
        signal,
        query: {
          q: q.q?.trim() || undefined,
          category: q.category,
          partner: q.partner,
          priceMin: q.priceMin,
          priceMax: q.priceMax,
          favorites: q.favorites ? true : undefined,
          sort: q.sort && q.sort !== "relevance" ? q.sort : undefined,
          cursor: q.cursor,
          limit: q.limit ?? 24,
        },
      }),
    product: (id: string) => get(`/catalog/products/${encodeURIComponent(id)}`, parseProduct, { auth: "optional" }),
  },
  closet: {
    get: () => get("/closet", parseCloset, { auth: "required" }),
    savePiece: (productId: string) => http.request<null>(`/closet/pieces/${encodeURIComponent(productId)}`, { method: "PUT", auth: "required" }),
    removePiece: (productId: string) => http.request<null>(`/closet/pieces/${encodeURIComponent(productId)}`, { method: "DELETE", auth: "required" }),
    saveLook: (lookId: string) => http.request<null>(`/closet/looks/${encodeURIComponent(lookId)}`, { method: "PUT", auth: "required" }),
    removeLook: (lookId: string) => http.request<null>(`/closet/looks/${encodeURIComponent(lookId)}`, { method: "DELETE", auth: "required" }),
  },
  preferences: {
    list: () => get("/preferences", parsePreferences, { auth: "required" }),
    update: (id: string, rules: PreferenceRules) => http.request<unknown>(`/preferences/${encodeURIComponent(id)}`, { method: "PATCH", body: { rules }, auth: "required" }).then(parsePreference),
  },
  studio: {
    config: () => get("/studio/config", parseStudioConfig, { auth: "optional" }),
    uploadReference: (file: File) => {
      const form = new FormData()
      form.append("file", file)
      return http.request<unknown>("/uploads/references", { method: "POST", form, auth: "required", timeoutMs: 120_000 }).then(parseUpload)
    },
    generate: (input: GenerateInput) => http.request<unknown>("/studio/generations", { method: "POST", body: input, auth: "required" }).then(parseJob),
    edit: (lookId: string, instruction: string) => http.request<unknown>(`/studio/looks/${encodeURIComponent(lookId)}/edits`, { method: "POST", body: { instruction }, auth: "required" }).then(parseJob),
    tryOn: (sourceLookId: string, productIds: string[]) => http.request<unknown>("/studio/try-ons", { method: "POST", body: { sourceLookId, productIds }, auth: "required" }).then(parseJob),
    job: (id: string, signal?: AbortSignal) => get(`/studio/jobs/${encodeURIComponent(id)}`, parseJob, { auth: "required", signal }),
    cancelJob: (id: string) => http.request<unknown>(`/studio/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", auth: "required" }).then(parseJob),
    looks: () => get("/studio/looks", parseLooks, { auth: "required", query: { limit: 12 } }),
    look: (id: string) => get(`/studio/looks/${encodeURIComponent(id)}`, parseLook, { auth: "required" }),
    candidates: (lookId: string) => get(`/studio/looks/${encodeURIComponent(lookId)}/candidates`, parseCandidates, { auth: "required" }),
    matchDeck: (lookId: string) => get("/studio/match/deck", parseLooks, { auth: "required", query: { lookId } }),
    decide: (lookId: string, decision: "save" | "pass") => http.request<unknown>("/studio/match/decisions", { method: "POST", body: { lookId, decision }, auth: "required" }).then(parseDecision),
    undoDecision: (decisionId: string) => http.request<null>(`/studio/match/decisions/${encodeURIComponent(decisionId)}`, { method: "DELETE", auth: "required" }),
  },
}

export type Api = typeof api
