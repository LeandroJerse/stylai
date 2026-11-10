/**
 * Outbound partner links. URLs were already validated as https in api/parse.ts; this decides how
 * to present them. Affiliate links carry rel="sponsored" and a commission notice.
 */
import type { ProductLinks } from "../api/types"

export type PartnerLink =
  | { kind: "affiliate"; href: string; rel: string }
  | { kind: "direct"; href: string; rel: string }
  | { kind: "none" }

export function resolvePartnerLink(links: ProductLinks): PartnerLink {
  if (links.affiliateUrl) return { kind: "affiliate", href: links.affiliateUrl, rel: "sponsored noopener noreferrer" }
  if (links.productUrl) return { kind: "direct", href: links.productUrl, rel: "noopener noreferrer" }
  return { kind: "none" }
}
