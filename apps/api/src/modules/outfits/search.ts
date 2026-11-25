/**
 * Durable outfit search: interpret -> plan queries -> real store search (complete outfits first) -> select -> prepare
 * references -> persist. Every stage is stored, so a reload (or an API restart) never loses the search or repeats it.
 * Agents are optional: any failure falls back to labelled rules; a valid agent abstention is final.
 */
import { z } from "zod"
import {
  interpretCompositionRules, MAX_OUTFITS, outfitSlotOfCategory, OUTFIT_TARGET_PER_SLOT, rankCandidates, searchPlan, selectOutfitsRules,
  applyFiltersToIntent, normalizeText, storeQuery, NO_FILTERS, normalizeFilters, SLOT_CATEGORIES, type OutfitFilters,
  type CompositionIntent, type LockedPieces, type OutfitCandidate, type OutfitPools, type OutfitSlot, type SlotId, type ValidOutfit,
} from "@stylai/contracts"
import type { AliExpressCatalogService } from "@stylai/commerce"
import { ComposerResponseError, type Composer, type ComposerUsage, type InterpretationCache, type OutfitAgents } from "@stylai/ai"
import type { Json, PrivateDatabase } from "@stylai/supabase"
import type { CatalogRow } from "../catalog/routes.js"
import type { AffiliateOfferQuery, PublishedAffiliateOffer } from "../catalog/affiliate.js"
import {
  candidateOf, orderPieces, pieceFromAliExpress, pieceFromCatalog, poolsSchema, referenceItemOf, slotSchema, totalOf, type StoredPiece, type StoredPools,
} from "./pieces.js"
import type { ReferencePreparer } from "./references.js"

export type OutfitSourceKind = "curated" | "aliexpress_affiliate"
export interface OutfitSearchDeps {
  db: PrivateDatabase<"api">
  source: OutfitSourceKind
  aliexpressCatalog?: AliExpressCatalogService | null
  findPublishedOffers?: (query: AffiliateOfferQuery) => Promise<{ items: PublishedAffiliateOffer[]; nextCursor: string | null }>
  listCatalog: () => Promise<CatalogRow[]>
  composer?: Composer | null
  interpretationCache?: InterpretationCache | null
  agents?: OutfitAgents | null
  /** Global budget of model calls; false = rules, without calling the model. */
  acquireAgentCall?: () => Promise<boolean>
  agentPrice?: { inputPerMTok: bigint; outputPerMTok: bigint } | null
  preparer?: ReferencePreparer | null
  log?: (event: { stage: string; reason: string }) => void
}

const queryLog = z.object({ slot: slotSchema, query: z.string(), outcome: z.enum(["ok", "empty", "filtered_out", "unavailable", "skipped"]), returned: z.number(), kept: z.number(), fromCache: z.boolean(), code: z.string().nullable() })
export const planSchema = z.object({
  intent: z.custom<CompositionIntent>((v) => typeof v === "object" && v !== null && Array.isArray((v as { slots?: unknown }).slots)),
  interpretedBy: z.enum(["agent", "rules_fallback"]), plannedBy: z.enum(["agent", "rules_fallback"]),
  queries: z.array(queryLog), pools: poolsSchema, rejected: z.record(z.string(), z.number()), missingSlots: z.array(z.string()),
  agent: z.object({ calls: z.number(), inputTokens: z.number(), outputTokens: z.number(), costMicros: z.string().nullable(), promptVersions: z.array(z.string()) }),
  notes: z.array(z.string()),
  // Purchase filters of this search (absent in older searches).
  filters: z.unknown().transform(normalizeFilters).optional(),
})
export type StoredPlan = z.infer<typeof planSchema>

const reasonOf = (error: unknown): string => error instanceof Error ? error.message.replace(/[^a-z0-9_ ]/gi, "").slice(0, 40) : "unknown"
export const toPools = (pools: StoredPools): OutfitPools =>
  Object.fromEntries(Object.entries(pools).map(([slot, list]) => [slot, (list ?? []).map(candidateOf)])) as OutfitPools
/** Unusable pieces leave the selection pools (a locked one stays: the person chose it). */
const withoutBlocked = (pools: StoredPools, locked: LockedPieces = {}): StoredPools =>
  Object.fromEntries(Object.entries(pools).map(([slot, list]) => [slot, (list ?? []).filter((p) => p.blocked === null || locked[p.slot] === p.id)])) as StoredPools

