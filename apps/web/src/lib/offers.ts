/**
 * Store offers: one product, several stores, each with its own price and links (Product.offers).
 * Pure helpers; the store chosen per product lives in the UI store (offerChoice).
 */
import type { Look, Product, ProductOffer } from "../api/types"
import { formatMoney } from "./format"

export interface RankedOffer extends ProductOffer {
  /** Cheapest priced offer of this product (only when prices differ in one currency). */
  lowest: boolean
  /** Most expensive priced offer (same condition). */
  highest: boolean
}

/** Offers with their price rank. No rank with a single store, tied prices, missing prices only or mixed currencies. */
export function rankOffers(product: Product): RankedOffer[] {
  const offers = product.offers.length > 0 ? product.offers : [{ partner: product.partner, price: product.price, links: product.links }]
  const priced = offers.map((o) => o.price).filter((p): p is NonNullable<typeof p> => p !== null)
  const currency = priced[0]?.currency
  const comparable = priced.length >= 2 && priced.every((p) => p.currency === currency)
  const amounts = priced.map((p) => p.amount)
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  const differ = comparable && min < max
  return offers.map((o) => ({
    ...o,
    lowest: differ && o.price !== null && o.price.amount === min,
    highest: differ && o.price !== null && o.price.amount === max,
  }))
}

/** The product as shown for the chosen store: partner, price and links swapped for that offer. */
export function withOffer(product: Product, partnerId: string | undefined): Product {
  if (!partnerId || partnerId === product.partner.id) return product
  const o = product.offers.find((x) => x.partner.id === partnerId)
  return o ? { ...product, partner: o.partner, price: o.price, links: o.links } : product
}

/** Sum of the look's pieces with the chosen stores; null when prices are missing or mixed. */
export function sumLookWith(look: Look, choice: Record<string, string>): string | null {
  const priced = look.pieces.map((p) => withOffer(p.product, choice[p.product.id]).price)
  const known = priced.filter((p): p is NonNullable<typeof p> => p !== null)
  const first = known[0]
  if (!first || known.length !== priced.length || known.some((p) => p.currency !== first.currency)) return null
  return formatMoney(
    known.reduce((s, p) => s + p.amount, 0),
    first.currency,
  )
}
