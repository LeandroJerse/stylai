/**
 * Coordinated outfits (browser-safe, deterministic): compatibility filters, ranking, server-side validation of any
 * proposed outfit and the labelled rules selection used when the agent is unavailable.
 * Product titles are untrusted data and only the seller's statement: a title never proves fabric, origin or fit.
 */
import { normalizeText } from "./search-rules.js"
import { filterConflict, type OutfitFilters } from "./outfit-filters.js"
import { buildSlotQueries, SLOT_LABEL, slotOfCategory, type CompositionIntent, type SlotId } from "./composition.js"

/** "set" = one listing sold as a complete outfit (top and bottom together). */
export type OutfitSlot = SlotId | "set"
export const OUTFIT_SLOTS: readonly OutfitSlot[] = ["set", "dress", "lower", "upper", "outer"]
export const OUTFIT_SLOT_LABEL: Record<OutfitSlot, string> = { ...SLOT_LABEL, set: "Conjunto completo" }
export const MAX_OUTFITS = 4
export const MIN_PANELS = 2
export const MAX_PANELS = 4
/** Store queries of one search, complete outfits included. */
export const MAX_SEARCH_QUERIES = 8
/** Candidates kept per slot after ranking (stored pool) and sent to the model (window). */
export const OUTFIT_POOL_PER_SLOT = 12
export const OUTFIT_WINDOW_PER_SLOT = 8
const MAX_BUNDLES_BY_RULES = 2

export const outfitSlotOfCategory = (category: string): OutfitSlot | null => category === "outfit_sets" ? "set" : slotOfCategory(category)

export interface OutfitCandidate {
  id: string
  slot: OutfitSlot
  categoryId: string
  name: string
  priceMinor: number | null
  colorTags: string[]
  /** As the store publishes them; unknown stays null. */
  ratingPercent?: number | null
  recentSales?: number | null
}
export type OutfitPools = Partial<Record<OutfitSlot, OutfitCandidate[]>>
export interface OutfitChoice { slot: OutfitSlot; productId: string; reason: string }
export interface OutfitProposal { title: string; rationale: string; pieces: OutfitChoice[] }
export interface ValidOutfit extends OutfitProposal {
  kind: "bundle" | "assembled"
  totalMinor: number | null
  /** Requested slots without any candidate (reported, never filled with something else). */
  missingSlots: SlotId[]
}
export type LockedPieces = Partial<Record<OutfitSlot, string>>

/* ------------------------------------------------------------------ compatibility */

const NOT_OUTFIT = /\b(infantil|infantis|menin[oa]s?|bebes?|criancas?|kids|bonecas?|pijamas?|pajamas?|lingerie|calcinhas?|cuecas?|sutia|sutias|modelador(a|as|es)?|shapewear|fantasias?|cosplay|cachorros?|pet)\b/
const LEISURE = /\b(moletom|moletons|jogger|joggers|pelucia|lazer|uso domestico|ao ar livre|academia|fitness|treino|corrida|caminhada|esportiv[oa]s?|agasalhos?|tactel|rasgad[oa]s?|sweatpants|tracksuit|trekking|pescaria)\b/
const FORMAL_PIECE = /\b(social|sociais|alfaiataria|terno|smoking|blazer)\b/
const FEMININE_GARMENT = /\b(saias?|vestidos?|cropped|boca de sino|acentua\w* a cintura)\b/
const ELEGANT = /(italian|elegant|social|classic|sofisticad|chique|alfaiataria|formal|executiv)/
const RELAXED = /(esportiv|streetwear|confortavel|relaxad|academia|lazer)/
const SPORT = /(esportiv|academia|fitness)/
const FORMAL_OCCASION = /(jantar|trabalho|escritorio|casamento|formatura|reuniao|entrevista)/
const SUMMER_PIECE = /\b(verao|praia|regatas?|bermudas?|shorts?|manga curta|sandalias?)\b/
const LONG_SLEEVE = /\bmangas? (longas?|compridas?)\b/
const CHRISTMAS = /\b(natal|natalin[oa]s?|christmas|papai noel)\b/
const WINTER_PIECE = /\b(inverno|neve|forrad[oa]s?|pelucia|termic[oa]s?|fleece|acolchoad[oa]s?|sherpa)\b/

