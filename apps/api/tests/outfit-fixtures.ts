/** In-memory stand-in for the private outfit functions (their real rules are covered by supabase/tests/outfits.sql). */
import { randomUUID } from "node:crypto"
import { PrivateDatabaseError, type PrivateDatabase } from "@stylai/supabase"
import type { AliExpressCatalogService, NormalizedAliExpressCatalogItem } from "@stylai/commerce"

export const A = "20000000-0000-4000-8000-0000000000a1"
export const B = "20000000-0000-4000-8000-0000000000b2"
export const rejected = (state: string) => new PrivateDatabaseError("rejected", state)

export function item(n: number, category: string, name: string, priceMinor: number | null = 9000): NormalizedAliExpressCatalogItem {
  return {
    source: "aliexpress", canonicalKey: `aliexpress:${n}`, seller: "aliexpress-shop-9", sellerName: "Loja", externalProductId: String(n), category, categoryLabel: category,
    name, color: null, variants: [], priceMinor, currency: "BRL", priceObservedAt: "2026-11-24T10:00:00.000Z", productUrl: `https://pt.aliexpress.com/item/${n}.html`,
    affiliateUrl: `https://s.click.aliexpress.com/e/${n}`, image: `https://ae01.alicdn.com/kf/${n}.jpg`, rights: { basis: "unconfirmed", evidence: "x", tryOnAllowed: false },
    capabilities: { displayAndLink: true, aiTryOn: false, aiTryOnBlockedReason: "ai_image_rights_unconfirmed" }, fixture: false, ratingPercent: null, recentSales: null,
  } as NormalizedAliExpressCatalogItem
}

type Answer = NormalizedAliExpressCatalogItem[] | "down" | "limited"
export function fakeStore(answer: (keywords: string) => Answer) {
  const queries: string[] = []
  const service = { search: async ({ keywords }: { keywords: string }) => {
    queries.push(keywords)
    const items = answer(keywords)
    const common = { rejectedCount: 0, links: null, trackingIdEcho: null, linkErrorCode: null, observedAt: "x", expiresAt: null, fromCache: false, requestId: null, errorMessage: null, backoffUntil: null, emptyReason: null }
    return items === "down" ? { ...common, state: "degraded", items: [], errorKind: "network", errorCode: null }
      : items === "limited" ? { ...common, state: "degraded", items: [], errorKind: "rate_limited", errorCode: "429" }
      : { ...common, state: "ready", items, errorKind: null, errorCode: null }
  }, findFresh: async () => null } as unknown as AliExpressCatalogService
  return { service, queries }
}

export interface FakeSearch { id: string; user: string; key: string; hash: string; prompt: string; source: string; model: string | null; status: string; stage: string; detail: unknown; method: string | null; error: string | null; plan: unknown; expired?: boolean }
export interface FakeSet { id: string; user: string; search: string; position: number; kind: string; recommended: boolean; title: string; rationale: string; missing: string[]; revision: number; revisions: { revision: number; origin: string; pieces: unknown[]; locked: string[]; total: number | null }[] }

