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
  parseBodyPhotosState,
  parseCandidates,
  parseCloset,
  parseDecision,
  parseFacets, parseCatalogSource,
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
  parseSignUpResult,
  parseSearchResult,
  parseComposition,
  parseComposeOutcome,
  parseStudioConfig,
  parseUpload,
  parseUser,
} from "./parse"
import type { SearchFilters } from "../lib/filters"
import type { BodyAngle, CompositionSlotId, Measurements, PreferenceRules } from "./types"

export const http: HttpClient = createHttpClient({ baseUrl: env.apiBaseUrl })

export type CatalogSort = "relevance" | "price_asc" | "price_desc" | "newest"

export interface CatalogQuery {
  q?: string
  collection?: string | null
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
  /** "search": the prompt drives a catalog search. "dress": wear productIds + referenceIds as picked, no search. */
  mode: "search" | "dress"
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
    /** Never a session: the account exists only after the e-mail link is confirmed. */
    signUp: (input: { name: string; email: string; password: string }) => http.request<unknown>("/auth/sign-up", { method: "POST", body: input, auth: "none" }).then(parseSignUpResult),
    verifyEmail: (tokenHash: string) => http.request<unknown>("/auth/email/verify", { method: "POST", body: { tokenHash }, auth: "none" }).then(parseSession),
    resendConfirmation: (email: string) => http.request<null>("/auth/email/verify/resend", { method: "POST", body: { email }, auth: "none" }),
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
    bodyPhotosState: () => get("/me/body-photos", parseBodyPhotosState, { auth: "required" }),
    acceptPhotoConsent: (version: string) => http.request<unknown>("/privacy/consents", { method: "POST", body: { version, purpose: "body_photo_try_on" }, auth: "required" }),
    uploadBodyPhoto: (angle: BodyAngle, file: File) => {
      const form = new FormData()
      form.append("file", file)
      return http.request<unknown>(`/me/body-photos/${angle}`, { method: "PUT", form, auth: "required", timeoutMs: 120_000 }).then((raw) => {
        const photo = parseBodyPhoto(raw)
        if (!photo) throw new ApiError({ status: 200, code: "bad_response", message: defaultMessage("bad_response") })
        return photo
      })
    },
    /** Re-runs validation of a stored candidate after a technical validator error. */
    revalidateBodyPhoto: (angle: BodyAngle) => http.request<unknown>(`/me/body-photos/${angle}/revalidate`, { method: "POST", auth: "required", timeoutMs: 60_000 }).then((raw) => {
      const photo = parseBodyPhoto(raw)
      if (!photo) throw new ApiError({ status: 200, code: "bad_response", message: defaultMessage("bad_response") })
      return photo
    }),
    deleteBodyPhoto: (angle: BodyAngle) => http.request<null>(`/me/body-photos/${angle}`, { method: "DELETE", auth: "required" }),
    deleteAllBodyData: () => http.request<null>("/me/body-data", { method: "DELETE", auth: "required" }),
  },
  billing: {
    plans: () => get("/plans", parsePlans, { auth: "optional" }),
  },
  catalog: {
    hero: () => get("/explore/hero", parseHero, { auth: "optional" }),
    facets: () => get("/catalog/facets", parseFacets, { auth: "optional" }),
    source: () => get("/catalog/source", parseCatalogSource, { auth: "optional" }),
    products: (q: CatalogQuery, signal?: AbortSignal) =>
      get("/catalog/products", (raw) => parsePage(raw, parseProduct), {
        auth: q.favorites ? "required" : "optional",
        signal,
        query: {
          q: q.q?.trim() || undefined,
          collection: q.collection,
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
    related: (id: string, signal?: AbortSignal) => get(`/catalog/products/${encodeURIComponent(id)}/related`, (raw) => parsePage(raw, parseProduct), {
      auth: "optional",
      query: { limit: 6 },
      signal,
    }),
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
    /** One catalog piece on the person's photo. The key makes retries (double click, network) reuse one job. */
    tryOnPiece: (input: { productId: string; variantId: string | null; parentLookId: string | null }, idempotencyKey: string) =>
      http.request<unknown>(input.parentLookId ? "/studio/try-ons" : "/studio/generations", {
        method: "POST",
        auth: "required",
        headers: { "Idempotency-Key": idempotencyKey },
        body: input.parentLookId ? { sourceLookId: input.parentLookId, productIds: [input.productId], variantId: input.variantId } : { productId: input.productId, variantId: input.variantId },
      }).then(parseJob),
    /** Outfit composition: interpretation -> candidates per slot -> agent selection (never generates). */
    compose: (input: { prompt: string; locked: Partial<Record<CompositionSlotId, string>> }) =>
      http.request<unknown>("/studio/compositions", { method: "POST", body: input, auth: "required", timeoutMs: 90_000 }).then(parseComposeOutcome),
    composition: (id: string) => get(`/studio/compositions/${encodeURIComponent(id)}`, parseComposition, { auth: "required" }),
    /** Generates the confirmed composition (every piece re-validated by the server). New version when parentLookId is set. */
    generateComposition: (input: { compositionId: string; choices: { slot: CompositionSlotId; productId: string; variantId: string | null }[]; parentLookId: string | null }, idempotencyKey: string) =>
      http.request<unknown>(input.parentLookId ? "/studio/try-ons" : "/studio/generations", {
        method: "POST", auth: "required", headers: { "Idempotency-Key": idempotencyKey },
        body: input.parentLookId ? { compositionId: input.compositionId, choices: input.choices, sourceLookId: input.parentLookId } : { compositionId: input.compositionId, choices: input.choices },
      }).then(parseJob),
    /** Search step: request + preferences -> candidates. Never generates. */
    search: (input: { prompt: string; rules: PreferenceRules | null; filters?: Partial<SearchFilters> }) => http.request<unknown>("/studio/searches", { method: "POST", body: input, auth: "required" }).then(parseSearchResult),
    activeJob: () => http.request<unknown>("/studio/jobs", { method: "GET", auth: "required", query: { active: "true" } }).then((raw) => parsePage(raw, parseJob).items[0] ?? null),
    versions: (lookId: string) => get(`/studio/looks/${encodeURIComponent(lookId)}/versions`, parseLooks, { auth: "required" }),
    edit: (lookId: string, instruction: string) => http.request<unknown>(`/studio/looks/${encodeURIComponent(lookId)}/edits`, { method: "POST", body: { instruction }, auth: "required" }).then(parseJob),
    tryOn: (sourceLookId: string, productIds: string[]) => http.request<unknown>("/studio/try-ons", { method: "POST", body: { sourceLookId, productIds }, auth: "required" }).then(parseJob),
    job: (id: string, signal?: AbortSignal) => get(`/studio/jobs/${encodeURIComponent(id)}`, parseJob, { auth: "required", signal }),
    cancelJob: (id: string) => http.request<unknown>(`/studio/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST", auth: "required" }).then(parseJob),
    looks: () => get("/studio/looks", parseLooks, { auth: "required", query: { limit: 12 } }),
    look: (id: string) => get(`/studio/looks/${encodeURIComponent(id)}`, parseLook, { auth: "required" }),
    candidates: (lookId: string) => get(`/studio/looks/${encodeURIComponent(lookId)}/candidates`, parseCandidates, { auth: "required" }),
    matchDeck: (lookId: string | null) => get("/studio/match/deck", parseLooks, { auth: "required", query: { lookId: lookId ?? undefined } }),
    decide: (lookId: string, decision: "save" | "pass") => http.request<unknown>("/studio/match/decisions", { method: "POST", body: { lookId, decision }, auth: "required" }).then(parseDecision),
    undoDecision: (decisionId: string) => http.request<null>(`/studio/match/decisions/${encodeURIComponent(decisionId)}`, { method: "DELETE", auth: "required" }),
  },
}

export type Api = typeof api
