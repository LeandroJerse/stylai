/**
 * Estúdio sheets: edit the current image, the search pool ("acervo") with try-on, the preference
 * picker and the balance/plans sheet. All values come from the API (useStudio / queries).
 */
import { useId, useState } from "react"
import { Check, CheckSquare, Square } from "@phosphor-icons/react"
import { messageOf } from "../api/errors"
import { useCandidates, useFacets, usePlans, useSavePreferenceRules } from "../api/queries"
import type { Product } from "../api/types"
import { useStore } from "../app/store"
import { useStudio } from "../app/useStudio"
import { formatDay, formatMoney, plural } from "../lib/format"
import { summarizeRules } from "../lib/rules"
import { priceText } from "./pieces"
import { PreferenceEditorSheet } from "./PreferenceEditor"
import { ErrorState, Hint, LoadingState, Notice, Photo, Segmented, Sheet } from "./ui"

/** Sum of known prices (same currency only); null when nothing has a price. */
function sumPrices(products: Product[]): string | null {
  const priced = products.filter((p) => p.price)
  const first = priced[0]?.price
  if (!first || priced.some((p) => p.price?.currency !== first.currency)) return null
  return formatMoney(
    priced.reduce((s, p) => s + (p.price?.amount ?? 0), 0),
    first.currency,
  )
}

function CostLine({ kind }: { kind: "edit" | "tryon" }) {
  const studio = useStudio()
  const cost = studio.costOf(kind)
  const short = studio.shortBy(kind)
  if (cost === null) return null
  return <p className="sa-caption sa-muted mt-2">{short !== null ? <span className="sa-error-text">Saldo insuficiente: faltam {short} tokens.</span> : studio.balance.data ? `Custa ${cost} tokens · saldo ${studio.balance.data.tokens}. Falha ou cancelamento não debita.` : `Custa ${cost} tokens.`}</p>
}

/* ------------------------------------------------------------------ edit */

