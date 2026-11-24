/**
 * Estúdio logic shared by the screen and its sheets: which preference is in effect, starting
 * jobs (generate, edit, try-on) against the API, and following the job until it settles.
 * Costs and balance come from the API; the client only pre-checks to explain before spending.
 */
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../api/client"
import { isApiError, messageOf } from "../api/errors"
import { isJobDone, keys, useBalance, useJob, useLook, usePreferences, useStartJob, useStudioConfig } from "../api/queries"
import type { Job, JobKind, Preference, PreferenceRules, Product, CompositionSlotId } from "../api/types"
import { filtersToSend } from "../lib/filters"
import { bindKey, forgetJob, forgetKey, keyFor } from "../lib/requestKeys"
import { useAuth } from "../auth/AuthProvider"
import { useStore, type StudioMode } from "./store"

export type StartResult = { ok: true } | { ok: false; message: string }

export function useStudio() {
  const { status } = useAuth()
  const signedIn = status === "signed-in"
  const { draft, setDraft } = useStore()
  const config = useStudioConfig()
  const caps = config.data?.capabilities
  /** The current engine: one catalog piece per request, on the consented Perfil photo. */
  const singlePiece = caps?.mode === "single_piece_try_on"
  const balance = useBalance(signedIn)
  // Preferences are not served by the single-piece engine: never request what does not exist.
  const preferences = usePreferences(signedIn)
  // The same photos the Perfil manages (no parallel registration in the Estúdio).
  const photos = useQuery({ queryKey: [...keys.bodyPhotos, "state"], queryFn: api.me.bodyPhotosState, enabled: signedIn && caps?.bodyPhotoRequired === true })
  const photoReady = caps?.bodyPhotoRequired !== true || (photos.data?.consent?.accepted === true && photos.data.items.some((p) => p.angle === "front" && p.status === "ready"))
  const [searching, setSearching] = useState(false)
  const [sending, setSending] = useState(false)
  const [composing, setComposing] = useState(false)
  const qc = useQueryClient()
  const look = useLook(draft.lookId)
  const job = useJob(draft.jobId)
  const start = useStartJob()

  const prefs = preferences.data
  const activePreference: Preference | null = prefs ? (prefs.items.find((p) => p.id === draft.preferenceId) ?? prefs.items.find((p) => p.id === prefs.defaultId) ?? prefs.items[0] ?? null) : null
  const rules: PreferenceRules | null = draft.sessionRules ?? activePreference?.rules ?? null
  const running = !!job.data && !isJobDone(job.data)

  const costOf = (kind: JobKind): number | null => {
    const c = config.data?.costs
    if (!c) return null
    return kind === "generate" ? c.generate : kind === "edit" ? c.edit : c.tryOn
  }

  /** Missing tokens for a job, or null when it is affordable or unknown (the API decides then). */
  const shortBy = (kind: JobKind): number | null => {
    const cost = costOf(kind)
    const tokens = balance.data?.tokens
    if (cost === null || tokens === undefined) return null
    return tokens < cost ? cost - tokens : null
  }

  /** Variant to send: the explicit choice, or the only available one. */
  const variantOf = (p: Product): { ok: true; id: string | null } | { ok: false; message: string } => {
    const available = p.variants.filter((v) => v.available && v.id)
    const chosen = draft.variantChoice[p.id]
    if (chosen && available.some((v) => v.id === chosen)) return { ok: true, id: chosen }
    if (available.length === 1) return { ok: true, id: available[0]!.id }
    if (available.length === 0) return { ok: false, message: `${p.name} não tem tamanho disponível.` }
    return { ok: false, message: `Escolha o tamanho de ${p.name}.` }
  }

  /** One-piece try-on on the engine (new look, or a new version of parentLookId). */
  async function tryOnPiece(piece: Product, parentLookId: string | null): Promise<StartResult> {
    if (!signedIn) return { ok: false, message: "Entre na sua conta para usar o Estúdio." }
    if (!photoReady) return { ok: false, message: "Para gerar, adicione uma foto de corpo inteiro no Perfil." }
    if (running || sending) return { ok: false, message: "Já existe um pedido em andamento. Aguarde ou cancele." }
    const variant = variantOf(piece)
    if (!variant.ok) return variant
    const fingerprint = `${piece.id}|${variant.id ?? ""}|${parentLookId ?? ""}`
    setSending(true)
    try {
      const j = await api.studio.tryOnPiece({ productId: piece.id, variantId: variant.id, parentLookId }, keyFor(fingerprint))
      qc.setQueryData(keys.job(j.id), j)
      setDraft({ jobId: j.id })
      if (isJobDone(j)) forgetKey(fingerprint)
      else bindKey(fingerprint, j.id)
      void qc.invalidateQueries({ queryKey: keys.balance })
      return { ok: true }
    } catch (e) {
      // A refused request will never succeed as is: the next attempt is a new request.
      if (isApiError(e) && e.status >= 400 && e.status < 500 && e.code !== "conflict") forgetKey(fingerprint)
      if (isApiError(e) && (e.code === "photo_required" || e.code === "consent_required")) void qc.invalidateQueries({ queryKey: keys.bodyPhotos })
      return { ok: false, message: messageOf(e) }
    } finally {
      setSending(false)
    }
  }

  async function run(input: Parameters<typeof start.mutateAsync>[0]): Promise<StartResult> {
    if (!signedIn) return { ok: false, message: "Entre na sua conta para usar o Estúdio." }
    if (running) return { ok: false, message: "Já existe um pedido em andamento. Aguarde ou cancele." }
    const missing = shortBy(input.kind)
    if (missing !== null) return { ok: false, message: `Saldo insuficiente: faltam ${missing} tokens.` }
    try {
      const j = await start.mutateAsync(input)
      setDraft({ jobId: j.id })
      return { ok: true }
    } catch (e) {
      return { ok: false, message: messageOf(e) }
    }
  }

  return {
    signedIn,
    config,
    balance,
    preferences,
    activePreference,
    rules,
    look,
    job,
    running,
    starting: start.isPending || sending,
    caps,
    singlePiece,
    photos,
    photoReady,
    searching,
    variantOf,
    /** Search step on the catalog (Procurar). Never generates. */
    search: async (): Promise<StartResult> => {
      if (!signedIn) return { ok: false, message: "Entre na sua conta para usar o Estúdio." }
      setSearching(true)
      const filters = filtersToSend(draft.filters, caps?.outfitFilters ?? [])
      try {
        const result = await api.studio.search({ prompt: draft.prompt.trim(), rules: draft.sessionRules, ...(filters ? { filters } : {}) })
        setDraft((d) => ({ searchResult: result, stageView: "pieces", stageNonce: d.stageNonce + 1, ...(caps?.outfits && !d.lookId ? { composerOpen: false } : {}) }))
        return { ok: true }
      } catch (e) {
        return { ok: false, message: messageOf(e) }
      } finally {
        setSearching(false)
      }
    },
    composing,
    /** Outfit composition: the agent (or the labelled rules fallback) picks real pieces per slot. Never generates. */
    compose: async (locked: Partial<Record<CompositionSlotId, string>> = {}): Promise<StartResult> => {
      if (!signedIn) return { ok: false, message: "Entre na sua conta para usar o Estúdio." }
      if (!draft.prompt.trim()) return { ok: false, message: "Descreva o look: peças, ocasião, cores ou orçamento total." }
      setComposing(true)
      try {
        const outcome = await api.studio.compose({ prompt: draft.prompt.trim(), locked })
        if (outcome.kind === "not_composed") { setDraft({ composition: null }); return { ok: false, message: outcome.message } }
        setDraft({ composition: outcome.composition })
        return { ok: true }
      } catch (e) {
        return { ok: false, message: messageOf(e) }
      } finally {
        setComposing(false)
      }
    },
    /** Generates the confirmed composition (one job; one daily request). New version when a look is on screen. */
    generateComposition: async (choices: { slot: CompositionSlotId; productId: string; variantId: string | null }[], asNewVersion: boolean): Promise<StartResult> => {
      const composition = draft.composition
      if (!composition) return { ok: false, message: "Monte o look primeiro." }
      if (!signedIn) return { ok: false, message: "Entre na sua conta para usar o Estúdio." }
      if (!photoReady) return { ok: false, message: "Para gerar, adicione uma foto de corpo inteiro no Perfil." }
      if (running || sending) return { ok: false, message: "Já existe um pedido em andamento. Aguarde ou cancele." }
      const parentLookId = asNewVersion ? draft.lookId : null
      const fingerprint = `composition|${composition.id}|${choices.map((c) => `${c.slot}:${c.productId}:${c.variantId ?? ""}`).join(",")}|${parentLookId ?? ""}`
      setSending(true)
      try {
        const j = await api.studio.generateComposition({ compositionId: composition.id, choices, parentLookId }, keyFor(fingerprint))
        qc.setQueryData(keys.job(j.id), j)
        setDraft({ jobId: j.id })
        if (isJobDone(j)) forgetKey(fingerprint)
        else bindKey(fingerprint, j.id)
        void qc.invalidateQueries({ queryKey: keys.balance })
        return { ok: true }
      } catch (e) {
        if (isApiError(e) && e.status >= 400 && e.status < 500 && e.code !== "conflict") forgetKey(fingerprint)
        return { ok: false, message: messageOf(e) }
      } finally {
        setSending(false)
      }
    },
    /** New version of the look on screen with another piece (v1 -> v2). */
    swap: (piece: Product) => (draft.lookId ? tryOnPiece(piece, draft.lookId) : Promise.resolve<StartResult>({ ok: false, message: "Não há look de origem." })),
    costOf,
    shortBy,
    /** Starts a generation in the given mode (defaults to the Estúdio's current mode). */
    generate: (mode: StudioMode = draft.mode): Promise<StartResult> => {
      if (singlePiece) {
        if (mode !== "vestir") return Promise.resolve({ ok: false, message: "Busque as peças primeiro e escolha uma para vestir." })
        if (draft.references.length > 0) return Promise.resolve({ ok: false, message: "Fotos de roupas do celular ainda não podem ser vestidas. Remova-as para continuar." })
        if (draft.chosen.length !== 1) return Promise.resolve({ ok: false, message: draft.chosen.length === 0 ? "Escolha uma peça para vestir." : "Por enquanto o provador veste uma peça por vez. Deixe só uma peça escolhida." })
        return tryOnPiece(draft.chosen[0]!, null)
      }
      return run({
        kind: "generate",
        data:
          mode === "vestir"
            ? { mode: "dress", prompt: draft.prompt.trim(), productIds: draft.chosen.map((p) => p.id), referenceIds: draft.references.map((r) => r.id), preferenceId: null, rules: null }
            : { mode: "search", prompt: draft.prompt.trim(), productIds: draft.chosen.map((p) => p.id), referenceIds: [], preferenceId: activePreference?.id ?? null, rules: draft.sessionRules },
      })
    },
    edit: (instruction: string) => (draft.lookId ? run({ kind: "edit", lookId: draft.lookId, instruction }) : Promise.resolve<StartResult>({ ok: false, message: "Não há imagem para editar." })),
    tryOn: (productIds: string[]) => (draft.lookId ? run({ kind: "tryon", lookId: draft.lookId, productIds }) : Promise.resolve<StartResult>({ ok: false, message: "Não há look de origem." })),
  }
}

