/**
 * Estúdio: compose a request (text, catalog pieces from Explorar, reference images, preference),
 * start a job on the API and follow it until the look arrives. Costs, balance, progress, results,
 * versions and history all come from the server (useStudio, api/queries.ts).
 */
import { useEffect, useId, useRef, useState } from "react"
import type { ChangeEvent } from "react"
import { useMutation } from "@tanstack/react-query"
import { Archive, ArrowsClockwise, CaretDown, CaretLeft, CaretRight, Check, CircleNotch, CoatHanger, Coins, Compass, CornersOut, Info, MagnifyingGlass, PencilSimpleLine, Plus, SquaresFour, TShirt, Trash, X } from "@phosphor-icons/react"
import { api } from "../api/client"
import { messageOf } from "../api/errors"
import { useCancelJob, useCandidates, useLooks, useToggleSavedLook } from "../api/queries"
import type { Job, Look, Product, UploadedImage } from "../api/types"
import { showLookPatch, useStore, type StudioMode } from "../app/store"
import { CardSwap, useCardDrag, useLookDeck, type SwapDir } from "../components/LookDeck"
import { useStudio } from "../app/useStudio"
import { plural } from "../lib/format"
import { checkImageFile } from "../lib/images"
import { relaxRule } from "../lib/rules"
import { FavButton, PieceCard, priceText, ROLE_LABEL } from "../components/pieces"
import { CriterionQuick } from "../components/CriterionQuick"
import { EmptyState, ErrorState, Notice, Photo, Skeleton, useReducedMotion } from "../components/ui"
import { ORIGIN_LABEL } from "../lib/looks"
import { sumLookWith, withOffer } from "../lib/offers"
import { OfferPrice, StoreTags } from "../components/offers"

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
          Fotos do seu celular
        </p>
        <span className="sa-caption sa-muted sa-num" aria-live="polite">
          {count} de {max}
        </span>
      </div>
      <p className="sa-caption sa-muted mt-1">Roupas ou acessórios que você quer vestir. Não são fotos do seu corpo; essas ficam no Perfil.</p>
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
  const { draft, setDraft, go, open, offerChoice } = useStore()
  const studio = useStudio()
  const headId = useId()
  const max = studio.config.data?.maxChosenPieces ?? 0
  const count = draft.chosen.length
  const dressing = draft.mode === "vestir"
  if (count === 0) {
    if (dressing) {
      return (
        <div>
          <p className="sa-title-sm">Peças das lojas</p>
          <p className="sa-caption sa-muted mt-1">Escolha no Explorar ou no Acervo da última busca. Elas são vestidas como estão, com a loja e o link escolhidos.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => go("explorar")}>
              <Compass size={18} aria-hidden="true" /> Escolher no Explorar
            </button>
            {draft.acervoLookId ? (
              <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => open({ kind: "acervo" })}>
                <SquaresFour size={18} aria-hidden="true" /> Abrir Acervo
              </button>
            ) : null}
          </div>
        </div>
      )
    }
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
          {dressing ? "Peças para vestir" : "Peças base do look"}
        </p>
        {max > 0 ? (
          <span className="sa-caption sa-muted sa-num">
            {count} de {max}
          </span>
        ) : null}
      </div>
      <p className="sa-caption sa-muted mt-1">{dressing ? "Vestidas como estão, com a loja e o link escolhidos." : "A busca completa o look em volta delas, com a loja e o link escolhidos."}</p>
      <ul className="mt-3 grid gap-2">
        {draft.chosen.map((base) => {
          const p = withOffer(base, offerChoice[base.id])
          return (
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
          )
        })}
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
  // Brief 2026-11-12: no preset names and no "Trocar" here; the criteria themselves are shown and edited.
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="sa-title-sm min-w-0 flex-1">
          Preferências de compra
          {draft.sessionRules ? <span className="sa-badge sa-badge-quiet ml-2 align-middle">Ajustadas nesta busca</span> : null}
        </p>
        <div className="flex gap-1">
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

