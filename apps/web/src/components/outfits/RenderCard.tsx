/**
 * One image batch. Open: the result large, its pieces and what can be recovered. Closed: one line with a thumbnail.
 * When the comparison is ready the separate images stay one tap away.
 */
import { useState } from "react"
import { CaretDown, CircleNotch, CornersOut } from "@phosphor-icons/react"
import type { OutfitPanel, OutfitRender } from "../../api/outfits"
import { useStore } from "../../app/store"
import type { Outfits } from "../../app/useOutfits"
import { shortPieceName } from "../../lib/titles"
import { Notice, Photo } from "../ui"
import { money, StoreLink } from "./OutfitCard"

const STATUS: Record<OutfitRender["status"], string> = { running: "Gerando", assembling: "Montando o comparativo", succeeded: "Pronta", partial: "Parcial", failed: "Não concluída" }
const TONE: Record<OutfitRender["status"], string> = { running: "sa-badge-quiet", assembling: "sa-badge-quiet", succeeded: "sa-badge-success", partial: "sa-badge-warning", failed: "sa-badge-error" }
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "")
type Result = { ok: true } | { ok: false; message: string }

export const isWorking = (r: OutfitRender): boolean => r.status === "running" || r.status === "assembling"
export const renderTitle = (r: OutfitRender): string => {
  const panels = r.panels.filter((p) => p.state !== "dropped")
  return r.mode === "comparison" ? `Comparativo de ${panels.length} conjuntos` : (panels[0]?.title ?? "Imagem individual")
}

/** What the image is made of, with the way to the store. */
function ShopList({ panel }: { panel: OutfitPanel }) {
  if (panel.pieces.length === 0) return null
  return (
    <ul className="sa-shoplist" aria-label={`Peças de ${panel.title}`}>
      {panel.pieces.map((p) => (
        <li key={p.product.id} className="flex items-center gap-3">
          <span className="sa-alt-photo" style={{ width: 44 }}>
            <Photo image={p.product.images[0] ?? null} alt="" className="h-full w-full" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="sa-body-sm block font-semibold">{shortPieceName(p.product.name)}</span>
            <span className="sa-caption sa-muted sa-num block">{money(p.product.price)}</span>
          </span>
          <StoreLink piece={p} />
        </li>
      ))}
    </ul>
  )
}

function Panel({ panel, busy, single, retry, openSearch }: { panel: OutfitPanel; busy: boolean; single: boolean; retry: (accept: boolean) => void; openSearch: (() => void) | null }) {
  const { open } = useStore()
  const [accept, setAccept] = useState(false)
  const working = panel.state === "queued" || panel.state === "running"
  return (
    <li className="sa-render-panel" data-testid="render-panel" data-state={panel.state} data-panel={panel.panel}>
      <div className="sa-render-media" data-empty={panel.image ? undefined : ""}>
        {panel.image ? (
          <>
            <Photo image={panel.image} alt={panel.image.alt ?? panel.title} fit="contain" className="h-full w-full" />
            <button type="button" className="sa-iconbtn sa-photo-ctrl sa-render-zoom" aria-label={`Ampliar ${panel.title}`} onClick={() => open({ kind: "viewer", image: panel.image!, alt: panel.image!.alt ?? panel.title })}>
              <CornersOut size={18} aria-hidden="true" />
            </button>
          </>
        ) : (
          <p className="sa-caption sa-muted flex flex-col items-center gap-2 p-4 text-center" role="status">
            {working ? <CircleNotch size={22} className="sa-spin" aria-hidden="true" /> : null}
            {panel.stateLabel}
          </p>
        )}
      </div>
      <div className="grid content-start gap-2">
        {single ? null : (
          <p className="sa-body-sm font-semibold">
            {panel.panel} · {panel.title}
          </p>
        )}
        {panel.state === "ready" || working ? null : (
          <p className="sa-caption sa-muted">
            {panel.stateLabel}
            {panel.attempts > 1 ? ` · ${panel.attempts} tentativas` : ""}
          </p>
        )}
        {panel.error ? <p className="sa-caption sa-error-text">{panel.error}</p> : null}
        {panel.canRetry && panel.retryNeedsChargeAcceptance ? (
          <label className="sa-caption flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={accept} onChange={(e) => setAccept(e.target.checked)} data-testid="accept-charge" />
            <span>A tentativa anterior já foi cobrada pelo provador. Aceito uma nova cobrança para refazer esta imagem.</span>
          </label>
        ) : null}
        {panel.canRetry ? (
          <>
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm justify-self-start" disabled={busy || (panel.retryNeedsChargeAcceptance && !accept)} onClick={() => retry(accept)} data-testid="render-retry">
              Gerar o que falta
            </button>
            <p className="sa-caption sa-muted">Refazer usa 10 moedas e uma nova chamada de geração, só para este painel.</p>
          </>
        ) : null}
        {panel.retryBlockedReason ? <p className="sa-caption sa-muted">{panel.retryBlockedReason}</p> : null}
        {single ? <ShopList panel={panel} /> : null}
        {openSearch ? (
          <button type="button" className="sa-btn-quiet sa-caption justify-self-start" onClick={openSearch}>
            Ver os conjuntos desta busca
          </button>
        ) : null}
      </div>
    </li>
  )
}