/** Repeated titles (rules use one label) get a number, so panels and labels can be told apart. */
const titleOf = (titles: readonly string[], i: number): string => titles.filter((x) => x === titles[i]).length > 1 ? `${titles[i]} ${titles.slice(0, i + 1).filter((x) => x === titles[i]).length}` : titles[i]!

export function createOutfitSearch(deps: OutfitSearchDeps) {
  const log = deps.log ?? (() => undefined)
  const acquire = deps.acquireAgentCall ?? (async () => true)

  function meter() {
    const total = { calls: 0, inputTokens: 0, outputTokens: 0, promptVersions: [] as string[] }
    return {
      add(usage: ComposerUsage, version?: string) {
        total.calls++; total.inputTokens += usage.inputTokens; total.outputTokens += usage.outputTokens
        if (version && !total.promptVersions.includes(version)) total.promptVersions.push(version)
      },
      report: () => ({ ...total, costMicros: deps.agentPrice && total.calls
        ? ((BigInt(total.inputTokens) * deps.agentPrice.inputPerMTok + BigInt(total.outputTokens) * deps.agentPrice.outputPerMTok) / 1_000_000n).toString() : total.calls ? null : "0" }),
    }
  }
  /** One model call: budget first, usage kept even on refusal, any failure = null (rules decide). */
  async function agentCall<T>(stage: string, m: ReturnType<typeof meter>, run: () => Promise<T>): Promise<T | null> {
    try {
      if (!(await acquire())) throw new Error("agent_budget")
      return await run()
    } catch (error) {
      if (error instanceof ComposerResponseError) m.add(error.usage)
      log({ stage, reason: reasonOf(error) })
      return null
    }
  }

  async function interpret(prompt: string, m: ReturnType<typeof meter>): Promise<{ intent: CompositionIntent; by: "agent" | "rules_fallback" }> {
    if (deps.composer) {
      try {
        const r = deps.interpretationCache ? await deps.interpretationCache.interpret(deps.composer, prompt, acquire)
          : await (async () => { if (!(await acquire())) throw new Error("agent_budget"); return deps.composer!.interpret(prompt) })()
        if (r.usage) m.add(r.usage)
        return { intent: r.intent, by: "agent" }
      } catch (error) {
        if (error instanceof ComposerResponseError) m.add(error.usage)
        log({ stage: "interpret", reason: reasonOf(error) })
      }
    }
    return { intent: interpretCompositionRules(prompt), by: "rules_fallback" }
  }

  /** References for pieces that need one; each result is written to the piece (ready or blocked), never swapped. */
  async function prepare(pieces: readonly StoredPiece[]): Promise<void> {
    const pending = pieces.filter((p) => p.source === "aliexpress" && p.reference === null)
    if (!pending.length) return
    const prepared = deps.preparer ? await deps.preparer.prepare(pending.map(referenceItemOf)) : null
    for (const p of pending) {
      const r = prepared?.get(p.id)
      if (r?.status === "ready") { p.reference = r.reference; p.blocked = null }
      else p.blocked = r?.code ?? "reference_unavailable"
    }
  }

  async function retrieve(user: string, intent: CompositionIntent, filters: OutfitFilters, queries: { slot: OutfitSlot; query: string }[], progress: (done: number, found: number) => Promise<void>) {
    const raw = new Map<OutfitSlot, StoredPiece[]>()
    const logs: z.infer<typeof queryLog>[] = []
    const rejected: Record<string, number> = {}
    const wanted = new Set<OutfitSlot>([...intent.slots.map((s) => s.slot), "set"])
    const ranked = (slot: OutfitSlot) => rankCandidates(intent, (raw.get(slot) ?? []).map(candidateOf), filters)
    let unavailable = 0
    if (deps.source === "curated") {
      for (const r of await deps.listCatalog()) {
        const slot = r.category ? outfitSlotOfCategory(r.category.id) : null
        if (slot && wanted.has(slot) && r.availability !== "unavailable") raw.set(slot, [...(raw.get(slot) ?? []), pieceFromCatalog(r, slot)])
      }
    } else {
      let stopped = false
      for (const [i, { slot, query }] of queries.entries()) {
        const skip = stopped || ranked(slot).kept.length >= OUTFIT_TARGET_PER_SLOT
        if (skip || !deps.aliexpressCatalog) {
          logs.push({ slot, query, outcome: stopped || !deps.aliexpressCatalog ? "unavailable" : "skipped", returned: 0, kept: 0, fromCache: false, code: deps.aliexpressCatalog ? null : "source_not_configured" })
          if (!deps.aliexpressCatalog) unavailable++
          continue
        }
        const res = await deps.aliexpressCatalog.search({ keywords: query, pageSize: 50, viewer: user })
        if (res.state !== "ready") {
          unavailable++
          logs.push({ slot, query, outcome: "unavailable", returned: 0, kept: 0, fromCache: res.fromCache, code: res.errorCode ?? res.errorKind })
          // Throttled, or failing repeatedly: no more calls in this search.
          if (res.errorKind === "rate_limited" || unavailable >= 2) stopped = true
        } else {
          const items = res.items.filter((x) => outfitSlotOfCategory(x.category) === slot)
          const list = raw.get(slot) ?? []
          for (const x of items) if (!list.some((p) => p.id === x.canonicalKey)) list.push(pieceFromAliExpress(x, slot, res.expiresAt))
          raw.set(slot, list)
          logs.push({ slot, query, outcome: items.length ? "ok" : res.items.length ? "filtered_out" : "empty", returned: res.items.length, kept: items.length, fromCache: res.fromCache, code: res.errorCode })
        }
        await progress(i + 1, [...raw.keys()].reduce((a, s) => a + ranked(s).kept.length, 0))
      }
    }
    const pools: StoredPools = {}
    for (const [slot, list] of raw) {
      const { kept, rejected: out } = rankCandidates(intent, list.map(candidateOf), filters)
      for (const r of out) rejected[r.reason] = (rejected[r.reason] ?? 0) + 1
      if (kept.length) pools[slot] = kept.map((c) => list.find((p) => p.id === c.id)!)
    }
    return { pools, logs, rejected, unavailable }
  }

  const materialize = (pools: StoredPools, outfit: ValidOutfit): StoredPiece[] =>
    orderPieces(outfit.pieces.map((x) => ({ ...pools[x.slot]!.find((p) => p.id === x.productId)!, reason: x.reason })))

  async function compose(intent: CompositionIntent, pools: StoredPools, m: ReturnType<typeof meter>, options: { max: number; locked?: LockedPieces; exclude?: readonly string[]; bundles?: boolean; agent?: boolean }) {
    const candidates = toPools(withoutBlocked(pools, options.locked))
    if (deps.agents && options.agent !== false) {
      const r = await agentCall("outfits", m, async () => {
        const out = await deps.agents!.compose(intent, candidates, options)
        m.add(out.usage, out.promptVersion)
        return out
      })
      // Valid outfits, or an explicit abstention, are final. Proposals that ALL failed validation are not an answer.
      if (r && (r.outfits.length || !r.rejected.length)) return { outfits: r.outfits, method: "agent" as const, rejected: r.rejected.length }
      if (r) log({ stage: "outfits", reason: "agent_outfits_rejected" })
    }
    return { outfits: selectOutfitsRules(intent, candidates, options), method: "rules_fallback" as const, rejected: 0 }
  }

  /** Before anything is shown: an outfit whose image cannot be used is rebuilt by rules around its usable pieces, once. */
  async function repair(intent: CompositionIntent, pools: StoredPools, outfits: { outfit: ValidOutfit; pieces: StoredPiece[] }[], notes: string[]) {
    const out: typeof outfits = []
    for (const entry of outfits) {
      if (!entry.pieces.some((p) => p.blocked !== null)) { out.push(entry); continue }
      const usable = withoutBlocked(pools)
      const locked: LockedPieces = Object.fromEntries(entry.pieces.filter((p) => p.blocked === null).map((p) => [p.slot, p.id]))
      const others = [...out, ...outfits].flatMap((o) => o.pieces.map((p) => p.id)).filter((id) => !Object.values(locked).includes(id))
      const pick = selectOutfitsRules(intent, toPools(usable), { max: 1, locked, exclude: others, bundles: entry.outfit.kind === "bundle" })[0]
        ?? selectOutfitsRules(intent, toPools(usable), { max: 1, locked, bundles: entry.outfit.kind === "bundle" })[0]
      const pieces = pick ? materialize(usable, pick) : null
      if (pieces) await prepare(pieces)
      for (const p of pieces ?? []) remember(pools, p)
      const key = (xs: StoredPiece[]) => xs.map((p) => p.id).sort().join("|")
      if (pick && pieces && pieces.every((p) => p.blocked === null) && !out.some((o) => key(o.pieces) === key(pieces))) {
        out.push({ outfit: { ...pick, title: entry.outfit.title, rationale: entry.outfit.rationale }, pieces: pieces.map((p) => entry.pieces.some((q) => q.id === p.id) ? { ...p, reason: entry.pieces.find((q) => q.id === p.id)!.reason }
          : { ...p, reason: "Entrou no lugar de um anúncio cuja imagem não pôde ser usada" }) })
        notes.push("outfit_rebuilt_unusable_image")
      } else out.push(entry)
    }
    // Usable outfits first; a blocked one is still shown, with its reason, for the person to swap the piece.
    return [...out.filter((o) => o.pieces.every((p) => p.blocked === null)), ...out.filter((o) => o.pieces.some((p) => p.blocked !== null))]
  }
  const remember = (pools: StoredPools, piece: StoredPiece) => {
    const stored = pools[piece.slot]?.find((p) => p.id === piece.id)
    if (stored) { stored.reference = piece.reference; stored.blocked = piece.blocked }
  }

  class Cancelled extends Error {}

  async function run(user: string, id: string, prompt: string, filters: OutfitFilters = NO_FILTERS): Promise<void> {
    const m = meter()
    const notes: string[] = []
    const stage = async (name: string, detail: Record<string, Json> = {}) => { if (!(await deps.db.call("update_outfit_search", user, id, name, detail))) throw new Cancelled() }
    const finish = (status: "succeeded" | "empty" | "failed", error: string | null, method: "agent" | "rules_fallback" | null, plan: StoredPlan | null, sets: Json) =>
      deps.db.call("finish_outfit_search", user, id, status, error, method, (plan ? JSON.parse(JSON.stringify(plan)) : {}) as Json, sets)
    let plan: StoredPlan | null = null
    try {
      await stage("interpreting")
      const interpreted = await interpret(prompt, m)
      const by = interpreted.by
      const intent = applyFiltersToIntent(interpreted.intent, filters)
      await stage("planning", { slots: intent.slots.map((s) => s.slot) })
      const planned = deps.agents && deps.source !== "curated" ? await agentCall("plan", m, async () => {
        const p = await deps.agents!.plan(intent); m.add(p.usage, p.promptVersion); return p
      }) : null
      const queries = deps.source === "curated" ? [] : searchPlan(intent, planned ? { bundles: planned.bundles, slots: planned.slots } : {})
      await stage("searching", { done: 0, total: queries.length, found: 0 })
      const { pools, logs, rejected, unavailable } = await retrieve(user, intent, filters, queries, (done, found) => stage("searching", { done, total: queries.length, found }))
      const missing: SlotId[] = intent.slots.map((s) => s.slot).filter((s) => !pools[s]?.length)
      plan = { intent, interpretedBy: by, plannedBy: planned ? "agent" : "rules_fallback", queries: logs, pools, rejected, missingSlots: missing, agent: m.report(), notes, filters }
      const found = Object.values(pools).reduce((a, l) => a + (l?.length ?? 0), 0)
      if (!found) { await finish(unavailable ? "failed" : "empty", unavailable ? "source_unavailable" : "no_results", null, plan, []); return }
      await stage("selecting", { found })
      const selected = await compose(intent, pools, m, { max: MAX_OUTFITS })
      plan.agent = m.report()
      if (!selected.outfits.length) {
        await finish("empty", selected.method === "agent" ? "agent_abstained" : missing.length ? "missing_pieces" : "no_compatible_outfit", selected.method, plan, []); return
      }
      await stage("preparing", { outfits: selected.outfits.length })
      let outfits = selected.outfits.map((outfit) => ({ outfit, pieces: materialize(pools, outfit) }))
      const unique = [...new Map(outfits.flatMap((o) => o.pieces).map((p) => [p.id, p])).values()]
      await prepare(unique)
      for (const p of unique) remember(pools, p)
      outfits = outfits.map((o) => ({ ...o, pieces: o.pieces.map((p) => ({ ...p, reference: unique.find((q) => q.id === p.id)!.reference, blocked: unique.find((q) => q.id === p.id)!.blocked })) }))
      outfits = await repair(intent, pools, outfits, notes)
      const sets = outfits.map((o, i) => ({
        kind: o.pieces.some((p) => p.slot === "set") ? "bundle" : "assembled", recommended: i === 0, title: titleOf(outfits.map((x) => x.outfit.title), i), rationale: o.outfit.rationale,
        missingSlots: o.outfit.missingSlots, totalMinor: totalOf(o.pieces), pieces: o.pieces,
      }))
      await finish("succeeded", null, selected.method, plan, JSON.parse(JSON.stringify(sets)) as Json)
    } catch (error) {
      if (error instanceof Cancelled) return
      log({ stage: "search", reason: reasonOf(error) })
      await finish("failed", "internal_error", null, plan, []).catch(() => undefined)
    }
  }

  /** "Outra combinação" without a new store search: stored pools, locked pieces kept, the current ones excluded. */
  async function resuggest(plan: StoredPlan, current: readonly StoredPiece[], locked: readonly OutfitSlot[], seen: readonly string[]): Promise<{ pieces: StoredPiece[]; method: "agent" | "rules_fallback" } | null> {
    const m = meter()
    const keep: LockedPieces = Object.fromEntries(current.filter((p) => locked.includes(p.slot)).map((p) => [p.slot, p.id]))
    const pools: StoredPools = JSON.parse(JSON.stringify(plan.pools)) as StoredPools
    // A locked piece chosen earlier is always part of the pool, with the size the person picked.
    for (const p of current) if (keep[p.slot]) pools[p.slot] = [p, ...(pools[p.slot] ?? []).filter((x) => x.id !== p.id)]
    const key = current.map((p) => p.id).sort().join("|")
    let agent = true
    for (const exclude of [seen, current.map((p) => p.id)]) {
      // A slot whose whole pool was already seen may repeat; the others still change.
      const excluded = exclude.filter((id) => !Object.values(keep).includes(id)
        && Object.values(pools).some((list) => list?.some((p) => p.id === id) && list.some((p) => p.blocked === null && !exclude.includes(p.id))))
      for (let attempt = 0; attempt < 2; attempt++) {
        // At most one model call per request.
        const { outfits, method } = await compose(plan.intent, pools, m, { max: 1, locked: keep, exclude: excluded, bundles: current.some((p) => p.slot === "set"), agent })
        agent = false
        const pick = outfits[0]
        if (!pick && method === "agent") return null
        if (!pick) break
        const pieces = materialize(pools, pick)
        if (pieces.map((p) => p.id).sort().join("|") === key) break
        await prepare(pieces)
        if (pieces.every((p) => p.blocked === null)) return { pieces, method }
        for (const p of pieces) remember(pools, p)
      }
    }
    return null
  }

  /** Explicit swap search. The new query replaces the initial style while keeping the purchase constraints. */
  async function options(user: string, plan: StoredPlan, slot: OutfitSlot, query: string, current: readonly StoredPiece[] = []) {
    const filters = plan.filters ?? NO_FILTERS
    const asked: CompositionIntent = { ...plan.intent, style: [], occasion: null, climate: undefined, avoid: [], colors: [], terms: query.split(/\s+/), slots: slot === "set" ? [] : [{ slot, required: true, query }] }
    const keywords = storeQuery(query)
    const ids = new Set(current.map((piece) => piece.id))
    const budget = applyFiltersToIntent(plan.intent, filters)
    const remaining = current.filter((piece) => piece.slot !== slot)
    const limit = budget.budgetMode === "require" && budget.budgetTotalBrl !== null
      ? remaining.some((piece) => piece.priceMinor === null)
        ? -1
        : Math.round(budget.budgetTotalBrl * 100) - (totalOf(remaining) ?? 0)
      : null
    if (limit !== null && limit < 0) return { pieces: [], returned: 0, outside: { filter_total: 1 } }

    function rankOptions(rows: StoredPiece[], returned: number, otherPart: number) {
      const outside: Record<string, number> = {}
      const left = (reason: string, n = 1) => { if (n) outside[reason] = (outside[reason] ?? 0) + n }
      left("other_part", otherPart)
      const available = rows.filter((piece) => {
        if (ids.has(piece.id)) { left("already_in_look"); return false }
        if (limit !== null && (piece.priceMinor === null || piece.priceMinor > limit)) { left("filter_total"); return false }
        return true
      })
      const { kept, rejected } = rankCandidates(asked, available.map(candidateOf), filters)
      for (const r of rejected) left(r.reason)
      const byId = new Map(available.map((piece) => [piece.id, piece]))
      return { pieces: kept.map((candidate) => byId.get(candidate.id)!), returned, outside }
    }

    if (deps.source === "curated") {
      const words = normalizeText(query).split(/\s+/).filter((w) => w.length > 2)
      const rows = (await deps.listCatalog()).filter((r) => r.availability !== "unavailable" && words.some((w) => normalizeText(r.name).includes(w)))
      const found = rows.filter((r) => r.category && outfitSlotOfCategory(r.category.id) === slot).map((r) => pieceFromCatalog(r, slot))
      return rankOptions(found, rows.length, rows.length - found.length)
    }

    if (deps.findPublishedOffers && keywords) {
      const stopWords = new Set(["para", "com", "uma", "das", "dos", "por", "sem"])
      const requiredTerms = normalizeText(keywords).split(/[^a-z0-9]+/).filter((term) => term.length > 2 && !stopWords.has(term))
      const categories = slot === "set" ? ["outfit_sets"] : [...SLOT_CATEGORIES[slot]]
      const minPriceMinor = filters.minPieceBrl === null ? undefined : Math.round(filters.minPieceBrl * 100)
      const pieceLimit = filters.maxPieceBrl === null ? null : Math.round(filters.maxPieceBrl * 100) * (slot === "set" ? 2 : 1)
      const maxPriceMinor = limit === null ? pieceLimit : pieceLimit === null ? limit : Math.min(pieceLimit, limit)
      if (minPriceMinor !== undefined && maxPriceMinor !== null && minPriceMinor > maxPriceMinor) {
        return { pieces: [], returned: 0, outside: { filter_total: 1 } }
      }
      if (requiredTerms.length) {
        let cursor: string | undefined
        // The catalog is bounded by configured collections. Page past rows that
        // only fail the shared style/ratings rules, before using a provider slot.
        do {
          const page: { items: PublishedAffiliateOffer[]; nextCursor: string | null } = await deps.findPublishedOffers({
            categories, requiredTerms, minPriceMinor, maxPriceMinor: maxPriceMinor ?? undefined,
            exclude: current.find((piece) => piece.slot === slot)?.id, cursor, limit: 96,
          })
          const matching = page.items.filter((item) => item.affiliateUrl)
          const result = rankOptions(matching.map((item) => pieceFromAliExpress(item, slot, item.offerExpiresAt)), matching.length, 0)
          if (result.pieces.length) return result
          cursor = page.nextCursor ?? undefined
        } while (cursor)
      }
    }

    if (!deps.aliexpressCatalog) return "unavailable" as const
    const res = await deps.aliexpressCatalog.search({ keywords, pageSize: 50, viewer: user })
    if (res.state !== "ready") {
      log({ stage: "options", reason: res.errorCode ?? res.errorKind ?? "unavailable" })
      return res.errorKind === "rate_limited" ? "rate_limited" as const : "unavailable" as const
    }
    if (res.links === "failed" || res.links === "missing_tracking_id") {
      log({ stage: "options_links", reason: res.linkErrorCode ?? res.links })
      return res.linkErrorKind === "rate_limited" ? "rate_limited" as const : "unavailable" as const
    }
    const sameSlot = res.items.filter((item) => outfitSlotOfCategory(item.category) === slot)
    const linked = sameSlot.filter((item) => item.affiliateUrl)
    const result = rankOptions(linked.map((item) => pieceFromAliExpress(item, slot, res.expiresAt)), res.items.length, res.items.length - sameSlot.length)
    if (sameSlot.length > linked.length) result.outside.affiliate_link_missing = sameSlot.length - linked.length
    return result
  }

  return { run, resuggest, prepare, options }
}
export type OutfitSearch = ReturnType<typeof createOutfitSearch>
export type { OutfitCandidate }
