/**
 * Outfit composition contract (browser-safe): slots, deterministic interpretation, validation and the
 * explicit rules fallback used when the AI composer is unavailable. See
 * docs/decisions/2026-11-23-composicao-multipeca.md.
 *
 * Product titles are untrusted data: nothing here executes or forwards them as instructions.
 */
import { normalizeText } from "./search-rules.js"

export type SlotId = "upper" | "lower" | "dress" | "outer"
export const SLOT_IDS: readonly SlotId[] = ["upper", "lower", "dress", "outer"]
export const MAX_COMPOSITION_ITEMS = 3
/** Finite candidate cap per slot shown to the agent and the person. */
export const MAX_CANDIDATES_PER_SLOT = 12

export const SLOT_LABEL: Record<SlotId, string> = { upper: "Parte de cima", lower: "Parte de baixo", dress: "Peça única", outer: "Camada externa" }
export const SLOT_CATEGORIES: Record<SlotId, readonly string[]> = { upper: ["tops", "shirts"], lower: ["pants", "bottoms"], dress: ["dresses"], outer: ["jackets"] }
/** Neutral default garment per slot (P10: never a fixed audience; the request's audience is added by buildSlotQuery). */
export const SLOT_SEARCH_TERMS: Record<SlotId, string> = { upper: "camisa", lower: "calça", dress: "vestido", outer: "jaqueta" }
/** Render order: base garments first, outer layer last. */
const ORDER: readonly SlotId[] = ["dress", "lower", "upper", "outer"]

export function slotOfCategory(category: string): SlotId | null {
  for (const slot of SLOT_IDS) if (SLOT_CATEGORIES[slot].includes(category)) return slot
  return null
}
export const renderOrder = (slots: readonly SlotId[]): SlotId[] => ORDER.filter((s) => slots.includes(s))

export type Audience = "masculino" | "feminino"
export interface SlotRequest {
  slot: SlotId
  required: boolean
  /** Short store query for THIS slot (garment + audience + its own qualifiers). Sanitized again by buildSlotQuery. */
  query?: string | null
  /** This slot's own colour (never inherited from another piece). */
  color?: string | null
}
export interface CompositionIntent {
  /** Who the outfit is for, when the request says it. */
  audience?: Audience | null
  slots: SlotRequest[]
  colors: string[]
  terms: string[]
  occasion: string | null
  /** TOTAL budget for the whole composition, BRL. */
  budgetTotalBrl: number | null
  /** "require": never exceed; "prefer": rank cheaper first. */
  budgetMode: "require" | "prefer"
  avoid: string[]
  /** P13: requested aesthetic as short descriptors ("estilo italiano", "elegante"). A look, never a claimed origin. */
  style?: string[]
  /** Weather the request implies ("roupas de frio", "verão"); null when not stated. */
  climate?: "frio" | "calor" | null
}

/** Dress replaces top + bottom; at most one item per slot and MAX_COMPOSITION_ITEMS overall. */
export function normalizeSlots(slots: readonly SlotRequest[]): SlotRequest[] {
  const seen = new Map<SlotId, SlotRequest>()
  for (const s of slots) if (SLOT_IDS.includes(s.slot) && !seen.has(s.slot)) seen.set(s.slot, s)
  if (seen.has("dress")) { seen.delete("upper"); seen.delete("lower") }
  return renderOrder([...seen.keys()]).slice(0, MAX_COMPOSITION_ITEMS).map((slot) => seen.get(slot)!)
}

