/**
 * Demonstration catalog. Partners are FICTITIOUS, prices/ratings/stock are illustrative,
 * and no product has a real or affiliate URL (url: null everywhere). Links are configured
 * only through public/partner-links.json (see data/catalog-source.ts).
 * Photos: v1 Unsplash set (see README). Pieces without a product photo use a labelled
 * crop of the look image ("recorte do look"), never a fake product shot.
 */
import { asset } from "./assets"

export type Category =
  | "casaco"
  | "alfaiataria"
  | "conjunto"
  | "malha"
  | "camisa"
  | "calca"
  | "sapato"
  | "bolsa"
  | "acessorio"

export const CATEGORY_LABEL: Record<Category, string> = {
  casaco: "Casacos",
  alfaiataria: "Alfaiataria",
  conjunto: "Conjuntos",
  malha: "Malhas",
  camisa: "Camisas",
  calca: "Calças",
  sapato: "Sapatos",
  bolsa: "Bolsas",
  acessorio: "Acessórios",
}

/** Size group used by presets ("tamanho por categoria"). */
export type SizeGroup = "top" | "bottom" | "shoes" | "none"

export const SIZE_GROUP: Record<Category, SizeGroup> = {
  casaco: "top",
  alfaiataria: "top",
  conjunto: "top",
  malha: "top",
  camisa: "top",
  calca: "bottom",
  sapato: "shoes",
  bolsa: "none",
  acessorio: "none",
}

export interface Partner {
  id: string
  name: string
}

export const PARTNERS: Partner[] = [
  { id: "aurora", name: "Loja Aurora" },
  { id: "linho", name: "Casa Linho" },
  { id: "sul", name: "Mercado Sul" },
  { id: "norte", name: "Ateliê Norte" },
  { id: "leste", name: "Bazar Leste" },
  { id: "oeste", name: "Vitrine Oeste" },
]

export const partnerName = (id: string): string => PARTNERS.find((p) => p.id === id)?.name ?? id

/**
 * The same product sold by another store, with its own price and link. The search agent
 * returns duplicates across stores (e.g. marketplaces); StylAI groups them under one product.
 * Demo values: fictitious stores, illustrative prices, no URL.
 */
export interface Offer {
  partnerId: string
  price: number
  url: string | null
}

/** Extra offers per product id. The product's own partnerId/price is always the first offer. */
export const EXTRA_OFFERS: Record<string, Offer[]> = {
  "blazer-la-fria": [
    { partnerId: "leste", price: 612, url: null },
    { partnerId: "aurora", price: 729, url: null },
  ],
  "trench-gabardine": [
    { partnerId: "sul", price: 849, url: null },
    { partnerId: "oeste", price: 799, url: null },
    { partnerId: "linho", price: 935, url: null },
  ],
  "casaco-camelo": [{ partnerId: "norte", price: 1190, url: null }],
  "pantalona-risca": [
    { partnerId: "leste", price: 389, url: null },
    { partnerId: "aurora", price: 455, url: null },
  ],
  "trico-caxemira": [{ partnerId: "oeste", price: 579, url: null }],
  "terno-preto": [{ partnerId: "linho", price: 1420, url: null }],
  "mocassim-conhaque": [
    { partnerId: "oeste", price: 569, url: null },
    { partnerId: "norte", price: 655, url: null },
  ],
  "tote-couro": [{ partnerId: "leste", price: 698, url: null }],
  "gola-alta-preta": [
    { partnerId: "leste", price: 159, url: null },
    { partnerId: "oeste", price: 189, url: null },
    { partnerId: "aurora", price: 229, url: null },
  ],
  "top-cropped": [{ partnerId: "sul", price: 139, url: null }],
  "camisa-algodao": [
    { partnerId: "oeste", price: 259, url: null },
    { partnerId: "linho", price: 309, url: null },
  ],
  "scarpin-preto": [{ partnerId: "oeste", price: 459, url: null }],
}

export interface ImageRef {
  src: string
  /** object-position or background-position */
  pos: string
  /** When set, the image is a crop of a larger photo (background-size in % of width). */
  zoom?: number
}

export interface SizeOption {
  label: string
  available: boolean
}

export interface Product {
  id: string
  name: string
  category: Category
  partnerId: string
  price: number
  /** Product rating on a 0 to 5 scale; null = not provided by the partner (never zero). */
  rating: number | null
  reviews: number | null
  sellerRating: number | null
  sizes: SizeOption[]
  measurements: { label: string; value: string }[] | null
  material: string | null
  color: string | null
  fit: "ajustado" | "regular" | "amplo" | null
  deliveryDays: number | null
  updatedAt: string
  stale: boolean
  image: ImageRef
  /** Partner product URL. None configured in the demo. */
  url: string | null
}