const ACTION_LABEL: Record<StudioMode, string> = { procurar: "Procurar e vestir", vestir: "Vestir peças" }

function CostRow({ onGenerate }: { onGenerate: () => void }) {
  const { open, draft } = useStore()
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
          <>
            {ACTION_LABEL[draft.mode]}
            {cost !== null ? ` · ${plural(cost, "token", "tokens")}` : ""}
          </>
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

/** Vestir / Procurar. The draft (pieces, photos, Acervo) is kept when switching. */
function ModeSwitch() {
  const { draft, setDraft } = useStore()
  const options: { id: StudioMode; label: string; Icon: typeof TShirt }[] = [
    { id: "procurar", label: "Procurar", Icon: MagnifyingGlass },
    { id: "vestir", label: "Vestir", Icon: TShirt },
  ]
  return (
    <div className="grid gap-2">
      <div role="radiogroup" aria-label="Modo do Estúdio" className="sa-segmented sa-segmented-block sa-modeswitch">
        {options.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={draft.mode === id}
            tabIndex={draft.mode === id ? 0 : -1}
            onClick={() => setDraft({ mode: id })}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
              e.preventDefault()
              setDraft({ mode: draft.mode === "procurar" ? "vestir" : "procurar" })
              const group = e.currentTarget.parentElement
              window.requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>("[aria-checked=true]")?.focus())
            }}
          >
            <Icon size={18} aria-hidden="true" weight={draft.mode === id ? "bold" : "regular"} />
            {label}
          </button>
        ))}
      </div>
      <p className="sa-caption sa-muted sa-pretty">
        {draft.mode === "procurar" ? "Diga o que procura: buscamos nas lojas parceiras e mostramos você vestindo o resultado." : "Escolha peças nossas ou fotos do seu celular e veja você vestindo exatamente isso, sem busca."}
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
  const dressing = draft.mode === "vestir"
  useEffect(() => setError(null), [draft.mode])

  const submit = async (): Promise<void> => {
    if (dressing && draft.references.length === 0 && draft.chosen.length === 0) {
      setError("Escolha uma peça no Explorar ou no Acervo, ou adicione uma foto, para vestir.")
      return
    }
    if (!dressing && !draft.prompt.trim() && draft.chosen.length === 0) {
      setError("Diga o que você procura, por exemplo a ocasião ou a estação.")
      document.getElementById(fieldId)?.focus()
      return
    }
    setError(null)
    const out = await studio.generate()
    if (!out.ok) setError(out.message)
  }

  const prompt = (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor={fieldId} className="sa-title-sm">
          {dressing ? "Algum ajuste? (opcional)" : "O que você quer vestir?"}
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
        rows={dressing ? 2 : 3}
        maxLength={max}
        value={draft.prompt}
        aria-invalid={error && !dressing ? true : undefined}
        aria-describedby={counterId}
        placeholder={dressing ? "Camisa por dentro da calça, mangas dobradas" : "Me vista com roupas de verão"}
        onChange={(e) => {
          setDraft({ prompt: e.target.value.slice(0, max) })
          if (error) setError(null)
        }}
      />
      <div id={counterId} className="mt-1 flex justify-between gap-3 sa-caption sa-muted">
        <span>{dressing ? "Ex.: “barra da calça dobrada”" : "Ex.: “moda italiana para o inverno”"}</span>
        <span className="sa-num flex-none">
          {draft.prompt.length}/{max}
        </span>
      </div>
    </div>
  )

  return (
    <section aria-label={dressing ? "Vestir" : "Procurar"} className="sa-panel sa-composer sa-enter grid gap-5 p-4 md:p-5">
      {dressing ? (
        <>
          <ChosenPieces />
          <ReferencePicker />
          {prompt}
        </>
      ) : (
        <>
          {prompt}
          <ChosenPieces />
          <div className="sa-rule" />
          <PreferenceRow />
        </>
      )}
      {error ? (
        <p className="sa-caption sa-error-text" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sa-rule" />
      <CostRow onGenerate={() => void submit()} />
    </section>
  )
}

function ComposerSummary() {
  const { draft, setDraft } = useStore()
  const dressing = draft.mode === "vestir"
  // A fresh request: the result, the mode and the Acervo stay; what was asked is cleared.
  const startNew = (): void => {
    setDraft({ prompt: "", chosen: [], references: [], sessionRules: null, composerOpen: true })
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".sa-composer textarea")?.focus())
  }
  return (
    <section aria-label="Pedido atual" className="sa-summary sa-enter flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="sa-body-sm sa-pretty sa-clamp2">{draft.prompt.trim() || (draft.chosen.length > 0 ? "Pedido a partir das peças escolhidas" : draft.references.length > 0 ? "Pedido só com fotos" : "Pedido vazio")}</p>
        <p className="sa-caption sa-muted mt-1">
          {dressing ? "Vestir" : "Procurar"}
          {draft.chosen.length > 0 ? ` · ${plural(draft.chosen.length, "peça", "peças")}` : ""}
          {dressing ? ` · ${plural(draft.references.length, "foto", "fotos")}` : ""}
          {!dressing && draft.sessionRules ? " · preferências ajustadas" : ""}
        </p>
      </div>
      <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm flex-none" onClick={startNew}>
        <Plus size={18} aria-hidden="true" /> Novo pedido
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
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => open({ kind: "preferenceEditor" })}>
          Editar preferências
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
        <button key={l.id} type="button" role="radio" aria-checked={l.id === look.id} onClick={() => setDraft({ lookId: l.id })}>
          v{l.version}
        </button>
      ))}
    </div>
  )
}