const SLOT_WORDS: Record<SlotId, string[]> = {
  upper: ["blusa", "camisa", "camiseta", "regata", "top", "cropped", "body", "tricot", "sueter", "polo"],
  // "jeans" is a material ("jaqueta jeans", "calça jeans"), not a garment on its own.
  lower: ["calca", "saia", "short", "bermuda", "legging"],
  dress: ["vestido", "macacao"],
  outer: ["jaqueta", "blazer", "casaco", "cardigan", "sobretudo", "colete"],
}
/** Display spelling (accents) of normalized garment nouns, and their grammatical gender. */
const GARMENT_DISPLAY: Record<string, string> = { calca: "calça", macacao: "macacão", sueter: "suéter" }
const MASCULINE_NOUNS = new Set(["top", "cropped", "body", "tricot", "sueter", "polo", "short", "vestido", "macacao", "blazer", "casaco", "cardigan", "sobretudo", "colete"])
const COLORS: Record<string, string[]> = {
  preto: ["preto", "preta", "black"], branco: ["branco", "branca", "off-white", "offwhite"], azul: ["azul", "jeans", "marinho"],
  vermelho: ["vermelho", "vermelha"], verde: ["verde"], rosa: ["rosa"], bege: ["bege", "nude", "caramelo"],
  cinza: ["cinza"], amarelo: ["amarelo", "amarela"], marrom: ["marrom"],
}
const OUTFIT_WORDS = ["look", "roupa", "conjunto", "composicao", "producao", "vestir", "outfit"]
/** P12: plurals ("roupas", "looks") and conjugations of "vestir" ("vista", "veste", "vestindo") are whole-outfit requests. */
const VESTIR_FORMS = new Set(["vista", "veste", "vestir", "vestindo", "vestida", "vestisse"])
const isOutfitWord = (w: string): boolean => OUTFIT_WORDS.includes(w) || OUTFIT_WORDS.some((o) => w === `${o}s` || w === `${o}es`) || VESTIR_FORMS.has(w)
const CONNECTORS = new Set(["e", "com", "para", "pra", "ate", "mais", "num", "numa", "no", "na", "em", "sem", "por", "ou"])
const STOP = new Set(["de", "do", "da", "um", "uma", "o", "a", "os", "as", "que", "quero", "me", "meu", "minha", "bem", "tipo", "estilo"])
const AUDIENCE_WORDS: Record<Audience, string[]> = { masculino: ["masculino", "masculina", "masculinos", "masculinas", "homem", "homens", "masc"], feminino: ["feminino", "feminina", "femininos", "femininas", "mulher", "mulheres", "fem"] }
/** P13: style words -> descriptor. Formal styles also give generic slots concrete attributes (rules only). */
const STYLE_WORDS: Record<string, string> = {
  italiano: "estilo italiano", italiana: "estilo italiano", italianos: "estilo italiano", italianas: "estilo italiano",
  elegante: "elegante", elegantes: "elegante", social: "social", sociais: "social", classico: "clássico", classica: "clássico",
  sofisticado: "sofisticado", sofisticada: "sofisticado", chique: "chique", casual: "casual", minimalista: "minimalista",
  esportivo: "esportivo", esportiva: "esportivo",
}
const FORMAL_STYLES = new Set(["estilo italiano", "elegante", "social", "clássico", "sofisticado", "chique"])
/** Weather words -> climate. Generic slots then get a garment worn in that weather (rules only). */
const COLD = /\b(frio|friozinho|inverno|gelad[oa]|neve|polar)\b/, HOT = /\b(calor|verao|tropical|praia)\b/
const COLD_HINT: Partial<Record<SlotId, { noun?: string; qualifier?: string }>> = { upper: { noun: "suéter" }, outer: { noun: "casaco" } }
const FORMAL_HINT: Partial<Record<SlotId, { noun?: string; qualifier?: string }>> = { upper: { qualifier: "social" }, lower: { qualifier: "alfaiataria" }, outer: { noun: "blazer" } }
/** Origin claims are never searched for: a listing's origin is the seller's unverified statement. "made in X" drops X too. */
const stripOriginClaims = (tokens: string[]): string[] => {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const w = normalizeText(tokens[i]!)
    if (w === "made") { i += tokens[i + 1] && normalizeText(tokens[i + 1]!) === "in" ? 2 : 0; continue }
    if (/^(importad|fabricad|produzid)[oa]s?$/.test(w) || w === "origem") {
      // "fabricada na italia" / "importado da italia": drop the place phrase too.
      while (tokens[i + 1] && /^(na|no|em|da|do|de)$/.test(normalizeText(tokens[i + 1]!))) i += 2
      continue
    }
    out.push(tokens[i]!)
  }
  return out
}
const OCCASIONS = /(trabalho|escritorio|casamento|festa|praia|balada|jantar|academia|viagem|faculdade)/