export function RenderCard({ render, outfits, expanded, onToggle, onOpenSearch }: { render: OutfitRender; outfits: Outfits; expanded: boolean; onToggle: () => void; onOpenSearch: (id: string) => void }) {
  const { open, notify } = useStore()
  const [busy, setBusy] = useState(false)
  const run = (act: () => Promise<Result>): void => {
    if (busy) return
    setBusy(true)
    void act().then((r) => { if (!r.ok) notify(r.message) }).finally(() => setBusy(false))
  }
  const working = isWorking(render)
  const missing = render.panels.filter((p) => p.state !== "ready" && !["dropped", "queued", "running"].includes(p.state)).length
  const image = render.comparison?.image ?? null
  const thumb = image ?? render.panels.find((p) => p.image)?.image ?? null
  const kept = render.panels.filter((p) => p.state !== "dropped")
  const panels = (
    <ul className="sa-render-panels" data-count={render.panels.length}>
      {render.panels.map((p) => (
        <Panel key={p.panel} panel={p} busy={busy} single={render.panels.length === 1} retry={(accept) => run(() => outfits.retry(render, p.panel, accept))} openSearch={p.searchId && p.searchId !== outfits.searchId ? () => onOpenSearch(p.searchId!) : null} />
      ))}
    </ul>
  )
  return (
    <article className="sa-panel sa-render" data-testid="render-card" data-render-id={render.id} data-status={render.status} data-mode={render.mode} data-open={expanded || undefined} aria-busy={working || undefined}>
      <h3 className="m-0">
        <button type="button" className="sa-render-head" aria-expanded={expanded} onClick={onToggle} data-testid="render-open">
          {expanded ? null : (
            <span className="sa-render-thumb">
              <Photo image={thumb} alt="" className="h-full w-full" />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="sa-title-sm block">{renderTitle(render)}</span>
            {render.createdAt ? <span className="sa-caption sa-muted sa-num block">{when(render.createdAt)}</span> : null}
          </span>
          <span className={`sa-badge flex-none ${TONE[render.status]}`} role="status">
            {working ? <CircleNotch size={12} className="sa-spin" aria-hidden="true" /> : null} {STATUS[render.status]}
          </span>
          <CaretDown size={18} aria-hidden="true" className="sa-caret flex-none" />
        </button>
      </h3>
      {expanded ? (
        <div className="sa-render-body">
          {image ? (
            <div className="sa-render-comparison">
              <Photo image={image} alt={image.alt ?? "Comparativo"} fit="contain" />
              <button type="button" className="sa-iconbtn sa-photo-ctrl sa-render-zoom" aria-label="Ampliar comparativo" onClick={() => open({ kind: "viewer", image, alt: image.alt ?? "Comparativo" })} data-testid="comparison-image">
                <CornersOut size={18} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {render.comparison?.error ? <Notice tone="warning">{render.comparison.error}</Notice> : null}
          {image && kept.every((p) => p.state === "ready") ? (
            <>
              {kept.some((p) => p.pieces.length) ? (
                <div className="sa-render-shops">
                  {kept.map((p) => (
                    <div key={p.panel} className="grid content-start gap-2">
                      <p className="sa-body-sm font-semibold">
                        {p.panel} · {p.title}
                      </p>
                      <ShopList panel={p} />
                    </div>
                  ))}
                </div>
              ) : null}
              <details className="sa-body-sm" data-testid="render-separate">
                <summary className="sa-summaryline">Ver as imagens separadas</summary>
                <div className="mt-3">{panels}</div>
              </details>
            </>
          ) : (
            panels
          )}
          {render.canFinalize ? (
            <div className="grid gap-2">
              <p className="sa-body-sm">{render.comparison?.state === "failed" ? "As imagens prontas continuam salvas." : `Você pode refazer ${missing === 1 ? "a imagem que falta" : "as imagens que faltam"} ou montar o comparativo só com as prontas.`}</p>
              <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm justify-self-start" disabled={busy} onClick={() => run(() => outfits.finalize(render))} data-testid="render-finalize">
                Montar com as prontas
              </button>
            </div>
          ) : null}
          {render.canCancel ? (
            <button type="button" className="sa-btn-quiet sa-body-sm justify-self-start" disabled={busy} onClick={() => run(() => outfits.cancelRender(render))} data-testid="render-cancel">
              Cancelar as que não começaram
            </button>
          ) : null}
          <p className="sa-caption sa-muted">{working ? "Você pode sair desta tela: a geração continua no servidor." : "Prévia ilustrativa gerada por IA a partir da sua foto aprovada; caimento, cor e tecido reais podem ser diferentes."}</p>
        </div>
      ) : null}
    </article>
  )
}