const stylesOf = (intent: CompositionIntent): string => normalizeText((intent.style ?? []).join(" "))
export const wantsElegant = (intent: CompositionIntent): boolean => {
  const s = stylesOf(intent)
  return !RELAXED.test(s) && (ELEGANT.test(s) || FORMAL_OCCASION.test(normalizeText(intent.occasion ?? "")))
}
export function audienceOfName(name: string): "masculino" | "feminino" | null {
  const n = normalizeText(name)
  const m = /\b(masculin[oa]s?|homem|homens|men|mens)\b/.test(n), f = /\b(feminin[oa]s?|mulher|mulheres|women|womens)\b/.test(n)
  return m === f ? null : m ? "masculino" : "feminino"
}

/** Why a listing cannot belong to the requested outfit (null = compatible as far as the title says). */
export function styleConflict(intent: CompositionIntent, name: string): string | null {
  const n = normalizeText(name)
  if (NOT_OUTFIT.test(n)) return "not_outfit"
  const audience = audienceOfName(name)
  if (intent.audience && audience && audience !== intent.audience) return "audience"
  if (intent.audience === "masculino" && audience === null && FEMININE_GARMENT.test(n)) return "audience"
  if (intent.avoid.some((a) => a.trim().length > 2 && n.includes(normalizeText(a.trim())))) return "avoided"
  if (wantsElegant(intent) && LEISURE.test(n)) return "leisure_for_elegant"
  if (SPORT.test(stylesOf(intent)) && FORMAL_PIECE.test(n)) return "formal_for_sport"
  if (intent.climate === "frio" && SUMMER_PIECE.test(n)) return "season"
  if (intent.climate === "calor" && WINTER_PIECE.test(n)) return "season"
  // What the person wrote about the pieces themselves overrides these two.
  const asked = normalizeText([intent.occasion ?? "", ...intent.terms, ...(intent.style ?? []), ...intent.slots.map((s) => s.query ?? "")].join(" "))
  if (intent.climate === "calor" && LONG_SLEEVE.test(n) && !wantsElegant(intent) && !LONG_SLEEVE.test(asked)) return "season"
  if (CHRISTMAS.test(n) && !CHRISTMAS.test(asked)) return "season"
  return null
}

/* ------------------------------------------------------------------ ranking */

function score(intent: CompositionIntent, c: OutfitCandidate): number {
  const n = normalizeText(c.name)
  const request = intent.slots.find((s) => s.slot === c.slot)
  let s = 0
  if (request?.color && c.colorTags.includes(request.color)) s += 3
  for (const color of intent.colors) if (c.colorTags.includes(color)) s += 1
  for (const word of normalizeText(request?.query ?? "").split(/\s+/)) if (word.length > 3 && n.includes(word)) s += 1
  for (const term of intent.terms) if (n.includes(normalizeText(term))) s += 1
  if (wantsElegant(intent) && FORMAL_PIECE.test(n)) s += 2
  if (intent.climate === "frio" && /\b(inverno|la|trico|tricot|termic[oa]|forrad[oa]|sobretudo)\b/.test(n)) s += 2
  // Unlabelled listings stay possible, but never ahead of one that names the requested audience.
  if (intent.audience && audienceOfName(c.name) === intent.audience) s += 10
  if (c.priceMinor === null) s -= 1
  return s
}

/** Conflicts and repeated listings out (with the reason), best first. Pure function of its input. */
export function rankCandidates(intent: CompositionIntent, pool: readonly OutfitCandidate[], filters: OutfitFilters | null = null): { kept: OutfitCandidate[]; rejected: { id: string; reason: string }[] } {
  const rejected: { id: string; reason: string }[] = []
  const titles = new Set<string>(), ids = new Set<string>()
  const kept: OutfitCandidate[] = []
  for (const c of pool) {
    if (ids.has(c.id)) continue
    ids.add(c.id)
    const conflict = styleConflict(intent, c.name) ?? (filters ? filterConflict(filters, c) : null)
    if (conflict) { rejected.push({ id: c.id, reason: conflict }); continue }
    const title = normalizeText(c.name).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)
    if (titles.has(title)) { rejected.push({ id: c.id, reason: "duplicate_title" }); continue }
    titles.add(title)
    kept.push(c)
  }
  const scored = kept.map((c, i) => ({ c, i, s: score(intent, c) }))
  scored.sort((a, b) => b.s - a.s || (a.c.priceMinor ?? Infinity) - (b.c.priceMinor ?? Infinity) || a.i - b.i)
  return { kept: scored.map((x) => x.c).slice(0, OUTFIT_POOL_PER_SLOT), rejected }
}

