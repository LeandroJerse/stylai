/**
 * Outfit composition (Estúdio > Procurar): the agent's choice per slot, alternatives, lock/swap, the honest
 * cost/rights summary and the confirmation that starts ONE generation. Links come from the server per piece
 * (affiliate only when generated with the server's tracking ID; see lib/links.ts).
 */
import { useState } from "react"
import { ArrowUpRight, CircleNotch, Lock, LockOpen, Sparkle } from "@phosphor-icons/react"
import type { Composition, CompositionSlotId } from "../api/types"
import { useStore } from "../app/store"
import { useStudio } from "../app/useStudio"
import { resolvePartnerLink } from "../lib/links"

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const BLOCKED: Record<string, string> = {
  ai_image_rights_unconfirmed: "Geração bloqueada: as imagens destas peças não têm direito de uso comprovado para o provador (ex.: AliExpress). A pesquisa e os links continuam valendo; nenhuma outra peça é usada no lugar.",
  no_pieces: "Nenhuma peça encontrada para gerar.",
  composition_incomplete: "Falta uma peça obrigatória. Busque uma alternativa para completar o look antes de gerar.",
  selection_review_required: "O agente não concluiu a seleção. Peça uma nova sugestão antes de gerar a prévia.",
}

export function CompositionPanel({ composition }: { composition: Composition }) {
  const studio = useStudio()
  const { draft, notify } = useStore()
  const [picked, setPicked] = useState<Partial<Record<CompositionSlotId, string>>>(() =>
    Object.fromEntries(composition.slots.flatMap((s) => (s.choice ? [[s.slot, s.choice.productId]] : []))))
  const [locked, setLocked] = useState<Partial<Record<CompositionSlotId, boolean>>>({})
  /** Size per chosen piece: never invented; required when the store offers more than one. */
  const [sizes, setSizes] = useState<Partial<Record<CompositionSlotId, string>>>({})
  const busy = studio.composing || studio.starting
  const chosen = composition.slots.flatMap((s) => {
    const c = s.candidates.find((x) => x.product.id === picked[s.slot])
    return c ? [{ slot: s.slot, candidate: c }] : []
  })
  const total = chosen.every((c) => c.candidate.product.price) ? chosen.reduce((a, c) => a + (c.candidate.product.price?.amount ?? 0), 0) : null
  const sizeOf = (slot: CompositionSlotId, p: (typeof chosen)[number]["candidate"]["product"]) => {
    const available = p.variants.filter((v) => v.available && v.id)
    return available.length === 1 ? available[0]!.id : available.some((v) => v.id === sizes[slot]) ? sizes[slot]! : null
  }
  const joint = composition.generation.render === "joint_outfit_unverified"
  const renderCalls = joint ? Number(chosen.length > 0) : chosen.length
  const missingSize = chosen.some((c) => c.candidate.product.variants.some((v) => v.available) && !sizeOf(c.slot, c.candidate.product))
  const complete = chosen.length > 0 && composition.slots.every((s) => s.required === false || chosen.some((c) => c.slot === s.slot))
  const eligible = composition.generation.blockedReason !== "selection_review_required" && complete && chosen.length > 0 && chosen.every((c) => c.candidate.generationEligible)

  const recompose = async () => {
    const keep = Object.fromEntries(Object.entries(picked).filter(([slot]) => locked[slot as CompositionSlotId]))
    const r = await studio.compose(keep)
    if (!r.ok) notify(r.message)
  }
  const generate = async () => {
    const r = await studio.generateComposition(chosen.map((c) => ({ slot: c.slot, productId: c.candidate.product.id, variantId: sizeOf(c.slot, c.candidate.product) })), Boolean(draft.lookId))
    notify(r.ok ? "Composição enviada para gerar." : r.message)
  }

  return (
    <section className="mt-4 grid gap-3" aria-label="Look montado pelo agente" data-testid="composition-panel">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="sa-title-sm">{complete ? "Look sugerido" : "Look em montagem — faltam peças"}</h2>
        <span className="sa-caption sa-muted" data-testid="composition-method">
          {composition.selectionMethod === "agent" ? `Selecionado pelo agente (${composition.model ?? "IA"}), conferido pelo servidor` : "Seleção por regras (sem agente)"}
          {composition.stages ? ` · interpretação: ${composition.stages.interpretation === "agent" ? "agente" : "regras"} · busca: ${composition.stages.retrieval} · fonte: ${composition.source === "aliexpress_affiliate" ? "API AliExpress" : composition.source === "curated" ? "catálogo local" : composition.source}` : ""}
        </span>
      </header>
      {composition.slots.map((slot) => (
        <fieldset key={slot.slot} className="sa-card grid gap-2 p-3" data-testid={`composition-slot-${slot.slot}`}>
          <legend className="flex w-full items-center justify-between gap-2 font-semibold">
            {slot.label}
            {picked[slot.slot] ? (
              <button type="button" className="sa-btn sa-btn-ghost" aria-pressed={locked[slot.slot] === true}
                onClick={() => setLocked((l) => ({ ...l, [slot.slot]: !l[slot.slot] }))}>
                {locked[slot.slot] ? <Lock size={16} aria-hidden="true" /> : <LockOpen size={16} aria-hidden="true" />}
                {locked[slot.slot] ? "Travada" : "Travar"}
              </button>
            ) : null}
          </legend>
          {slot.candidates.length === 0 ? <p className="sa-body-sm sa-muted">{slot.error && slot.error !== "no_results" ? "Fonte indisponível para esta parte agora." : "Nenhuma peça compatível encontrada para esta parte."}</p> : null}
          {slot.choice && picked[slot.slot] === slot.choice.productId ? <p className="sa-caption sa-muted">Motivo: {slot.choice.reason}</p> : null}
          {slot.alternativeSearch && slot.candidates.length > 0 ? <p className="sa-caption sa-muted">Encontrada em uma busca alternativa para completar o estilo pedido.</p> : null}
          {(() => {
            const piece = slot.candidates.find((x) => x.product.id === picked[slot.slot])
            const options = piece ? piece.product.variants.filter((v) => v.available && v.id) : []
            return options.length > 1 ? (
              <label className="sa-body-sm flex items-center gap-2">
                Tamanho
                <select value={sizes[slot.slot] ?? ""} data-testid={`composition-size-${slot.slot}`}
                  onChange={(e) => setSizes((s) => ({ ...s, [slot.slot]: e.target.value }))}>
                  <option value="" disabled>Escolha</option>
                  {options.map((v) => <option key={v.id} value={v.id!}>{v.label}</option>)}
                </select>
              </label>
            ) : null
          })()}
          <ul className="grid gap-2" role="radiogroup" aria-label={`Opções para ${slot.label}`}>
            {slot.candidates.slice(0, 6).map((c) => {
              const link = resolvePartnerLink(c.product.links)
              const active = picked[slot.slot] === c.product.id
              return (
                <li key={c.product.id} className="flex items-center gap-3">
                  <input type="radio" name={`slot-${slot.slot}`} checked={active} disabled={locked[slot.slot] === true && !active}
                    onChange={() => setPicked((p) => ({ ...p, [slot.slot]: c.product.id }))} aria-label={`Usar ${c.product.name}`} />
                  {c.product.images[0] ? <img src={c.product.images[0].url} alt="" width={48} height={64} className="h-16 w-12 rounded object-cover" loading="lazy" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="sa-body-sm truncate">{c.product.name}</p>
                    <p className="sa-caption sa-muted">{c.product.price ? brl(c.product.price.amount) : "Preço não informado"} · {c.product.partner.name}{c.generationEligible ? "" : " · sem direito de prova"}</p>
                  </div>
                  {link.kind !== "none" ? (
                    <a href={link.href} target="_blank" rel={link.rel} data-link-kind={link.kind} className="sa-btn sa-btn-ghost" aria-label={`Ver ${c.product.name} na loja (${link.kind === "affiliate" ? "link comissionado" : "link da loja"})`}>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </fieldset>
      ))}
      <div className="sa-card grid gap-2 p-3" data-testid="composition-summary">
        <p className="font-semibold">Total das peças: {total === null ? "não confirmado (preço ausente)" : brl(total)}</p>
        {eligible ? (
          <>
            <p className="sa-body-sm" data-testid="composition-cost">
              Gerar a prévia usa {composition.generation.coins} moedas (um pedido do dia) e {renderCalls} {renderCalls === 1 ? "etapa" : "etapas"} de render
              {composition.generation.provider ? ` (${composition.generation.provider})` : ""}.
              {composition.generation.estimatedProviderUsd !== null
                ? ` Custo estimado do provedor ≈ US$ ${(chosen.length * (composition.generation.estimatedProviderUsd / Math.max(composition.generation.layers, 1))).toFixed(3)}.`
                : " O provedor cobra por uso: o custo real só é conhecido depois."}
              {composition.generation.reservePerLayerUsd !== null ? ` Reserva máxima: US$ ${(renderCalls * composition.generation.reservePerLayerUsd).toFixed(2)} (todas as camadas são conferidas antes da primeira).` : ""}
            </p>
            <p className="sa-caption sa-muted">{composition.generation.coinsNote} {joint ? "Prévia ilustrativa: conjunto gerado em uma única imagem; fidelidade ainda não medida." : chosen.length > 1 ? "Prévia ilustrativa: as peças são vestidas em camadas e a fidelidade de cada camada não foi medida." : ""}</p>
          </>
        ) : (
          <p className="sa-body-sm" data-testid="composition-blocked">{BLOCKED[composition.generation.blockedReason ?? (chosen.length ? "ai_image_rights_unconfirmed" : "no_pieces")] ?? BLOCKED.no_pieces}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="sa-btn sa-btn-secondary" aria-disabled={busy || undefined} onClick={() => !busy && void recompose()}>
            {studio.composing ? <CircleNotch size={16} className="sa-spin" aria-hidden="true" /> : <Sparkle size={16} aria-hidden="true" />} Sugerir de novo (mantém as travadas)
          </button>
          {eligible && missingSize ? <p className="sa-caption" data-testid="composition-size-needed">Escolha o tamanho de cada peça antes de gerar.</p> : null}
          <button type="button" className="sa-btn sa-btn-primary" disabled={!eligible || missingSize || busy || studio.running} data-testid="composition-generate" onClick={() => void generate()}>
            {draft.lookId ? "Gerar nova versão com estas peças" : "Confirmar e gerar"}
          </button>
        </div>
      </div>
    </section>
  )
}
