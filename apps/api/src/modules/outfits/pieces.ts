/** Stored outfit pieces: what the server kept about each listing (never client input) and how it is presented. */
import { z } from "zod"
import { colorTagsOf, OUTFIT_SLOT_LABEL, OUTFIT_SLOTS, type CompositionIntent, type OutfitCandidate, type OutfitSlot } from "@stylai/contracts"
import type { NormalizedAliExpressCatalogItem } from "@stylai/commerce"
import { displayImageUrl, type CatalogRow } from "../catalog/routes.js"
import type { ReferenceItem } from "./references.js"

const uuid = z.string().uuid()
export const slotSchema = z.enum(["set", "dress", "lower", "upper", "outer"])
export const referenceSchema = z.object({ productId: uuid, variantId: uuid.nullable(), imageUrl: z.string().nullable(), sha256: z.string().optional() })
export const pieceSchema = z.object({
  slot: slotSchema, id: z.string().min(1).max(200), name: z.string(), reason: z.string().default(""), categoryId: z.string(),
  priceMinor: z.number().int().nullable(), priceObservedAt: z.string().nullable(), image: z.string().nullable(),
  productUrl: z.string().nullable(), affiliateUrl: z.string().nullable(), source: z.string(), partnerId: z.string(), partner: z.string(),
  externalId: z.string().nullable(), fixture: z.boolean(),
  variants: z.array(z.object({ id: uuid, label: z.string() })).max(40), variantId: uuid.nullable(),
  reference: referenceSchema.nullable(), blocked: z.string().nullable(),
  // Absent in sets stored before 2026-11-24.
  ratingPercent: z.number().nullable().optional(), recentSales: z.number().int().nullable().optional(),
})
export type StoredPiece = z.infer<typeof pieceSchema>
export const poolsSchema = z.partialRecord(slotSchema, z.array(pieceSchema))
export type StoredPools = z.infer<typeof poolsSchema>

const short = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n)

export function pieceFromAliExpress(item: NormalizedAliExpressCatalogItem, slot: OutfitSlot): StoredPiece {
  return {
    slot, id: item.canonicalKey, name: short(item.name, 160), reason: "", categoryId: item.category, priceMinor: item.priceMinor, priceObservedAt: item.priceObservedAt,
    image: item.image, productUrl: item.productUrl, affiliateUrl: item.affiliateUrl, source: item.source, partnerId: item.seller, partner: short(item.sellerName, 120),
    externalId: item.externalProductId, fixture: false, variants: [], variantId: null, reference: null, blocked: null,
    ratingPercent: item.ratingPercent, recentSales: item.recentSales,
  }
}
export const referenceItemOf = (p: StoredPiece): ReferenceItem => ({
  source: "aliexpress", canonicalKey: p.id, seller: p.partnerId, sellerName: p.partner, externalProductId: p.externalId ?? "", category: p.categoryId, name: p.name,
  priceMinor: p.priceMinor, priceObservedAt: p.priceObservedAt, productUrl: p.productUrl, image: p.image ?? "",
})
export function pieceFromCatalog(row: CatalogRow, slot: OutfitSlot): StoredPiece {
  const sizes = row.variants.filter((v) => v.available === true).map((v) => ({ id: v.id, label: v.label })).slice(0, 40)
  const image = row.images.find((i) => i.try_on_allowed) ?? null
  const only = sizes.length === 1 ? sizes[0]!.id : null
  return {
    slot, id: row.id, name: short(row.name, 160), reason: "", categoryId: row.category?.id ?? "", priceMinor: row.price_minor, priceObservedAt: row.source_updated_at,
    image: (image ?? row.images[0])?.url ?? null, productUrl: row.product_url, affiliateUrl: null, source: row.partner?.source ?? "curated",
    partnerId: row.partner?.id ?? "unknown", partner: row.partner?.name ?? "Loja não informada", externalId: null, fixture: row.fixture, variants: sizes, variantId: only,
    reference: image && sizes.length ? { productId: row.id, variantId: only, imageUrl: null } : null, blocked: image && sizes.length ? null : "rights_unavailable",
  }
}
export const candidateOf = (p: StoredPiece): OutfitCandidate => ({ id: p.id, slot: p.slot, categoryId: p.categoryId, name: p.name, priceMinor: p.priceMinor, colorTags: colorTagsOf(p.name),
  ratingPercent: p.ratingPercent ?? null, recentSales: p.recentSales ?? null })