/* ------------------------------------------------------------------ validation */

/** Slots an outfit must fill. An outer layer nobody sells is reported as missing instead of blocking the outfit. */
function requirements(intent: CompositionIntent, pools: OutfitPools): { required: SlotId[]; missing: SlotId[] } {
  const asked = intent.slots.filter((s) => s.required).map((s) => s.slot)
  const missing = asked.filter((s) => (pools[s]?.length ?? 0) === 0)
  return { required: asked.filter((s) => s !== "outer" || !missing.includes(s)), missing }
}
const order = (pieces: readonly OutfitChoice[]): OutfitChoice[] => OUTFIT_SLOTS.flatMap((s) => pieces.filter((x) => x.slot === s))
const coreSignature = (pieces: readonly OutfitChoice[]): string => pieces.filter((x) => x.slot !== "outer").map((x) => x.productId).sort().join("|")

export function checkOutfit(intent: CompositionIntent, pools: OutfitPools, proposal: OutfitProposal, locked: LockedPieces = {}): { ok: true; outfit: ValidOutfit } | { ok: false; reason: string } {
  const bySlot = new Map<OutfitSlot, OutfitChoice>()
  const picked: OutfitCandidate[] = []
  for (const piece of proposal.pieces) {
    const found = pools[piece.slot]?.find((x) => x.id === piece.productId)
    if (!found) return { ok: false, reason: OUTFIT_SLOTS.some((s) => pools[s]?.some((x) => x.id === piece.productId)) ? "wrong_slot" : "unknown_product" }
    if (bySlot.has(piece.slot)) return { ok: false, reason: "duplicate_slot" }
    bySlot.set(piece.slot, { slot: piece.slot, productId: piece.productId, reason: piece.reason.replace(/\s+/g, " ").trim().slice(0, 140) })
    picked.push(found)
  }
  const has = (s: OutfitSlot) => bySlot.has(s)
  if ((has("set") && (has("upper") || has("lower") || has("dress"))) || (has("dress") && (has("upper") || has("lower")))) return { ok: false, reason: "slot_conflict" }
  for (const [slot, id] of Object.entries(locked) as [OutfitSlot, string | undefined][]) if (id && bySlot.get(slot)?.productId !== id) return { ok: false, reason: "lock_overridden" }
  const { required, missing } = requirements(intent, pools)
  const covered = (s: SlotId) => has(s) || (has("set") && (s === "upper" || s === "lower"))
  // A complete set already is an outfit; its outer layer stays optional.
  if (!picked.length || required.some((s) => !covered(s) && !(has("set") && s === "outer"))) return { ok: false, reason: "incomplete" }
  const audiences = new Set(picked.map((x) => audienceOfName(x.name)).filter((a) => a !== null))
  if (audiences.size > 1) return { ok: false, reason: "audience_mixed" }
  for (const x of picked) if (!Object.values(locked).includes(x.id) && styleConflict(intent, x.name)) return { ok: false, reason: "style_conflict" }
  const totalMinor = picked.every((x) => x.priceMinor !== null) ? picked.reduce((a, x) => a + (x.priceMinor ?? 0), 0) : null
  if (intent.budgetMode === "require" && intent.budgetTotalBrl !== null) {
    if (totalMinor === null) return { ok: false, reason: "budget_unverifiable" }
    if (totalMinor > Math.round(intent.budgetTotalBrl * 100)) return { ok: false, reason: "over_budget" }
  }
  return { ok: true, outfit: {
    title: proposal.title.replace(/\s+/g, " ").trim().slice(0, 60) || "Conjunto", rationale: proposal.rationale.replace(/\s+/g, " ").trim().slice(0, 160),
    pieces: order([...bySlot.values()]), kind: has("set") ? "bundle" : "assembled", totalMinor,
    missingSlots: missing.filter((s) => !covered(s)),
  } }
}

