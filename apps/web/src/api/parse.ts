/**
 * Tolerant normalisers from raw JSON to the domain types. A malformed optional field becomes
 * null/empty instead of crashing a screen; a malformed required field throws `ApiError("bad_response")`.
 * Image and link URLs must be absolute http(s); anything else (javascript:, data:, relative) is dropped.
 */
import { FILTER_IDS } from "../lib/filters"
import { ApiError, defaultMessage } from "./errors"
import type { CatalogSource,
  Availability,
  Balance,
  BodyAngle,
  BodyPhoto,
  BodyPhotosState,
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
  ProductOffer,
  RuleMode,
  Session,
  SearchResult,
  SignUpResult,
  StudioCapabilities,
  StudioConfig,
  UploadedImage,
  User, Composition, CompositionCandidate, CompositionSlot, CompositionSlotId, ComposeOutcome, CompositionStages } from "./types"

type Obj = Record<string, unknown>

const bad = (what: string): ApiError => new ApiError({ status: 200, code: "bad_response", message: `${defaultMessage("bad_response")} (${what})` })

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v)
export const obj = (v: unknown, what: string): Obj => {
  if (!isObj(v)) throw bad(what)
  return v
}
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null)
export const reqStr = (v: unknown, what: string): string => {
  const s = str(v)
  if (s === null) throw bad(what)
  return s
}
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
export const bool = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : fallback)
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export const strs = (v: unknown): string[] => arr(v).map(str).filter((s): s is string => s !== null)
export const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback)
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

/** Object URL of a file chosen in this browser (demo preview of the persons own photo; never fetched remotely). */
const localObjectUrl = (raw: unknown): string | null => {
  const s = str(raw)
  return s && /^blob:https?:\/\/\S+$/.test(s) ? s : null
}

export function parseImage(raw: unknown): ImageAsset | null {
  if (!isObj(raw)) return null
  const url = safeUrl(raw.url) ?? localObjectUrl(raw.url)
  if (!url) return null
  return { url, width: num(raw.width), height: num(raw.height), alt: str(raw.alt), focus: str(raw.focus) }
}

const images = (v: unknown): ImageAsset[] => arr(v).map(parseImage).filter((i): i is ImageAsset => i !== null)

export function money(raw: unknown): Money | null {
  if (!isObj(raw)) return null
  const amount = num(raw.amount)
  if (amount === null || amount < 0) return null
  return { amount, currency: str(raw.currency) ?? "BRL" }
}

const rating = (v: unknown): number | null => {
  const n = num(v)
  return n === null || n < 0 || n > 5 ? null : n
}

/** One store's offer; null when the store id is missing (the offer is then dropped). */
function offer(raw: unknown): ProductOffer | null {
  if (!isObj(raw) || !isObj(raw.partner)) return null
  const id = str(raw.partner.id)
  if (!id) return null
  const links = isObj(raw.links) ? raw.links : {}
  return {
    partner: { id, name: str(raw.partner.name) ?? id },
    price: money(raw.price),
    links: { affiliateUrl: safeExternalUrl(links.affiliateUrl), productUrl: safeExternalUrl(links.productUrl) },
  }
}