export function EditSheet() {
  const { close } = useStore()
  const studio = useStudio()
  const look = studio.look.data
  const [text, setText] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const fieldId = useId()
  const cost = studio.costOf("edit")
  const short = studio.shortBy("edit") !== null
  if (!look) return null

  const submit = async (): Promise<void> => {
    if (!text.trim()) {
      setMessage("Descreva o que mudar na imagem atual.")
      return
    }
    const out = await studio.edit(text.trim())
    if (out.ok) close()
    else setMessage(out.message)
  }

  return (
    <Sheet
      title="Editar imagem"
      description={`A alteração parte da v${look.version} e cria a v${look.version + 1}, ligada a ela.`}
      onClose={close}
      footer={
        <div>
          <button type="button" className="sa-btn sa-btn-primary sa-btn-block" aria-disabled={short || studio.starting || undefined} onClick={() => !short && !studio.starting && void submit()}>
            {studio.starting ? "Enviando…" : `Aplicar alteração${cost !== null ? ` · ${cost} tokens` : ""}`}
          </button>
          <CostLine kind="edit" />
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="flex items-center gap-3">
          <div className="sa-photo flex-none" style={{ width: 64, height: 80 }}>
            <Photo image={look.image} alt="" className="h-full w-full" />
          </div>
          <p className="sa-body-sm">
            <strong>{look.title}</strong>
            <span className="sa-muted block">Versão atual: v{look.version}</span>
          </p>
        </div>
        <div>
          <label htmlFor={fieldId} className="sa-fieldlabel">
            O que mudar?
          </label>
          <textarea
            id={fieldId}
            className="sa-field"
            rows={3}
            value={text}
            maxLength={300}
            onChange={(e) => {
              setText(e.target.value)
              setMessage(null)
            }}
            placeholder="Ex.: ver de perfil, aproximar o enquadramento…"
          />
        </div>
        {message ? <Notice tone="warning">{message}</Notice> : null}
        <Hint>Edições mudam a imagem atual. Para trocar uma peça, use o acervo da busca: as peças e os links do look acompanham a troca.</Hint>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ acervo */

type PoolFilter = "todas" | "fora" | "usadas"

export function AcervoSheet() {
  const { draft, setDraft, close, open } = useStore()
  const studio = useStudio()
  const query = useCandidates(draft.lookId)
  const [filter, setFilter] = useState<PoolFilter>("todas")
  const [review, setReview] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const selection = draft.acervoSelection
  const all = query.data ?? []
  const selected = all.filter((c) => selection.includes(c.product.id)).map((c) => c.product)
  const total = sumPrices(selected)
  const cost = studio.costOf("tryon")
  const short = studio.shortBy("tryon") !== null
  const toggle = (id: string): void => setDraft({ acervoSelection: selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id] })

  if (review) {
    const confirm = async (): Promise<void> => {
      if (short || studio.starting) return
      const out = await studio.tryOn(selection)
      if (out.ok) close()
      else setMessage(out.message)
    }
    return (
      <Sheet
        title="Revisar prova"
        onClose={close}
        footer={
          <div className="grid gap-2">
            <button type="button" className="sa-btn sa-btn-primary sa-btn-block" aria-disabled={short || studio.starting || undefined} onClick={() => void confirm()}>
              {studio.starting ? "Enviando…" : `Confirmar prova${cost !== null ? ` · ${cost} tokens` : ""}`}
            </button>
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-block" onClick={() => setReview(false)}>
              Voltar à seleção
            </button>
            <CostLine kind="tryon" />
          </div>
        }
      >
        <div className="grid gap-4">
          <ul className="sa-divided">
            {selected.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-3">
                <div className="sa-photo flex-none" style={{ width: 48, height: 60 }}>
                  <Photo image={p.images[0] ?? null} alt="" className="h-full w-full" />
                </div>
                <span className="sa-body-sm min-w-0 flex-1">{p.name}</span>
                <span className="sa-body-sm sa-num font-semibold">{priceText(p)}</span>
              </li>
            ))}
          </ul>
          {total ? (
            <p className="sa-body-sm flex justify-between">
              <span className="sa-muted">Peças somam</span>
              <span className="sa-num font-semibold">{total}</span>
            </p>
          ) : null}
          {message ? <Notice tone="warning">{message}</Notice> : null}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet
      title="Acervo da busca"
      description="Peças encontradas para este pedido, inclusive as que não entraram no look. O acervo não é o Closet: nada aqui fica guardado sem você favoritar."
      onClose={close}
      footer={
        <div>
          <div className="flex items-center justify-between gap-3 sa-body-sm">
            <span aria-live="polite">
              {plural(selection.length, "selecionada", "selecionadas")}
              {total ? <span className="sa-num"> · {total}</span> : null}
            </span>
            <button type="button" className="sa-btn-quiet" onClick={() => setDraft({ acervoSelection: [] })} aria-disabled={selection.length === 0 || undefined}>
              Limpar
            </button>
          </div>
          <button type="button" className="sa-btn sa-btn-primary sa-btn-block mt-2" aria-disabled={selection.length === 0 || undefined} onClick={() => selection.length > 0 && setReview(true)}>
            Revisar prova{cost !== null ? ` · ${cost} tokens` : ""}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        {query.isPending ? (
          <LoadingState label="Carregando o acervo…" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
        ) : all.length === 0 ? (
          <Notice tone="info">Esta busca não trouxe candidatos além das peças do look.</Notice>
        ) : (
          <>
            <Segmented
              label="Mostrar"
              value={filter}
              onChange={setFilter}
              block
              options={[
                { id: "todas", label: `Todas ${all.length}` },
                { id: "fora", label: `Fora ${all.filter((c) => !c.usedInLook).length}` },
                { id: "usadas", label: `No look ${all.filter((c) => c.usedInLook).length}` },
              ]}
            />
            <ul className="sa-divided">
              {all
                .filter((c) => (filter === "todas" ? true : filter === "fora" ? !c.usedInLook : c.usedInLook))
                .map((c) => {
                  const p = c.product
                  const isSel = selection.includes(p.id)
                  const blocked = c.failed.length > 0 ? `Fora das preferências: ${c.failed.join(", ")}` : null
                  return (
                    <li key={p.id} className="flex items-center gap-3 py-3">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSel}
                        aria-disabled={(!isSel && blocked !== null) || undefined}
                        aria-label={`Selecionar ${p.name}${blocked && !isSel ? `: ${blocked}` : ""}`}
                        className="sa-iconbtn flex-none"
                        onClick={() => {
                          if (!isSel && blocked) return
                          toggle(p.id)
                        }}
                      >
                        {isSel ? <CheckSquare size={24} weight="fill" /> : <Square size={24} style={{ color: blocked ? "var(--text4)" : undefined }} />}
                      </button>
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => open({ kind: "product", productId: p.id, back: { kind: "acervo" } })} aria-label={`Ver detalhes de ${p.name}`}>
                        <div className="sa-photo flex-none" style={{ width: 56, height: 70 }}>
                          <Photo image={p.images[0] ?? null} alt="" className="h-full w-full" />
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="sa-body-sm sa-truncate block font-semibold">{p.name}</span>
                          <span className="sa-caption sa-muted block">
                            <span className="sa-num">{priceText(p)}</span> · {p.partner.name}
                            {p.category ? ` · ${p.category.label}` : ""}
                          </span>
                          <span className={`sa-caption block ${blocked && !isSel ? "sa-warning-text" : "sa-muted"}`}>{blocked && !isSel ? blocked : c.usedInLook ? "No look atual" : "Não usada no look"}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ preferences */

export function PreferencePickerSheet() {
  const { draft, setDraft, close, notify } = useStore()
  const studio = useStudio()
  const save = useSavePreferenceRules()
  const prefs = studio.preferences
  const active = studio.activePreference
  return (
    <Sheet title="Preferências desta busca" description="Exigências restringem a busca; preferências só ordenam. Trocar aqui não altera a preferência padrão." onClose={close}>
      <div className="grid gap-4">
        {prefs.isPending ? (
          <LoadingState />
        ) : prefs.isError ? (
          <ErrorState error={prefs.error} onRetry={() => void prefs.refetch()} compact />
        ) : prefs.data.items.length === 0 ? (
          <Notice tone="info">Sua conta ainda não tem preferências de compra. A busca usa as regras padrão do servidor.</Notice>
        ) : (
          <div role="radiogroup" aria-label="Preferências de compra" className="sa-divided">
            {prefs.data.items.map((p) => {
              const isActive = p.id === active?.id
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className="flex w-full items-start gap-3 py-3 text-left"
                  onClick={() => {
                    setDraft({ preferenceId: p.id, sessionRules: null })
                    notify(`${p.name} ativa nesta busca`)
                  }}
                >
                  <span className="flex h-6 w-6 flex-none items-center justify-center" aria-hidden="true">
                    {isActive ? <Check size={20} weight="bold" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sa-body-sm block font-semibold">
                      {p.name}
                      {p.id === prefs.data.defaultId ? <span className="sa-caption sa-muted font-medium"> · padrão</span> : null}
                    </span>
                    <span className="sa-caption sa-muted block sa-pretty">{summarizeRules(p.rules, studio.config.data?.budget.currency)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
        {draft.sessionRules && active ? (
          <Notice tone="info">
            <p className="font-semibold">Ajustes só desta busca</p>
            <p className="mt-1">{summarizeRules(draft.sessionRules, studio.config.data?.budget.currency)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="sa-btn sa-btn-primary sa-btn-sm"
                aria-disabled={save.isPending || undefined}
                onClick={() => {
                  if (!draft.sessionRules || save.isPending) return
                  save.mutate(
                    { id: active.id, rules: draft.sessionRules },
                    {
                      onSuccess: () => {
                        setDraft({ sessionRules: null })
                        notify(`Ajustes salvos em ${active.name}`)
                      },
                      onError: (e) => notify(messageOf(e)),
                    },
                  )
                }}
              >
                {save.isPending ? "Salvando…" : `Salvar em ${active.name}`}
              </button>
              <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => setDraft({ sessionRules: null })}>
                Descartar ajustes
              </button>
            </div>
          </Notice>
        ) : null}
      </div>
    </Sheet>
  )
}

/** Advanced editor for this search, fed by the API (rules, partners, limits, sizes). */
export function SearchPreferenceEditor() {
  const { close, setDraft, notify } = useStore()
  const studio = useStudio()
  const facets = useFacets()
  if (!studio.rules || !studio.config.data) {
    return (
      <Sheet title="Preferências desta busca" onClose={close}>
        {studio.config.isError ? <ErrorState error={studio.config.error} onRetry={() => void studio.config.refetch()} compact /> : <LoadingState />}
      </Sheet>
    )
  }
  return (
    <PreferenceEditorSheet
      initial={studio.rules}
      sourceName={studio.activePreference?.name ?? "sua preferência"}
      partners={facets.data?.partners ?? []}
      config={studio.config.data}
      onApply={(rules) => {
        setDraft({ sessionRules: rules })
        notify("Ajustes aplicados só nesta busca. A preferência salva não mudou.")
      }}
    />
  )
}

/* ------------------------------------------------------------------ tokens */

export function TokensSheet() {
  const { close } = useStore()
  const studio = useStudio()
  const plans = usePlans()
  const balance = studio.balance
  const costs = studio.config.data?.costs
  const renews = formatDay(balance.data?.renewsAt ?? null)
  return (
    <Sheet title="Saldo e planos" onClose={close}>
      <div className="grid gap-6">
        {balance.isPending ? (
          <LoadingState />
        ) : balance.isError ? (
          <ErrorState error={balance.error} onRetry={() => void balance.refetch()} compact />
        ) : (
          <div>
            <p className="sa-caption sa-muted">Saldo</p>
            <p className="sa-heading sa-num mt-1">{plural(balance.data.tokens, "token", "tokens")}</p>
            <p className="sa-caption sa-muted mt-1">
              Plano {balance.data.plan.name}
              {balance.data.plan.tokensPerPeriod !== null && balance.data.plan.period ? ` · ${balance.data.plan.tokensPerPeriod} por ${balance.data.plan.period === "day" ? "dia" : "mês"}` : ""}
              {renews ? ` · renova em ${renews}` : ""}
            </p>
          </div>
        )}
        {costs ? (
          <dl className="sa-divided sa-body-sm">
            {(
              [
                ["Gerar look", costs.generate],
                ["Editar imagem", costs.edit],
                ["Prova do acervo", costs.tryOn],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 py-3">
                <dt>{k}</dt>
                <dd className="sa-num m-0 text-right font-semibold">{plural(v, "token", "tokens")}</dd>
              </div>
            ))}
            <div className="flex items-start justify-between gap-4 py-3">
              <dt>Busca, Match e Closet</dt>
              <dd className="m-0 text-right font-semibold">sem custo</dd>
            </div>
          </dl>
        ) : null}
        <div>
          <p className="sa-title-sm">Planos</p>
          {plans.isPending ? (
            <LoadingState className="mt-2" />
          ) : plans.isError ? (
            <ErrorState error={plans.error} onRetry={() => void plans.refetch()} compact className="mt-2" />
          ) : plans.data.length === 0 ? (
            <p className="sa-body-sm sa-muted mt-1">Nenhum plano disponível no momento.</p>
          ) : (
            <ul className="sa-divided mt-2">
              {plans.data.map((p) => (
                <li key={p.id} className="flex items-start justify-between gap-4 py-3 sa-body-sm">
                  <span>
                    <span className="font-semibold">{p.name}</span>
                    {p.id === balance.data?.plan.id ? <span className="sa-badge sa-badge-quiet ml-2 align-middle">Atual</span> : null}
                    {p.tokensPerPeriod !== null && p.period ? <span className="sa-caption sa-muted block">{`${p.tokensPerPeriod} tokens por ${p.period === "day" ? "dia" : "mês"}`}</span> : null}
                  </span>
                  <span className="sa-num font-semibold">{p.price ? formatMoney(p.price.amount, p.price.currency) : "Grátis"}</span>
                </li>
              ))}
            </ul>
          )}
          <Hint className="mt-2">A troca de plano e o pagamento ainda não estão disponíveis no app.</Hint>
        </div>
      </div>
    </Sheet>
  )
}
