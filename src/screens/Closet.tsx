/**
 * Closet: saved looks and favourite pieces of the signed-in person (GET /closet).
 * Removing a look offers undo (PUT again); favourite pieces are toggled by the heart.
 */
import { useState } from "react"
import { ArrowLeft, Trash } from "@phosphor-icons/react"
import { messageOf } from "../api/errors"
import { useCloset, useToggleSavedLook } from "../api/queries"
import type { Product } from "../api/types"
import { useStore, type Overlay } from "../app/store"
import { useAuth } from "../auth/AuthProvider"
import { formatDay, plural } from "../lib/format"
import { ORIGIN_LABEL, sumLook } from "../lib/looks"
import { PieceCard, PieceCardSkeletons, priceText, ROLE_LABEL } from "../components/pieces"
import { EmptyState, ErrorState, Notice, Photo, Segmented, Sheet, Skeleton } from "../components/ui"

type View = "pecas" | "looks"

const TAB_LABEL = { explorar: "Explorar", estudio: "Estúdio", perfil: "Perfil", closet: "Explorar" } as const

/** Prices older than this are flagged as possibly out of date. */
const STALE_DAYS = 7
const isStale = (p: Product): boolean => {
  if (!p.updatedAt) return false
  const t = new Date(p.updatedAt).getTime()
  return Number.isFinite(t) && Date.now() - t > STALE_DAYS * 86_400_000
}

function Empty({ title, text }: { title: string; text: string }) {
  const { go } = useStore()
  return (
    <EmptyState
      title={title}
      action={
        <div className="flex flex-wrap gap-2 md:justify-center">
          <button type="button" className="sa-btn sa-btn-primary" onClick={() => go("explorar")}>
            Explorar peças
          </button>
          <button type="button" className="sa-btn sa-btn-secondary" onClick={() => go("estudio")}>
            Ir ao Estúdio
          </button>
        </div>
      }
    >
      {text}
    </EmptyState>
  )
}

function LookSkeletons() {
  return (
    <ul className="sa-grid" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <li key={i}>
          <Skeleton style={{ aspectRatio: "4 / 5", borderRadius: "var(--r-card)" }} />
          <Skeleton className="mt-3" style={{ height: 18, width: "70%" }} />
        </li>
      ))}
    </ul>
  )
}