export function parseProduct(raw: unknown): Product {
  const o = obj(raw, "product")
  const partner = obj(o.partner, "product.partner")
  const category = isObj(o.category) && str(o.category.id) ? { id: String(o.category.id), label: str(o.category.label) ?? String(o.category.id) } : null
  const links = isObj(o.links) ? o.links : {}
  const expiry = str(o.offerExpiresAt)
  const own: ProductOffer = {
    partner: { id: reqStr(partner.id, "partner.id"), name: str(partner.name) ?? String(partner.id) },
    price: money(o.price),
    links: { affiliateUrl: safeExternalUrl(links.affiliateUrl), productUrl: safeExternalUrl(links.productUrl) },
  }
  // Own store first, then one offer per other store (repeated stores are ignored).
  const offers: ProductOffer[] = [own]
  for (const extra of arr(o.offers).map(offer)) {
    if (extra && !offers.some((x) => x.partner.id === extra.partner.id)) offers.push(extra)
  }
  return {
    id: reqStr(o.id, "product.id"),
    name: reqStr(o.name, "product.name"),
    category,
    partner: own.partner,
    price: own.price,
    images: images(o.images),
    rating: rating(o.rating),
    reviewsCount: num(o.reviewsCount),
    sellerRating: rating(o.sellerRating),
    variants: arr(o.variants)
      .filter(isObj)
      .map((v) => ({ id: str(v.id), label: str(v.label) ?? "", available: bool(v.available) }))
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
    offerExpiresAt: expiry && Number.isFinite(Date.parse(expiry)) ? expiry : null,
    catalogPublished: o.catalogPublished === true,
    links: own.links,
    offers,
    favorite: bool(o.favorite),
    fixture: bool(o.fixture),
    tryOnReady: bool(o.tryOnReady),
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
    collections: arr(o.collections).map(facet).filter((f): f is Facet => f !== null),
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
  const status = oneOf(raw.status, ["processing", "ready", "rejected"] as const, "processing")
  const v = isObj(raw.validation) ? raw.validation : null
  const validation = v && oneOfOrNull(v.status, ["approved", "needs_adjustment", "inconclusive", "error"] as const) ? {
    status: oneOf(v.status, ["approved", "needs_adjustment", "inconclusive", "error"] as const, "error"),
    framing: oneOfOrNull(v.framing, ["full_body", "to_knees", "partial", "none"] as const),
    supports: isObj(v.supports) ? { upper: bool(v.supports.upper), lower: bool(v.supports.lower), dress: bool(v.supports.dress) } : null,
    measuredAngle: oneOfOrNull(v.measuredAngle, ANGLES),
    version: str(v.version),
  } : null
  // Older servers had no validation: their ready photo is the one in use.
  const inUse = typeof raw.inUse === "boolean" ? raw.inUse : status === "ready"
  const revalidatable = typeof raw.revalidatable === "boolean" ? raw.revalidatable : validation?.status === "error"
  return { id: str(raw.id), angle, image, status, issues: strs(raw.issues), advice: strs(raw.advice), revalidatable, inUse, validation, uploadedAt: str(raw.uploadedAt), expiresAt: str(raw.expiresAt) }
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

/** Base pieces per request when the server does not say (product decision 2026-11-11). */
export const DEFAULT_MAX_CHOSEN = 6

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
    costs: { generate: need(costs.generate, "costs.generate"), edit: costs.edit === null ? null : need(costs.edit, "costs.edit"), tryOn: need(costs.tryOn, "costs.tryOn") },
    plans: arr(o.plans).flatMap((p) => isObj(p) && str(p.id) && str(p.name) && num(p.coinsPerPeriod) !== null ? [{ id: String(p.id), name: String(p.name), coinsPerPeriod: num(p.coinsPerPeriod)!, period: p.period === "month" ? "month" as const : "day" as const }] : []),
    costGaps: strs(o.costGaps),
    generationMode: o.generationMode === "simulated" || o.generationMode === "real" || o.generationMode === "disabled" ? o.generationMode : null,
    realProvider: isObj(o.realProvider) && str(o.realProvider.model) ? {
      provider: str(o.realProvider.provider) ?? "", model: String(o.realProvider.model), callsPerGeneration: num(o.realProvider.callsPerGeneration) ?? 1,
      estimatedUsdPerCall: num(o.realProvider.estimatedUsdPerCall) ?? 0, maxUsdPerCall: num(o.realProvider.maxUsdPerCall) ?? 0,
    } : null,
    maxReferences: num(o.maxReferences) ?? 0,
    maxChosenPieces: num(o.maxChosenPieces) ?? DEFAULT_MAX_CHOSEN,
    maxPromptLength: num(o.maxPromptLength) ?? 500,
    budget: { min: need(budget.min, "budget.min"), max: need(budget.max, "budget.max"), step: num(budget.step) ?? 1, currency: str(budget.currency) ?? "BRL" },
    acceptedImageTypes: strs(o.acceptedImageTypes),
    maxImageBytes: num(o.maxImageBytes) ?? 0,
    minImageHeight: num(o.minImageHeight) ?? 0,
    sizes: { top: strs(isObj(o.sizes) ? o.sizes.top : null), bottom: strs(isObj(o.sizes) ? o.sizes.bottom : null), shoes: strs(isObj(o.sizes) ? o.sizes.shoes : null) },
    capabilities: capabilities(o.capabilities),
    unit: isObj(o.unit) && str(o.unit.singular) && str(o.unit.plural) ? { singular: String(o.unit.singular), plural: String(o.unit.plural) } : { singular: "moeda", plural: "moedas" },
    quotaStatus: o.quotaStatus === "provisional" ? "provisional" : "final",
    photoPolicyVersion: str(o.photoPolicyVersion),
  }
}