/** Server-side revalidation of proposed outfits (agent or rules): only what survives is ever stored or shown. */
export function validateOutfits(intent: CompositionIntent, pools: OutfitPools, proposals: readonly OutfitProposal[],
  options: { max?: number; locked?: LockedPieces } = {}): { outfits: ValidOutfit[]; rejected: { index: number; reason: string }[] } {
  const max = Math.min(options.max ?? MAX_OUTFITS, MAX_OUTFITS)
  const outfits: ValidOutfit[] = []
  const rejected: { index: number; reason: string }[] = []
  const seen = new Set<string>()
  proposals.forEach((proposal, index) => {
    const result = checkOutfit(intent, pools, proposal, options.locked)
    if (!result.ok) { rejected.push({ index, reason: result.reason }); return }
    const signature = coreSignature(result.outfit.pieces)
    if (seen.has(signature)) { rejected.push({ index, reason: "repeated" }); return }
    if (outfits.length >= max) { rejected.push({ index, reason: "limit" }); return }
    seen.add(signature)
    outfits.push(result.outfit)
  })
  return { outfits, rejected }
}

/* ------------------------------------------------------------------ rules selection */

const NEUTRAL = new Set(["preto", "branco", "cinza", "bege", "marrom"])
/** More than one strong colour in the same outfit is coordinated less often than neutrals plus one accent. */
const colorPenalty = (pieces: readonly OutfitCandidate[]): number =>
  Math.max(0, new Set(pieces.flatMap((x) => x.colorTags.filter((t) => !NEUTRAL.has(t)))).size - 1) * 2

export interface RulesOptions { max?: number; locked?: LockedPieces; exclude?: readonly string[]; bundles?: boolean }

/** Deterministic, labelled fallback: bundles first (bounded), then the best distinct combinations. Never fabricates. */
export function selectOutfitsRules(intent: CompositionIntent, pools: OutfitPools, options: RulesOptions): ValidOutfit[] {
  const max = Math.min(options.max ?? MAX_OUTFITS, MAX_OUTFITS)
  const locked = options.locked ?? {}
  const excluded = new Set(options.exclude ?? [])
  const usable = (slot: OutfitSlot): OutfitCandidate[] => {
    const all = pools[slot] ?? []
    const id = locked[slot]
    return id ? all.filter((x) => x.id === id) : all.filter((x) => !excluded.has(x.id)).slice(0, 8)
  }
  const reasonFor = (x: OutfitCandidate) => locked[x.slot] === x.id ? "Escolhida por você"
    : intent.slots.find((s) => s.slot === x.slot)?.color && x.colorTags.includes(intent.slots.find((s) => s.slot === x.slot)!.color!) ? "Cor pedida"
    : "Melhor encaixe pelas regras"
  const { required } = requirements(intent, pools)
  const twoPiece = required.includes("upper") && required.includes("lower")
  const proposals: OutfitProposal[] = []
  const lockedPart = (["upper", "lower", "dress"] as const).some((s) => locked[s])
  if (options.bundles !== false && twoPiece && !lockedPart) {
    for (const x of usable("set").slice(0, MAX_BUNDLES_BY_RULES)) {
      proposals.push({ title: "Conjunto completo", rationale: "Anúncio único com as peças do conjunto", pieces: [{ slot: "set", productId: x.id, reason: "Conjunto vendido completo" }] })
    }
  }
  const combos: { pieces: OutfitCandidate[]; score: number }[] = []
  const walk = (i: number, pieces: OutfitCandidate[]): void => {
    if (i === required.length) { combos.push({ pieces, score: pieces.reduce((a, x) => a + score(intent, x), 0) - colorPenalty(pieces) }); return }
    for (const x of usable(required[i]!)) walk(i + 1, [...pieces, x])
  }
  if (required.length) walk(0, [])
  combos.sort((a, b) => b.score - a.score)
  // Prefer outfits that reuse fewer pieces: the person compares real alternatives.
  const used = new Map<string, number>()
  const room = max * 3
  for (let k = 0; k < room && combos.length; k++) {
    let best = 0
    const value = (x: (typeof combos)[number]) => x.score - x.pieces.reduce((a, q) => a + (locked[q.slot] ? 0 : (used.get(q.id) ?? 0) * 3), 0)
    for (let j = 1; j < combos.length; j++) if (value(combos[j]!) > value(combos[best]!)) best = j
    const [pick] = combos.splice(best, 1)
    for (const x of pick!.pieces) used.set(x.id, (used.get(x.id) ?? 0) + 1)
    proposals.push({ title: "Combinação sugerida", rationale: "Peças compatíveis combinadas por regras", pieces: pick!.pieces.map((x) => ({ slot: x.slot, productId: x.id, reason: reasonFor(x) })) })
  }
  return validateOutfits(intent, pools, proposals, { max, locked }).outfits
}

