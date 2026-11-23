/**
 * Curated real-garment pilot catalog manifest & validator (P1).
 * Keeps real pilot garments strictly separated from the synthetic test catalog and from
 * unconfirmed store references (e.g. SHEIN). Never invents commercial price, stock, SKU or links.
 */
import { CATEGORY_GROUP } from "./photo-validation.js"
import { isTestImageUrl } from "./catalog-source.js"

export const PILOT_SELLER_ID = "stylai-pilot"
export const PILOT_SELLER_NAME = "Catálogo piloto — peças reais"

export type PilotRightsBasis = "owner_authorized" | "cc0" | "public_domain"

export interface PilotGarmentRights {
  basis: PilotRightsBasis
  /** Required for cc0 / public_domain (the specific file page proving the license). */
  sourcePageUrl: string | null
  author: string | null
  licenseLabel: string
  evidence: string
  verifiedAt: string
  reviewer: string
  tryOnAllowed: true
}

export interface PilotGarmentItem {
  externalProductId: string
  name: string
  category: keyof typeof CATEGORY_GROUP
  color: string | null
  /** Label identifying the physical garment photographed (e.g. "Peça fotografada" or real size "M"). */
  variantLabel: string
  imageUrl: string
  rights: PilotGarmentRights
}

export interface PilotCatalogManifest {
  batchId: string
  source: "curated"
  seller: typeof PILOT_SELLER_ID
  sellerName: typeof PILOT_SELLER_NAME
  items: PilotGarmentItem[]
}

const VALID_BASIS = new Set<string>(["owner_authorized", "cc0", "public_domain"])
const VALID_CATEGORIES = new Set<string>(Object.keys(CATEGORY_GROUP))

function isPublicHttpsUrl(raw: string): boolean {
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== "https:") return false
  if (isTestImageUrl(raw)) return false
  const h = u.hostname.toLowerCase()
  if (h === "localhost" || /\.(local|localhost|test|invalid|internal)$/.test(h)) return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "[::1]") return false
  return true
}

export class PilotCatalogValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(`Pilot catalog manifest invalid:\n- ${errors.join("\n- ")}`)
  }
}

export function validatePilotCatalog(input: unknown): PilotCatalogManifest {
  const errors: string[] = []
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PilotCatalogValidationError(["manifest must be a JSON object"])
  }
  const obj = input as Record<string, unknown>
  const batchId = typeof obj.batchId === "string" ? obj.batchId.trim() : ""
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(batchId)) errors.push("batchId must match ^[a-z0-9][a-z0-9_-]{2,63}$")

  if (!Array.isArray(obj.items) || obj.items.length === 0) {
    errors.push("items must be a non-empty array")
    throw new PilotCatalogValidationError(errors)
  }

  const seenIds = new Set<string>()
  const items: PilotGarmentItem[] = []

  obj.items.forEach((raw, idx) => {
    const p = `items[${idx}]`
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${p}: must be an object`)
      return
    }
    const r = raw as Record<string, unknown>
    const id = typeof r.externalProductId === "string" ? r.externalProductId.trim() : ""
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(id)) errors.push(`${p}.externalProductId: invalid stable id`)
    else if (seenIds.has(id)) errors.push(`${p}.externalProductId: duplicate id "${id}"`)
    else seenIds.add(id)

    const name = typeof r.name === "string" ? r.name.trim() : ""
    if (name.length < 3 || name.length > 120) errors.push(`${p}.name: must be 3..120 chars`)

    const category = typeof r.category === "string" ? r.category.trim() : ""
    if (!VALID_CATEGORIES.has(category)) errors.push(`${p}.category: unsupported category "${category}"`)

    const color = r.color == null ? null : (typeof r.color === "string" && r.color.trim() ? r.color.trim().toLowerCase() : null)
    const variantLabel = typeof r.variantLabel === "string" && r.variantLabel.trim() ? r.variantLabel.trim() : "Peça fotografada"

    // Commercial offer fields are forbidden in the curated real-garment pilot.
    if (r.priceMinor !== undefined && r.priceMinor !== null) errors.push(`${p}.priceMinor: pilot items must not invent commercial prices`)
    if (r.productUrl !== undefined && r.productUrl !== null) errors.push(`${p}.productUrl: pilot items must not claim commercial store links`)

    const imageUrl = typeof r.imageUrl === "string" ? r.imageUrl.trim() : ""
    if (!isPublicHttpsUrl(imageUrl)) errors.push(`${p}.imageUrl: must be a public https URL (never local or .invalid test fixture)`)

    const rightsRaw = r.rights
    if (!rightsRaw || typeof rightsRaw !== "object" || Array.isArray(rightsRaw)) {
      errors.push(`${p}.rights: required rights evidence object`)
      return
    }
    const rt = rightsRaw as Record<string, unknown>
    const basis = typeof rt.basis === "string" ? rt.basis : ""
    if (!VALID_BASIS.has(basis)) errors.push(`${p}.rights.basis: must be owner_authorized, cc0 or public_domain (got "${basis}")`)
    if (rt.tryOnAllowed !== true) errors.push(`${p}.rights.tryOnAllowed: must be explicitly true for pilot try-on`)

    const sourcePageUrl = rt.sourcePageUrl == null ? null : (typeof rt.sourcePageUrl === "string" ? rt.sourcePageUrl.trim() : "")
    if ((basis === "cc0" || basis === "public_domain") && (!sourcePageUrl || !isPublicHttpsUrl(sourcePageUrl))) {
      errors.push(`${p}.rights.sourcePageUrl: public https file page URL required for ${basis}`)
    }
    const evidence = typeof rt.evidence === "string" ? rt.evidence.trim() : ""
    if (evidence.length < 10) errors.push(`${p}.rights.evidence: must describe the rights proof (>= 10 chars)`)
    const licenseLabel = typeof rt.licenseLabel === "string" ? rt.licenseLabel.trim() : ""
    if (licenseLabel.length < 2) errors.push(`${p}.rights.licenseLabel: required`)
    const verifiedAt = typeof rt.verifiedAt === "string" ? rt.verifiedAt.trim() : ""
    if (!/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt)) errors.push(`${p}.rights.verifiedAt: must be YYYY-MM-DD`)
    const reviewer = typeof rt.reviewer === "string" ? rt.reviewer.trim() : ""
    if (reviewer.length < 2) errors.push(`${p}.rights.reviewer: required`)
    const author = rt.author == null ? null : (typeof rt.author === "string" && rt.author.trim() ? rt.author.trim() : null)

    if (errors.length === 0) {
      items.push({
        externalProductId: id,
        name,
        category: category as keyof typeof CATEGORY_GROUP,
        color,
        variantLabel,
        imageUrl,
        rights: {
          basis: basis as PilotRightsBasis,
          sourcePageUrl,
          author,
          licenseLabel,
          evidence,
          verifiedAt,
          reviewer,
          tryOnAllowed: true,
        },
      })
    }
  })

  if (errors.length > 0) throw new PilotCatalogValidationError(errors)

  return {
    batchId,
    source: "curated",
    seller: PILOT_SELLER_ID,
    sellerName: PILOT_SELLER_NAME,
    items,
  }
}