/** Look ids this arrow/swipe navigation selected: the screen must not move focus or scroll for them. */
const browsedIds = new Set<string>()

/**
 * Pages through the deck (generated looks, then the search's other prepared looks). A generated
 * look becomes the current one; a suggestion is only previewed on the photo.
 */
function useStageDeck(look: Look) {
  const { setDraft } = useStore()
  const cards = useLookDeck(look)
  const [viewKey, setViewKey] = useState<string | null>(null)
  const [dir, setDir] = useState<SwapDir>("next")
  // A new or picked look (not by browsing) brings the photo back to it.
  useEffect(() => setViewKey(null), [look.id])
  const ownIndex = Math.max(0, cards.findIndex((c) => c.key === look.id))
  const viewIndex = viewKey ? cards.findIndex((c) => c.key === viewKey) : -1
  const index = viewIndex >= 0 ? viewIndex : ownIndex
  const card = cards[index] ?? null
  const goTo = (i: number): void => {
    const c = cards[i]
    if (!c) return
    setDir(i > index ? "next" : "prev")
    if (c.kind === "result") {
      browsedIds.add(c.look.id)
      setDraft({ lookId: c.look.id })
      setViewKey(null)
    } else setViewKey(c.key)
  }
  return {
    card,
    dir,
    count: cards.length,
    index,
    hasPrev: index > 0,
    hasNext: index < cards.length - 1,
    neighbor: (d: SwapDir) => cards[d === "next" ? index + 1 : index - 1] ?? null,
    prev: () => index > 0 && goTo(index - 1),
    next: () => index < cards.length - 1 && goTo(index + 1),
  }
}

