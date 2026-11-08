/**
 * Tolerant normalisers from raw JSON to the domain types. A malformed optional field becomes
 * null/empty instead of crashing a screen; a malformed required field throws `ApiError("bad_response")`.
 * Image and link URLs must be absolute http(s); anything else (javascript:, data:, relative) is dropped.
 */
import { ApiError, defaultMessage } from "./errors"
import type {
  Availability,
  Balance,
  BodyAngle,
  BodyPhoto,
  CatalogFacets,
  Candidate,
  Closet,
  ClosetPiece,
  ExploreHero,
  Facet,
  ImageAsset,
  Job,
  JobKind,
  JobStatus,
  LimitingCriterion,
  Look,
  LookPiece,
  MatchDecision,
  Measurements,
  Money,
  NumericRule,
  Page,
  Plan,
  Preference,
  PreferenceRules,
  Preferences,
  Product,
  RuleMode,
  Session,
  StudioConfig,
  UploadedImage,
  User,
} from "./types"

type Obj = Record<string, unknown>

const bad = (what: string): ApiError => new ApiError({ status: 200, code: "bad_response", message: `${defaultMessage("bad_response")} (${what})` })

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
const obj = (v: unknown, what: string): Obj => {
  if (!isObj(v)) throw bad(what)
  return v
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null)
const reqStr = (v: unknown, what: string): string => {
  const s = str(v)
  if (s === null) throw bad(what)
  return s
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const bool = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : fallback)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => arr(v).map(str).filter((s): s is string => s !== null)
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback)
const oneOfOrNull = <T extends string>(v: unknown, options: readonly T[]): T | null => (typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : null)

