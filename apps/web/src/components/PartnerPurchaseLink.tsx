import { ArrowUpRight } from "@phosphor-icons/react"
import type { Product } from "../api/types"
import { resolvePartnerLink } from "../lib/links"
import { isOfferExpired } from "../lib/offers"
import { useOfferExpiry } from "../lib/useOfferExpiry"

export function PartnerPurchaseLink({ product, label, affiliateOnly = false }: { product: Product; label?: string; affiliateOnly?: boolean }) {
  const expired = useOfferExpiry(product.offerExpiresAt)
  const link = resolvePartnerLink(product.links)
  if (expired || link.kind === "none" || (affiliateOnly && link.kind !== "affiliate")) return null
  return (
    <a
      href={link.href}
      target="_blank"
      rel={link.rel}
      data-link-kind={link.kind}
      className={label ? "sa-btn sa-btn-secondary sa-btn-sm" : "sa-iconbtn"}
      aria-label={`Ver ${product.name} na loja (${link.kind === "affiliate" ? "link comissionado" : "link da loja"})`}
      onClick={(event) => { if (isOfferExpired(product.offerExpiresAt)) event.preventDefault() }}
    >
      {label} <ArrowUpRight size={label ? 16 : 18} aria-hidden="true" />
    </a>
  )
}