const SLOT_IDS: readonly CompositionSlotId[] = ["upper", "lower", "dress", "outer"]
const slotOf = (v: unknown): CompositionSlotId | null => (SLOT_IDS as readonly unknown[]).includes(v) ? (v as CompositionSlotId) : null

/** Outfit composition: every link goes through parseProduct (https only); unknown slots are dropped. */
const stagesOf = (raw: unknown): CompositionStages | null =>
  isObj(raw) && str(raw.interpretation) && str(raw.retrieval) && str(raw.selection)
    ? { interpretation: String(raw.interpretation), retrieval: String(raw.retrieval), selection: String(raw.selection) } : null

/** P07: a "not composed" answer (no candidates) is explicit and never parsed as a look. */
export function parseComposeOutcome(raw: unknown): ComposeOutcome {
  const o = obj(raw, "composeOutcome")
  if (o.composed === false) {
    return { kind: "not_composed", stages: stagesOf(o.stages) ?? { interpretation: "unknown", retrieval: "unknown", selection: "not_run" }, message: str(o.message) ?? "Nenhum look foi montado." }
  }
  return { kind: "composed", composition: parseComposition(raw) }
}

export function parseComposition(raw: unknown): Composition {
  const o = obj(raw, "composition")
  const g = isObj(o.generation) ? o.generation : {}
  const slots = arr(o.slots).flatMap((s): CompositionSlot[] => {
    if (!isObj(s)) return []
    const slot = slotOf(s.slot)
    if (!slot) return []
    const candidates = arr(s.candidates).flatMap((c): CompositionCandidate[] => {
      try { return isObj(c) ? [{ product: parseProduct(c), slot, generationEligible: c.generationEligible === true }] : [] } catch { return [] }
    })
    const rawChoice = isObj(s.choice) ? s.choice : null
    const choiceId = rawChoice ? str(rawChoice.productId) : null
    const choice = rawChoice && choiceId && candidates.some((c) => c.product.id === choiceId) ? { productId: choiceId, reason: str(rawChoice.reason) ?? "" } : null
    return [{ slot, required: s.required !== false, alternativeSearch: isObj(s.retrieval) && arr(s.retrieval.attempts).length > 1,
      label: str(s.label) ?? slot, candidates, choice, error: str(s.error) }]
  })
  return {
    id: reqStr(o.id, "composition.id"),
    source: str(o.source) ?? "unknown",
    selectionMethod: o.selectionMethod === "agent" ? "agent" : "rules_fallback",
    stages: stagesOf(o.stages),
    model: str(o.model),
    slots,
    totalPrice: money(o.totalPrice),
    missingSlots: arr(o.missingSlots).map(slotOf).filter((x): x is CompositionSlotId => x !== null),
    generation: {
      eligible: g.eligible === true,
      blockedReason: str(g.blockedReason),
      layers: num(g.layers) ?? 0,
      render: g.render === "joint_outfit_unverified" ? "joint_outfit_unverified" : g.render === "sequential_layers_unverified" ? "sequential_layers_unverified" : "single_garment",
      estimatedProviderUsd: num(g.estimatedProviderUsd),
      provider: str(g.provider),
      reservePerLayerUsd: num(g.reservePerLayerUsd),
      maxReservedUsd: num(g.maxReservedUsd),
      coins: num(g.coins) ?? 0,
      coinsNote: str(g.coinsNote) ?? "",
    },
  }
}

