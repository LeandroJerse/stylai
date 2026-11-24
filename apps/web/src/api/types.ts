/**
 * Domain types as the screens use them. They mirror the JSON of docs/API-CONTRACT.md;
 * `parse.ts` turns raw responses into these shapes (and drops what is unsafe or malformed).
 */

export interface ImageAsset {
  url: string
  width: number | null
  height: number | null
  alt: string | null
  /** CSS object-position hint from the server (focal point), e.g. "50% 20%". */
  focus: string | null
}

export interface Money {
  amount: number
  currency: string
}

export interface PartnerRef {
  id: string
  name: string
}

export interface CategoryRef {
  id: string
  label: string
}

export type Availability = "available" | "partial" | "unavailable" | "unknown"

export interface Variant {
  /** Server id of the variant (needed to request a try-on); null on older payloads. */
  id: string | null
  label: string
  available: boolean
}

export interface ProductLinks {
  /** Affiliate URL (commission may apply). */
  affiliateUrl: string | null
  /** Plain product page at the partner. */
  productUrl: string | null
}

/**
 * The same product sold by one store: its own price and links. The search agent finds duplicates
 * across stores (marketplaces included); the API groups them under one Product.
 */
export interface ProductOffer {
  partner: PartnerRef
  price: Money | null
  links: ProductLinks
}

export interface Product {
  id: string
  name: string
  category: CategoryRef | null
  partner: PartnerRef
  price: Money | null
  images: ImageAsset[]
  /** Product rating, 0 to 5. null = the partner did not provide one (never shown as zero). */
  rating: number | null
  reviewsCount: number | null
  sellerRating: number | null
  variants: Variant[]
  availability: Availability
  material: string | null
  color: string | null
  fit: "ajustado" | "regular" | "amplo" | null
  deliveryDays: number | null
  measurements: { label: string; value: string }[]
  styles: string[]
  updatedAt: string | null
  links: ProductLinks
  /**
   * Every store selling this product. offers[0] is always the product's own store
   * (partner/price/links above); the rest come from `offers` in the API, one per store.
   */
  offers: ProductOffer[]
  /** Whether the signed-in person saved it to the Closet (false when signed out). */
  favorite: boolean
  /** Synthetic test item: never a real offer. */
  fixture: boolean
  /** Has an image cleared for virtual try-on and an available variant. */
  tryOnReady: boolean
}

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  total: number | null
}

export interface Facet {
  id: string
  label: string
  count: number | null
}

export interface CatalogFacets {
  categories: Facet[]
  partners: Facet[]
  priceRange: { min: number; max: number; currency: string } | null
  total: number | null
}

export interface ExploreHero {
  product: Product
  image: ImageAsset
}

/* ------------------------------------------------------------------ account */

export type AuthProviderId = "password" | "google"

export interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean
  avatarUrl: string | null
  providers: AuthProviderId[]
  createdAt: string | null
}

export interface Session {
  accessToken: string
  user: User
}

export interface Plan {
  id: string
  name: string
  /** Tokens granted per renewal period; null when the plan has no allowance. */
  tokensPerPeriod: number | null
  period: "day" | "month" | null
  price: Money | null
}

export interface Balance {
  tokens: number
  plan: Plan
  renewsAt: string | null
}

/** Where the catalog comes from (GET /catalog/source). Only a confirmed store integration may say so. */
export interface CatalogSource {
  id: string
  label: string
  /** Synthetic products for testing: no store, no real price, stock or purchase link. */
  test: boolean
}

export type BodyAngle = "front" | "side" | "profile"

export interface BodyPhoto {
  id: string | null
  angle: BodyAngle
  image: ImageAsset
  /** ready = approved and in use; processing = being validated; rejected = needs adjustment, unconfirmed or validator error. */
  status: "processing" | "ready" | "rejected"
  /** Server-side findings, in Portuguese (e.g. "Afaste a câmera para incluir as pernas."). */
  issues: string[]
  /** True for the approved photo of this angle that the Estúdio uses. */
  inUse: boolean
  /** Recommendations on an accepted photo (e.g. little room above the head); never blocking. */
  advice: string[]
  /** The server can re-run the current rules on this stored photo (technical error or older rules). */
  revalidatable: boolean
  validation: PhotoValidationView | null
  uploadedAt: string | null
  expiresAt: string | null
}

