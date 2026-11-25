/**
 * Store tags: the same product in several stores (Product.offers). Each tag is a radio; choosing
 * one switches the price, the look total and the "Ver na <loja>" link everywhere in the app.
 * Cheapest store: name in red + down arrow; most expensive: amber + up arrow (never colour alone).
 */
import { useId, useRef } from "react"
import type { KeyboardEvent } from "react"
import { ArrowDown, ArrowUp } from "@phosphor-icons/react"
import type { Product } from "../api/types"
import { useStore } from "../app/store"
import { formatMoney } from "../lib/format"
import { rankOffers, withOffer, type RankedOffer } from "../lib/offers"
import { useOfferExpiry } from "../lib/useOfferExpiry"

/** The product as shown for the store the person chose (or its own store). */
export function useOfferProduct(product: Product): Product {
  const { offerChoice } = useStore()
  useOfferExpiry(product.offerExpiresAt)
  return withOffer(product, offerChoice[product.id])
}

const priceOf = (o: RankedOffer): string => (o.price ? formatMoney(o.price.amount, o.price.currency) : "preço não informado")
const rankWord = (o: RankedOffer): string | null => (o.lowest ? "menor preço" : o.highest ? "maior preço" : null)
const rankClass = (o: RankedOffer): string => (o.lowest ? "sa-price-low" : o.highest ? "sa-price-high" : "")

function RankIcon({ offer, size }: { offer: RankedOffer; size: number }) {
  if (offer.lowest) return <ArrowDown size={size} weight="bold" aria-hidden="true" />
  if (offer.highest) return <ArrowUp size={size} weight="bold" aria-hidden="true" />
  return null
}

interface StoreTagsProps {
  product: Product
  /** "sm" in grid cards, "md" in sheets and side lists. */
  size?: "sm" | "md"
  className?: string
}

export function StoreTags({ product, size = "sm", className = "" }: StoreTagsProps) {
  const { offerChoice, chooseOffer } = useStore()
  const listRef = useRef<HTMLDivElement | null>(null)
  const labelId = useId()
  const offers = rankOffers(product)
  const selectedId = withOffer(product, offerChoice[product.id]).partner.id

  if (offers.length < 2) {
    return (
      <div className={`sa-storetags ${className}`}>
        <span className={`sa-storetag sa-storetag-${size} sa-storetag-static`}>{product.partner.name}</span>
      </div>
    )
  }

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0
    if (!delta && e.key !== "Home" && e.key !== "End") return
    e.preventDefault()
    const n = offers.length
    const next = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + delta + n) % n
    const target = offers[next]
    if (!target) return
    chooseOffer(product.id, target.partner.id)
    listRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus()
  }

  return (
    <div ref={listRef} role="radiogroup" aria-labelledby={labelId} className={`sa-storetags ${className}`}>
      <span id={labelId} className="sa-sr">
        Lojas que vendem {product.name}
      </span>
      {offers.map((o, i) => {
        const checked = o.partner.id === selectedId
        const rank = rankWord(o)
        return (
          <button
            key={o.partner.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            aria-label={`${o.partner.name}, ${priceOf(o)}${rank ? `, ${rank}` : ""}`}
            className={`sa-storetag sa-hit sa-storetag-${size} ${rankClass(o)}`}
            onClick={(e) => {
              e.stopPropagation()
              chooseOffer(product.id, o.partner.id)
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            <RankIcon offer={o} size={size === "sm" ? 12 : 14} />
            <span className="sa-truncate">{o.partner.name}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Price of the chosen store plus its rank marker ("Menor preço" / "Maior preço"). */
export function OfferPrice({ product, size = "sm" }: { product: Product; size?: "sm" | "lg" }) {
  const { offerChoice } = useStore()
  const expired = useOfferExpiry(product.offerExpiresAt)
  const offers = rankOffers(product)
  const selectedId = withOffer(product, offerChoice[product.id]).partner.id
  const selected = offers.find((o) => o.partner.id === selectedId) ?? offers[0]
  if (!selected) return null
  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 ${size === "lg" ? "mt-2" : "mt-1"}`} aria-live="polite">
      <span className={`sa-num font-semibold ${size === "lg" ? "text-lg" : "sa-caption"}`} style={{ color: "var(--text1)" }}>
        {expired ? "Oferta expirada" : selected.price ? formatMoney(selected.price.amount, selected.price.currency) : "Preço não informado"}
      </span>
      {selected.lowest || selected.highest ? (
        <span className={`sa-caption sa-pricerank ${rankClass(selected)}`}>
          <RankIcon offer={selected} size={12} />
          {selected.lowest ? "Menor preço" : "Maior preço"}
        </span>
      ) : offers.length > 1 ? (
        <span className="sa-caption sa-muted">{offers.length} lojas</span>
      ) : null}
    </p>
  )
}