export function parseSearchResult(raw: unknown): SearchResult {
  const o = obj(raw, "search")
  const i = isObj(o.interpretation) ? o.interpretation : {}
  const category = isObj(i.category) && str(i.category.id) ? { id: String(i.category.id), label: str(i.category.label) ?? String(i.category.id) } : null
  return {
    source: str(o.source) ?? "unknown",
    interpretation: { category, colors: strs(i.colors), maxPriceBrl: num(i.maxPriceBrl), terms: strs(i.terms) },
    items: parseCandidates(raw),
    total: num(o.total) ?? 0,
  }
}

/** Missing capabilities = the historical full contract (everything on). */
function capabilities(raw: unknown): StudioCapabilities {
  if (!isObj(raw)) return { mode: "full", dress: true, adjustments: true, bodyPhotoRequired: false, closet: true, searchScope: "stores", generation: true, edits: true, match: true, references: true, preferences: true, search: true, measurements: true, plans: true, candidates: true, outfits: false, outfitFilters: [], composer: { mode: "rules", model: null } }
  const flag = (v: unknown) => v === true
  return {
    mode: raw.mode === "single_piece_try_on" ? "single_piece_try_on" : "full",
    dress: raw.dress === undefined ? true : flag(raw.dress), adjustments: flag(raw.adjustments),
    bodyPhotoRequired: flag(raw.bodyPhotoRequired), closet: flag(raw.closet),
    searchScope: raw.searchScope === "curated_catalog" ? "curated_catalog" : "stores",
    generation: flag(raw.generation), edits: flag(raw.edits), match: flag(raw.match),
    references: flag(raw.references), preferences: flag(raw.preferences), search: flag(raw.search),
    // Declared capabilities fail closed: a flag the server does not send is off.
    measurements: flag(raw.measurements), plans: flag(raw.plans), candidates: flag(raw.candidates), outfits: flag(raw.outfits),
    outfitFilters: FILTER_IDS.filter((id) => strs(raw.outfitFilters).includes(id)),
    composer: isObj(raw.composer) && raw.composer.mode === "agent" ? { mode: "agent", model: str(raw.composer.model) } : { mode: "rules", model: null },
  }
}

export function parseCatalogSource(raw: unknown): CatalogSource {
  const o = obj(raw, "catalogSource")
  const id = str(o.id) ?? "unknown"
  return { id, label: str(o.label) ?? id, test: id === "test_catalog" }
}

export function parseBodyPhotosState(raw: unknown): BodyPhotosState {
  const o = obj(raw, "bodyPhotos")
  const c = isObj(o.consent) && str(o.consent.policyVersion) ? { policyVersion: String(o.consent.policyVersion), accepted: bool(o.consent.accepted) } : null
  const required = strs(o.requiredAngles).filter((a): a is BodyAngle => (ANGLES as readonly string[]).includes(a))
  return {
    items: arr(o.items).map(parseBodyPhoto).filter((p): p is BodyPhoto => p !== null), consent: c,
    requiredAngles: required.length ? required : ["front"],
    validator: isObj(o.validator) ? { available: bool(o.validator.available), where: o.validator.kind === "local_pose_model_in_browser" ? "browser" as const : "server" as const } : null,
  }
}

export function parseSignUpResult(raw: unknown): SignUpResult {
  const o = obj(raw, "signUp")
  if (o.status !== "verification_required") throw bad("signUp.status")
  return { status: "verification_required" }
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
    simulated: bool(o.simulated),
    lineageId: str(o.lineageId),
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
