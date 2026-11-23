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
/** Provider search keywords per slot (pt-BR). */
export const SLOT_SEARCH_TERMS: Record<SlotId, string> = { upper: "blusa feminina", lower: "calça feminina", dress: "vestido", outer: "jaqueta feminina" }
/** Render order: base garments first, outer layer last. */
const ORDER: readonly SlotId[] = ["dress", "lower", "upper", "outer"]

export function slotOfCategory(category: string): SlotId | null {
  for (const slot of SLOT_IDS) if (SLOT_CATEGORIES[slot].includes(category)) return slot
  return null
}
export const renderOrder = (slots: readonly SlotId[]): SlotId[] => ORDER.filter((s) => slots.includes(s))

export interface SlotRequest { slot: SlotId; required: boolean }
export interface CompositionIntent {
  slots: SlotRequest[]
  colors: string[]
  terms: string[]
  occasion: string | null
  /** TOTAL budget for the whole composition, BRL. */
  budgetTotalBrl: number | null
  /** "require": never exceed; "prefer": rank cheaper first. */
  budgetMode: "require" | "prefer"
  avoid: string[]
}

/** Dress replaces top + bottom; at most one item per slot and MAX_COMPOSITION_ITEMS overall. */
export function normalizeSlots(slots: readonly SlotRequest[]): SlotRequest[] {
  const seen = new Map<SlotId, SlotRequest>()
  for (const s of slots) if (SLOT_IDS.includes(s.slot) && !seen.has(s.slot)) seen.set(s.slot, s)
  if (seen.has("dress")) { seen.delete("upper"); seen.delete("lower") }
  return renderOrder([...seen.keys()]).slice(0, MAX_COMPOSITION_ITEMS).map((slot) => seen.get(slot)!)
}

const SLOT_WORDS: Record<SlotId, string[]> = {
  upper: ["blusa", "camisa", "camiseta", "regata", "top", "cropped", "body", "tricot", "suéter", "sueter"],
  lower: ["calca", "saia", "short", "bermuda", "jeans", "legging"],
  dress: ["vestido", "macacao"],
  outer: ["jaqueta", "blazer", "casaco", "cardigan", "sobretudo", "colete"],
}
const COLORS: Record<string, string[]> = {
  preto: ["preto", "preta", "black"], branco: ["branco", "branca", "off-white", "offwhite"], azul: ["azul", "jeans"],
  vermelho: ["vermelho", "vermelha"], verde: ["verde"], rosa: ["rosa"], bege: ["bege", "nude", "caramelo"],
  cinza: ["cinza"], amarelo: ["amarelo", "amarela"], marrom: ["marrom"],
}
const OUTFIT_WORDS = ["look", "roupa", "conjunto", "composicao", "producao", "vestir", "outfit"]

/** Deterministic interpretation (no AI): used as the explicit fallback and to bound the agent. */
export function interpretCompositionRules(text: string): CompositionIntent {
  const t = normalizeText(text.slice(0, 500))
  const words = t.split(/[^a-z0-9-]+/).filter(Boolean)
  const has = (w: string) => words.some((x) => x === w || x.startsWith(w))
  const slots: SlotRequest[] = SLOT_IDS.filter((slot) => SLOT_WORDS[slot].some((w) => has(normalizeText(w)))).map((slot) => ({ slot, required: true }))
  if (!slots.length && OUTFIT_WORDS.some(has)) slots.push({ slot: "upper", required: true }, { slot: "lower", required: true })
  const budget = /(?:ate|max(?:imo)?|abaixo de|menos de|orcamento de)\s*(?:r\$)?\s*(\d{1,6}(?:[.,]\d{1,2})?)/.exec(t)
  const colors = Object.entries(COLORS).filter(([, vs]) => vs.some((v) => words.includes(v))).map(([k]) => k)
  const occasion = /(trabalho|escritorio|casamento|festa|praia|balada|jantar|academia|viagem|faculdade)/.exec(t)?.[1] ?? null
  const avoid = [...t.matchAll(/sem ([a-z-]{3,20})/g)].map((m) => m[1]!).slice(0, 8)
  const allWords = new Set([...Object.values(SLOT_WORDS).flat(), ...Object.values(COLORS).flat(), ...OUTFIT_WORDS].map(normalizeText))
  const terms = [...new Set(words.filter((w) => w.length > 3 && !allWords.has(w) && !/^\d/.test(w)))].slice(0, 8)
  return {
    slots: normalizeSlots(slots.length ? slots : [{ slot: "upper", required: true }]),
    colors, terms, occasion, budgetTotalBrl: budget ? Number(budget[1]!.replace(",", ".")) : null,
    budgetMode: budget ? "require" : "prefer", avoid,
  }
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
export type CandidatesBySlot = Partial<Record<SlotId, CompositionCandidate[]>>
export type LockedSlots = Partial<Record<SlotId, string>>

export interface CompositionValidation { ok: boolean; choices: CompositionChoice[]; totalMinor: number | null; errors: string[] }

/** Server-side revalidation of any proposed composition (agent or person). */
export function validateComposition(intent: CompositionIntent, bySlot: CandidatesBySlot, choices: readonly CompositionChoice[], locked: LockedSlots,
  options: { requireAll?: boolean } = {}): CompositionValidation {
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
