import type { AliExpressAffiliateClient, AliExpressErrorKind } from "./client.js"
import { safeAliExpressUrl, type NormalizedAliExpressCatalogItem } from "./catalog.js"

export const ALIEXPRESS_LINK_BATCH_SIZE = 50
export type AliExpressLinkState = "generated" | "unmatched" | "missing_tracking_id" | "failed"

/** A link belongs to the exact listing sent to link.generate, using our signed tracking ID. */
export async function linkAliExpressCatalogItems(
  client: Pick<AliExpressAffiliateClient, "generateLinks">,
  items: NormalizedAliExpressCatalogItem[],
  trackingId: string | null,
): Promise<{
  items: NormalizedAliExpressCatalogItem[]
  links: AliExpressLinkState | null
  trackingIdEcho: string | null
  linkErrorCode: string | null
  linkErrorKind?: AliExpressErrorKind
}> {
  const unlinked = items.map((item) => ({ ...item, affiliateUrl: null }))
  const result = { items: unlinked, links: null, trackingIdEcho: null, linkErrorCode: null }
  if (!items.length) return result
  if (!trackingId) return { ...result, links: "missing_tracking_id" }

  const sources = [...new Set(items.flatMap(({ productUrl }) => productUrl ? [productUrl] : []))]
  if (!sources.length) return result
  if (sources.length > ALIEXPRESS_LINK_BATCH_SIZE) return { ...result, links: "failed", linkErrorCode: "link_batch_too_large" }
  const generated = await client.generateLinks(sources)
  if (!generated.ok) return { ...result, links: "failed", linkErrorCode: generated.code ?? generated.kind, linkErrorKind: generated.kind }
  if (generated.trackingId !== null && generated.trackingId !== trackingId) {
    return { ...result, links: "failed", trackingIdEcho: generated.trackingId, linkErrorCode: "tracking_id_mismatch" }
  }

  const bySource = new Map<string, string | null>()
  const requested = new Set(sources)
  for (const link of generated.links) {
    if (!requested.has(link.sourceValue)) continue
    const safe = safeAliExpressUrl(link.promotionLink, ["aliexpress.com"])
    // A contradictory pair is ambiguous. Later duplicates cannot override this decision.
    bySource.set(link.sourceValue, bySource.has(link.sourceValue) && bySource.get(link.sourceValue) !== safe ? null : safe)
  }
  const linked = items.map((item) => ({ ...item, affiliateUrl: item.productUrl ? bySource.get(item.productUrl) ?? null : null }))
  return { ...result, items: linked, links: linked.some((item) => item.affiliateUrl !== null) ? "generated" : "unmatched", trackingIdEcho: generated.trackingId }
}
