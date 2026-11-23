/**
 * Catalog source boundary. Every source (the synthetic test catalog today; official store connectors
 * later) produces the SAME normalized item, keyed by source + seller + external ids, and declares
 * what it really provides. The Estúdio reads capabilities and hides what a source does not offer;
 * nothing is filled in by guessing (unknown stays null/"unknown").
 * The importer (scripts/dev-db.ts) writes normalized items into the catalog tables; the API serves
 * them (GET /v1/catalog/*, POST /v1/studio/searches) without knowing the source.
 */

export interface CatalogSourceCapabilities {
  /** Where search runs: StylAI rules over imported items, or a source search API. */
  search: "stylai_rules" | "source_api"
  variants: "source" | "test_data" | "none"
  /** Stock is never confirmed by the test catalog. */
  stock: "unknown" | "source"
  price: "test_price" | "observed" | "source" | "none"
  productLinks: boolean
  affiliateLinks: boolean
  pagination: "none" | "cursor" | "page"
  /** Image use for display / try-on input must come from rights evidence, per image. */
  imageRights: "per_item_evidence"
}

export type CatalogSourceMode = "curated_pilot" | "tiktok_shop" | "aliexpress_affiliate" | "test_catalog"

export interface CatalogItemCapabilities {
  /** Authorized to display product metadata, image and external link in discovery/Estúdio. */
  displayAndLink: boolean
  /** Authorized to send the product image as input to an external AI try-on provider. */
  aiTryOn: boolean
  /** Stable reason when aiTryOn is false (never presumed from display access). */
  aiTryOnBlockedReason: string | null
}

export interface NormalizedVariant { externalVariantId: string; label: string; available: boolean | null }
export interface NormalizedCatalogItem {
  source: "curated" | "shein" | "aliexpress" | "tiktok_shop"
  seller: string
  sellerName: string
  externalProductId: string
  category: string
  categoryLabel: string
  name: string
  color: string | null
  variants: NormalizedVariant[]
  priceMinor: number | null
  currency: "BRL"
  priceObservedAt: string | null
  productUrl: string | null
  /** Image path (test catalog) or absolute https URL (real source). */
  image: string
  rights: { basis: "owner_authorized" | "licensed" | "test_fixture" | "unconfirmed"; evidence: string; tryOnAllowed: boolean }
  fixture: boolean
  /** Explicit separation between display/link capability and AI try-on capability. */
  capabilities?: CatalogItemCapabilities
  /** Synthetic edge case for automated tests (failure, no price, display-only, sold out): kept out of the main demo. */
  edgeCase?: boolean
}

export interface CatalogConnector {
  id: string
  label: string
  capabilities: CatalogSourceCapabilities
  list(cursor: string | null): Promise<{ items: NormalizedCatalogItem[]; nextCursor: string | null }>
}

/* --------------------------------------------------------------- synthetic test catalog */

export const TEST_CATALOG_CAPABILITIES: CatalogSourceCapabilities = {
  search: "stylai_rules", variants: "test_data", stock: "unknown", price: "test_price",
  productLinks: false, affiliateLinks: false, pagination: "none", imageRights: "per_item_evidence",
}
const EVIDENCE = "Ilustração sintética gerada pelo StylAI (scripts/generate-test-catalog-images.ts). Produto de teste: não é oferta real."
type Row = [id: string, category: string, name: string, color: string, price: number | null, sizes: string, seller: "a" | "b"]
const CATEGORY_LABEL: Record<string, string> = { tops: "Blusas", shirts: "Camisas", jackets: "Jaquetas", pants: "Calças", bottoms: "Saias e shorts", dresses: "Vestidos" }
// sizes: "P M G" available; "-" marks an unavailable size (e.g. "P -M G").
const ROWS: Row[] = [
  ["blusa-basica-branca", "tops", "Blusa básica branca", "branco", 4990, "P M G", "a"],
  ["blusa-canelada-preta", "tops", "Blusa canelada preta", "preto", 6990, "P M G GG", "a"],
  ["regata-oliva", "tops", "Regata verde-oliva", "verde", 3990, "P M -G", "b"],
  ["blusa-alca-rosa", "tops", "Blusa de alça rosa", "rosa", 5490, "P M G", "b"],
  ["camisa-linho-bege", "shirts", "Camisa de linho bege", "bege", 15990, "P M G", "a"],
  ["camisa-social-azul", "shirts", "Camisa social azul", "azul", 12990, "P M G GG", "b"],
  ["camisa-branca-oversized", "shirts", "Camisa branca oversized", "branco", 13990, "M G", "a"],
  ["jaqueta-jeans-azul", "jackets", "Jaqueta jeans azul", "azul", 21990, "P M G", "b"],
  ["blazer-preto", "jackets", "Blazer preto alfaiataria", "preto", 32990, "P M G", "a"],
  ["casaco-caramelo", "jackets", "Casaco caramelo", "bege", 38990, "M G", "a"],
  ["corta-vento-amarelo", "jackets", "Jaqueta corta-vento amarela", "amarelo", 18990, "P M G", "b"],
  ["calca-reta-preta", "pants", "Calça reta preta", "preto", 17990, "36 38 40 42", "a"],
  ["calca-wide-bege", "pants", "Calça wide leg bege", "bege", 19990, "36 38 -40 42", "a"],
  ["calca-jeans-azul", "pants", "Calça jeans azul", "azul", 16990, "36 38 40 42 44", "b"],
  ["calca-cargo-verde", "pants", "Calça cargo verde", "verde", 15990, "38 40 42", "b"],
  ["saia-midi-vermelha", "bottoms", "Saia midi vermelha", "vermelho", 12990, "P M G", "a"],
  ["short-jeans-azul", "bottoms", "Short jeans azul", "azul", 8990, "36 38 40", "b"],
  ["saia-plissada-cinza", "bottoms", "Saia plissada cinza", "cinza", 13990, "P M G", "a"],
  ["vestido-midi-preto", "dresses", "Vestido midi preto", "preto", 22990, "P M G", "a"],
  ["vestido-rosa", "dresses", "Vestido rosa de alça", "rosa", 18990, "P M G", "b"],
  ["vestido-verde-longo", "dresses", "Vestido longo verde", "verde", 26990, "P M G", "b"],
]