function ResultHero({ look }: { look: Look }) {
  const { open, overlay } = useStore()
  const deck = useStageDeck(look)
  const drag = useCardDrag({ canPrev: deck.hasPrev, canNext: deck.hasNext, onPrev: deck.prev, onNext: deck.next })
  // After a card thrown by hand lands, later swaps animate normally again.
  useEffect(() => drag.settle(), [deck.card?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const neighbour = drag.peek ? deck.neighbor(drag.peek) : null
  const shown = deck.card?.look ?? look
  const isSuggestion = deck.card?.kind === "suggestion"
  // Try-on images have no prepared looks to compare, so Match is not offered for them.
  const canMatch = look.origin !== "tryon"
  const viewing = overlay?.kind === "viewer" || overlay?.kind === "lookViewer"
  // Tapping the photo hides the title and Match so the whole look can be seen; tapping again brings them back.
  const [matchHidden, setMatchHidden] = useState(false)
  useEffect(() => setMatchHidden(false), [look.id])
  const showMatch = canMatch && !viewing && !matchHidden
  const viewerOpen = (): void => open({ kind: "lookViewer", lookId: shown.id })
  return (
    <div className="sa-photo sa-photo-lg sa-stage-photo relative" data-match={canMatch ? "" : undefined} data-browse={deck.count > 1 ? "" : undefined} {...drag.handlers}>
      <CardSwap
        cardKey={shown.id}
        dir={deck.dir}
        instant={drag.flung}
        topRef={drag.topRef}
        under={neighbour ? <Photo image={neighbour.look.image} alt="" className="h-full w-full" /> : null}
        className="absolute inset-0"
      >
        <Photo image={shown.image} alt="" className="h-full w-full" eager sizes="(min-width: 1024px) 45vw, 100vw" />
      </CardSwap>
      {canMatch ? (
        <button type="button" className="sa-photo-tap absolute inset-0 block h-full w-full" aria-pressed={matchHidden} aria-label={`${shown.title}: ocultar título e Match`} onClick={() => !drag.dragged() && setMatchHidden((h) => !h)} />
      ) : (
        <button type="button" className="absolute inset-0 block h-full w-full" aria-label={`Abrir look: ${shown.title}`} onClick={() => !drag.dragged() && viewerOpen()} />
      )}
      <span className="sa-badge sa-badge-photo absolute" style={{ left: 10, top: 10 }}>
        {isSuggestion ? "Sugestão da busca" : `${look.origin === "tryon" ? "Prova no corpo" : "Imagem gerada"} · v${look.version}`}
      </span>
      <button type="button" className="sa-iconbtn sa-photo-ctrl absolute" style={{ right: 10, top: 10 }} aria-label="Ampliar imagem" onClick={viewerOpen}>
        <CornersOut size={22} />
      </button>
      {deck.count > 1 ? (
        <>
          <button type="button" className="sa-stagenav" data-side="prev" aria-label={`Look anterior (${deck.index + 1} de ${deck.count})`} aria-disabled={!deck.hasPrev || undefined} onClick={deck.prev}>
            <CaretLeft size={16} weight="bold" aria-hidden="true" />
          </button>
          <button type="button" className="sa-stagenav" data-side="next" aria-label={`Próximo look (${deck.index + 1} de ${deck.count})`} aria-disabled={!deck.hasNext || undefined} onClick={deck.next}>
            <CaretRight size={16} weight="bold" aria-hidden="true" />
          </button>
          <span className="sa-badge sa-badge-photo sa-stagecount sa-num" aria-hidden="true">
            {deck.index + 1} de {deck.count}
          </span>
        </>
      ) : null}
      {/* The title lives on the image; the rest of the description opens with the look. */}
      <div className="sa-phototitle" data-hidden={matchHidden || viewing ? "" : undefined}>
        <h2 id="result-title" tabIndex={-1} className="sa-phototitle-text sa-clamp2" aria-live="polite">
          <span key={shown.id} className="sa-appear inline-block">
            {shown.title}
          </span>
        </h2>
      </div>
      {canMatch && !viewing ? (
        <div className="sa-matchcta-row" data-hidden={showMatch ? undefined : ""}>
          <button
            type="button"
            className="sa-matchcta"
            aria-label="Abrir Match: looks preparados para guardar ou passar"
            tabIndex={showMatch ? undefined : -1}
            aria-hidden={showMatch ? undefined : true}
            onClick={(e) => {
              // Only Match opens: never the photo toggle behind it.
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
  const { open, notify, go, offerChoice, draft } = useStore()
  const toggle = useToggleSavedLook()
  const pending = toggle.isPending && toggle.variables?.lookId === look.id
  const saved = pending ? (toggle.variables?.save ?? look.saved) : look.saved
  const total = sumLookWith({ ...look, pieces: look.pieces.filter((p) => p.role !== "similar") }, offerChoice)

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
      <div className="flex flex-wrap items-center gap-3">
        <p className="sa-caption sa-muted min-w-0 flex-1">
          {ORIGIN_LABEL[look.origin]}
          {total ? (
            <>
              {" "}
              · peças do look somam <span className="sa-num">{total}</span>
            </>
          ) : null}
        </p>
        {look.note ? (
          <button type="button" className="sa-btn-quiet sa-body-sm font-semibold" onClick={() => open({ kind: "lookViewer", lookId: look.id })}>
            Ler descrição
          </button>
        ) : null}
        <VersionStrip look={look} />
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
      {/* The Acervo is the last search's pool and stays available in both modes and after try-ons. */}
      {draft.acervoLookId ? (
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-block justify-between" onClick={() => open({ kind: "acervo" })}>
          <span className="flex items-center gap-2">
            <SquaresFour size={18} aria-hidden="true" />
            Acervo da busca
          </span>
          <span className="sa-caption sa-muted">{draft.acervoSelection.length > 0 ? `${plural(draft.acervoSelection.length, "selecionada", "selecionadas")} · vestir` : "Escolher peças para vestir"}</span>
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
  const { open, offerChoice } = useStore()
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
        {look.pieces.map(({ product: p, role, warnings }) => {
          const shown = withOffer(p, offerChoice[p.id])
          return (
            <li key={p.id} className="sa-striprow">
              <div className="flex items-center gap-1">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => open({ kind: "product", productId: p.id })} aria-label={`${p.name}, ${priceText(shown)}, ${shown.partner.name}. Ver detalhes`}>
                  <span className="sa-photo sa-thumb flex-none" style={{ width: 52, height: 66 }}>
                    <Photo image={p.images[0] ?? null} alt="" className="h-full w-full" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sa-caption block font-semibold" style={{ color: "var(--text1)" }}>
                      {p.name}
                    </span>
                    {look.origin !== "tryon" ? <span className="sa-caption sa-accent-text block">{ROLE_LABEL[role]}</span> : null}
                    {warnings[0] ? <span className="sa-caption sa-warning-text block">{warnings[0]}</span> : null}
                  </span>
                </button>
                <FavButton product={p} />
              </div>
              <div className="sa-striprow-offers">
                <OfferPrice product={p} />
                <StoreTags product={p} className="mt-1" />
              </div>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

/* ------------------------------------------------------------------ search catalog */

const CATALOG_PAGE_SIZE = 6

/**
 * Everything the search agent returned for this look (GET /studio/looks/{id}/candidates), one
 * tile per product: the same piece in several stores arrives as one Product with offers and shows
 * store tags. Collapsible (loads on first open) and paged; up to `maxChosenPieces` products become
 * the base of the next generation (draft.chosen, shared with Explorar's "Levar ao Estúdio").
 */
function SearchCatalogPanel({ look }: { look: Look }) {
  const { draft, setDraft, open } = useStore()
  const studio = useStudio()
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const bodyId = useId()
  const titleId = useId()
  const candidates = useCandidates(expanded ? look.id : null)
  useEffect(() => setPage(0), [look.id])

  // One tile per product id, look pieces first.
  const items: { product: Product; usedInLook: boolean; failed: string[] }[] = []
  for (const c of [...(candidates.data ?? [])].sort((a, b) => Number(b.usedInLook) - Number(a.usedInLook))) {
    if (!items.some((x) => x.product.id === c.product.id)) items.push(c)
  }
  const pages = Math.max(1, Math.ceil(items.length / CATALOG_PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const visible = items.slice(current * CATALOG_PAGE_SIZE, current * CATALOG_PAGE_SIZE + CATALOG_PAGE_SIZE)
  const max = studio.config.data?.maxChosenPieces ?? 0
  const selection = draft.chosen
  const full = selection.length >= max
  const cost = studio.costOf("generate")
  const short = studio.shortBy("generate")
  const busy = studio.running || studio.starting
  const total = candidates.data ? items.length : look.candidatesCount

  const toggle = (product: Product): void => {
    setError(null)
    if (selection.some((p) => p.id === product.id)) setDraft((d) => ({ chosen: d.chosen.filter((p) => p.id !== product.id) }))
    else if (!full) setDraft((d) => ({ chosen: [...d.chosen, product] }))
  }
  // Picking pieces from the search to wear them is the Vestir mode.
  const generate = async (): Promise<void> => {
    if (selection.length === 0 || busy || short !== null) return
    setDraft({ mode: "vestir" })
    const out = await studio.generate("vestir")
    setError(out.ok ? null : out.message)
  }

  return (
    <section className="sa-searchcat" aria-labelledby={titleId}>
      <h2 id={titleId} className="m-0">
        <button type="button" className="sa-searchcat-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded((v) => !v)}>
          <SquaresFour size={20} aria-hidden="true" className="flex-none" />
          <span className="min-w-0 flex-1 text-left">
            <span className="sa-title-sm block">Catálogo da busca</span>
            <span className="sa-caption sa-muted sa-num block">
              {plural(total, "produto", "produtos")}
              {max > 0 ? ` · ${selection.length} de ${max} na base` : ""}
            </span>
          </span>
          <CaretDown size={20} aria-hidden="true" className="sa-caret flex-none" />
        </button>
      </h2>
      <div id={bodyId} hidden={!expanded} className="sa-searchcat-body">
        {candidates.isError ? (
          <ErrorState error={candidates.error} onRetry={() => void candidates.refetch()} />
        ) : candidates.isPending ? (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-2" aria-busy="true">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} aria-hidden="true">
                <Skeleton className="w-full" style={{ aspectRatio: "3 / 4", borderRadius: "var(--r-card)" }} />
                <Skeleton className="mt-2" style={{ height: 14, width: "80%" }} />
              </li>
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="sa-body-sm sa-muted">A busca não trouxe outras peças para este look.</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-2">
              {visible.map(({ product: p, usedInLook, failed }) => {
                const selected = selection.some((x) => x.id === p.id)
                const blocked = !selected && full
                return (
                  <li key={p.id} className="relative min-w-0">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      aria-disabled={blocked || undefined}
                      aria-label={`Usar ${p.name} como base${blocked ? `: limite de ${max} peças atingido` : ""}`}
                      className="sa-cardbtn sa-pick block w-full text-left"
                      onClick={() => toggle(p)}
                    >
                      <span className="sa-photo relative block" style={{ aspectRatio: "3 / 4" }}>
                        <Photo image={p.images[0] ?? null} alt="" className="absolute inset-0 h-full w-full" sizes="(min-width: 1024px) 15vw, 45vw" />
                        <span className="sa-pick-mark absolute" aria-hidden="true">
                          {selected ? <Check size={16} weight="bold" /> : null}
                        </span>
                      </span>
                      <span className="sa-title-sm sa-clamp2 block pt-2">{p.name}</span>
                    </button>
                    <button type="button" className="sa-iconbtn sa-photo-ctrl absolute" style={{ top: 6, right: 6 }} aria-label={`Detalhes de ${p.name}`} onClick={() => open({ kind: "product", productId: p.id })}>
                      <Info size={18} />
                    </button>
                    <OfferPrice product={p} />
                    <StoreTags product={p} className="mt-2" />
                    <p className={`sa-caption mt-2 ${failed.length ? "sa-warning-text" : "sa-muted"}`}>{failed.length ? `Fora das preferências: ${failed[0]}` : usedInLook ? "No look atual" : "Não usada no look"}</p>
                  </li>
                )
              })}
            </ul>
            {pages > 1 ? (
              <nav className="sa-pager" aria-label="Páginas do catálogo">
                <button type="button" className="sa-iconbtn" aria-label="Página anterior" aria-disabled={current === 0 || undefined} onClick={() => current > 0 && setPage(current - 1)}>
                  <CaretLeft size={20} />
                </button>
                <ol className="sa-pager-list">
                  {Array.from({ length: pages }, (_, i) => (
                    <li key={i}>
                      <button type="button" className="sa-pager-num sa-num" aria-current={i === current ? "page" : undefined} aria-label={`Página ${i + 1}`} onClick={() => setPage(i)}>
                        {i + 1}
                      </button>
                    </li>
                  ))}
                </ol>
                <button type="button" className="sa-iconbtn" aria-label="Próxima página" aria-disabled={current >= pages - 1 || undefined} onClick={() => current < pages - 1 && setPage(current + 1)}>
                  <CaretRight size={20} />
                </button>
              </nav>
            ) : null}
            <p className="sa-sr" aria-live="polite">
              Página {current + 1} de {pages}
            </p>
          </>
        )}

        <div className="sa-searchcat-foot">
          <div className="flex items-center justify-between gap-3 sa-body-sm">
            <span aria-live="polite" className="sa-num">
              {selection.length} de {max} na base{full ? " · limite atingido" : ""}
            </span>
            <button type="button" className="sa-btn-quiet" aria-disabled={selection.length === 0 || undefined} onClick={() => selection.length && setDraft({ chosen: [] })}>
              Limpar
            </button>
          </div>
          <button type="button" className="sa-btn sa-btn-primary sa-btn-block mt-2" aria-disabled={selection.length === 0 || busy || short !== null || cost === null || undefined} onClick={() => void generate()}>
            {studio.starting ? (
              <>
                <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> Enviando…
              </>
            ) : studio.running && studio.job.data?.kind === "generate" ? (
              <>
                <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> Gerando…
              </>
            ) : (
              <>
                Vestir {plural(selection.length, "peça", "peças")}
                {cost !== null ? ` · ${plural(cost, "token", "tokens")}` : ""}
              </>
            )}
          </button>
          {short !== null ? <p className="sa-caption sa-error-text mt-2">Sem saldo para gerar com estas peças: faltam {plural(short, "token", "tokens")}.</p> : null}
          {error ? (
            <p className="sa-caption sa-error-text mt-2" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </section>
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
              <button type="button" className="sa-historybtn" aria-pressed={l.id === draft.lookId} aria-label={`Retomar ${l.title}, versão ${l.version}`} onClick={() => setDraft({ lookId: l.id })}>
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
            <button type="button" className="sa-cardbtn block w-full text-left" onClick={() => setDraft({ lookId: l.id, composerOpen: false })}>
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
  const { draft, setDraft } = useStore()
  const studio = useStudio()
  const reduced = useReducedMotion()
  const look = studio.look.data ?? null
  const showComposer = draft.composerOpen || !draft.lookId
  const stageRef = useRef<HTMLDivElement | null>(null)
  const lastShown = useRef<string | null>(null)

  // A search result on screen becomes the Acervo; edits, try-ons and Vestir results keep the last one.
  useEffect(() => {
    if (look) setDraft((d) => (d.lookId === look.id ? showLookPatch(d, look) : {}))
  }, [look, setDraft])

  // A new look moves focus to its title; the page scrolls only when the image is out of view.
  useEffect(() => {
    const id = look?.id
    if (!id || id === lastShown.current) return
    lastShown.current = id
    // Browsing with the arrows or a swipe keeps the person where they are.
    if (browsedIds.delete(id)) return
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
        <p className="sa-body-sm sa-muted mt-2 sa-pretty">Procure um look pelo que você imagina ou vista peças que já escolheu. Tudo vem de lojas parceiras, e a compra acontece na loja.</p>
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
          <ModeSwitch />
          {showComposer ? <Composer /> : <ComposerSummary />}
          <JobPanel />
          {look ? (
            <>
              <ResultDetails look={look} />
              {look.candidatesCount > 0 ? <SearchCatalogPanel look={look} /> : null}
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