export type PhotoValidationStatus = "approved" | "needs_adjustment" | "inconclusive" | "error"
export interface PhotoValidationView {
  status: PhotoValidationStatus
  framing: "full_body" | "to_knees" | "partial" | "none" | null
  supports: { upper: boolean; lower: boolean; dress: boolean } | null
  measuredAngle: BodyAngle | null
  version: string | null
}

export interface BodyPhotosState {
  items: BodyPhoto[]
  /** Angles the current provider needs to generate (today: front only). */
  requiredAngles: BodyAngle[]
  /** Where the pose validator runs: on StylAI servers (official) or in this browser (demo). */
  validator: { available: boolean; where: "server" | "browser" } | null
  /** Consent for using the photo in virtual try-on (versioned by the server). */
  consent: { policyVersion: string; accepted: boolean } | null
}

export type SignUpResult = { status: "verification_required" }

/** Result of the Estúdio search step (before any generation). */
export interface SearchResult {
  /** "curated_catalog": reviewed catalog rows, not a live search in stores. */
  source: string
  interpretation: { category: CategoryRef | null; colors: string[]; maxPriceBrl: number | null; terms: string[] }
  items: Candidate[]
  total: number
}

export interface Measurements {
  size: string | null
  bustCm: number | null
  waistCm: number | null
  hipsCm: number | null
  heightCm: number | null
  useInSearch: boolean
}

/* ------------------------------------------------------------------ preferences */

export type RuleMode = "require" | "prefer" | "off"
export type BudgetScope = "look" | "piece"

export interface NumericRule {
  value: number
  mode: RuleMode
}

export interface PreferenceRules {
  minRating: NumericRule
  minReviews: NumericRule
  excludedPartners: string[]
  sizes: { top: string | null; bottom: string | null; shoes: string | null }
  onlyAvailableSize: boolean
  budget: { value: number; scope: BudgetScope; mode: RuleMode }
  missingRating: "exclude" | "warn"
  advanced: {
    sellerRating: NumericRule
    maxDeliveryDays: NumericRule
    avoidColors: string[]
    preferMaterials: string[]
    fit: { value: "ajustado" | "regular" | "amplo"; mode: RuleMode }
  }
}

export interface Preference {
  id: string
  name: string
  rules: PreferenceRules
}

export interface Preferences {
  items: Preference[]
  defaultId: string | null
}

/* ------------------------------------------------------------------ studio */

export interface StudioConfig {
  /** In moedas. null = cost not defined by the owner (shown as such, never guessed). */
  costs: { generate: number; edit: number | null; tryOn: number }
  /** Plans as the server defines them (moedas per period). */
  plans: { id: string; name: string; coinsPerPeriod: number; period: "day" | "month" }[]
  /** Commercial rules still open (e.g. "edit", "monthly_limit"); shown, never invented. */
  costGaps: string[]
  /** How this stack renders: simulated (no paid call), real (paid provider) or disabled. null = not declared. */
  generationMode: "simulated" | "real" | "disabled" | null
  /** Real mode: what one generation calls and its estimated cost, shown before the paid call. */
  realProvider: { provider: string; model: string; callsPerGeneration: number; estimatedUsdPerCall: number; maxUsdPerCall: number } | null
  maxReferences: number
  /** Base pieces per request (from Explorar or the search catalog panel). */
  maxChosenPieces: number
  maxPromptLength: number
  budget: { min: number; max: number; step: number; currency: string }
  acceptedImageTypes: string[]
  maxImageBytes: number
  minImageHeight: number
  /** Size grids offered in the preference editor, per group. */
  sizes: { top: string[]; bottom: string[]; shoes: string[] }
  /** What this server actually supports; screens hide everything else. */
  capabilities: StudioCapabilities
  unit: { singular: string; plural: string }
  /** "provisional": the request limit is a test value, not an approved commercial rule. */
  quotaStatus: "provisional" | "final"
  photoPolicyVersion: string | null
}

/**
 * What the server can do today. The Estúdio keeps its full layout and shows a clear
 * "not available yet" state for anything switched off here; it never fakes a result.
 */
