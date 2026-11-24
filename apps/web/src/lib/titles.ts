/**
 * Marketplace listings are titled for search engines ("Calça Pantalona Feminina Cintura Alta Wide Leg..."). The screens
 * show a short name; the full one stays in the piece detail and in the accessible name of its link.
 */
const MAX_AS_IS = 40

/** Garment nouns, singular and plural are matched together; longer forms first. */
const GARMENT = "conjuntos?|macac[ãa]o|macacões|vestidos?|camisetas?|camisas?|blus(?:a|as|ão|ões)|regatas?|cropped|su[ée]ter(?:es)?|moletom|moletons|cardig[ãa]|cardigans?|jaquetas?|casacos?|casaquinhos?|blazers?|coletes?|sobretudos?|quimonos?|kimonos?|parkas?|t[úu]nicas?|batas?|polos?|pul[ôo]ver|tops?|cal[çc]as?|bermudas?|shorts?|saias?|leggings?|jardineiras?|pantalonas?|bodys?|bodies"
const GARMENT_RE = new RegExp(`(?<![\p{L}\p{N}])(${GARMENT})(?![\p{L}\p{N}])`, "iu")
/** Words that say who or when, never what the piece is. */
const NOISE = /^(feminin[oa]s?|masculin[oa]s?|mulher(es)?|homem|homens|meninas?|meninos?|unissex|infantil|nov[oa]s?|para|d[ao]s?|e|ou|em|na|no|a|o|as|os|mod[ae]|estilo|casual|casuais|elegantes?|ver[ãa]o|inverno|outono|primavera|cole[çc][ãa]o|tend[êe]ncia|cintura|manga|plus|size|[\d_./-]+)$/iu

const words = (text: string): string[] => text.replace(/[,;:|()[\]/]+/g, " ").split(/\s+/).filter(Boolean)
const sentence = (text: string): string => { const t = text.toLocaleLowerCase("pt-BR"); return t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1) }
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const space = head.lastIndexOf(" ")
  return `${(space > max / 3 ? head.slice(0, space) : head.slice(0, max - 1)).trimEnd()}…`
}

/** "Calça Pantalona Feminina Cintura Alta…" -> "Calça pantalona". Short names are kept as written. */
export function shortPieceName(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim()
  if (clean.length <= MAX_AS_IS) return clean
  const found = GARMENT_RE.exec(clean)
  if (!found) return cut(clean, MAX_AS_IS)
  const rest = words(clean.slice(found.index + found[0].length))
  // Skips "Feminina", "2026"…; a season or a cut that starts right there adds nothing.
  for (let i = 0; i < Math.min(rest.length, 3); i++) {
    const w = rest[i]!
    const next = rest[i + 1]
    if (/^\d+$/.test(w) && next && /^pe[çc]as$/iu.test(next)) return sentence(`${found[0]} ${w} ${next}`)
    if (/^(de|com)$/iu.test(w)) { if (next && !NOISE.test(next)) return sentence(`${found[0]} ${w} ${next}`); break }
    if (NOISE.test(w)) { if (/^(feminin|masculin|mulher|home|unissex)/iu.test(w)) continue; break }
    return sentence(`${found[0]} ${w}`)
  }
  return sentence(found[0])
}

/** Title of a look: "Calça, suéter e jaqueta". A short authored title is kept. */
export function lookTitle(look: { title: string; pieces: readonly { product: { name: string } }[] }): string {
  const title = look.title.trim()
  if (title.length <= MAX_AS_IS && !title.includes(" + ")) return title
  const names = look.pieces.map((p) => p.product.name)
  if (names.length === 0) return cut(title, 56)
  if (names.length === 1) return shortPieceName(names[0]!)
  const garments = names.map((n) => GARMENT_RE.exec(n)?.[0].toLocaleLowerCase("pt-BR") ?? null)
  if (garments.some((g) => g === null)) return `Look com ${names.length} peças`
  return sentence(`${garments.slice(0, -1).join(", ")} e ${garments.at(-1)}`)
}