const sizes = (labels: string[], unavailable: string[] = []): SizeOption[] =>
  labels.map((label) => ({ label, available: !unavailable.includes(label) }))
const APPAREL = ["P", "M", "G"]

export const PRODUCTS: Product[] = [
  {
    id: "blazer-la-fria",
    name: "Blazer oversized de lã fria",
    category: "alfaiataria",
    partnerId: "norte",
    price: 689,
    rating: 4.7,
    reviews: 214,
    sellerRating: 4.8,
    sizes: sizes(APPAREL, ["G"]),
    measurements: [
      { label: "Ombro a ombro (M)", value: "46 cm" },
      { label: "Comprimento (M)", value: "74 cm" },
      { label: "Manga (M)", value: "61 cm" },
    ],
    material: "Lã fria",
    color: "Areia",
    fit: "amplo",
    deliveryDays: 6,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("blazerDetail"), pos: "50% 30%" },
    url: null,
  },
  {
    id: "trench-gabardine",
    name: "Trench de gabardine com faixa",
    category: "casaco",
    partnerId: "aurora",
    price: 899,
    rating: 4.4,
    reviews: 86,
    sellerRating: 4.6,
    sizes: sizes(APPAREL),
    measurements: null,
    material: "Gabardine de algodão",
    color: "Bege",
    fit: "regular",
    deliveryDays: 9,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("trench"), pos: "50% 20%" },
    url: null,
  },
  {
    id: "casaco-camelo",
    name: "Casaco de lã camelo",
    category: "casaco",
    partnerId: "linho",
    price: 1290,
    rating: 4.8,
    reviews: 312,
    sellerRating: null,
    sizes: sizes(APPAREL),
    measurements: [{ label: "Comprimento (M)", value: "98 cm" }],
    material: "Lã batida",
    color: "Camelo",
    fit: "regular",
    deliveryDays: null,
    updatedAt: "2026-11-04",
    stale: false,
    image: { src: asset("camelCoat"), pos: "50% 35%" },
    url: null,
  },
  {
    id: "pantalona-risca",
    name: "Pantalona risca de giz",
    category: "calca",
    partnerId: "sul",
    price: 429,
    rating: 4.2,
    reviews: 41,
    sellerRating: 4.1,
    sizes: sizes(["36", "38", "40", "42"], ["42"]),
    measurements: null,
    material: "Linho e viscose",
    color: "Off-white listrado",
    fit: "amplo",
    deliveryDays: 12,
    updatedAt: "2026-11-03",
    stale: false,
    image: { src: asset("pinstripe"), pos: "50% 40%" },
    url: null,
  },
  {
    id: "trico-caxemira",
    name: "Tricô de caxemira areia",
    category: "malha",
    partnerId: "linho",
    price: 549,
    rating: null,
    reviews: null,
    sellerRating: 4.7,
    sizes: sizes(APPAREL),
    measurements: null,
    material: "Caxemira e lã merino",
    color: "Areia",
    fit: "regular",
    deliveryDays: 5,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("knit"), pos: "50% 25%" },
    url: null,
  },
  {
    id: "conjunto-off",
    name: "Conjunto de alfaiataria off-white",
    category: "conjunto",
    partnerId: "aurora",
    price: 1190,
    rating: 4.6,
    reviews: 128,
    sellerRating: 4.6,
    sizes: sizes(APPAREL),
    measurements: [
      { label: "Busto do blazer (M)", value: "100 cm" },
      { label: "Cintura da calça (M)", value: "74 cm" },
    ],
    material: "Sarja de lã",
    color: "Off-white",
    fit: "regular",
    deliveryDays: 10,
    updatedAt: "2026-11-02",
    stale: false,
    image: { src: asset("whiteSet"), pos: "50% 30%" },
    url: null,
  },
  {
    id: "terno-preto",
    name: "Terno preto de corte reto",
    category: "alfaiataria",
    partnerId: "norte",
    price: 1340,
    rating: 4.9,
    reviews: 503,
    sellerRating: 4.8,
    sizes: sizes(APPAREL),
    measurements: [
      { label: "Busto (M)", value: "92 cm" },
      { label: "Cintura da calça (M)", value: "72 cm" },
    ],
    material: "Lã fria com elastano",
    color: "Preto",
    fit: "ajustado",
    deliveryDays: 6,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("blackSuit"), pos: "50% 35%" },
    url: null,
  },
  {
    id: "mocassim-conhaque",
    name: "Mocassim de couro conhaque",
    category: "sapato",
    partnerId: "sul",
    price: 619,
    rating: 4.5,
    reviews: 97,
    sellerRating: 4.3,
    sizes: sizes(["35", "36", "37", "38"], ["36"]),
    measurements: null,
    material: "Couro",
    color: "Conhaque",
    fit: null,
    deliveryDays: 8,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("loafers"), pos: "50% 40%" },
    url: null,
  },
  {
    id: "tote-couro",
    name: "Bolsa tote de couro",
    category: "bolsa",
    partnerId: "linho",
    price: 749,
    rating: 4.3,
    reviews: 22,
    sellerRating: null,
    sizes: sizes(["Único"]),
    measurements: [
      { label: "Largura", value: "38 cm" },
      { label: "Altura", value: "30 cm" },
    ],
    material: "Couro",
    color: "Conhaque",
    fit: null,
    deliveryDays: 7,
    updatedAt: "2026-10-21",
    stale: true,
    image: { src: asset("tote"), pos: "50% 50%" },
    url: null,
  },
  // Pieces below have no product photo: labelled crops of the look photograph.
  {
    id: "scarpin-preto",
    name: "Scarpin preto de tira",
    category: "sapato",
    partnerId: "aurora",
    price: 459,
    rating: 4.1,
    reviews: 33,
    sellerRating: 4.4,
    sizes: sizes(["35", "36", "37", "38"]),
    measurements: null,
    material: null,
    color: "Preto",
    fit: null,
    deliveryDays: 9,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("tryFront"), pos: "50% 97%", zoom: 380 },
    url: null,
  },
  {
    id: "gola-alta-preta",
    name: "Gola alta de malha preta",
    category: "malha",
    partnerId: "sul",
    price: 199,
    rating: 4.0,
    reviews: 150,
    sellerRating: 4.1,
    sizes: sizes(APPAREL),
    measurements: null,
    material: null,
    color: "Preto",
    fit: "ajustado",
    deliveryDays: 11,
    updatedAt: "2026-11-01",
    stale: false,
    image: { src: asset("lookOldMoneyA"), pos: "50% 40%", zoom: 420 },
    url: null,
  },
  {
    id: "calca-reta-preta",
    name: "Calça reta de lã preta",
    category: "calca",
    partnerId: "sul",
    price: 459,
    rating: null,
    reviews: null,
    sellerRating: 4.1,
    sizes: sizes(["36", "38", "40", "42"]),
    measurements: null,
    material: "Lã",
    color: "Preto",
    fit: "regular",
    deliveryDays: 11,
    updatedAt: "2026-11-01",
    stale: false,
    image: { src: asset("lookOldMoneyA"), pos: "50% 100%", zoom: 420 },
    url: null,
  },
  {
    id: "chapeu-feltro",
    name: "Chapéu de feltro caramelo",
    category: "acessorio",
    partnerId: "aurora",
    price: 329,
    rating: 4.6,
    reviews: 58,
    sellerRating: 4.6,
    sizes: sizes(["Único"]),
    measurements: null,
    material: "Feltro de lã",
    color: "Caramelo",
    fit: null,
    deliveryDays: 9,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("lookOldMoneyB"), pos: "48% 14%", zoom: 260 },
    url: null,
  },
  {
    id: "top-cropped",
    name: "Top cropped de malha branca",
    category: "malha",
    partnerId: "aurora",
    price: 149,
    rating: 3.9,
    reviews: 210,
    sellerRating: 4.6,
    sizes: sizes(APPAREL),
    measurements: null,
    material: null,
    color: "Branco",
    fit: "ajustado",
    deliveryDays: 9,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("lookStreetA"), pos: "45% 40%", zoom: 360 },
    url: null,
  },
  {
    id: "jaqueta-camurca",
    name: "Jaqueta de camurça vinho",
    category: "casaco",
    partnerId: "norte",
    price: 799,
    rating: 4.7,
    reviews: 64,
    sellerRating: 4.8,
    sizes: sizes(APPAREL, ["P"]),
    measurements: null,
    material: "Camurça",
    color: "Vinho",
    fit: "regular",
    deliveryDays: 6,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("lookStreetB"), pos: "50% 38%", zoom: 300 },
    url: null,
  },
  {
    id: "camisa-cetim",
    name: "Camisa de cetim ameixa",
    category: "camisa",
    partnerId: "linho",
    price: 389,
    rating: 4.5,
    reviews: 77,
    sellerRating: null,
    sizes: sizes(APPAREL),
    measurements: null,
    material: "Cetim",
    color: "Ameixa",
    fit: "regular",
    deliveryDays: 5,
    updatedAt: "2026-11-04",
    stale: false,
    image: { src: asset("lookChicA"), pos: "62% 30%", zoom: 300 },
    url: null,
  },
  {
    id: "camisa-algodao",
    name: "Camisa de algodão oversized",
    category: "camisa",
    partnerId: "sul",
    price: 279,
    rating: 4.3,
    reviews: 140,
    sellerRating: 4.1,
    sizes: sizes(APPAREL),
    measurements: null,
    material: "Algodão",
    color: "Branco",
    fit: "amplo",
    deliveryDays: 11,
    updatedAt: "2026-11-04",
    stale: false,
    image: { src: asset("lookChicB"), pos: "70% 34%", zoom: 300 },
    url: null,
  },
  {
    id: "scarpin-nude",
    name: "Scarpin nude de bico fino",
    category: "sapato",
    partnerId: "norte",
    price: 489,
    rating: 4.6,
    reviews: 44,
    sellerRating: 4.8,
    sizes: sizes(["35", "36", "37", "38"], ["38"]),
    measurements: null,
    material: "Couro",
    color: "Nude",
    fit: null,
    deliveryDays: 6,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("lookTailorA"), pos: "50% 97%", zoom: 380 },
    url: null,
  },
  {
    id: "blazer-xadrez",
    name: "Blazer xadrez marrom",
    category: "alfaiataria",
    partnerId: "norte",
    price: 869,
    rating: 4.8,
    reviews: 120,
    sellerRating: 4.8,
    sizes: sizes(APPAREL),
    measurements: null,
    material: "Tweed de lã",
    color: "Marrom",
    fit: "regular",
    deliveryDays: 6,
    updatedAt: "2026-11-05",
    stale: false,
    image: { src: asset("lookTailorB"), pos: "52% 40%", zoom: 280 },
    url: null,
  },
]

