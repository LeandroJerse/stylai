/** Small look helpers shared by Estúdio and Closet (kept out of the screens so chunks stay independent). */
import type { Look } from "../api/types"

export const ORIGIN_LABEL: Record<Look["origin"], string> = {
  generate: "Criado no Estúdio",
  edit: "Edição do Estúdio",
  tryon: "Prova do acervo",
  match: "Guardado no Match",
}

// Look totals live in lib/offers.ts (sumLookWith): they follow the store chosen per piece.