const garmentSlot = (word: string): { slot: SlotId; noun: string } | null => {
  for (const slot of SLOT_IDS) for (const noun of SLOT_WORDS[slot]) if (word === noun || word === `${noun}s` || word === `${noun}es`) return { slot, noun }
  return null
}
const colorOf = (word: string): string | null => {
  for (const [color, forms] of Object.entries(COLORS)) if (forms.includes(word)) return color
  return null
}
const audienceOf = (words: readonly string[]): Audience | null => {
  const m = words.some((w) => AUDIENCE_WORDS.masculino.includes(w)), f = words.some((w) => AUDIENCE_WORDS.feminino.includes(w))
  return m === f ? null : m ? "masculino" : "feminino"
}
const audienceWord = (audience: Audience, noun: string) =>
  MASCULINE_NOUNS.has(noun) ? audience : audience === "masculino" ? "masculina" : "feminina"

/**
 * Deterministic interpretation (no AI): the explicit fallback and the bound for the agent. Each garment owns the
 * words that follow it until the next garment or connector (P10): "camisa de linho branca e calça chino azul"
 * gives upper={linho, branca} and lower={chino, azul}; colours never leak between pieces.
 */
export function interpretCompositionRules(text: string): CompositionIntent {
  const t = normalizeText(text.slice(0, 500))
  const words = t.split(/[^a-z0-9-]+/).filter(Boolean)
  const audience = audienceOf(words)
  const found = new Map<SlotId, { noun: string; qualifiers: string[]; color: string | null }>()
  for (let i = 0; i < words.length; i++) {
    const g = garmentSlot(words[i]!)
    if (!g || found.has(g.slot)) continue
    const qualifiers: string[] = []
    let color: string | null = null
    for (let k = i + 1; k < words.length && k <= i + 6; k++) {
      const w = words[k]!
      if (garmentSlot(w) || CONNECTORS.has(w) || isOutfitWord(w) || /^\d/.test(w) || OCCASIONS.test(w)) break
      if (STOP.has(w) || AUDIENCE_WORDS.masculino.includes(w) || AUDIENCE_WORDS.feminino.includes(w) || w.length < 3) continue
      color ??= colorOf(w)
      if (!qualifiers.includes(w)) qualifiers.push(w)
    }
    found.set(g.slot, { noun: g.noun, qualifiers: qualifiers.slice(0, 4), color })
  }
  let slots: SlotRequest[] = [...found.entries()].map(([slot, f]) => ({
    slot, required: true, color: f.color,
    query: [GARMENT_DISPLAY[f.noun] ?? f.noun, ...(audience ? [audienceWord(audience, f.noun)] : []), ...f.qualifiers].join(" "),
  }))
  const climate = COLD.test(t) ? "frio" as const : HOT.test(t) ? "calor" as const : null
  if (!slots.length && words.some(isOutfitWord)) slots = [{ slot: "upper", required: true }, { slot: "lower", required: true }, ...(climate === "frio" ? [{ slot: "outer" as const, required: true }] : [])]
  const budget = /(?:ate|max(?:imo)?|abaixo de|menos de|orcamento de)\s*(?:r\$)?\s*(\d{1,6}(?:[.,]\d{1,2})?)/.exec(t)
  const colors = [...new Set(words.map(colorOf).filter((c): c is string => c !== null))]
  const occasion = OCCASIONS.exec(t)?.[1] ?? null
  const avoid = [...t.matchAll(/sem ([a-z-]{3,20})/g)].map((m) => m[1]!).slice(0, 8)
  const known = new Set([...Object.values(SLOT_WORDS).flat(), ...Object.values(COLORS).flat(), ...OUTFIT_WORDS, ...STOP, ...CONNECTORS,
    ...AUDIENCE_WORDS.masculino, ...AUDIENCE_WORDS.feminino])
  const terms = [...new Set(words.filter((w) => w.length > 3 && !known.has(w) && !/^\d/.test(w)))].slice(0, 8)
  const style = [...new Set(words.map((w) => STYLE_WORDS[w]).filter((x): x is string => Boolean(x)))].slice(0, 3)
  return {
    audience, style, climate,
    slots: normalizeSlots(slots.length ? slots : [{ slot: "upper", required: true }]),
    colors, terms, occasion, budgetTotalBrl: budget ? Number(budget[1]!.replace(",", ".")) : null,
    budgetMode: budget ? "require" : "prefer", avoid,
  }
}

