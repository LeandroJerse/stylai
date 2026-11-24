/**
 * Autonomous outfits (docs/API-CONTRACT.md): searches, sets and image batches. Same rules as parse.ts: optional fields
 * degrade to null, safe URLs only, and anything that would enable an action fails closed.
 */
import { http } from "./client"
import { arr, bool, isObj, money, num, obj, oneOf, parseImage, parseProduct, reqStr, str, strs } from "./parse"
import { NO_FILTERS, type FilterReport, type SearchFilters } from "../lib/filters"
import type { ImageAsset, Money, Product } from "./types"

export const OUTFIT_SLOT_IDS = ["set", "dress", "lower", "upper", "outer"] as const
export type OutfitSlotId = (typeof OUTFIT_SLOT_IDS)[number]
export interface OutfitPiece {
  slot: OutfitSlotId
  label: string
  reason: string
  variantId: string | null
  tryOn: { ready: boolean; code: string | null; message: string | null }
  /** Positive feedback (percentage) and recent units, as the store publishes them. */
  storeRating: number | null
  storeSales: number | null
  product: Product
}
export interface OutfitSet {
  id: string
  searchId: string
  kind: "bundle" | "assembled"
  recommended: boolean
  title: string
  rationale: string
  missingSlots: string[]
  revision: number
  locked: OutfitSlotId[]
  pieces: OutfitPiece[]
  total: Money | null
  overBudget: boolean | null
  originLabel: string
}
export interface OutfitSetDetail extends OutfitSet {
  alternatives: Partial<Record<OutfitSlotId, OutfitPiece[]>>
  revisions: { revision: number; label: string; createdAt: string | null; current: boolean; total: Money | null; pieces: OutfitPiece[] }[]
}
/** Answer of “buscar outra”: how many came back, how many became options, and why the others did not. */
export interface OptionsFound { returned: number; added: number; otherPart: number; filtered: number; unsuitable: number }
export type OutfitSearchStatus = "running" | "interrupted" | "succeeded" | "empty" | "failed" | "cancelled"
export interface OutfitSearch {
  id: string
  prompt: string
  source: string
  status: OutfitSearchStatus
  createdAt: string | null
  stage: { id: string; label: string; done: number | null; total: number | null }
  selection: { method: "agent" | "rules_fallback"; model: string | null } | null
  message: string | null
  /** Filters used by this search (null while it runs or when unknown). */
  filters: SearchFilters | null
  sets: OutfitSet[]
  report: {
    interpretedBy: "agent" | "rules_fallback"; plannedBy: "agent" | "rules_fallback"
    queries: { slot: string; query: string; outcome: string; returned: number; kept: number }[]
    removed: number; filters: FilterReport; missingSlots: string[]; agentCalls: number; agentUsd: number | null
  } | null
}
export interface OutfitSearchItem { id: string; prompt: string; createdAt: string | null; status: OutfitSearchStatus; sets: number }
export interface OutfitQuote {
  mode: "individual" | "comparison"
  ready: boolean
  blockers: { code: string; message: string }[]
  blockedPieces: { setId: string; slot: string; name: string; message: string }[]
  changes: { setId: string; name: string; kind: "price" | "image"; before: number | null; after: number | null }[]
  panels: { panel: number; setId: string; revision: number; title: string; pieces: OutfitPiece[]; total: Money | null }[]
  generation: { simulated: boolean; provider: string; model: string; calls: number; estimatedUsd: number; maxUsd: number } | null
  coins: { cost: number; available: number }
  pilot: { remainingAttempts: number; maxAttempts: number; remainingUsd: number; paused: boolean } | null
  confirmation: string | null
}
export type PanelState = "queued" | "running" | "ready" | "failed" | "failed_charged" | "cancelled" | "needs_reconciliation" | "dropped"
export interface OutfitPanel {
  panel: number
  setId: string
  searchId: string | null
  title: string
  state: PanelState
  stateLabel: string
  image: ImageAsset | null
  lookId: string | null
  pieces: OutfitPiece[]
  error: string | null
  attempts: number
  canRetry: boolean
  retryNeedsChargeAcceptance: boolean
  retryBlockedReason: string | null
}
export interface OutfitRender {
  id: string
  mode: "individual" | "comparison"
  createdAt: string | null
  model: string
  status: "running" | "assembling" | "succeeded" | "partial" | "failed"
  panels: OutfitPanel[]
  comparison: { state: string; image: ImageAsset | null; error: string | null } | null
  spentUsd: number
  canCancel: boolean
  canFinalize: boolean
}