const SELLERS = { a: ["stylai-teste-a", "Loja de teste A"], b: ["stylai-teste-b", "Loja de teste B"] } as const

function item(r: Row, extra: Partial<NormalizedCatalogItem> = {}): NormalizedCatalogItem {
  const [id, category, name, color, price, sizes, seller] = r
  return {
    source: "curated", seller: SELLERS[seller][0], sellerName: SELLERS[seller][1], externalProductId: `teste-${id}`,
    category, categoryLabel: CATEGORY_LABEL[category]!, name: `${name} (teste)`, color,
    variants: sizes.split(" ").map((s) => ({ externalVariantId: `teste-${id}-${s.replace("-", "")}`, label: s.replace("-", ""), available: !s.startsWith("-") })),
    priceMinor: price, currency: "BRL", priceObservedAt: null, productUrl: null,
    image: `${id}.png`,
    rights: { basis: "test_fixture", evidence: EVIDENCE, tryOnAllowed: true },
    fixture: true, ...extra,
  }
}

export const TEST_CATALOG: NormalizedCatalogItem[] = [
  ...ROWS.map((r) => item(r)),
  // Edge cases the Estúdio must handle honestly (automated tests; not in the main demo experience).
  item(["blusa-sem-preco", "tops", "Blusa listrada azul (sem preço informado)", "azul", null, "P M G", "a"], { edgeCase: true }),
  item(["blusa-falha", "tops", "Blusa coral (simula falha do provador)", "rosa", 5990, "P M G", "a"], { image: "fail/blusa-falha.png", edgeCase: true }),
  item(["camisa-so-exibicao", "shirts", "Camisa verde (imagem só para exibição)", "verde", 11990, "P M G", "b"], {
    rights: { basis: "test_fixture", evidence: `${EVIDENCE} Marcada sem permissão de prova para testar o bloqueio.`, tryOnAllowed: false },
    edgeCase: true,
  }),
  item(["blusa-esgotada", "tops", "Blusa cinza (sem tamanho disponível)", "cinza", 4990, "-P -M -G", "a"], { edgeCase: true }),
]

/** The shared test catalog seen in the official front and the demo (no edge cases). */
export const TEST_CATALOG_MAIN: NormalizedCatalogItem[] = TEST_CATALOG.filter((i) => !i.edgeCase)
export const testCatalogItems = (o: { edgeCases?: boolean } = {}): NormalizedCatalogItem[] => (o.edgeCases ? TEST_CATALOG : TEST_CATALOG_MAIN)

/**
 * Canonical identity of test images in the catalog tables (the schema requires https). The host is
 * a reserved, never-resolvable name (RFC 2606 ".invalid"): the API maps it to its local route for
 * display, and a real provider can never fetch it (the worker refuses it before any paid call).
 */
export const TEST_IMAGE_ORIGIN = "https://test-catalog.stylai.invalid/"
export const isTestImageUrl = (url: string): boolean => url.startsWith(TEST_IMAGE_ORIGIN)

export const TEST_CATALOG_IMAGES: string[] = [...new Set(TEST_CATALOG.map((i) => i.image))]

export const testCatalogConnector: CatalogConnector = {
  id: "test_catalog",
  label: "Catálogo de teste (dados sintéticos)",
  capabilities: TEST_CATALOG_CAPABILITIES,
  async list() { return { items: TEST_CATALOG_MAIN, nextCursor: null } },
}