/** Hard sanitization of any query (agent or rules): letters only, <= 6 words, must name this slot's garment. */
export function sanitizeSlotQuery(raw: string | null | undefined, slot: SlotId): string | null {
  if (!raw) return null
  const tokens = stripOriginClaims(raw.split(/\s+/).filter((w) => /^[\p{L}-]{2,20}$/u.test(w)).map((w) => w.toLowerCase())).slice(0, 6)
  if (tokens.some((w) => { const g = garmentSlot(normalizeText(w)); return g && g.slot !== slot })) return null
  if (!tokens.some((w) => garmentSlot(normalizeText(w))?.slot === slot)) return null
  return tokens.join(" ")
}

/** A query for one listing sold as a complete outfit: must say so, letters only, no origin claims. */
export function sanitizeBundleQuery(raw: string): string | null {
  const tokens = stripOriginClaims(raw.split(/\s+/).filter((w) => /^[\p{L}-]{2,20}$/u.test(w)).map((w) => w.toLowerCase())).slice(0, 6)
  return tokens.length >= 2 && tokens.some((w) => /^(conjuntos?|ternos?)$/.test(normalizeText(w))) ? tokens.join(" ") : null
}

/**
 * The store query for one slot (P10): the slot's sanitized query when it names the slot's garment; otherwise the
 * neutral garment + the request's audience + THIS slot's colour. Never another slot's colour, never a fixed gender.
 */
export function buildSlotQuery(intent: CompositionIntent, slot: SlotId): string {
  const req = intent.slots.find((s) => s.slot === slot)
  const sanitized = sanitizeSlotQuery(req?.query, slot)
  if (sanitized) return sanitized
  const hint = (intent.climate === "frio" ? COLD_HINT[slot] : undefined) ?? ((intent.style ?? []).some((x) => FORMAL_STYLES.has(x)) ? FORMAL_HINT[slot] : undefined)
  const display = hint?.noun ?? SLOT_SEARCH_TERMS[slot]
  const noun = normalizeText(display)
  const audience = intent.audience ?? null
  return [display, ...(audience ? [audienceWord(audience, noun)] : []), ...(hint?.qualifier ? [hint.qualifier] : []), ...(req?.color ? [req.color] : [])].join(" ")
}

