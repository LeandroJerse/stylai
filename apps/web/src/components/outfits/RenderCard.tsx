/** One image batch: its panels, what can be recovered, and the comparison assembled from the finished panels. */
import { useState } from "react"
import { CircleNotch, CornersOut } from "@phosphor-icons/react"
import type { OutfitPanel, OutfitRender } from "../../api/outfits"
import { useStore } from "../../app/store"
import type { Outfits } from "../../app/useOutfits"
import { Notice, Photo } from "../ui"

const STATUS: Record<OutfitRender["status"], string> = { running: "Gerando imagens", assembling: "Montando o comparativo", succeeded: "Concluído", partial: "Parcial: parte das imagens ficou pronta", failed: "Não concluído" }
type Result = { ok: true } | { ok: false; message: string }

function Panel({ panel, busy, retry, openSearch }: { panel: OutfitPanel; busy: boolean; retry: (accept: boolean) => void; openSearch: (() => void) | null }) {
  const { open } = useStore()
  const [accept, setAccept] = useState(false)
  const working = panel.state === "queued" || panel.state === "running"
  return (
    <li className="sa-render-panel" data-testid="render-panel" data-state={panel.state} data-panel={panel.panel}>
      <div className="sa-render-media">
        {panel.image ? (
          <>
            <Photo image={panel.image} alt={panel.image.alt ?? panel.title} fit="contain" />
            <button type="button" className="sa-iconbtn sa-render-zoom" aria-label={`Ampliar ${panel.title}`} onClick={() => open({ kind: "viewer", image: panel.image!, alt: panel.image!.alt ?? panel.title })}>
              <CornersOut size={18} aria-hidden="true" />
            </button>
          </>
        ) : (
          <p className="sa-caption sa-muted flex items-center gap-2" role="status">
            {working ? <CircleNotch size={18} className="sa-spin" aria-hidden="true" /> : null}{panel.stateLabel}
          </p>
        )}
      </div>
      <p className="sa-body-sm font-semibold">{panel.panel} · {panel.title}</p>
      <p className="sa-caption sa-muted">{panel.stateLabel}{panel.attempts > 1 ? ` · ${panel.attempts} tentativas` : ""}</p>
      {panel.error ? <p className="sa-caption sa-error-text">{panel.error}</p> : null}
      {panel.canRetry && panel.retryNeedsChargeAcceptance ? (
        <label className="sa-caption flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={accept} onChange={(e) => setAccept(e.target.checked)} data-testid="accept-charge" />
          <span>A tentativa anterior já foi cobrada pelo provador. Aceito uma nova cobrança para refazer esta imagem.</span>
        </label>
      ) : null}
      {panel.canRetry ? (
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm justify-self-start" disabled={busy || (panel.retryNeedsChargeAcceptance && !accept)} onClick={() => retry(accept)} data-testid="render-retry">Gerar o que falta</button>
      ) : null}
      {panel.canRetry ? <p className="sa-caption sa-muted">Refazer usa 10 moedas e uma nova chamada de geração, só para este painel.</p> : null}
      {panel.retryBlockedReason ? <p className="sa-caption sa-muted">{panel.retryBlockedReason}</p> : null}
      {openSearch ? <button type="button" className="sa-btn-quiet sa-caption justify-self-start" onClick={openSearch}>Ver os conjuntos desta busca</button> : null}
    </li>
  )
}

export function RenderCard({ render, outfits }: { render: OutfitRender; outfits: Outfits }) {
  const { open, notify } = useStore()
  const [busy, setBusy] = useState(false)
  const run = (act: () => Promise<Result>): void => {
    if (busy) return
    setBusy(true)
    void act().then((r) => { if (!r.ok) notify(r.message) }).finally(() => setBusy(false))
  }
  const working = render.status === "running" || render.status === "assembling"
  const missing = render.panels.filter((p) => p.state !== "ready" && !["dropped", "queued", "running"].includes(p.state)).length
  const image = render.comparison?.image ?? null
  return (
    <article className="sa-panel sa-outfit" data-testid="render-card" data-render-id={render.id} data-status={render.status} data-mode={render.mode} aria-busy={working || undefined}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="sa-title-sm">{render.mode === "comparison" ? `Comparativo de ${render.panels.filter((p) => p.state !== "dropped").length} conjuntos` : "Imagem individual"}</h3>
        <span className={`sa-badge ${render.status === "succeeded" ? "sa-badge-success" : render.status === "failed" ? "sa-badge-error" : render.status === "partial" ? "sa-badge-warning" : "sa-badge-quiet"}`} role="status">{STATUS[render.status]}</span>
      </header>
      {image ? (
        <div className="sa-render-comparison">
          <Photo image={image} alt={image.alt ?? "Comparativo"} fit="contain" />
          <button type="button" className="sa-iconbtn sa-render-zoom" aria-label="Ampliar comparativo" onClick={() => open({ kind: "viewer", image, alt: image.alt ?? "Comparativo" })} data-testid="comparison-image">
            <CornersOut size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {render.comparison?.error ? <Notice tone="warning">{render.comparison.error}</Notice> : null}
      <ul className="sa-render-panels" data-count={render.panels.length}>
        {render.panels.map((p) => (
          <Panel key={p.panel} panel={p} busy={busy} retry={(accept) => run(() => outfits.retry(render, p.panel, accept))}
            openSearch={p.searchId && p.searchId !== outfits.searchId ? () => outfits.open(p.searchId!) : null} />
        ))}
      </ul>
      {render.canFinalize ? (
        <div className="grid gap-2">
          <p className="sa-body-sm">{render.comparison?.state === "failed" ? "As imagens prontas continuam salvas." : `Você pode refazer ${missing === 1 ? "a imagem que falta" : "as imagens que faltam"} ou montar o comparativo só com as prontas.`}</p>
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm justify-self-start" disabled={busy} onClick={() => run(() => outfits.finalize(render))} data-testid="render-finalize">Montar com as prontas</button>
        </div>
      ) : null}
      {render.canCancel ? <button type="button" className="sa-btn-quiet sa-body-sm justify-self-start" disabled={busy} onClick={() => run(() => outfits.cancelRender(render))} data-testid="render-cancel">Cancelar as que não começaram</button> : null}
      <p className="sa-caption sa-muted">Prévia ilustrativa gerada por IA a partir da sua foto aprovada; caimento, cor e tecido reais podem ser diferentes.</p>
    </article>
  )
}