export interface StudioCapabilities {
  /** "single_piece_try_on": the engine dresses one chosen catalog piece on the person's photo. */
  mode: "single_piece_try_on" | "full"
  /** Vestir: dress chosen catalog pieces (limit = maxChosenPieces). */
  dress: boolean
  /** Vestir: free-text adjustment ("camisa por dentro da calça"). */
  adjustments: boolean
  /** A consented body photo is required before dressing. */
  bodyPhotoRequired: boolean
  /** Save looks/pieces in the Closet. */
  closet: boolean
  /** Where Procurar searches: "curated_catalog" (reviewed rows) or "stores" (live partner search). */
  searchScope: "curated_catalog" | "stores"
  /** Who picks pieces: the AI agent (model) or deterministic rules (never shown as "agent"). */
  composer: { mode: "agent" | "rules"; model: string | null }
  generation: boolean
  edits: boolean
  match: boolean
  references: boolean
  preferences: boolean
  search: boolean
  /** Body measurements (GET/PUT /me/measurements). */
  measurements: boolean
  /** Plan catalogue (GET /plans). */
  plans: boolean
  /** Search pool of a generated look (GET /studio/looks/:id/candidates). */
  candidates: boolean
}

/** Capabilities that are on/off flags (not the mode/scope strings). */
export type CapabilityFlag = { [K in keyof StudioCapabilities]: StudioCapabilities[K] extends boolean ? K : never }[keyof StudioCapabilities]

export type PieceRole = "look" | "similar" | "chosen"

export interface LookPiece {
  product: Product
  role: PieceRole
  warnings: string[]
}

export interface Look {
  id: string
  title: string
  note: string | null
  image: ImageAsset
  pieces: LookPiece[]
  prompt: string | null
  origin: "generate" | "edit" | "tryon" | "match"
  version: number
  parentId: string | null
  createdAt: string | null
  candidatesCount: number
  saved: boolean
  /** Image produced by a simulator or the demo, not by the real provider. */
  simulated: boolean
  /** Look lineage (all versions share it); null on older payloads. */
  lineageId: string | null
}

export interface Candidate {
  product: Product
  usedInLook: boolean
  /** Labels of the preference criteria this piece fails (empty = passes). */
  failed: string[]
}

export interface LimitingCriterion {
  id: string
  label: string
  removed: number
  total: number
  unlocks: boolean
}

export type JobKind = "generate" | "edit" | "tryon"
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "no_results" | "cancelled"

export interface Job {
  id: string
  kind: JobKind
  status: JobStatus
  /** Human-readable step from the server, e.g. "Buscando peças nos parceiros". */
  step: string | null
  /** 0 to 1 when the server knows it. */
  progress: number | null
  cost: number
  /** True when the tokens were actually debited (only on success). */
  charged: boolean
  lookId: string | null
  limiting: LimitingCriterion[]
  candidatesCount: number | null
  error: { code: string; message: string } | null
}

export interface UploadedImage {
  id: string
  image: ImageAsset
  sizeBytes: number | null
  mime: string | null
}

export interface MatchDecision {
  id: string
  lookId: string
  decision: "save" | "pass"
}

/* ------------------------------------------------------------------ closet */

export interface ClosetPiece {
  product: Product
  savedAt: string | null
  via: "favorite" | "look"
}

export interface Closet {
  pieces: ClosetPiece[]
  looks: Look[]
}

/* ----------------------------------------------------------------- outfit composition */
export type CompositionSlotId = "upper" | "lower" | "dress" | "outer"
export interface CompositionCandidate { product: Product; slot: CompositionSlotId; generationEligible: boolean }
export interface CompositionSlot {
  slot: CompositionSlotId
  required?: boolean
  alternativeSearch?: boolean
  label: string
  candidates: CompositionCandidate[]
  choice: { productId: string; reason: string } | null
  error: string | null
}
export interface Composition {
  id: string
  stages: CompositionStages | null
  source: string
  /** "agent" = chosen by the AI composer and revalidated by the server; "rules_fallback" = deterministic rules. */
  selectionMethod: "agent" | "rules_fallback"
  model: string | null
  slots: CompositionSlot[]
  totalPrice: Money | null
  missingSlots: CompositionSlotId[]
  generation: {
    eligible: boolean
    blockedReason: string | null
    layers: number
    render: "sequential_layers_unverified" | "single_garment"
    /** Null when the provider bills by usage (e.g. Segmind GPU-seconds): only the reservation ceiling is known. */
    estimatedProviderUsd: number | null
    provider: string | null
    reservePerLayerUsd: number | null
    maxReservedUsd: number | null
    coins: number
    coinsNote: string
  }
}

export interface CompositionStages { interpretation: string; retrieval: string; selection: string }
export type ComposeOutcome =
  | { kind: "composed"; composition: Composition }
  | { kind: "not_composed"; stages: CompositionStages; message: string }
