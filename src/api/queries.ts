/**
 * Server state for the screens (TanStack Query). Keys are centralised so mutations invalidate
 * exactly what they change. Nothing here holds placeholder data: until a request succeeds the
 * screens show loading, empty or error states.
 */
import { keepPreviousData, QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api, type CatalogQuery, type GenerateInput } from "./client"
import { isApiError } from "./errors"
import type { BodyAngle, Job, Measurements, PreferenceRules } from "./types"

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        // Do not retry what cannot succeed by retrying.
        retry: (count, e) => {
          if (isApiError(e) && ["not_configured", "unauthorized", "forbidden", "not_found", "validation", "aborted"].includes(e.code)) return false
          return count < 2
        },
      },
      mutations: { retry: false },
    },
  })
}

export const keys = {
  me: ["me"] as const,
  balance: ["me", "balance"] as const,
  measurements: ["me", "measurements"] as const,
  bodyPhotos: ["me", "body-photos"] as const,
  plans: ["plans"] as const,
  hero: ["explore", "hero"] as const,
  facets: ["catalog", "facets"] as const,
  products: (q: CatalogQuery) => ["catalog", "products", q] as const,
  product: (id: string) => ["catalog", "product", id] as const,
  closet: ["closet"] as const,
  preferences: ["preferences"] as const,
  studioConfig: ["studio", "config"] as const,
  looks: ["studio", "looks"] as const,
  look: (id: string) => ["studio", "look", id] as const,
  candidates: (lookId: string) => ["studio", "candidates", lookId] as const,
  matchDeck: (lookId: string) => ["studio", "match", lookId] as const,
  job: (id: string) => ["studio", "job", id] as const,
}

/* ------------------------------------------------------------------ catalog (public) */

export const useHero = () => useQuery({ queryKey: keys.hero, queryFn: api.catalog.hero })
export const useFacets = () => useQuery({ queryKey: keys.facets, queryFn: api.catalog.facets, staleTime: 5 * 60_000 })

export function useCatalog(q: CatalogQuery, enabled = true) {
  return useInfiniteQuery({
    queryKey: keys.products(q),
    queryFn: ({ pageParam, signal }) => api.catalog.products({ ...q, cursor: pageParam }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export const useProduct = (id: string | null) => useQuery({ queryKey: keys.product(id ?? ""), queryFn: () => api.catalog.product(id ?? ""), enabled: id !== null })

/* ------------------------------------------------------------------ account */

export const useBalance = (enabled: boolean) => useQuery({ queryKey: keys.balance, queryFn: api.me.balance, enabled, staleTime: 15_000 })
export const usePlans = () => useQuery({ queryKey: keys.plans, queryFn: api.billing.plans, staleTime: 10 * 60_000 })
export const useMeasurements = (enabled: boolean) => useQuery({ queryKey: keys.measurements, queryFn: api.me.measurements, enabled })
export const useBodyPhotos = (enabled: boolean) =>
  useQuery({
    queryKey: keys.bodyPhotos,
    queryFn: api.me.bodyPhotos,
    enabled,
    // Photos under server analysis are polled until they settle.
    refetchInterval: (query) => (query.state.data?.some((p) => p.status === "processing") ? 2500 : false),
  })

export function useSaveMeasurements() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (m: Measurements) => api.me.saveMeasurements(m), onSuccess: (data) => qc.setQueryData(keys.measurements, data) })
}

export function useUploadBodyPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ angle, file }: { angle: BodyAngle; file: File }) => api.me.uploadBodyPhoto(angle, file),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.bodyPhotos }),
  })
}

export function useDeleteBodyPhoto() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (angle: BodyAngle) => api.me.deleteBodyPhoto(angle), onSettled: () => qc.invalidateQueries({ queryKey: keys.bodyPhotos }) })
}

/* ------------------------------------------------------------------ closet */

export const useCloset = (enabled: boolean) => useQuery({ queryKey: keys.closet, queryFn: api.closet.get, enabled })

/** Saves or removes a piece; every list that shows the heart is refreshed afterwards. */
export function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ productId, save }: { productId: string; save: boolean }) => (save ? api.closet.savePiece(productId) : api.closet.removePiece(productId)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.closet })
      void qc.invalidateQueries({ queryKey: ["catalog"] })
      void qc.invalidateQueries({ queryKey: ["studio", "look"] })
    },
  })
}

export function useToggleSavedLook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lookId, save }: { lookId: string; save: boolean }) => (save ? api.closet.saveLook(lookId) : api.closet.removeLook(lookId)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.closet })
      void qc.invalidateQueries({ queryKey: ["studio"] })
    },
  })
}

/* ------------------------------------------------------------------ preferences */

export const usePreferences = (enabled: boolean) => useQuery({ queryKey: keys.preferences, queryFn: api.preferences.list, enabled })

export function useSavePreferenceRules() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, rules }: { id: string; rules: PreferenceRules }) => api.preferences.update(id, rules),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.preferences }),
  })
}

/* ------------------------------------------------------------------ studio */

export const useStudioConfig = () => useQuery({ queryKey: keys.studioConfig, queryFn: api.studio.config, staleTime: 10 * 60_000 })
export const useLooks = (enabled: boolean) => useQuery({ queryKey: keys.looks, queryFn: api.studio.looks, enabled })
export const useLook = (id: string | null) => useQuery({ queryKey: keys.look(id ?? ""), queryFn: () => api.studio.look(id ?? ""), enabled: id !== null })
export const useCandidates = (lookId: string | null) => useQuery({ queryKey: keys.candidates(lookId ?? ""), queryFn: () => api.studio.candidates(lookId ?? ""), enabled: lookId !== null })
export const useMatchDeck = (lookId: string | null) => useQuery({ queryKey: keys.matchDeck(lookId ?? ""), queryFn: () => api.studio.matchDeck(lookId ?? ""), enabled: lookId !== null, staleTime: Infinity })

export const isJobDone = (job: Job | undefined): boolean => !!job && ["succeeded", "failed", "no_results", "cancelled"].includes(job.status)

/** Polls a job until it settles (1.5 s, then 3 s after 20 s). */
export function useJob(id: string | null) {
  return useQuery({
    queryKey: keys.job(id ?? ""),
    queryFn: ({ signal }) => api.studio.job(id ?? "", signal),
    enabled: id !== null,
    staleTime: 0,
    refetchInterval: (query) => (isJobDone(query.state.data) ? false : query.state.dataUpdateCount > 13 ? 3000 : 1500),
  })
}

export function useStartJob() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { kind: "generate"; data: GenerateInput } | { kind: "edit"; lookId: string; instruction: string } | { kind: "tryon"; lookId: string; productIds: string[] }) =>
      input.kind === "generate" ? api.studio.generate(input.data) : input.kind === "edit" ? api.studio.edit(input.lookId, input.instruction) : api.studio.tryOn(input.lookId, input.productIds),
    onSuccess: (job) => qc.setQueryData(keys.job(job.id), job),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.balance }),
  })
}

export function useCancelJob() {
  const qc = useQueryClient()
  return useMutation({ mutationFn: (id: string) => api.studio.cancelJob(id), onSuccess: (job) => qc.setQueryData(keys.job(job.id), job) })
}