const PRODUCT_INDEX = new Map(PRODUCTS.map((p) => [p.id, p]))

export function productById(id: string): Product | undefined {
  return PRODUCT_INDEX.get(id)
}

/* ------------------------------------------------------------------ looks */

export type StyleId = "old-money" | "minimal-street" | "casual-chic" | "alfaiataria"

export const STYLES: { id: StyleId; label: string }[] = [
  { id: "alfaiataria", label: "Alfaiataria" },
  { id: "old-money", label: "Old Money" },
  { id: "casual-chic", label: "Casual Chic" },
  { id: "minimal-street", label: "Minimalist Streetwear" },
]

/** "chosen" = picked by the user in Explorar and carried into the result unchanged. */
export type PieceRole = "look" | "similar" | "chosen"

export interface LookPiece {
  productId: string
  /** "look" = demonstrative corresponding piece; "similar" = similar alternative, not the exact piece. */
  role: PieceRole
}

export interface PreparedEdit {
  id: string
  label: string
  keywords: string[]
  image: ImageRef
  note: string
}

export interface Look {
  id: string
  style: StyleId
  title: string
  note: string
  image: ImageRef
  pieces: LookPiece[]
  /** Prepared edits that only change framing/angle of the same photo shoot (same person, same clothes). */
  edits: PreparedEdit[]
}