export function ClosetScreen() {
  const { open, prevTab, go } = useStore()
  const { status } = useAuth()
  const closet = useCloset(status === "signed-in")
  const back = prevTab === "closet" ? "explorar" : prevTab
  const [view, setView] = useState<View>("looks")
  const looks = closet.data?.looks ?? []
  const pieces = closet.data?.pieces ?? []
  const stale = pieces.filter((p) => isStale(p.product)).length

  return (
    <div className="sa-page">
      <button type="button" className="sa-btn-quiet sa-body-sm -ml-2 mb-2 flex items-center gap-2" onClick={() => go(back)}>
        <ArrowLeft size={18} aria-hidden="true" /> Voltar para {TAB_LABEL[back]}
      </button>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="sa-display">Closet</h1>
          {closet.data ? (
            <p className="sa-body-sm sa-muted mt-2">
              {plural(looks.length, "look guardado", "looks guardados")} · {plural(pieces.length, "peça", "peças")}
            </p>
          ) : null}
        </div>
        <Segmented
          label="Mostrar"
          value={view}
          onChange={setView}
          options={[
            { id: "looks", label: closet.data ? `Looks ${looks.length}` : "Looks" },
            { id: "pecas", label: closet.data ? `Peças ${pieces.length}` : "Peças" },
          ]}
        />
      </header>

      {closet.isPending ? (
        view === "looks" ? (
          <LookSkeletons />
        ) : (
          <ul className="sa-grid" aria-hidden="true">
            <PieceCardSkeletons count={6} />
          </ul>
        )
      ) : closet.isError ? (
        <ErrorState error={closet.error} onRetry={() => void closet.refetch()} />
      ) : view === "looks" ? (
        looks.length === 0 ? (
          <Empty title="Nenhum look guardado" text="Guarde um resultado do Estúdio ou deslize para a direita no Match. O look entra aqui com as peças dele." />
        ) : (
          <ul className="sa-grid">
            {looks.map((l) => (
              <li key={l.id} className="min-w-0">
                <button type="button" className="sa-cardbtn block w-full text-left" onClick={() => open({ kind: "closetLook", lookId: l.id })} aria-label={`${l.title}, ${plural(l.pieces.length, "peça", "peças")}. Ver look`}>
                  <div className="sa-photo sa-card-photo" style={{ aspectRatio: "4 / 5" }}>
                    <Photo image={l.image} alt="" className="h-full w-full" sizes="(min-width: 1024px) 25vw, 50vw" />
                  </div>
                  <p className="sa-subheading mt-3" style={{ fontSize: 20 }}>
                    {l.title}
                  </p>
                  <p className="sa-caption sa-muted mt-1">
                    {plural(l.pieces.length, "peça", "peças")} · {ORIGIN_LABEL[l.origin]}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : pieces.length === 0 ? (
        <Empty title="Nenhuma peça favorita" text="Toque no coração de uma peça no Explorar ou no Estúdio. Favoritar guarda só a peça; o look inteiro só entra quando você guarda o look." />
      ) : (
        <>
          {stale > 0 ? (
            <Notice tone="warning" className="mb-5">
              {plural(stale, "peça tem", "peças têm")} preço e estoque conferidos há mais de {STALE_DAYS} dias: podem ter mudado na loja.
            </Notice>
          ) : null}
          <ul className="sa-grid">
            {pieces.map((p) => {
              const day = formatDay(p.product.updatedAt)
              return <PieceCard key={p.product.id} product={p.product} extra={isStale(p.product) && day ? `Dados de ${day}, podem estar desatualizados` : p.via === "look" ? "Veio com um look guardado" : "Favoritada"} />
            })}
          </ul>
        </>
      )}
    </div>
  )
}

export function ClosetLookSheet({ lookId }: { lookId: string }) {
  const { close, notify, open } = useStore()
  const closet = useCloset(true)
  const toggle = useToggleSavedLook()
  const look = closet.data?.looks.find((l) => l.id === lookId)
  if (!look) {
    return (
      <Sheet title="Look" onClose={close}>
        {closet.isError ? <ErrorState error={closet.error} onRetry={() => void closet.refetch()} compact /> : closet.isPending ? <Skeleton style={{ aspectRatio: "4 / 5", maxHeight: 420 }} /> : <Notice tone="info">Este look não está mais no Closet.</Notice>}
      </Sheet>
    )
  }
  const self: Overlay = { kind: "closetLook", lookId }
  const total = sumLook(look)
  const created = formatDay(look.createdAt)

  const remove = (): void => {
    if (toggle.isPending) return
    toggle.mutate(
      { lookId: look.id, save: false },
      {
        onSuccess: () => {
          close()
          notify(`${look.title} saiu do Closet. As peças favoritas continuam.`, {
            label: "Desfazer",
            run: () => toggle.mutate({ lookId: look.id, save: true }, { onError: (e) => notify(messageOf(e)) }),
          })
        },
        onError: (e) => notify(messageOf(e)),
      },
    )
  }

  return (
    <Sheet
      title={look.title}
      onClose={close}
      footer={
        <button type="button" className="sa-btn sa-btn-danger sa-btn-block" onClick={remove} aria-disabled={toggle.isPending || undefined}>
          <Trash size={18} aria-hidden="true" /> {toggle.isPending ? "Removendo…" : "Remover look do Closet"}
        </button>
      }
    >
      <div className="grid gap-5">
        <button type="button" className="sa-photo sa-photo-lg block w-full" style={{ aspectRatio: "4 / 5", maxHeight: 420 }} onClick={() => open({ kind: "viewer", image: look.image, alt: look.title, back: self })} aria-label={`Ampliar ${look.title}`}>
          <Photo image={look.image} alt="" className="h-full w-full" eager />
        </button>
        <p className="sa-caption sa-muted">
          {ORIGIN_LABEL[look.origin]}
          {created ? ` em ${created}` : ""}
          {total ? (
            <>
              {" "}
              · peças somam <span className="sa-num">{total}</span>
            </>
          ) : null}
        </p>
        {look.note ? <p className="sa-body-sm sa-pretty">{look.note}</p> : null}
        {look.pieces.length === 0 ? (
          <p className="sa-body-sm sa-muted">Este look não tem peças associadas.</p>
        ) : (
          <ul className="sa-divided">
            {look.pieces.map((p) => (
              <li key={p.product.id}>
                <button type="button" className="flex w-full items-center gap-3 py-3 text-left" onClick={() => open({ kind: "product", productId: p.product.id, back: self })}>
                  <div className="sa-photo sa-thumb flex-none" style={{ width: 56, height: 70 }}>
                    <Photo image={p.product.images[0] ?? null} alt="" className="h-full w-full" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="sa-body-sm sa-truncate block font-semibold">{p.product.name}</span>
                    <span className="sa-caption sa-muted block">{p.product.partner.name}</span>
                    {look.origin !== "tryon" ? <span className="sa-caption sa-accent-text block">{ROLE_LABEL[p.role]}</span> : null}
                    {isStale(p.product) ? <span className="sa-caption sa-warning-text block">Dados de {formatDay(p.product.updatedAt)}</span> : null}
                  </span>
                  <span className="sa-body-sm sa-num font-semibold">{priceText(p.product)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