/**
 * Mounted once in the shell: when the followed job settles, shows its look, refreshes the
 * balance and history, and tells the person what happened (also when they are on another tab).
 */
export function JobWatcher() {
  const { draft, setDraft, notify, tab, go } = useStore()
  const qc = useQueryClient()
  const job = useJob(draft.jobId)
  const handled = useRef<string | null>(null)

  useEffect(() => {
    const j: Job | undefined = job.data
    if (!j || !isJobDone(j) || handled.current === j.id) return
    handled.current = j.id
    // A settled job frees its idempotency key: retrying afterwards is a new request.
    forgetJob(j.id)
    void qc.invalidateQueries({ queryKey: keys.balance })
    if (j.status === "succeeded" && j.lookId) {
      void qc.invalidateQueries({ queryKey: keys.looks })
      // The Acervo follows the look only when it is a search result (StudioScreen, showLookPatch).
      setDraft({ lookId: j.lookId, composerOpen: false })
      if (tab !== "estudio") notify(j.kind === "tryon" ? "Sua prova ficou pronta" : "Seu look ficou pronto", { label: "Ver", run: () => go("estudio") })
    } else if (j.status === "failed" && tab !== "estudio") {
      notify("O pedido do Estúdio falhou. Nada foi cobrado.", { label: "Ver", run: () => go("estudio") })
    }
  }, [job.data, qc, setDraft, notify, tab, go])

  return null
}
