/**
 * Autonomous outfits: everything durable lives on the server (search stages, sets, versions, locks, image batches).
 * A reload just reads it again; the client keeps only which search is open and what is ticked.
 */
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { isApiError, messageOf } from "../api/errors"
import { outfitsApi, type OutfitQuote, type OutfitRender, type OutfitSearch, type OutfitSet, type OutfitSetDetail } from "../api/outfits"
import { keys } from "../api/queries"
import { filtersToSend, type SearchFilters } from "../lib/filters"
import { forgetKey, keyFor } from "../lib/requestKeys"
import { useStore } from "./store"
import { useStudio, type StartResult } from "./useStudio"

export const outfitKeys = {
  searches: ["outfits", "searches"] as const,
  search: (id: string) => ["outfits", "search", id] as const,
  set: (id: string) => ["outfits", "set", id] as const,
  renders: ["outfits", "renders"] as const,
}
const active = (r: OutfitRender) => r.status === "running" || r.status === "assembling"

export function useOutfits() {
  const studio = useStudio()
  const { draft, setDraft } = useStore()
  const qc = useQueryClient()
  const enabled = studio.signedIn && studio.caps?.outfits === true
  const [starting, setStarting] = useState(false)
  const searches = useQuery({ queryKey: outfitKeys.searches, queryFn: outfitsApi.searches, enabled })
  // The last search is reopened on its own after a reload; the history opens any other one.
  const searchId = draft.outfitSearchId ?? searches.data?.[0]?.id ?? null
  const search = useQuery({
    queryKey: outfitKeys.search(searchId ?? ""), queryFn: ({ signal }) => outfitsApi.search(searchId!, signal), enabled: enabled && searchId !== null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  })
  const renders = useQuery({
    queryKey: outfitKeys.renders, queryFn: ({ signal }) => outfitsApi.renders(signal), enabled,
    refetchInterval: (q) => (q.state.data?.some(active) ? 3000 : false),
  })

  const putSet = (detail: OutfitSetDetail) => {
    qc.setQueryData(outfitKeys.set(detail.id), detail)
    qc.setQueryData<OutfitSearch>(outfitKeys.search(detail.searchId), (s) => s && { ...s, sets: s.sets.map((x) => (x.id === detail.id ? detail : x)) })
  }
  const putRender = (r: OutfitRender) => qc.setQueryData<OutfitRender[]>(outfitKeys.renders, (list) => (list?.some((x) => x.id === r.id) ? list.map((x) => (x.id === r.id ? r : x)) : [r, ...(list ?? [])]))
  /** Runs a change; a stale version (other tab) is reloaded and explained, never overwritten. */
  async function change<T>(run: () => Promise<T>, done: (value: T) => void, refresh: () => void): Promise<StartResult> {
    try { done(await run()); return { ok: true } } catch (e) {
      if (isApiError(e) && (e.status === 409 || e.status === 404)) refresh()
      return { ok: false, message: messageOf(e) }
    }
  }
  const reloadSet = (s: Pick<OutfitSet, "id" | "searchId">) => {
    void qc.invalidateQueries({ queryKey: outfitKeys.search(s.searchId) })
    void qc.invalidateQueries({ queryKey: outfitKeys.set(s.id) })
  }
  const changeSet = (s: OutfitSet, run: () => Promise<OutfitSetDetail>) => change(run, putSet, () => reloadSet(s))
  const changeRender = (run: () => Promise<OutfitRender>) => change(run, (r) => { putRender(r); void qc.invalidateQueries({ queryKey: keys.balance }) }, () => void qc.invalidateQueries({ queryKey: outfitKeys.renders }))

  return {
    enabled, studio, searches, searchId, search, renders, starting,
    open: (id: string) => setDraft({ outfitSearchId: id }),
    /** Starts a search from the composer text. Never generates and never spends coins. */
    start: async (prompt: string, filters: Partial<SearchFilters> | null = filtersToSend(draft.filters, studio.caps?.outfitFilters ?? [])): Promise<StartResult> => {
      if (!studio.signedIn) return { ok: false, message: "Entre na sua conta para usar o Estúdio." }
      if (!prompt.trim()) return { ok: false, message: "Descreva o look: estilo, ocasião, cores ou orçamento total." }
      const fingerprint = `outfit-search|${prompt.trim()}|${JSON.stringify(filters)}`
      setStarting(true)
      try {
        const s = await outfitsApi.startSearch(prompt.trim(), filters, keyFor(fingerprint))
        forgetKey(fingerprint)
        qc.setQueryData(outfitKeys.search(s.id), s)
        // The request leaves the composer and its outfits take the work area.
        setDraft((d) => ({ outfitSearchId: s.id, lookId: null, stageView: "sets", stageNonce: d.stageNonce + 1, composerOpen: false }))
        void qc.invalidateQueries({ queryKey: outfitKeys.searches })
        return { ok: true }
      } catch (e) {
        // A refused request is a new request next time; a lost answer reuses the key and returns the same search.
        if (isApiError(e) && e.status >= 400 && e.status < 500) forgetKey(fingerprint)
        if (isApiError(e) && e.code === "search_in_progress") void qc.invalidateQueries({ queryKey: outfitKeys.searches })
        return { ok: false, message: messageOf(e) }
      } finally { setStarting(false) }
    },
    cancelSearch: (id: string) => change(() => outfitsApi.cancelSearch(id), (s) => { qc.setQueryData(outfitKeys.search(s.id), s); void qc.invalidateQueries({ queryKey: outfitKeys.searches }) }, () => undefined),
    swap: (s: OutfitSet, slot: OutfitSet["locked"][number], productId: string, variantId?: string | null) => changeSet(s, () => outfitsApi.swap(s.id, { slot, productId, ...(variantId === undefined ? {} : { variantId }), base: s.revision })),
    lock: (s: OutfitSet, locked: OutfitSet["locked"]) => changeSet(s, () => outfitsApi.locks(s.id, { locked, base: s.revision })),
    suggest: (s: OutfitSet) => changeSet(s, () => outfitsApi.suggest(s.id, { locked: s.locked, base: s.revision })),
    restore: (s: OutfitSet, revision: number) => changeSet(s, () => outfitsApi.restore(s.id, { revision, base: s.revision })),
    quote: async (sets: OutfitSet[]): Promise<{ ok: true; quote: OutfitQuote } | { ok: false; message: string }> => {
      try {
        const quote = await outfitsApi.quote(sets.length === 1 ? "individual" : "comparison", sets.map((s) => ({ setId: s.id, revision: s.revision })))
        // The store changed something: the sets on screen follow the new versions.
        if (quote.changes.length) sets.forEach(reloadSet)
        return { ok: true, quote }
      } catch (e) {
        if (isApiError(e) && e.status === 409) sets.forEach(reloadSet)
        return { ok: false, message: messageOf(e) }
      }
    },
    confirm: async (quote: OutfitQuote): Promise<StartResult> => {
      if (!quote.ready || !quote.confirmation) return { ok: false, message: "Confira o pedido antes de gerar." }
      const fingerprint = `outfit-render|${quote.confirmation}`
      try {
        const r = await outfitsApi.startRender({ mode: quote.mode, sets: quote.panels.map((p) => ({ setId: p.setId, revision: p.revision })), confirmation: quote.confirmation }, keyFor(fingerprint))
        forgetKey(fingerprint)
        putRender(r)
        void qc.invalidateQueries({ queryKey: keys.balance })
        return { ok: true }
      } catch (e) {
        if (isApiError(e) && e.status >= 400 && e.status < 500) forgetKey(fingerprint)
        return { ok: false, message: messageOf(e) }
      }
    },
    retry: (r: OutfitRender, panel: number, acceptCharge: boolean) => changeRender(() => outfitsApi.retry(r.id, panel, acceptCharge)),
    finalize: (r: OutfitRender) => changeRender(() => outfitsApi.finalize(r.id)),
    cancelRender: (r: OutfitRender) => changeRender(() => outfitsApi.cancel(r.id)),
  }
}
export type Outfits = ReturnType<typeof useOutfits>
