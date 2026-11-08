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
  label: string
  available: boolean
}

export interface ProductLinks {
  /** Affiliate URL (commission may apply). */
  affiliateUrl: string | null
  /** Plain product page at the partner. */
  productUrl: string | null
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
  /** Whether the signed-in person saved it to the Closet (false when signed out). */
  favorite: boolean
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

export type BodyAngle = "front" | "side" | "profile"

export interface BodyPhoto {
  angle: BodyAngle
  image: ImageAsset
  status: "processing" | "ready" | "rejected"
  /** Server-side quality findings, in Portuguese (e.g. "Corpo cortado na altura dos joelhos"). */
  issues: string[]
  uploadedAt: string | null
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
  costs: { generate: number; edit: number; tryOn: number }
  maxReferences: number
  /** Catalog pieces that can be carried from Explorar into one request. */
  maxChosenPieces: number
  maxPromptLength: number
  budget: { min: number; max: number; step: number; currency: string }
  acceptedImageTypes: string[]
  maxImageBytes: number
  minImageHeight: number
  /** Size grids offered in the preference editor, per group. */
  sizes: { top: string[]; bottom: string[]; shoes: string[] }
}

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