export const totalOf = (pieces: readonly StoredPiece[]): number | null =>
  pieces.length && pieces.every((p) => p.priceMinor !== null) ? pieces.reduce((a, p) => a + (p.priceMinor ?? 0), 0) : null
export const orderPieces = (pieces: readonly StoredPiece[]): StoredPiece[] => OUTFIT_SLOTS.flatMap((s) => pieces.filter((p) => p.slot === s))

/** Portuguese reason shown on the card; unknown codes never leak. */
export const BLOCKED_MESSAGE: Record<string, string> = {
  rights_unavailable: "O uso desta imagem no provador não está autorizado agora.",
  review_required: "Este anúncio mudou e precisa de revisão antes de usar a imagem.",
  product_link_missing: "O anúncio não informou um link válido.",
  seller_unidentified: "A loja não identificou o vendedor deste anúncio.",
  category_not_renderable: "Ainda não conseguimos vestir este tipo de peça.",
  not_found: "A imagem do anúncio não existe mais.",
  too_small: "A imagem do anúncio é pequena demais para o provador.",
  size_required: "Escolha o tamanho desta peça.",
}
export const blockedMessage = (code: string): string => BLOCKED_MESSAGE[code] ?? "Não conseguimos preparar a imagem deste anúncio. Troque a peça ou tente de novo."
export const blockedCode = (p: StoredPiece): string | null =>
  p.reference === null ? p.blocked ?? "not_prepared" : p.variants.length > 1 && p.variantId === null ? "size_required" : null

export function presentPieceCard(p: StoredPiece, base: string) {
  const code = blockedCode(p)
  return {
    slot: p.slot, label: OUTFIT_SLOT_LABEL[p.slot], reason: p.reason, variantId: p.variantId,
    // As the store publishes them (percentage of positive feedback, recent units); never converted to stars.
    storeRating: p.ratingPercent ?? null, storeSales: p.recentSales ?? null,
    tryOn: { ready: code === null, code, message: code === null ? null : code === "not_prepared" ? null : blockedMessage(code) },
    product: {
      id: p.id, name: p.name, category: { id: p.categoryId, label: OUTFIT_SLOT_LABEL[p.slot] }, partner: { id: p.partnerId, name: p.partner }, source: p.source,
      price: p.priceMinor === null ? null : { amount: p.priceMinor / 100, currency: "BRL" },
      images: p.image ? [{ url: displayImageUrl(p.image, base), width: 600, height: 800, alt: p.name, focus: null }] : [],
      rating: null, reviewsCount: null, sellerRating: null, variants: p.variants.map((v) => ({ ...v, available: true })), availability: "unknown" as const,
      material: null, color: null, fit: null, deliveryDays: null, measurements: [], styles: [], updatedAt: p.priceObservedAt,
      links: { productUrl: p.productUrl, affiliateUrl: p.affiliateUrl }, favorite: false, fixture: p.fixture, stockConfirmed: false,
      priceKind: p.priceMinor === null ? "none" as const : p.fixture ? "test_price" as const : "observed" as const, tryOnReady: code === null,
    },
  }
}

export const overBudget = (intent: Pick<CompositionIntent, "budgetTotalBrl">, totalMinor: number | null): boolean | null =>
  intent.budgetTotalBrl === null ? null : totalMinor === null ? null : totalMinor > Math.round(intent.budgetTotalBrl * 100)
