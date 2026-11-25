import { safeAliExpressUrl, type NormalizedAliExpressCatalogItem } from "@stylai/commerce"
import type { CatalogFacet } from "@stylai/contracts"
import type { PrivateDatabase } from "@stylai/supabase"
import { z } from "zod"

// A published offer has already passed the importer. Validate the database read
// at this boundary and keep the AI rights decision independent of publication.
const offerSchema = z.object({
  source: z.literal("aliexpress"),
  canonicalKey: z.string().regex(/^aliexpress:[0-9]{1,20}$/),
  externalProductId: z.string().regex(/^[0-9]{1,20}$/),
  name: z.string().min(1),
  seller: z.string().min(1),
  sellerName: z.string().min(1),
  category: z.string().min(1),
  categoryLabel: z.string().min(1),
  currency: z.literal("BRL"),
  priceMinor: z.number().int().nonnegative().nullable(),
  priceObservedAt: z.iso.datetime({ offset: true }).nullable(),
  offerExpiresAt: z.iso.datetime({ offset: true }),
  productUrl: z.string().refine((url) => Boolean(safeAliExpressUrl(url, ["aliexpress.com", "aliexpress.us"]))),
  affiliateUrl: z.string().refine((url) => Boolean(safeAliExpressUrl(url, ["aliexpress.com"]))),
  image: z.string().refine((url) => Boolean(safeAliExpressUrl(url, ["alicdn.com", "aliexpress-media.com"]))),
  color: z.string().nullable(),
  ratingPercent: z.number().min(0).max(100).nullable(),
  recentSales: z.number().int().nonnegative().nullable(),
}).refine((offer) => offer.canonicalKey === `aliexpress:${offer.externalProductId}`)

export type PublishedAffiliateOffer = NormalizedAliExpressCatalogItem & {
  offerExpiresAt: string
  catalogPublished: true
}

function publishedOffer(row: z.infer<typeof offerSchema>): PublishedAffiliateOffer {
  return {
    ...row,
    variants: [],
    rights: { basis: "unconfirmed", evidence: "AliExpress Affiliates", tryOnAllowed: false },
    capabilities: { displayAndLink: true, aiTryOn: false, aiTryOnBlockedReason: "ai_image_rights_unconfirmed" },
    catalogPublished: true,
    fixture: false,
  }
}

const pageSchema = z.object({ items: z.array(offerSchema), nextCursor: z.string().nullable(), total: z.number().int().nonnegative() })
const facetSchema = z.object({ id: z.string(), label: z.string(), count: z.number().int().nonnegative() }) satisfies z.ZodType<CatalogFacet>
const facetsSchema = z.object({
  categories: z.array(facetSchema),
  partners: z.array(facetSchema),
  collections: z.array(facetSchema),
  priceRange: z.object({ min: z.number(), max: z.number(), currency: z.literal("BRL") }).nullable(),
  total: z.number().int().nonnegative(),
})

export type AffiliateOfferQuery = {
  collection?: string
  category?: string
  categories?: string[]
  partner?: string
  keyword?: string
  requiredTerms?: string[]
  minPriceMinor?: number
  maxPriceMinor?: number
  nearPriceMinor?: number
  favoriteActor?: string
  exclude?: string
  limit?: number
  cursor?: string
  sort?: "newest" | "price_asc" | "price_desc" | "price_near"
}

export function canonicalAffiliateId(value: string): string | null {
  const match = /^(?:aliexpress:)?([0-9]{1,20})$/.exec(value)
  return match ? `aliexpress:${match[1]}` : null
}

export function createAffiliateCatalogReader(db: PrivateDatabase<"api">) {
  return {
    async list(query: AffiliateOfferQuery) {
      const page = pageSchema.parse(await db.call("list_affiliate_offers", query))
      return { ...page, items: page.items.map(publishedOffer) }
    },
    async detail(id: string): Promise<PublishedAffiliateOffer | null> {
      const row = await db.call("read_affiliate_offer", id)
      return row === null ? null : publishedOffer(offerSchema.parse(row))
    },
    async facets() {
      return facetsSchema.parse(await db.call("read_affiliate_facets"))
    },
  }
}