const slotOf = (v: unknown): OutfitSlotId | null => ((OUTFIT_SLOT_IDS as readonly unknown[]).includes(v) ? (v as OutfitSlotId) : null)
const STATUS = ["running", "interrupted", "succeeded", "empty", "failed", "cancelled"] as const
const method = (v: unknown) => oneOf(v, ["agent", "rules_fallback"] as const, "rules_fallback")

function parsePiece(raw: unknown): OutfitPiece | null {
  if (!isObj(raw)) return null
  const slot = slotOf(raw.slot)
  if (!slot) return null
  const t = isObj(raw.tryOn) ? raw.tryOn : {}
  return { slot, label: str(raw.label) ?? slot, reason: str(raw.reason) ?? "", variantId: str(raw.variantId), tryOn: { ready: t.ready === true, code: str(t.code), message: str(t.message) }, storeRating: num(raw.storeRating), storeSales: num(raw.storeSales), product: parseProduct(raw.product) }
}
const pieces = (v: unknown): OutfitPiece[] => arr(v).map(parsePiece).filter((p): p is OutfitPiece => p !== null)

export function parseOutfitSet(raw: unknown): OutfitSet {
  const o = obj(raw, "outfit")
  return {
    id: reqStr(o.id, "outfit.id"), searchId: reqStr(o.searchId, "outfit.searchId"), kind: oneOf(o.kind, ["bundle", "assembled"] as const, "assembled"), recommended: bool(o.recommended),
    title: str(o.title) ?? "Conjunto", rationale: str(o.rationale) ?? "", missingSlots: strs(o.missingSlots), revision: num(o.revision) ?? 1,
    locked: arr(o.locked).map(slotOf).filter((s): s is OutfitSlotId => s !== null), pieces: pieces(o.pieces), total: money(o.total),
    overBudget: typeof o.overBudget === "boolean" ? o.overBudget : null, originLabel: (isObj(o.origin) ? str(o.origin.label) : null) ?? "",
  }
}
export function parseOutfitSetDetail(raw: unknown): OutfitSetDetail {
  const o = obj(raw, "outfit")
  const alternatives: OutfitSetDetail["alternatives"] = {}
  if (isObj(o.alternatives)) for (const [key, list] of Object.entries(o.alternatives)) { const slot = slotOf(key); if (slot) alternatives[slot] = pieces(list) }
  return {
    ...parseOutfitSet(raw), alternatives,
    revisions: arr(o.revisions).filter(isObj).map((r) => ({ revision: num(r.revision) ?? 0, label: str(r.label) ?? "Versão", createdAt: str(r.createdAt), current: r.current === true, total: money(r.total), pieces: pieces(r.pieces) })),
  }
}
function parseFilters(raw: unknown): SearchFilters | null {
  if (!isObj(raw)) return null
  return {
    ...NO_FILTERS, audience: raw.audience === "feminino" || raw.audience === "masculino" ? raw.audience : null, minPieceBrl: num(raw.minPieceBrl), maxPieceBrl: num(raw.maxPieceBrl),
    maxTotalBrl: num(raw.maxTotalBrl), minRatingPercent: num(raw.minRatingPercent), minSales: num(raw.minSales),
  }
}
export function parseOptions(raw: unknown): { set: OutfitSetDetail; found: OptionsFound } {
  const o = obj(raw, "options")
  const f = isObj(o.found) ? o.found : {}
  const outside = isObj(f.outside) ? Object.entries(f.outside).map(([k, n]): [string, number] => [k, num(n) ?? 0]) : []
  const sum = (ok: (k: string) => boolean) => outside.reduce((a, [k, n]) => a + (ok(k) ? n : 0), 0)
  const isFilter = (k: string) => k.startsWith("filter_") || k === "audience"
  return { set: parseOutfitSetDetail(raw), found: { returned: num(f.returned) ?? 0, added: num(f.added) ?? 0, otherPart: sum((k) => k === "other_part"), filtered: sum(isFilter), unsuitable: sum((k) => k !== "other_part" && !isFilter(k)) } }
}
export function parseOutfitSearch(raw: unknown): OutfitSearch {
  const o = obj(raw, "outfitSearch")
  const stage = isObj(o.stage) ? o.stage : {}
  const detail = isObj(stage.detail) ? stage.detail : {}
  const r = isObj(o.report) ? o.report : null
  const agent = r && isObj(r.agent) ? r.agent : {}
  const filtered: Record<string, unknown> = r && isObj(r.filtered) ? r.filtered : {}
  return {
    id: reqStr(o.id, "outfitSearch.id"), prompt: str(o.prompt) ?? "", source: str(o.source) ?? "", status: oneOf(o.status, STATUS, "interrupted"), createdAt: str(o.createdAt),
    stage: { id: str(stage.id) ?? "", label: str(stage.label) ?? "", done: num(detail.done), total: num(detail.total) },
    selection: isObj(o.selection) ? { method: method(o.selection.method), model: str(o.selection.model) } : null, message: str(o.message), filters: parseFilters(o.filters), sets: arr(o.sets).map(parseOutfitSet),
    report: r ? {
      interpretedBy: method(r.interpretedBy), plannedBy: method(r.plannedBy),
      queries: arr(r.queries).filter(isObj).map((q) => ({ slot: str(q.slot) ?? "", query: str(q.query) ?? "", outcome: str(q.outcome) ?? "", returned: num(q.returned) ?? 0, kept: num(q.kept) ?? 0 })),
      removed: Object.entries(filtered).reduce<number>((a, [k, n]) => a + (k.startsWith("filter_") ? 0 : (num(n) ?? 0)), 0),
      filters: { price: num(filtered.filter_price) ?? 0, rating: num(filtered.filter_rating) ?? 0, ratingMissing: num(filtered.filter_rating_missing) ?? 0, sales: num(filtered.filter_sales) ?? 0, audience: num(filtered.filter_audience) ?? 0 },
      missingSlots: strs(r.missingSlots), agentCalls: num(agent.calls) ?? 0, agentUsd: num(agent.estimatedUsd),
    } : null,
  }
}
const parseSearchItem = (raw: unknown): OutfitSearchItem => {
  const o = obj(raw, "outfitSearchItem")
  return { id: reqStr(o.id, "outfitSearchItem.id"), prompt: str(o.prompt) ?? "", createdAt: str(o.createdAt), status: oneOf(o.status, STATUS, "interrupted"), sets: num(o.sets) ?? 0 }
}
export function parseOutfitQuote(raw: unknown): OutfitQuote {
  const o = obj(raw, "outfitQuote")
  const g = isObj(o.generation) ? o.generation : null
  const coins = isObj(o.coins) ? o.coins : {}
  const pilot = isObj(o.budget) && isObj(o.budget.pilot) ? o.budget.pilot : null
  const confirmation = str(o.confirmation)
  return {
    mode: oneOf(o.mode, ["individual", "comparison"] as const, "individual"), ready: o.ready === true && confirmation !== null,
    blockers: arr(o.blockers).filter(isObj).map((b) => ({ code: str(b.code) ?? "blocked", message: str(b.message) ?? "Pedido bloqueado." })),
    blockedPieces: arr(o.blockedPieces).filter(isObj).map((b) => ({ setId: str(b.setId) ?? "", slot: str(b.slot) ?? "", name: str(b.name) ?? "", message: str(b.message) ?? "" })),
    changes: arr(o.changes).filter(isObj).map((c) => ({ setId: str(c.setId) ?? "", name: str(c.name) ?? "", kind: oneOf(c.kind, ["price", "image"] as const, "price"), before: num(c.before), after: num(c.after) })),
    panels: arr(o.panels).filter(isObj).map((p) => ({ panel: num(p.panel) ?? 0, setId: reqStr(p.setId, "quote.setId"), revision: num(p.revision) ?? 1, title: str(p.title) ?? "Conjunto", pieces: pieces(p.pieces), total: money(p.total) })),
    generation: g ? { simulated: g.simulated === true, provider: str(g.provider) ?? "", model: str(g.model) ?? "", calls: num(g.calls) ?? 0, estimatedUsd: num(g.estimatedUsd) ?? 0, maxUsd: num(g.maxUsd) ?? 0 } : null,
    coins: { cost: num(coins.cost) ?? 0, available: num(coins.available) ?? 0 },
    pilot: pilot ? { remainingAttempts: num(pilot.remainingAttempts) ?? 0, maxAttempts: num(pilot.maxAttempts) ?? 0, remainingUsd: num(pilot.remainingUsd) ?? 0, paused: pilot.paused === true } : null,
    confirmation,
  }
}
export function parseOutfitRender(raw: unknown): OutfitRender {
  const o = obj(raw, "outfitRender")
  const c = isObj(o.comparison) ? o.comparison : null
  return {
    id: reqStr(o.id, "outfitRender.id"), mode: oneOf(o.mode, ["individual", "comparison"] as const, "individual"), createdAt: str(o.createdAt), model: str(o.model) ?? "",
    status: oneOf(o.status, ["running", "assembling", "succeeded", "partial", "failed"] as const, "failed"),
    panels: arr(o.panels).filter(isObj).map((p) => ({
      panel: num(p.panel) ?? 0, setId: reqStr(p.setId, "panel.setId"), searchId: str(p.searchId), title: str(p.title) ?? "Conjunto",
      state: oneOf(p.state, ["queued", "running", "ready", "failed", "failed_charged", "cancelled", "needs_reconciliation", "dropped"] as const, "needs_reconciliation"),
      stateLabel: str(p.stateLabel) ?? "", image: parseImage(p.image), lookId: str(p.lookId), pieces: pieces(p.pieces), error: isObj(p.error) ? str(p.error.message) : null, attempts: num(p.attempts) ?? 0,
      canRetry: p.canRetry === true, retryNeedsChargeAcceptance: p.retryNeedsChargeAcceptance === true, retryBlockedReason: str(p.retryBlockedReason),
    })),
    comparison: c ? { state: str(c.state) ?? "", image: parseImage(c.image), error: isObj(c.error) ? str(c.error.message) : null } : null,
    spentUsd: num(o.spentUsd) ?? 0, canCancel: o.canCancel === true, canFinalize: o.canFinalize === true,
  }
}
const items = <T>(parse: (raw: unknown) => T) => (raw: unknown): T[] => arr(obj(raw, "list").items).map(parse)