/** Extra operations (photos, renders) come from `extend`. */
export function fakeDb(extend: (op: string, args: unknown[]) => unknown = () => undefined) {
  const searches: FakeSearch[] = []
  const sets: FakeSet[] = []
  const stages: string[] = []
  const calls: { op: string; args: unknown[] }[] = []
  const setJson = (s: FakeSet) => {
    const r = s.revisions.find((x) => x.revision === s.revision)!
    return { id: s.id, search_id: s.search, position: s.position, kind: s.kind, recommended: s.recommended, title: s.title, rationale: s.rationale, missing_slots: s.missing,
      revision: s.revision, created_at: "2026-11-24T10:00:00Z", pieces: r.pieces, locked: r.locked, total_minor: r.total, origin: r.origin }
  }
  const searchJson = (q: FakeSearch) => ({ id: q.id, prompt: q.prompt, source: q.source, model: q.model, status: q.status === "running" && q.expired ? "interrupted" : q.status, stage: q.stage,
    stage_detail: q.detail ?? {}, selection_method: q.method, error_code: q.error, plan: q.plan ?? {}, created_at: "2026-11-24T10:00:00Z", finished_at: q.status === "running" ? null : "2026-11-24T10:01:00Z",
    sets: sets.filter((s) => s.search === q.id).map(setJson) })
  const mine = (user: unknown, id: unknown, base?: unknown) => {
    const s = sets.find((x) => x.id === id && x.user === user)
    if (!s) throw rejected("42501")
    if (base !== undefined && s.revision !== base) throw rejected("40001")
    return s
  }
  const db = { call: async (op: string, ...args: unknown[]) => {
    calls.push({ op, args })
    const custom = extend(op, args)
    if (custom !== undefined) return custom
    switch (op) {
      case "create_outfit_search": {
        const [user, key, hash, prompt, source, model] = args as [string, string, string, string, string, string | null]
        const prior = searches.find((q) => q.user === user && q.key === key)
        if (prior) { if (prior.hash !== hash) throw rejected("23505"); return { id: prior.id, created: false } }
        if (searches.some((q) => q.user === user && q.status === "running" && !q.expired)) throw rejected("23505")
        const q: FakeSearch = { id: randomUUID(), user, key, hash, prompt, source, model, status: "running", stage: "interpreting", detail: {}, method: null, error: null, plan: null }
        searches.push(q)
        return { id: q.id, created: true }
      }
      case "update_outfit_search": {
        const q = searches.find((x) => x.id === args[1] && x.user === args[0] && x.status === "running")
        if (!q) return false
        q.stage = String(args[2]); q.detail = args[3]; stages.push(q.stage)
        return true
      }
      case "finish_outfit_search": {
        const [user, id, status, error, method, plan, list] = args as [string, string, string, string | null, string | null, unknown, Record<string, unknown>[]]
        const q = searches.find((x) => x.id === id && x.user === user && x.status === "running")
        if (!q) return null
        Object.assign(q, { status, stage: "done", error, method, plan })
        if (status === "succeeded") list.forEach((s, i) => sets.push({ id: randomUUID(), user, search: id, position: i + 1, kind: String(s.kind), recommended: s.recommended === true, title: String(s.title),
          rationale: String(s.rationale), missing: s.missingSlots as string[], revision: 1, revisions: [{ revision: 1, origin: "suggested", pieces: s.pieces as unknown[], locked: [], total: s.totalMinor as number | null }] }))
        return []
      }
      case "cancel_outfit_search": { const q = searches.find((x) => x.id === args[1] && x.user === args[0] && x.status === "running"); if (q) q.status = "cancelled"; return Boolean(q) }
      case "read_outfit_search": { const q = searches.find((x) => x.id === args[1] && x.user === args[0]); return q ? searchJson(q) : null }
      case "list_outfit_searches": return searches.filter((q) => q.user === args[0]).map((q) => ({ id: q.id, prompt: q.prompt, created_at: "x", status: q.status, sets: sets.filter((s) => s.search === q.id).length }))
      case "read_outfit_set": {
        const s = sets.find((x) => x.id === args[1] && x.user === args[0])
        return s ? JSON.parse(JSON.stringify({ ...setJson(s), plan: searches.find((q) => q.id === s.search)!.plan, source: "aliexpress_affiliate",
          revisions: s.revisions.map((r) => ({ revision: r.revision, origin: r.origin, pieces: r.pieces, locked: r.locked, total_minor: r.total, created_at: "x" })) })) : null
      }
      case "save_outfit_set_revision": {
        const s = mine(args[0], args[1], args[2])
        s.revision++
        s.revisions.push({ revision: s.revision, origin: String(args[3]), pieces: args[4] as unknown[], locked: args[5] as string[], total: args[6] === null ? null : Number(args[6]) })
        return s.revision
      }
      case "set_outfit_locks": { const s = mine(args[0], args[1], args[2]); s.revisions.at(-1)!.locked = args[3] as string[]; return true }
      default: return null
    }
  } } as unknown as PrivateDatabase<"api">
  return { db, searches, sets, stages, calls }
}
