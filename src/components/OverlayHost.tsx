import type { ReactNode } from "react"
import {
  AcervoSheet,
  ClosetLookSheet,
  Deferred,
  DeleteAccountSheet,
  EditSheet,
  MatchDialog,
  PasswordSheet,
  PreferencePickerSheet,
  SearchPreferenceEditor,
  SettingsSheet,
  TokensSheet,
} from "../app/lazy"
import { useStore } from "../app/store"
import { ExploreFiltersSheet } from "../screens/Explore"
import { GoToPieceSheet, ProductDetailSheet } from "./pieces"
import { Viewer } from "./Viewer"

/** Lazy sheets are usually prefetched already; while a chunk is still downloading nothing is shown. */
const later = (node: ReactNode): ReactNode => (
  <Deferred fallback={null} compact>
    {node}
  </Deferred>
)

/** Renders the single active overlay. Opening another replaces it (no stacking; `back` returns). */
export function OverlayHost() {
  const { overlay } = useStore()
  if (!overlay) return null
  switch (overlay.kind) {
    case "product":
      return <ProductDetailSheet productId={overlay.productId} back={overlay.back} />
    case "goToPiece":
      return <GoToPieceSheet product={overlay.product} back={overlay.back} />
    case "viewer":
      return <Viewer image={overlay.image} alt={overlay.alt} />
    case "exploreFilters":
      return <ExploreFiltersSheet />
    case "edit":
      return later(<EditSheet />)
    case "match":
      return later(<MatchDialog />)
    case "acervo":
      return later(<AcervoSheet />)
    case "preferencePicker":
      return later(<PreferencePickerSheet />)
    case "preferenceEditor":
      return later(<SearchPreferenceEditor />)
    case "tokens":
      return later(<TokensSheet />)
    case "settings":
      return later(<SettingsSheet />)
    case "password":
      return later(<PasswordSheet />)
    case "deleteAccount":
      return later(<DeleteAccountSheet />)
    case "closetLook":
      return later(<ClosetLookSheet lookId={overlay.lookId} />)
  }
}