type SetRef = { setId: string; revision: number }
const id = encodeURIComponent
const read = <T>(path: string, parse: (raw: unknown) => T, signal?: AbortSignal) => http.request<unknown>(path, { method: "GET", auth: "required", signal }).then(parse)
const send = <T>(path: string, parse: (raw: unknown) => T, body?: unknown, extra: { key?: string; timeoutMs?: number } = {}) =>
  http.request<unknown>(path, { method: "POST", auth: "required", ...(body === undefined ? {} : { body }), ...(extra.key ? { headers: { "Idempotency-Key": extra.key } } : {}), ...(extra.timeoutMs ? { timeoutMs: extra.timeoutMs } : {}) }).then(parse)

export const outfitsApi = {
  startSearch: (prompt: string, filters: Partial<SearchFilters> | null, key: string) => send("/studio/outfit-searches", parseOutfitSearch, { prompt, ...(filters ? { filters } : {}) }, { key }),
  searches: () => read("/studio/outfit-searches", items(parseSearchItem)),
  search: (searchId: string, signal?: AbortSignal) => read(`/studio/outfit-searches/${id(searchId)}`, parseOutfitSearch, signal),
  cancelSearch: (searchId: string) => send(`/studio/outfit-searches/${id(searchId)}/cancel`, parseOutfitSearch),
  set: (setId: string, signal?: AbortSignal) => read(`/studio/outfit-sets/${id(setId)}`, parseOutfitSetDetail, signal),
  swap: (setId: string, input: { slot: OutfitSlotId; productId: string; variantId?: string | null; base: number }) => send(`/studio/outfit-sets/${id(setId)}/piece`, parseOutfitSetDetail, input, { timeoutMs: 60_000 }),
  options: (setId: string, input: { slot: OutfitSlotId; query: string }) => send(`/studio/outfit-sets/${id(setId)}/options`, parseOptions, input, { timeoutMs: 60_000 }),
  locks: (setId: string, input: { locked: OutfitSlotId[]; base: number }) => send(`/studio/outfit-sets/${id(setId)}/locks`, parseOutfitSetDetail, input),
  suggest: (setId: string, input: { locked: OutfitSlotId[]; base: number }) => send(`/studio/outfit-sets/${id(setId)}/suggest`, parseOutfitSetDetail, input, { timeoutMs: 90_000 }),
  restore: (setId: string, input: { revision: number; base: number }) => send(`/studio/outfit-sets/${id(setId)}/restore`, parseOutfitSetDetail, input),
  quote: (mode: "individual" | "comparison", sets: SetRef[]) => send("/studio/outfit-renders/quote", parseOutfitQuote, { mode, sets }, { timeoutMs: 90_000 }),
  startRender: (input: { mode: "individual" | "comparison"; sets: SetRef[]; confirmation: string }, key: string) => send("/studio/outfit-renders", parseOutfitRender, input, { key, timeoutMs: 90_000 }),
  renders: (signal?: AbortSignal) => read("/studio/outfit-renders", items(parseOutfitRender), signal),
  retry: (renderId: string, panel: number, acceptCharge: boolean) => send(`/studio/outfit-renders/${id(renderId)}/retry`, parseOutfitRender, { panel, acceptCharge }),
  finalize: (renderId: string) => send(`/studio/outfit-renders/${id(renderId)}/finalize`, parseOutfitRender),
  cancel: (renderId: string) => send(`/studio/outfit-renders/${id(renderId)}/cancel`, parseOutfitRender),
}