/* ------------------------------------------------------------------ queries */

/** Complete-outfit queries (searched BEFORE the separate pieces). None for a dress or a single requested piece. */
export function buildBundleQueries(intent: CompositionIntent): string[] {
  const slots = intent.slots.map((s) => s.slot)
  if (!slots.includes("upper") || !slots.includes("lower")) return []
  const audience = intent.audience ? ` ${intent.audience}` : ""
  const elegant = wantsElegant(intent)
  const first = intent.climate === "frio" ? "inverno" : elegant ? "alfaiataria" : SPORT.test(stylesOf(intent)) ? "esportivo" : intent.climate === "calor" ? "verão" : "casual"
  const second = elegant ? `terno${audience}` : `conjunto${audience} 2 peças`
  return [`conjunto${audience} ${first} calça`, second]
}

/** Ordered store queries of one search, bounded: complete outfits first, then each slot's progressive queries. */
/**
 * Store queries, as observed on the real source (free read-only calls, 2026-11-24): "short" returns 0 garments of 49 (read
 * as an English adjective) and "bermuda" 45 of 49; season words ("camiseta leve verão") come back empty.
 */
function storeQuery(raw: string): string {
  const words = raw.split(/\s+/).filter((w) => w && !/^(verao|calor|inverno|frio|outono|primavera|leves?|fresc[oa]s?|para|de|do|da|o|a)$/.test(normalizeText(w)))
  const out = words.map((w) => (/^shorts?$/.test(normalizeText(w)) ? "bermuda" : w))
  if (out.includes("bermuda")) for (let i = 0; i < out.length; i++) out[i] = normalizeText(out[i]!) === "femininos" ? "feminina" : normalizeText(out[i]!) === "masculinos" ? "masculina" : out[i]!
  return out.slice(0, 4).join(" ") || raw
}
/** Hot weather, nothing specific asked for that part: what the store really answers with summer clothes. */
function summerQueries(intent: CompositionIntent, slot: SlotId): string[] {
  const request = intent.slots.find((s) => s.slot === slot)
  if (intent.climate !== "calor" || wantsElegant(intent) || request?.query) return []
  const who = (f: string, m: string) => (intent.audience === "feminino" ? ` ${f}` : intent.audience === "masculino" ? ` ${m}` : "")
  const color = request?.color ? ` ${request.color}` : ""
  if (slot === "upper") return [`camiseta manga curta${who("feminina", "masculina")}${color}`, `regata${who("feminina", "masculina")}${color}`]
  if (slot === "lower") return [`bermuda${who("feminina", "masculina")}${color}`, ...(intent.audience === "masculino" ? [] : [`saia${who("feminina", "")}${color}`])]
  return []
}

export function searchPlan(intent: CompositionIntent, extra: { bundles?: readonly string[]; slots?: Partial<Record<SlotId, readonly string[]>> } = {}): { slot: OutfitSlot; query: string }[] {
  const bundles = [...new Set([...(extra.bundles ?? []), ...buildBundleQueries(intent)])].slice(0, 2).map((query) => ({ slot: "set" as const, query }))
  const perSlot = intent.slots.map(({ slot }) => {
    const own = buildSlotQueries(intent, slot)
    // "calça masculina" alone is answered mostly with complete sets (2026-11-24): a second, specific query follows it.
    const specific = slot === "lower" && own.length < 2 && own[0]?.startsWith("calça") ? [`${own[0]} jeans`] : []
    const audience = (q: string) => (slot === "lower" && q === "bermuda" && intent.audience ? `bermuda ${intent.audience === "feminino" ? "feminina" : "masculina"}` : q)
    return [...new Set([...(extra.slots?.[slot] ?? []).map(storeQuery).map(audience), ...summerQueries(intent, slot), ...own, ...specific])].slice(0, 3).map((query) => ({ slot: slot as OutfitSlot, query }))
  })
  const out: { slot: OutfitSlot; query: string }[] = [...bundles]
  // Round robin: every requested slot gets its best query before any slot gets a second one.
  for (let round = 0; round < 3; round++) for (const list of perSlot) if (list[round]) out.push(list[round]!)
  return out.slice(0, MAX_SEARCH_QUERIES)
}
