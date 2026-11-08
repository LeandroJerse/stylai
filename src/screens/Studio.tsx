/**
 * Estúdio: compose a request (text, catalog pieces from Explorar, reference images, preference),
 * start a job on the API and follow it until the look arrives. Costs, balance, progress, results,
 * versions and history all come from the server (useStudio, api/queries.ts).
 */
import { useEffect, useId, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { Archive, ArrowsClockwise, CircleNotch, CoatHanger, Coins, Compass, CornersOut, PencilSimpleLine, Plus, SquaresFour, Trash, X } from "@phosphor-icons/react"
import { api } from "../api/client"
import { messageOf } from "../api/errors"
import { useCancelJob, useLooks, useToggleSavedLook } from "../api/queries"
import type { Job, Look, UploadedImage } from "../api/types"
import { useStore } from "../app/store"
import { useStudio } from "../app/useStudio"
import { plural } from "../lib/format"
import { checkImageFile } from "../lib/images"
import { relaxRule } from "../lib/rules"
import { FavButton, PieceCard, priceText, ROLE_LABEL } from "../components/pieces"
import { CriterionQuick } from "../components/CriterionQuick"
import { EmptyState, ErrorState, Notice, Photo, Skeleton, useReducedMotion } from "../components/ui"
import { ORIGIN_LABEL, sumLook } from "../lib/looks"

/* ------------------------------------------------------------------ references */

function ReferencePicker() {
  const { draft, setDraft } = useStore()
  const studio = useStudio()
  const config = studio.config.data
  const inputRef = useRef<HTMLInputElement | null>(null)
  const replaceTarget = useRef<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const headId = useId()
  const upload = useMutation({ mutationFn: (file: File) => api.studio.uploadReference(file) })
  const max = config?.maxReferences ?? 0
  const count = draft.references.length
  const full = count >= max
  if (!config || max === 0) return null

  const pick = (replaceId: string | null): void => {
    replaceTarget.current = replaceId
    inputRef.current?.click()
  }

  const onChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ""
    if (files.length === 0) return
    const replaceId = replaceTarget.current
    replaceTarget.current = null
    const room = replaceId ? 1 : max - count
    const problems: string[] = []
    if (files.length > room) problems.push(`Limite de ${max} referências: ${plural(files.length - room, "arquivo ignorado", "arquivos ignorados")}.`)
    for (const file of files.slice(0, room)) {
      const problem = await checkImageFile(file, config)
      if (problem) {
        problems.push(problem)
        continue
      }
      try {
        const uploaded: UploadedImage = await upload.mutateAsync(file)
        setDraft((d) => ({ references: replaceId ? d.references.map((r) => (r.id === replaceId ? uploaded : r)) : [...d.references, uploaded] }))
      } catch (err) {
        problems.push(`“${file.name}”: ${messageOf(err)}`)
      }
    }
    setErrors(problems)
  }

  return (
    <div role="group" aria-labelledby={headId}>
      <div className="flex items-baseline justify-between gap-3">
        <p id={headId} className="sa-title-sm">
          Referências de roupa ou acessório
        </p>
        <span className="sa-caption sa-muted sa-num" aria-live="polite">
          {count} de {max}
        </span>
      </div>
      <p className="sa-caption sa-muted mt-1">Opcional. Não são fotos do seu corpo; essas ficam no Perfil.</p>
      <input ref={inputRef} type="file" accept={config.acceptedImageTypes.join(",") || "image/*"} multiple className="sa-sr" tabIndex={-1} aria-hidden="true" onChange={(e) => void onChange(e)} />
      <ul className="mt-3 flex flex-wrap gap-3">
        {draft.references.map((r, i) => (
          <li key={r.id} className="flex items-end gap-1">
            <div className="sa-photo" style={{ width: 72, height: 90 }}>
              <Photo image={r.image} alt={`Referência ${i + 1}`} className="h-full w-full" />
            </div>
            <div className="flex flex-col">
              <button type="button" className="sa-iconbtn" aria-label={`Trocar referência ${i + 1}`} onClick={() => pick(r.id)} aria-disabled={upload.isPending || undefined}>
                <ArrowsClockwise size={20} />
              </button>
              <button
                type="button"
                className="sa-iconbtn"
                aria-label={`Remover referência ${i + 1}`}
                onClick={() => {
                  setDraft((d) => ({ references: d.references.filter((x) => x.id !== r.id) }))
                  setErrors([])
                }}
              >
                <Trash size={20} />
              </button>
            </div>
          </li>
        ))}
        {upload.isPending ? (
          <li>
            <div className="flex flex-col items-center justify-center gap-1 sa-caption" style={{ width: 72, height: 90, borderRadius: "var(--r-thumb)", background: "var(--surface2)" }} role="status">
              <CircleNotch size={20} className="sa-spin" aria-hidden="true" />
              Enviando
            </div>
          </li>
        ) : !full ? (
          <li>
            <button
              type="button"
              onClick={() => pick(null)}
              className="flex flex-col items-center justify-center gap-1 sa-caption"
              style={{ width: 72, height: 90, borderRadius: "var(--r-thumb)", border: "1px dashed var(--control)" }}
              aria-label={`Adicionar referência (${count} de ${max})`}
            >
              <Plus size={20} aria-hidden="true" />
              Adicionar
            </button>
          </li>
        ) : null}
      </ul>
      {full ? <p className="sa-caption sa-muted mt-2">Limite atingido. Troque ou remova uma referência para usar outra.</p> : null}
      {errors.length > 0 ? (
        <div className="sa-caption sa-error-text mt-2" role="alert">
          {errors.map((er) => (
            <p key={er}>{er}</p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ pieces from Explorar */

function ChosenPieces() {
  const { draft, setDraft, go, open } = useStore()
  const studio = useStudio()
  const headId = useId()
  const max = studio.config.data?.maxChosenPieces ?? 0
  const count = draft.chosen.length
  if (count === 0) {
    return (
      <button type="button" className="sa-btn-quiet sa-body-sm -ml-2 flex items-center gap-2 font-semibold" onClick={() => go("explorar")}>
        <Compass size={18} aria-hidden="true" /> Partir de uma peça do Explorar
      </button>
    )
  }
  return (
    <div role="group" aria-labelledby={headId}>
      <div className="flex items-baseline justify-between gap-3">
        <p id={headId} className="sa-title-sm">
          Peças escolhidas no Explorar
        </p>
        {max > 0 ? (
          <span className="sa-caption sa-muted sa-num">
            {count} de {max}
          </span>
        ) : null}
      </div>
      <p className="sa-caption sa-muted mt-1">Entram no look como estão no catálogo, com a mesma loja e o mesmo link.</p>
      <ul className="mt-3 grid gap-2">
        {draft.chosen.map((p) => (
          <li key={p.id} className="sa-chosen">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => open({ kind: "product", productId: p.id })} aria-label={`${p.name}, ${p.partner.name}. Ver detalhes`}>
              <div className="sa-photo sa-thumb flex-none" style={{ width: 48, height: 60 }}>
                <Photo image={p.images[0] ?? null} alt="" className="h-full w-full" />
              </div>
              <span className="min-w-0 flex-1">
                <span className="sa-body-sm sa-truncate block font-semibold">{p.name}</span>
                <span className="sa-caption sa-muted block">
                  {p.partner.name} · <span className="sa-num">{priceText(p)}</span>
                </span>
              </span>
            </button>
            <button type="button" className="sa-iconbtn" aria-label={`Tirar ${p.name} do pedido`} onClick={() => setDraft((d) => ({ chosen: d.chosen.filter((x) => x.id !== p.id) }))}>
              <X size={18} />
            </button>
          </li>
        ))}
      </ul>
      {count < max ? (
        <button type="button" className="sa-btn-quiet sa-body-sm mt-1 flex items-center gap-2" onClick={() => go("explorar")}>
          <Plus size={16} aria-hidden="true" /> Adicionar outra peça
        </button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ composer */

function PreferenceRow() {
  const { draft, setDraft, open } = useStore()
  const studio = useStudio()
  const prefs = studio.preferences
  const limits = studio.config.data?.budget
  if (prefs.isPending) return <Skeleton style={{ height: 64 }} />
  if (prefs.isError) return <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} compact />
  const active = studio.activePreference
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="sa-title-sm min-w-0 flex-1">
          Preferência de compra: {active?.name ?? "padrão do servidor"}
          {draft.sessionRules ? <span className="sa-badge sa-badge-quiet ml-2 align-middle">Ajustada nesta busca</span> : null}
        </p>
        <div className="flex gap-1">
          {prefs.data.items.length > 1 ? (
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => open({ kind: "preferencePicker" })}>
              Trocar
            </button>
          ) : null}
          {studio.rules ? (
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => open({ kind: "preferenceEditor" })} aria-label="Editar preferências desta busca (opções avançadas)">
              Editar
            </button>
          ) : null}
        </div>
      </div>
      {studio.rules && limits ? <CriterionQuick rules={studio.rules} limits={limits} context="esta busca" confirmation="Ajustado só nesta busca" onChange={(next) => setDraft({ sessionRules: next })} /> : null}
      {studio.rules ? (
        <p className="sa-caption sa-muted flex flex-wrap items-center gap-x-2">
          <span>Ajustes aqui valem só para esta busca e não alteram a preferência salva.</span>
          {draft.sessionRules ? (
            <button type="button" className="sa-link" data-inline-target="" onClick={() => setDraft({ sessionRules: null })}>
              Voltar ao salvo
            </button>
          ) : null}
        </p>
      ) : (
        <p className="sa-caption sa-muted">Sua conta ainda não tem preferências de compra; a busca usa as regras padrão.</p>
      )}
    </div>
  )
}

function CostRow({ onGenerate }: { onGenerate: () => void }) {
  const { open } = useStore()
  const studio = useStudio()
  const cost = studio.costOf("generate")
  const short = studio.shortBy("generate")
  const busy = studio.running || studio.starting
  const hintId = useId()
  const tokens = studio.balance.data?.tokens
  return (
    <div className="sa-cta-dock">
      <div className="flex items-center justify-between gap-3 sa-body-sm">
        <span className="flex items-center gap-2">
          <Coins size={18} aria-hidden="true" />
          Custo: <strong className="sa-num">{cost !== null ? plural(cost, "token", "tokens") : "—"}</strong>
        </span>
        <button type="button" className="sa-btn-quiet sa-num" onClick={() => open({ kind: "tokens" })}>
          {tokens !== undefined ? `Saldo ${tokens}` : "Ver saldo"}
        </button>
      </div>
      <button
        type="button"
        className="sa-btn sa-btn-primary sa-btn-block mt-3"
        aria-disabled={busy || short !== null || cost === null || undefined}
        aria-describedby={hintId}
        onClick={() => {
          if (!busy) onGenerate()
        }}
      >
        {studio.starting ? (
          <>
            <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> Enviando…
          </>
        ) : studio.running && studio.job.data?.kind === "generate" ? (
          <>
            <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> Gerando…
          </>
        ) : (
          <>Gerar look{cost !== null ? ` · ${plural(cost, "token", "tokens")}` : ""}</>
        )}
      </button>
      <p id={hintId} className="sa-caption sa-muted mt-2">
        {short !== null ? (
          <span className="sa-error-text">
            Saldo insuficiente: faltam {plural(short, "token", "tokens")}.{" "}
            <button type="button" className="sa-link" data-inline-target="" onClick={() => open({ kind: "tokens" })}>
              Ver saldo e planos
            </button>
          </span>
        ) : studio.config.isError ? (
          <span className="sa-error-text">Não foi possível carregar os custos do Estúdio. {messageOf(studio.config.error)}</span>
        ) : (
          "Tokens só são debitados quando o look fica pronto. Busca, Match e Closet não consomem tokens."
        )}
      </p>
    </div>
  )
}

function Composer() {
  const { draft, setDraft } = useStore()
  const studio = useStudio()
  const fieldId = useId()
  const counterId = useId()
  const [error, setError] = useState<string | null>(null)
  const max = studio.config.data?.maxPromptLength ?? 500
  const hasResult = draft.lookId !== null

  const submit = async (): Promise<void> => {
    if (!draft.prompt.trim() && draft.references.length === 0 && draft.chosen.length === 0) {
      setError("Descreva o look, escolha uma peça no Explorar ou adicione uma referência para começar.")
      document.getElementById(fieldId)?.focus()
      return
    }
    setError(null)
    const out = await studio.generate()
    if (!out.ok) setError(out.message)
  }

  return (
    <section aria-label="Compositor" className="sa-panel sa-composer sa-enter grid gap-5 p-4 md:p-5">
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor={fieldId} className="sa-title-sm">
            O que você quer vestir?
          </label>
          {hasResult ? (
            <button type="button" className="sa-btn-quiet sa-body-sm" onClick={() => setDraft({ composerOpen: false })}>
              Recolher
            </button>
          ) : null}
        </div>
        <textarea
          id={fieldId}
          name="prompt"
          autoComplete="off"
          className="sa-field mt-2"
          rows={3}
          maxLength={max}
          value={draft.prompt}
          aria-invalid={error ? true : undefined}
          aria-describedby={counterId}
          placeholder="Ocasião, sensação, peças que você já imagina…"
          onChange={(e) => {
            setDraft({ prompt: e.target.value.slice(0, max) })
            if (error) setError(null)
          }}
        />
        <div id={counterId} className="mt-1 flex justify-between gap-3 sa-caption sa-muted">
          <span className={error ? "sa-error-text" : ""} role={error ? "alert" : undefined}>
            {error ?? "Ex.: “jantar de inverno, até R$ 500” ou o nome de uma loja."}
          </span>
          <span className="sa-num flex-none">
            {draft.prompt.length}/{max}
          </span>
        </div>
      </div>

      <ChosenPieces />
      <ReferencePicker />

      <div className="sa-rule" />
      <PreferenceRow />

      <div className="sa-rule" />
      <CostRow onGenerate={() => void submit()} />
    </section>
  )
}

function ComposerSummary() {
  const { draft, setDraft } = useStore()
  const studio = useStudio()
  return (
    <section aria-label="Pedido atual" className="sa-summary sa-enter flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="sa-body-sm sa-pretty sa-clamp2">{draft.prompt.trim() || (draft.chosen.length > 0 ? "Pedido a partir das peças escolhidas" : draft.references.length > 0 ? "Pedido só com referências" : "Pedido vazio")}</p>
        <p className="sa-caption sa-muted mt-1">
          {draft.chosen.length > 0 ? `${plural(draft.chosen.length, "peça escolhida", "peças escolhidas")} · ` : ""}
          {plural(draft.references.length, "referência", "referências")}
          {studio.activePreference ? ` · ${studio.activePreference.name}` : ""}
          {draft.sessionRules ? " (ajustado)" : ""}
        </p>
      </div>
      <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm flex-none" onClick={() => setDraft({ composerOpen: true })} aria-expanded={false}>
        <PencilSimpleLine size={18} aria-hidden="true" /> Editar pedido
      </button>
    </section>
  )
}

/* ------------------------------------------------------------------ job states */

const KIND_LABEL: Record<Job["kind"], string> = { generate: "Gerando o look", edit: "Editando a imagem", tryon: "Montando a prova" }

function JobPanel() {
  const { setDraft, open, notify } = useStore()
  const studio = useStudio()
  const cancel = useCancelJob()
  const job = studio.job.data
  const clear = (): void => setDraft({ jobId: null })

  if (studio.job.isError && !job) {
    return <ErrorState error={studio.job.error} onRetry={() => void studio.job.refetch()} compact />
  }
  if (!job || job.status === "succeeded") return null

  if (job.status === "queued" || job.status === "running") {
    const pct = job.progress !== null ? Math.round(job.progress * 100) : null
    return (
      <section className="sa-panel p-4 md:p-5" aria-live="polite" aria-busy="true" aria-label="Progresso">
        <p className="sa-title-sm flex items-center gap-2">
          <CircleNotch size={18} className="sa-spin" aria-hidden="true" />
          {job.status === "queued" ? "Na fila" : KIND_LABEL[job.kind]}
        </p>
        <div className={`sa-progress mt-3 ${pct === null ? "sa-progress-indeterminate" : ""}`} role="progressbar" aria-label={KIND_LABEL[job.kind]} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
          <span style={{ width: pct !== null ? `${pct}%` : undefined }} />
        </div>
        <p className="sa-body-sm sa-muted mt-3">{job.step ?? (job.status === "queued" ? "Aguardando a vez no servidor." : "Processando…")}</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="sa-caption sa-muted">Você pode sair desta tela: avisamos quando ficar pronto.</p>
          <button
            type="button"
            className="sa-btn sa-btn-secondary sa-btn-sm flex-none"
            aria-disabled={cancel.isPending || undefined}
            onClick={() => {
              if (cancel.isPending) return
              cancel.mutate(job.id, { onError: (e) => notify(messageOf(e)) })
            }}
          >
            {cancel.isPending ? "Cancelando…" : "Cancelar"}
          </button>
        </div>
      </section>
    )
  }

  if (job.status === "cancelled") {
    return (
      <Notice tone="info">
        <p className="font-semibold">Pedido cancelado.</p>
        <p className="mt-1">{job.charged ? `Foram debitados ${plural(job.cost, "token", "tokens")}.` : "Nada foi cobrado."}</p>
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm mt-3" onClick={clear}>
          Fechar
        </button>
      </Notice>
    )
  }

  if (job.status === "failed") {
    const retry = (): void => {
      if (job.kind === "generate") void studio.generate().then((out) => !out.ok && notify(out.message))
      else open({ kind: job.kind === "edit" ? "edit" : "acervo" })
    }
    const insufficient = job.error?.code === "insufficient_tokens"
    return (
      <Notice tone="error">
        <p className="font-semibold">Não foi possível concluir.</p>
        <p className="mt-1">{job.error?.message ?? "O servidor não conseguiu terminar este pedido."}</p>
        <p className="mt-1">{job.charged ? `Foram debitados ${plural(job.cost, "token", "tokens")}.` : "Nada foi cobrado."}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {insufficient ? (
            <button type="button" className="sa-btn sa-btn-primary sa-btn-sm" onClick={() => open({ kind: "tokens" })}>
              Ver saldo e planos
            </button>
          ) : (
            <button type="button" className="sa-btn sa-btn-primary sa-btn-sm" onClick={retry}>
              Tentar novamente
            </button>
          )}
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={clear}>
            Fechar
          </button>
        </div>
      </Notice>
    )
  }

  // no_results: explain the limiting criteria; relax one at a time for this search only.
  const rules = studio.rules
  return (
    <section className="sa-panel p-4 md:p-5" aria-labelledby="empty-title">
      <h2 id="empty-title" className="sa-subheading">
        Nenhum look passou nas exigências
      </h2>
      <p className="sa-body-sm sa-muted mt-2 sa-pretty">
        {job.candidatesCount !== null ? `A busca encontrou ${plural(job.candidatesCount, "peça candidata", "peças candidatas")}, mas nenhuma combinação atendeu a todos os critérios. ` : "Nenhuma combinação atendeu a todos os critérios. "}
        {job.charged ? `Foram debitados ${plural(job.cost, "token", "tokens")}.` : "Nada foi debitado."} Relaxe um critério por vez; a preferência salva não muda.
      </p>
      {job.limiting.length > 0 ? (
        <ul className="sa-divided mt-4">
          {job.limiting.map((l) => {
            const relaxed = rules ? relaxRule(rules, l.id) : null
            return (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="sa-body-sm font-semibold">{l.label}</p>
                  <p className="sa-caption sa-muted mt-1">
                    {l.removed > 0 ? `Removeu ${l.removed} de ${l.total} peças` : "Atua sobre o look inteiro"}
                    {l.unlocks ? " · relaxar só este já traz resultado" : ""}
                  </p>
                </div>
                {relaxed ? (
                  <button
                    type="button"
                    className="sa-btn sa-btn-secondary sa-btn-sm"
                    onClick={() => {
                      setDraft({ sessionRules: relaxed, jobId: null, composerOpen: true })
                      notify(`${l.label}: relaxado só nesta busca`)
                    }}
                  >
                    Relaxar nesta busca
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => open({ kind: "preferencePicker" })}>
          Trocar preferência
        </button>
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={clear}>
          Fechar
        </button>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ result */

/** Versions of the same image: the chain of edits that share a root, from the session history. */
function useVersions(look: Look): Look[] {
  const history = useLooks(true)
  const all = [...(history.data ?? [])]
  if (!all.some((l) => l.id === look.id)) all.push(look)
  const byId = new Map(all.map((l) => [l.id, l]))
  const rootOf = (l: Look): string => {
    let cur = l
    const seen = new Set<string>()
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id)
      cur = byId.get(cur.parentId) ?? cur
    }
    return cur.id
  }
  const root = rootOf(look)
  return all.filter((l) => l.origin !== "tryon" && rootOf(l) === root).sort((a, b) => a.version - b.version)
}

function VersionStrip({ look }: { look: Look }) {
  const { setDraft } = useStore()
  const chain = useVersions(look)
  if (chain.length < 2) return null
  return (
    <div role="radiogroup" aria-label="Versões desta imagem" className="sa-segmented">
      {chain.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={l.id === look.id} onClick={() => setDraft({ lookId: l.id, acervoSelection: [] })}>
          v{l.version}
        </button>
      ))}
    </div>
  )
}

function ResultHero({ look }: { look: Look }) {
  const { open, overlay } = useStore()
  const canMatch = look.origin !== "tryon"
  const viewing = overlay?.kind === "viewer"
  return (
    <div>
      <div className="sa-photo sa-photo-lg sa-stage-photo relative">
        <button type="button" className="absolute inset-0 block h-full w-full" aria-label={`Ampliar imagem: ${look.title}`} onClick={() => open({ kind: "viewer", image: look.image, alt: look.title })}>
          <Photo key={look.id} image={look.image} alt="" className="sa-appear h-full w-full" eager sizes="(min-width: 1024px) 45vw, 100vw" />
        </button>
        <span className="sa-badge sa-badge-photo absolute" style={{ left: 10, top: 10 }}>
          {look.origin === "tryon" ? "Prova no corpo" : "Imagem gerada"} · v{look.version}
        </span>
        <button type="button" className="sa-iconbtn sa-photo-ctrl absolute" style={{ right: 10, bottom: 10 }} aria-label="Ampliar imagem" onClick={() => open({ kind: "viewer", image: look.image, alt: look.title })}>
          <CornersOut size={22} />
        </button>
      </div>
      {canMatch && !viewing ? (
        <div className="sa-matchcta-row">
          <button
            type="button"
            className="sa-matchcta"
            aria-label="Abrir Match: looks preparados para guardar ou passar"
            onClick={(e) => {
              e.stopPropagation()
              open({ kind: "match" })
            }}
          >
            <CoatHanger size={22} aria-hidden="true" />
            Match
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ResultDetails({ look }: { look: Look }) {
  const { open, notify, go } = useStore()
  const toggle = useToggleSavedLook()
  const pending = toggle.isPending && toggle.variables?.lookId === look.id
  const saved = pending ? (toggle.variables?.save ?? look.saved) : look.saved
  const total = sumLook({ ...look, pieces: look.pieces.filter((p) => p.role !== "similar") })

  const save = (): void => {
    if (saved) {
      go("closet")
      return
    }
    if (pending) return
    toggle.mutate({ lookId: look.id, save: true }, { onSuccess: () => notify("Look e peças guardados no Closet", { label: "Ver Closet", run: () => go("closet") }), onError: (e) => notify(messageOf(e)) })
  }

  return (
    <div className="grid gap-5">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="sa-heading min-w-0 flex-1" tabIndex={-1} id="result-title">
            {look.title}
          </h2>
          <VersionStrip look={look} />
        </div>
        {look.note ? <p className="sa-body-sm sa-muted mt-2 sa-pretty">{look.note}</p> : null}
        <p className="sa-caption sa-muted mt-2">
          {ORIGIN_LABEL[look.origin]}
          {total ? (
            <>
              {" "}
              · peças do look somam <span className="sa-num">{total}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="sa-btn sa-btn-primary flex-1" onClick={save} style={{ minWidth: 150 }} aria-disabled={pending || undefined}>
          <Archive size={18} aria-hidden="true" />
          {pending ? "Guardando…" : saved ? "Ver no Closet" : "Guardar look"}
        </button>
        {look.origin !== "tryon" ? (
          <button type="button" className="sa-btn sa-btn-secondary flex-1" onClick={() => open({ kind: "edit" })} style={{ minWidth: 150 }}>
            <PencilSimpleLine size={18} aria-hidden="true" /> Editar imagem
          </button>
        ) : null}
      </div>
      {look.candidatesCount > 0 ? (
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-block justify-between" onClick={() => open({ kind: "acervo" })}>
          <span className="flex items-center gap-2">
            <SquaresFour size={18} aria-hidden="true" />
            Acervo da busca
          </span>
          <span className="sa-caption sa-muted">{plural(look.candidatesCount, "peça", "peças")}</span>
        </button>
      ) : null}
    </div>
  )
}

function PiecesGrid({ look }: { look: Look }) {
  if (look.pieces.length === 0) return null
  return (
    <section aria-labelledby="pieces-title">
      <div className="flex items-baseline justify-between">
        <h2 id="pieces-title" className="sa-subheading">
          Peças deste look
        </h2>
        <span className="sa-caption sa-muted">{plural(look.pieces.length, "peça", "peças")}</span>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-6 md:grid-cols-3">
        {look.pieces.map((p) => (
          <PieceCard key={p.product.id} product={p.product} role={look.origin === "tryon" ? undefined : p.role} warnings={p.warnings} />
        ))}
      </ul>
      <p className="sa-caption sa-muted mt-5">“Peça do look” é a correspondente encontrada no catálogo para esta imagem, não garantia de que seja idêntica. Tocar e segurar também abre o detalhe.</p>
    </section>
  )
}

/** Wide screens: the look's pieces sit next to the image they belong to. */
function ResultPiecesStrip({ look }: { look: Look }) {
  const { open } = useStore()
  if (look.pieces.length === 0) return null
  return (
    <aside className="sa-stage-side sa-only-xl" aria-labelledby="strip-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="strip-title" className="sa-title-sm">
          Peças deste look
        </h2>
        <span className="sa-caption sa-muted">{look.pieces.length}</span>
      </div>
      <ul className="mt-3 grid gap-2">
        {look.pieces.map(({ product: p, role, warnings }) => (
          <li key={p.id} className="sa-striprow">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => open({ kind: "product", productId: p.id })} aria-label={`${p.name}, ${priceText(p)}, ${p.partner.name}. Ver detalhes`}>
              <span className="sa-photo sa-thumb flex-none" style={{ width: 52, height: 66 }}>
                <Photo image={p.images[0] ?? null} alt="" className="h-full w-full" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="sa-caption block font-semibold" style={{ color: "var(--text1)" }}>
                  {p.name}
                </span>
                <span className="sa-caption sa-muted block">
                  <span className="sa-num">{priceText(p)}</span> · {p.partner.name}
                </span>
                {look.origin !== "tryon" ? <span className="sa-caption sa-accent-text block">{ROLE_LABEL[role]}</span> : null}
                {warnings[0] ? <span className="sa-caption sa-warning-text block">{warnings[0]}</span> : null}
              </span>
            </button>
            <FavButton product={p} />
          </li>
        ))}
      </ul>
    </aside>
  )
}

/** Recent looks of this account (GET /studio/looks), newest first. */
function RecentLooks({ variant }: { variant: "strip" | "grid" }) {
  const { draft, setDraft } = useStore()
  const looks = useLooks(true)
  const items = looks.data ?? []
  if (variant === "strip") {
    if (items.length < 2) return null
    return (
      <section className="mt-4" aria-labelledby="history-title">
        <h2 id="history-title" className="sa-caption sa-muted">
          Recentes
        </h2>
        <ul className="mt-2 flex flex-wrap gap-2">
          {items.slice(0, 8).map((l) => (
            <li key={l.id}>
              <button type="button" className="sa-historybtn" aria-pressed={l.id === draft.lookId} aria-label={`Retomar ${l.title}, versão ${l.version}`} onClick={() => setDraft({ lookId: l.id, acervoSelection: [] })}>
                <Photo image={l.image} alt="" className="h-full w-full" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    )
  }
  if (looks.isPending || items.length === 0) return null
  return (
    <section aria-labelledby="recent-title">
      <h2 id="recent-title" className="sa-subheading">
        Seus looks recentes
      </h2>
      <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 md:grid-cols-4">
        {items.slice(0, 8).map((l) => (
          <li key={l.id} className="min-w-0">
            <button type="button" className="sa-cardbtn block w-full text-left" onClick={() => setDraft({ lookId: l.id, composerOpen: false, acervoSelection: [] })}>
              <span className="sa-photo sa-card-photo relative block" style={{ aspectRatio: "4 / 5" }}>
                <Photo image={l.image} alt="" className="h-full w-full" />
              </span>
              <span className="sa-title-sm mt-2 block">{l.title}</span>
              <span className="sa-caption sa-muted mt-1 block">{ORIGIN_LABEL[l.origin]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Before the first result: an honest empty stage (no example images are shown as results). */
function EmptyStage() {
  return (
    <div className="sa-stage">
      <div className="sa-stage-main">
        <div className="sa-photo sa-photo-lg sa-stage-photo sa-stage-blank">
          <EmptyState title="Seu look aparece aqui">Descreva a ocasião ao lado ou parta de uma peça do Explorar. A imagem e as peças chegam quando o Estúdio terminar.</EmptyState>
        </div>
      </div>
    </div>
  )
}

export function StudioScreen() {
  const { draft } = useStore()
  const studio = useStudio()
  const reduced = useReducedMotion()
  const look = studio.look.data ?? null
  const showComposer = draft.composerOpen || !draft.lookId
  const stageRef = useRef<HTMLDivElement | null>(null)
  const lastShown = useRef<string | null>(null)

  // A new look moves focus to its title; the page scrolls only when the image is out of view.
  useEffect(() => {
    const id = look?.id
    if (!id || id === lastShown.current) return
    lastShown.current = id
    const el = stageRef.current
    if (!el || el.offsetParent === null) return
    const header = window.innerWidth < 1024 ? 64 : 80
    const r = el.getBoundingClientRect()
    const inView = r.top >= header - 4 && r.top < window.innerHeight * 0.45
    if (!inView) window.scrollTo({ top: Math.max(0, r.top + window.scrollY - header - 8), behavior: reduced ? "auto" : "smooth" })
    document.getElementById("result-title")?.focus({ preventScroll: true })
  }, [look?.id, reduced])

  return (
    <div className="sa-page sa-page-studio">
      <header className="sa-studio-head">
        <h1 className="sa-display">Estúdio</h1>
        <p className="sa-body-sm sa-muted mt-2 sa-pretty">Descreva a ocasião ou parta de uma peça do Explorar. O Estúdio monta um look com peças de parceiros, e você compra na loja.</p>
      </header>

      <div className={`sa-studio ${draft.lookId ? "sa-studio-result" : "sa-studio-empty"}`}>
        <div ref={stageRef} className="sa-studio-stage">
          {draft.lookId ? (
            look ? (
              <div className="sa-stage">
                <div className="sa-stage-main">
                  <ResultHero look={look} />
                  <RecentLooks variant="strip" />
                </div>
                <ResultPiecesStrip look={look} />
              </div>
            ) : studio.look.isError ? (
              <ErrorState error={studio.look.error} onRetry={() => void studio.look.refetch()} />
            ) : (
              <Skeleton className="sa-stage-photo" style={{ borderRadius: "var(--r-card)" }} />
            )
          ) : (
            <div className="sa-only-lg">
              <EmptyStage />
            </div>
          )}
        </div>
        <div className="sa-studio-controls grid content-start gap-6">
          {showComposer ? <Composer /> : <ComposerSummary />}
          <JobPanel />
          {look ? (
            <>
              <ResultDetails look={look} />
              <div className="sa-hide-xl">
                <PiecesGrid look={look} />
              </div>
            </>
          ) : !draft.lookId ? (
            <RecentLooks variant="grid" />
          ) : null}
        </div>
      </div>
    </div>
  )
}