/** Broaden retrieval only; the selector still receives the original constraints. Never loop on an outage. */
export function buildSlotQueries(intent: CompositionIntent, slot: SlotId): string[] {
  const exact = buildSlotQuery(intent, slot)
  const noun = exact.split(/\s+/).find((w) => garmentSlot(normalizeText(w))?.slot === slot) ?? SLOT_SEARCH_TERMS[slot]
  const req = intent.slots.find((s) => s.slot === slot)
  const words = exact.split(/\s+/).map(normalizeText)
  const audience = intent.audience ?? audienceOf(words)
  const color = req?.color ?? words.map(colorOf).find((c) => c !== null)
  const base = [noun, ...(audience ? [audienceWord(audience, normalizeText(noun))] : []), ...(color ? [color] : [])]
  const formal = (intent.style ?? []).some((s) => FORMAL_STYLES.has(s)) || /jantar|trabalho|casamento/.test(intent.occasion ?? "")
  // Keep the current garment's fabric before broadening to a bare noun; never borrow another slot's terms.
  const material = exact.split(/\s+/).find((w) => /^(linho|algodao|seda|la|jeans|couro|veludo|viscose|cetim)$/.test(normalizeText(w)))
  const middle = [...base, ...(material ? [material] : formal && slot !== "outer" ? ["social"] : [])].join(" ")
  return [...new Set([exact, middle, base.join(" ")])].slice(0, 3)
}

export interface CompositionCandidate {
  /** Server id (catalog uuid or source canonical key). */
  id: string
  slot: SlotId
  categoryId: string
  name: string
  priceMinor: number | null
  colorTags: string[]
  /** Product + image rights allow AI try-on (curated evidence). */
  generationEligible: boolean
}
export interface CompositionChoice { slot: SlotId; productId: string; reason: string }
/** Legacy snapshots already record a failed selector through interpretation/selection provenance. */
export function requiresSelectionReview(plan: { selectionReviewRequired?: boolean; interpretedBy?: string; selectionMethod?: string }): boolean {
  return plan.selectionReviewRequired === true || (plan.interpretedBy === "agent" && plan.selectionMethod === "rules_fallback")
}
export type CandidatesBySlot = Partial<Record<SlotId, CompositionCandidate[]>>
export type LockedSlots = Partial<Record<SlotId, string>>

export interface CompositionValidation { ok: boolean; choices: CompositionChoice[]; totalMinor: number | null; errors: string[] }

/** Server-side revalidation of any proposed composition (agent or person). */
export function validateComposition(intent: CompositionIntent, bySlot: CandidatesBySlot, choices: readonly CompositionChoice[], locked: LockedSlots,
  options: { requireAll?: boolean; abstained?: readonly SlotId[] } = {}): CompositionValidation {
  const errors: string[] = []
  const wanted = new Set(intent.slots.map((s) => s.slot))
  const out: CompositionChoice[] = []
  const used = new Set<string>()
  for (const choice of choices) {
    if (!wanted.has(choice.slot)) { errors.push(`slot_not_requested:${choice.slot}`); continue }
    if (out.some((x) => x.slot === choice.slot)) { errors.push(`duplicate_slot:${choice.slot}`); continue }
    const inSlot = bySlot[choice.slot]?.find((x) => x.id === choice.productId)
    if (!inSlot) {
      const elsewhere = SLOT_IDS.some((s) => bySlot[s]?.some((x) => x.id === choice.productId))
      errors.push(elsewhere ? `wrong_slot:${choice.slot}` : `unknown_product:${choice.slot}`); continue
    }
    if (used.has(choice.productId)) { errors.push(`duplicate_product:${choice.slot}`); continue }
    if (locked[choice.slot] && locked[choice.slot] !== choice.productId) { errors.push(`lock_overridden:${choice.slot}`); continue }
    used.add(choice.productId)
    out.push({ slot: choice.slot, productId: choice.productId, reason: choice.reason.replace(/\s+/g, " ").trim().slice(0, 140) })
  }
  // A locked piece is never dropped; the agent must fill every requested slot that has candidates.
  for (const [slot, id] of Object.entries(locked) as [SlotId, string][]) {
    if (id && wanted.has(slot) && !out.some((x) => x.slot === slot)) errors.push(`missing_locked:${slot}`)
  }
  if (options.requireAll) {
    for (const { slot } of intent.slots) {
      // One diagnosis per slot: an invalid choice for the slot already explains why it is missing.
      // An explicit abstention ("no candidate fits") is a valid, safe answer, except for a locked slot.
      if (options.abstained?.includes(slot) && !locked[slot]) continue
      if ((bySlot[slot]?.length ?? 0) > 0 && !out.some((x) => x.slot === slot) && !errors.some((e) => e.endsWith(`:${slot}`))) errors.push(`missing_required:${slot}`)
    }
  }
  const prices = out.map((x) => bySlot[x.slot]!.find((p) => p.id === x.productId)!.priceMinor)
  const totalMinor = prices.every((p) => p !== null) ? prices.reduce<number>((a, b) => a + (b ?? 0), 0) : null
  if (intent.budgetMode === "require" && intent.budgetTotalBrl !== null) {
    if (totalMinor === null) errors.push("budget_unverifiable")
    else if (totalMinor > Math.round(intent.budgetTotalBrl * 100)) errors.push("over_budget")
  }
  const ordered = renderOrder(out.map((x) => x.slot)).map((s) => out.find((x) => x.slot === s)!)
  return { ok: errors.length === 0, choices: ordered, totalMinor, errors }
}