export const LOOKS: Look[] = [
  {
    id: "la-fria",
    style: "alfaiataria",
    title: "Lã fria, ombro largo",
    note: "Blazer amplo aberto sobre preto, com scarpin de tira para alongar.",
    image: { src: asset("tryFront"), pos: "50% 30%" },
    pieces: [
      { productId: "blazer-la-fria", role: "look" },
      { productId: "scarpin-preto", role: "look" },
      { productId: "trench-gabardine", role: "similar" },
    ],
    edits: [
      { id: "perfil", label: "Ver de perfil", keywords: ["perfil", "lado", "lateral"], image: { src: asset("tryProfile"), pos: "50% 25%" }, note: "Mesmo look, vista de perfil." },
      { id: "tres-quartos", label: "Ver em três quartos", keywords: ["tres quartos", "3/4", "45", "girar", "angulo"], image: { src: asset("try34"), pos: "50% 25%" }, note: "Mesmo look, vista em três quartos." },
      { id: "aproximar", label: "Aproximar o enquadramento", keywords: ["aproximar", "perto", "close", "detalhe", "zoom", "enquadramento"], image: { src: asset("heroBlazer"), pos: "50% 20%" }, note: "Mesmo look, enquadramento mais próximo." },
    ],
  },
  {
    id: "preto-um-botao",
    style: "alfaiataria",
    title: "Preto, um botão",
    note: "Terno de corte reto com gola alta por baixo e scarpin nude.",
    image: { src: asset("lookTailorA"), pos: "50% 30%" },
    pieces: [
      { productId: "terno-preto", role: "look" },
      { productId: "gola-alta-preta", role: "similar" },
      { productId: "scarpin-nude", role: "look" },
    ],
    edits: [],
  },
  {
    id: "tweed",
    style: "alfaiataria",
    title: "Tweed ao fim da tarde",
    note: "Blazer xadrez marrom com camisa azul e calça café.",
    image: { src: asset("lookTailorB"), pos: "50% 30%" },
    pieces: [
      { productId: "blazer-xadrez", role: "look" },
      { productId: "blazer-la-fria", role: "similar" },
    ],
    edits: [],
  },
  {
    id: "camelo",
    style: "old-money",
    title: "Camelo à beira-mar",
    note: "Lã batida sobre gola alta preta: calor sem volume.",
    image: { src: asset("lookOldMoneyA"), pos: "50% 30%" },
    pieces: [
      { productId: "casaco-camelo", role: "look" },
      { productId: "gola-alta-preta", role: "look" },
      { productId: "calca-reta-preta", role: "look" },
    ],
    edits: [],
  },
  {
    id: "feltro",
    style: "old-money",
    title: "Feltro, trench e vento",
    note: "Chapéu de aba média e trench aberto sobre malha branca.",
    image: { src: asset("lookOldMoneyB"), pos: "50% 30%" },
    pieces: [
      { productId: "chapeu-feltro", role: "look" },
      { productId: "trench-gabardine", role: "similar" },
    ],
    edits: [],
  },
  {
    id: "cetim",
    style: "casual-chic",
    title: "Cetim contra a cortina",
    note: "Camisa ameixa de cetim com pantalona clara.",
    image: { src: asset("lookChicA"), pos: "50% 30%" },
    pieces: [
      { productId: "camisa-cetim", role: "look" },
      { productId: "pantalona-risca", role: "similar" },
    ],
    edits: [],
  },
  {
    id: "janela",
    style: "casual-chic",
    title: "Manhã na janela",
    note: "Camisa branca larga com jeans escuro e gola aberta.",
    image: { src: asset("lookChicB"), pos: "60% 40%" },
    pieces: [
      { productId: "camisa-algodao", role: "look" },
      { productId: "trico-caxemira", role: "similar" },
    ],
    edits: [],
  },
  {
    id: "off-white",
    style: "minimal-street",
    title: "Off-white em linha reta",
    note: "Calça reta e jaqueta curta no mesmo tom, com sandália fina.",
    image: { src: asset("lookStreetA"), pos: "50% 40%" },
    pieces: [
      { productId: "top-cropped", role: "look" },
      { productId: "conjunto-off", role: "similar" },
    ],
    edits: [],
  },
  {
    id: "camurca",
    style: "minimal-street",
    title: "Camurça e concreto",
    note: "Jaqueta vinho sobre sarja oliva. Cor só em uma peça.",
    image: { src: asset("lookStreetB"), pos: "50% 40%" },
    pieces: [
      { productId: "jaqueta-camurca", role: "look" },
      { productId: "mocassim-conhaque", role: "similar" },
    ],
    edits: [],
  },
]

export function lookById(id: string): Look | undefined {
  return LOOKS.find((l) => l.id === id)
}

/** Extra candidates every demo search "finds" besides the pieces of its style's looks. */
export const EXTRA_CANDIDATES = ["tote-couro", "mocassim-conhaque", "trico-caxemira"]

/** Keyword hints used to read the free-text intention. First hit wins. */
export const INTENT_HINTS: { words: string[]; style: StyleId; reading: string }[] = [
  { words: ["reuniao", "trabalho", "escritorio", "entrevista", "terno", "blazer", "alfaiataria"], style: "alfaiataria", reading: "ocasião de trabalho pede alfaiataria" },
  { words: ["rua", "tenis", "show", "skate", "street", "urbano"], style: "minimal-street", reading: "rotina de rua pede peças retas" },
  { words: ["jantar", "classico", "elegante", "viagem", "inverno", "frio", "casaco"], style: "old-money", reading: "clima e ocasião pedem lã e cores de base" },
  { words: ["cafe", "fim de semana", "brunch", "leve", "casual", "praia", "camisa"], style: "casual-chic", reading: "momento descontraído pede peças leves" },
]
