/** Small look helpers shared by Estúdio and Closet (kept out of the screens so chunks stay independent). */
import type { Look } from "../api/types"
import { formatMoney } from "./format"

export const ORIGIN_LABEL: Record<Look["origin"], string> = {
  generate: "Criado no Estúdio",
  edit: "Edição do Estúdio",
  tryon: "Prova do acervo",
  match: "Guardado no Match",
}

/** Sum of known prices in one currency; null when prices are missing or mixed. */
export function sumLook(look: Look): string | null {
  const priced = look.pieces.map((p) => p.product.price).filter((p): p is NonNullable<typeof p> => p !== null)
  const first = priced[0]
  if (!first || priced.length !== look.pieces.length || priced.some((p) => p.currency !== first.currency)) return null
  return formatMoney(
    priced.reduce((s, p) => s + p.amount, 0),
    first.currency,
  )
}
