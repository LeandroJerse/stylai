/**
 * Estúdio logic shared by the screen and its sheets: which preference is in effect, starting
 * jobs (generate, edit, try-on) against the API, and following the job until it settles.
 * Costs and balance come from the API; the client only pre-checks to explain before spending.
 */
import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { messageOf } from "../api/errors"
import { isJobDone, keys, useBalance, useJob, useLook, usePreferences, useStartJob, useStudioConfig } from "../api/queries"
import type { Job, JobKind, Preference, PreferenceRules } from "../api/types"
import { useAuth } from "../auth/AuthProvider"
import { useStore } from "./store"

export type StartResult = { ok: true } | { ok: false; message: string }

export function useStudio() {
  const { status } = useAuth()
  const signedIn = status === "signed-in"
  const { draft, setDraft } = useStore()
  const config = useStudioConfig()
  const balance = useBalance(signedIn)
  const preferences = usePreferences(signedIn)
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
    starting: start.isPending,
    costOf,
    shortBy,
    generate: () =>
      run({
        kind: "generate",
        data: {
          prompt: draft.prompt.trim(),
          productIds: draft.chosen.map((p) => p.id),
          referenceIds: draft.references.map((r) => r.id),
          preferenceId: activePreference?.id ?? null,
          rules: draft.sessionRules,
        },
      }),
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
    void qc.invalidateQueries({ queryKey: keys.balance })
    if (j.status === "succeeded" && j.lookId) {
      void qc.invalidateQueries({ queryKey: keys.looks })
      setDraft({ lookId: j.lookId, composerOpen: false, acervoSelection: [] })
      if (tab !== "estudio") notify(j.kind === "tryon" ? "Sua prova ficou pronta" : "Seu look ficou pronto", { label: "Ver", run: () => go("estudio") })
    } else if (j.status === "failed" && tab !== "estudio") {
      notify("O pedido do Estúdio falhou. Nada foi cobrado.", { label: "Ver", run: () => go("estudio") })
    }
  }, [job.data, qc, setDraft, notify, tab, go])

  return null
}