function score(intent: CompositionIntent, c: CompositionCandidate): number {
  const name = normalizeText(c.name)
  let s = 0
  for (const color of intent.colors) if (c.colorTags.includes(color)) s += 2
  for (const term of intent.terms) if (name.includes(term)) s += 1
  for (const avoid of intent.avoid) if (name.includes(avoid)) s -= 5
  if (c.generationEligible) s += 0.5
  return s
}

export interface RulesSelection { choices: CompositionChoice[]; totalMinor: number | null; missingSlots: SlotId[] }

/**
 * Explicit deterministic fallback: best total score under the TOTAL budget, respecting locks. Exhaustive over
 * at most MAX_CANDIDATES_PER_SLOT^3 combinations. Never fabricates a composition the budget forbids.
 */
export function selectCompositionRules(intent: CompositionIntent, bySlot: CandidatesBySlot, locked: LockedSlots): RulesSelection {
  const limit = intent.budgetMode === "require" && intent.budgetTotalBrl !== null ? Math.round(intent.budgetTotalBrl * 100) : null
  const slots = intent.slots.map((s) => s.slot)
  const pools = slots.map((slot) => {
    const all = (bySlot[slot] ?? []).slice(0, MAX_CANDIDATES_PER_SLOT)
    const lockedId = locked[slot]
    const pool = lockedId ? all.filter((x) => x.id === lockedId) : all
    return limit === null ? pool : pool.filter((x) => x.priceMinor !== null)
  })
  const missingSlots = slots.filter((_, i) => pools[i]!.length === 0)
  const active = slots.map((slot, i) => ({ slot, pool: pools[i]! })).filter((x) => x.pool.length > 0)
  let best: { picks: CompositionCandidate[]; score: number; total: number } | null = null
  const walk = (i: number, picks: CompositionCandidate[], total: number, sc: number) => {
    if (limit !== null && total > limit) return
    if (i === active.length) {
      if (!best || sc > best.score || (sc === best.score && total < best.total)) best = { picks: [...picks], score: sc, total }
      return
    }
    for (const cand of active[i]!.pool) walk(i + 1, [...picks, cand], total + (cand.priceMinor ?? 0), sc + score(intent, cand))
  }
  if (active.length) walk(0, [], 0, 0)
  const chosen = (best as { picks: CompositionCandidate[] } | null)?.picks ?? []
  const choices = chosen.map((p) => ({
    slot: p.slot, productId: p.id,
    reason: locked[p.slot] === p.id ? "Escolhida por você" : intent.colors.some((col) => p.colorTags.includes(col)) ? "Combina com a cor pedida" : "Melhor encaixe no orçamento",
  }))
  const v = validateComposition(intent, bySlot, choices, locked)
  return { choices: v.ok || !chosen.length ? v.choices : [], totalMinor: chosen.length ? v.totalMinor : null, missingSlots }
}