/** Absolute http(s) URL without credentials, else null. */
export function safeUrl(raw: unknown): string | null {
  const s = str(raw)
  if (!s) return null
  try {
    const u = new URL(s)
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    if (u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

/** Links that leave the app must be https. */
export function safeExternalUrl(raw: unknown): string | null {
  const u = safeUrl(raw)
  return u && u.startsWith("https://") ? u : null
}

export function parseImage(raw: unknown): ImageAsset | null {
  if (!isObj(raw)) return null
  const url = safeUrl(raw.url)
  if (!url) return null
  return { url, width: num(raw.width), height: num(raw.height), alt: str(raw.alt), focus: str(raw.focus) }
}

const images = (v: unknown): ImageAsset[] => arr(v).map(parseImage).filter((i): i is ImageAsset => i !== null)

function money(raw: unknown): Money | null {
  if (!isObj(raw)) return null
  const amount = num(raw.amount)
  if (amount === null || amount < 0) return null
  return { amount, currency: str(raw.currency) ?? "BRL" }
}

const rating = (v: unknown): number | null => {
  const n = num(v)
  return n === null || n < 0 || n > 5 ? null : n
}

export function parseProduct(raw: unknown): Product {
  const o = obj(raw, "product")
  const partner = obj(o.partner, "product.partner")
  const category = isObj(o.category) && str(o.category.id) ? { id: String(o.category.id), label: str(o.category.label) ?? String(o.category.id) } : null
  const links = isObj(o.links) ? o.links : {}
  return {
    id: reqStr(o.id, "product.id"),
    name: reqStr(o.name, "product.name"),
    category,
    partner: { id: reqStr(partner.id, "partner.id"), name: str(partner.name) ?? String(partner.id) },
    price: money(o.price),
    images: images(o.images),
    rating: rating(o.rating),
    reviewsCount: num(o.reviewsCount),
    sellerRating: rating(o.sellerRating),
    variants: arr(o.variants)
      .filter(isObj)
      .map((v) => ({ label: str(v.label) ?? "", available: bool(v.available) }))
      .filter((v) => v.label !== ""),
    availability: oneOf<Availability>(o.availability, ["available", "partial", "unavailable", "unknown"], "unknown"),
    material: str(o.material),
    color: str(o.color),
    fit: oneOfOrNull(o.fit, ["ajustado", "regular", "amplo"] as const),
    deliveryDays: num(o.deliveryDays),
    measurements: arr(o.measurements)
      .filter(isObj)
      .map((m) => ({ label: str(m.label) ?? "", value: str(m.value) ?? "" }))
      .filter((m) => m.label && m.value),
    styles: strs(o.styles),
    updatedAt: str(o.updatedAt),
    links: { affiliateUrl: safeExternalUrl(links.affiliateUrl), productUrl: safeExternalUrl(links.productUrl) },
    favorite: bool(o.favorite),
  }
}

export function parsePage<T>(raw: unknown, item: (v: unknown) => T): Page<T> {
  const o = obj(raw, "page")
  return { items: arr(o.items).map(item), nextCursor: str(o.nextCursor), total: num(o.total) }
}

const facet = (v: unknown): Facet | null => (isObj(v) && str(v.id) ? { id: String(v.id), label: str(v.label) ?? String(v.id), count: num(v.count) } : null)

export function parseFacets(raw: unknown): CatalogFacets {
  const o = obj(raw, "facets")
  const pr = isObj(o.priceRange) ? o.priceRange : null
  const min = pr ? num(pr.min) : null
  const max = pr ? num(pr.max) : null
  return {
    categories: arr(o.categories).map(facet).filter((f): f is Facet => f !== null),
    partners: arr(o.partners).map(facet).filter((f): f is Facet => f !== null),
    priceRange: min !== null && max !== null && max >= min ? { min, max, currency: (pr && str(pr.currency)) ?? "BRL" } : null,
    total: num(o.total),
  }
}

export function parseHero(raw: unknown): ExploreHero | null {
  if (!isObj(raw) || raw.hero === null || raw.hero === undefined) return null
  const h = obj(raw.hero, "hero")
  const product = parseProduct(h.product)
  const image = parseImage(h.image) ?? product.images[0] ?? null
  return image ? { product, image } : null
}

/* ------------------------------------------------------------------ account */

export function parseUser(raw: unknown): User {
  const o = obj(raw, "user")
  return {
    id: reqStr(o.id, "user.id"),
    name: str(o.name) ?? "",
    email: reqStr(o.email, "user.email"),
    emailVerified: bool(o.emailVerified),
    avatarUrl: safeUrl(o.avatarUrl),
    providers: strs(o.providers).filter((p): p is "password" | "google" => p === "password" || p === "google"),
    createdAt: str(o.createdAt),
  }
}

export function parseSession(raw: unknown): Session {
  const o = obj(raw, "session")
  return { accessToken: reqStr(o.accessToken, "accessToken"), user: parseUser(o.user) }
}

function plan(raw: unknown): Plan {
  const o = obj(raw, "plan")
  return {
    id: reqStr(o.id, "plan.id"),
    name: str(o.name) ?? String(o.id),
    tokensPerPeriod: num(o.tokensPerPeriod),
    period: oneOfOrNull(o.period, ["day", "month"] as const),
    price: money(o.price),
  }
}

export function parseBalance(raw: unknown): Balance {
  const o = obj(raw, "balance")
  const tokens = num(o.tokens)
  if (tokens === null) throw bad("balance.tokens")
  return { tokens, plan: plan(o.plan), renewsAt: str(o.renewsAt) }
}

export const parsePlans = (raw: unknown): Plan[] => arr(obj(raw, "plans").items).map(plan)

const ANGLES: readonly BodyAngle[] = ["front", "side", "profile"]

export function parseBodyPhoto(raw: unknown): BodyPhoto | null {
  if (!isObj(raw)) return null
  const angle = oneOfOrNull(raw.angle, ANGLES)
  const image = parseImage(raw.image)
  if (!angle || !image) return null
  return { angle, image, status: oneOf(raw.status, ["processing", "ready", "rejected"] as const, "processing"), issues: strs(raw.issues), uploadedAt: str(raw.uploadedAt) }
}

export const parseBodyPhotos = (raw: unknown): BodyPhoto[] => arr(obj(raw, "bodyPhotos").items).map(parseBodyPhoto).filter((p): p is BodyPhoto => p !== null)

export function parseMeasurements(raw: unknown): Measurements {
  const o = isObj(raw) ? raw : {}
  return {
    size: str(o.size),
    bustCm: num(o.bustCm),
    waistCm: num(o.waistCm),
    hipsCm: num(o.hipsCm),
    heightCm: num(o.heightCm),
    useInSearch: bool(o.useInSearch, true),
  }
}

/* ------------------------------------------------------------------ preferences */

const MODES: readonly RuleMode[] = ["require", "prefer", "off"]
const rule = (raw: unknown, fallback: number): NumericRule => (isObj(raw) ? { value: num(raw.value) ?? fallback, mode: oneOf(raw.mode, MODES, "off") } : { value: fallback, mode: "off" })

export function parseRules(raw: unknown): PreferenceRules {
  const o = obj(raw, "rules")
  const sizes = isObj(o.sizes) ? o.sizes : {}
  const budget = isObj(o.budget) ? o.budget : {}
  const adv = isObj(o.advanced) ? o.advanced : {}
  const fit = isObj(adv.fit) ? adv.fit : {}
  return {
    minRating: rule(o.minRating, 4),
    minReviews: rule(o.minReviews, 0),
    excludedPartners: strs(o.excludedPartners),
    sizes: { top: str(sizes.top), bottom: str(sizes.bottom), shoes: str(sizes.shoes) },
    onlyAvailableSize: bool(o.onlyAvailableSize),
    budget: { value: num(budget.value) ?? 0, scope: oneOf(budget.scope, ["look", "piece"] as const, "look"), mode: oneOf(budget.mode, MODES, "off") },
    missingRating: oneOf(o.missingRating, ["exclude", "warn"] as const, "warn"),
    advanced: {
      sellerRating: rule(adv.sellerRating, 4),
      maxDeliveryDays: rule(adv.maxDeliveryDays, 10),
      avoidColors: strs(adv.avoidColors),
      preferMaterials: strs(adv.preferMaterials),
      fit: { value: oneOf(fit.value, ["ajustado", "regular", "amplo"] as const, "regular"), mode: oneOf(fit.mode, MODES, "off") },
    },
  }
}

export function parsePreference(raw: unknown): Preference {
  const o = obj(raw, "preference")
  return { id: reqStr(o.id, "preference.id"), name: str(o.name) ?? "Sem nome", rules: parseRules(o.rules) }
}

export function parsePreferences(raw: unknown): Preferences {
  const o = obj(raw, "preferences")
  return { items: arr(o.items).map(parsePreference), defaultId: str(o.defaultId) }
}

/* ------------------------------------------------------------------ studio */

export function parseStudioConfig(raw: unknown): StudioConfig {
  const o = obj(raw, "studioConfig")
  const costs = obj(o.costs, "studioConfig.costs")
  const budget = obj(o.budget, "studioConfig.budget")
  const need = (v: unknown, what: string): number => {
    const n = num(v)
    if (n === null) throw bad(what)
    return n
  }
  return {
    costs: { generate: need(costs.generate, "costs.generate"), edit: need(costs.edit, "costs.edit"), tryOn: need(costs.tryOn, "costs.tryOn") },
    maxReferences: num(o.maxReferences) ?? 0,
    maxChosenPieces: num(o.maxChosenPieces) ?? 0,
    maxPromptLength: num(o.maxPromptLength) ?? 500,
    budget: { min: need(budget.min, "budget.min"), max: need(budget.max, "budget.max"), step: num(budget.step) ?? 1, currency: str(budget.currency) ?? "BRL" },
    acceptedImageTypes: strs(o.acceptedImageTypes),
    maxImageBytes: num(o.maxImageBytes) ?? 0,
    minImageHeight: num(o.minImageHeight) ?? 0,
    sizes: { top: strs(isObj(o.sizes) ? o.sizes.top : null), bottom: strs(isObj(o.sizes) ? o.sizes.bottom : null), shoes: strs(isObj(o.sizes) ? o.sizes.shoes : null) },
  }
}

function lookPiece(raw: unknown): LookPiece {
  const o = obj(raw, "look.piece")
  return { product: parseProduct(o.product), role: oneOf(o.role, ["look", "similar", "chosen"] as const, "look"), warnings: strs(o.warnings) }
}

export function parseLook(raw: unknown): Look {
  const o = obj(raw, "look")
  const image = parseImage(o.image)
  if (!image) throw bad("look.image")
  return {
    id: reqStr(o.id, "look.id"),
    title: str(o.title) ?? "Look",
    note: str(o.note),
    image,
    pieces: arr(o.pieces).map(lookPiece),
    prompt: str(o.prompt),
    origin: oneOf(o.origin, ["generate", "edit", "tryon", "match"] as const, "generate"),
    version: num(o.version) ?? 1,
    parentId: str(o.parentId),
    createdAt: str(o.createdAt),
    candidatesCount: num(o.candidatesCount) ?? 0,
    saved: bool(o.saved),
  }
}

export const parseLooks = (raw: unknown): Look[] => arr(obj(raw, "looks").items).map(parseLook)

export function parseCandidates(raw: unknown): Candidate[] {
  return arr(obj(raw, "candidates").items).map((v) => {
    const o = obj(v, "candidate")
    return { product: parseProduct(o.product), usedInLook: bool(o.usedInLook), failed: strs(o.failed) }
  })
}

const limiting = (v: unknown): LimitingCriterion | null =>
  isObj(v) && str(v.id) ? { id: String(v.id), label: str(v.label) ?? String(v.id), removed: num(v.removed) ?? 0, total: num(v.total) ?? 0, unlocks: bool(v.unlocks) } : null

export function parseJob(raw: unknown): Job {
  const o = obj(raw, "job")
  const err = isObj(o.error) ? { code: str(o.error.code) ?? "failed", message: str(o.error.message) ?? defaultMessage("server") } : null
  const progress = num(o.progress)
  return {
    id: reqStr(o.id, "job.id"),
    kind: oneOf<JobKind>(o.kind, ["generate", "edit", "tryon"], "generate"),
    status: oneOf<JobStatus>(o.status, ["queued", "running", "succeeded", "failed", "no_results", "cancelled"], "queued"),
    step: str(o.step),
    progress: progress === null ? null : Math.min(1, Math.max(0, progress)),
    cost: num(o.cost) ?? 0,
    charged: bool(o.charged),
    lookId: str(o.lookId),
    limiting: arr(o.limiting).map(limiting).filter((l): l is LimitingCriterion => l !== null),
    candidatesCount: num(o.candidatesCount),
    error: err,
  }
}

export function parseUpload(raw: unknown): UploadedImage {
  const o = obj(raw, "upload")
  const image = parseImage(o.image)
  if (!image) throw bad("upload.image")
  return { id: reqStr(o.id, "upload.id"), image, sizeBytes: num(o.sizeBytes), mime: str(o.mime) }
}

export function parseDecision(raw: unknown): MatchDecision {
  const o = obj(raw, "decision")
  return { id: reqStr(o.id, "decision.id"), lookId: reqStr(o.lookId, "decision.lookId"), decision: oneOf(o.decision, ["save", "pass"] as const, "pass") }
}

/* ------------------------------------------------------------------ closet */

export function parseCloset(raw: unknown): Closet {
  const o = obj(raw, "closet")
  const pieces: ClosetPiece[] = arr(o.pieces).map((v) => {
    const p = obj(v, "closet.piece")
    return { product: parseProduct(p.product), savedAt: str(p.savedAt), via: oneOf(p.via, ["favorite", "look"] as const, "favorite") }
  })
  return { pieces, looks: arr(o.looks).map(parseLook) }
}
