/**
 * Catalog pieces: card, favourite button, detail sheet and the partner exit. Everything shown
 * comes from the product returned by the API; missing data is said to be missing, never invented.
 */
import { useState } from "react"
import { ArrowUpRight, Heart, Info, PenNib } from "@phosphor-icons/react"
import { messageOf } from "../api/errors"
import { useProduct, useStudioConfig, useToggleFavorite } from "../api/queries"
import type { PieceRole, Product } from "../api/types"
import { useStore, type Overlay } from "../app/store"
import { useAuth } from "../auth/AuthProvider"
import { formatDay, formatInt, formatMoney, formatRating } from "../lib/format"
import { resolvePartnerLink } from "../lib/links"
import { StarRating } from "./controls"
import { ErrorState, Hint, Notice, Photo, Sheet, Skeleton, useLongPress } from "./ui"

export const ROLE_LABEL: Record<PieceRole, string> = {
  look: "Peça do look",
  similar: "Alternativa semelhante",
  chosen: "Escolhida no Explorar",
}

const ROLE_NOTE: Record<PieceRole, string> = {
  look: "Peça correspondente encontrada para o look: pode não ser idêntica à da imagem gerada.",
  similar: "Alternativa semelhante: não é a peça exata da imagem.",
  chosen: "Peça que você escolheu no Explorar: é o mesmo produto do catálogo, com a mesma loja e o mesmo link.",
}

export const priceText = (p: Product): string => (p.price ? formatMoney(p.price.amount, p.price.currency) : "Preço não informado")

/** Runs `action` when signed in; otherwise sends the person to sign in and back to this tab. */
export function useRequireAccount(): (reason: string, action: () => void) => void {
  const { status } = useAuth()
  const { go, tab, notify } = useStore()
  return (reason, action) => {
    if (status === "signed-in") return action()
    notify(reason)
    go({ kind: "auth", screen: "entrar", next: tab, token: null })
  }
}

/** Sends a catalog piece to the Estúdio request, keeping the product as returned by the API. */
export function useSendToStudio(product: Product | undefined): { send: () => void; inStudio: boolean; full: boolean } {
  const { draft, setDraft, go, notify } = useStore()
  const config = useStudioConfig()
  const max = config.data?.maxChosenPieces ?? 0
  const inStudio = !!product && draft.chosen.some((p) => p.id === product.id)
  const full = !inStudio && config.isSuccess && draft.chosen.length >= max
  const send = (): void => {
    if (!product) return
    if (full) {
      notify(`O Estúdio aceita até ${max} peças do Explorar por pedido. Remova uma no compositor.`)
      return
    }
    if (!inStudio) setDraft((d) => ({ chosen: [...d.chosen, product], composerOpen: true }))
    go("estudio")
    notify(inStudio ? "Esta peça já está no seu pedido do Estúdio" : `${product.name} entrou no pedido do Estúdio`)
  }
  return { send, inStudio, full }
}

/** Primary exit to the partner store. Only opens https URLs validated in api/parse.ts. */
export function StoreCta({ product, back }: { product: Product; back?: Overlay }) {
  const { open } = useStore()
  const link = resolvePartnerLink(product.links)
  if (link.kind === "none") {
    return (
      <button type="button" className="sa-btn sa-btn-primary sa-btn-block" onClick={() => open({ kind: "goToPiece", product, back })}>
        Ver na {product.partner.name} <ArrowUpRight size={18} aria-hidden="true" />
      </button>
    )
  }
  return (
    <a className="sa-btn sa-btn-primary sa-btn-block" href={link.href} target="_blank" rel={link.rel} data-link-kind={link.kind}>
      Ver na {product.partner.name} <ArrowUpRight size={18} aria-hidden="true" />
      <span className="sa-sr"> (abre o site da loja em nova aba)</span>
    </a>
  )
}

export function StoreLinkNote({ product }: { product: Product }) {
  const link = resolvePartnerLink(product.links)
  const text =
    link.kind === "affiliate"
      ? "Link comissionado: a compra acontece no site da loja e pode gerar comissão para o StylAI, sem custo extra para você."
      : link.kind === "direct"
        ? "Link da loja: a compra acontece no site dela."
        : "Esta peça ainda não tem link da loja disponível. A compra sempre acontece no site do parceiro."
  return <Hint>{text}</Hint>
}

export function FavButton({ product, onPhoto = false, size = 20 }: { product: Product; onPhoto?: boolean; size?: number }) {
  const toggle = useToggleFavorite()
  const requireAccount = useRequireAccount()
  const { notify } = useStore()
  // Optimistic: the heart flips at once and settles on the server answer.
  const pending = toggle.isPending ? toggle.variables : undefined
  const isFav = pending && pending.productId === product.id ? pending.save : product.favorite
  const run = (): void =>
    requireAccount("Entre para guardar peças no Closet.", () =>
      toggle.mutate(
        { productId: product.id, save: !isFav },
        {
          onSuccess: () => notify(isFav ? `${product.name} saiu do Closet` : `${product.name} favoritada no Closet`),
          onError: (e) => notify(messageOf(e)),
        },
      ),
    )
  return (
    <button type="button" className={`sa-iconbtn ${onPhoto ? "sa-photo-ctrl" : ""}`} aria-pressed={isFav} aria-label={isFav ? `Remover ${product.name} do Closet` : `Favoritar ${product.name}`} onClick={run}>
      <Heart size={size} weight={isFav ? "fill" : "regular"} />
    </button>
  )
}

interface PieceCardProps {
  product: Product
  role?: PieceRole
  warnings?: string[]
  back?: Overlay
  extra?: string
  /** First rows above the fold load eagerly. */
  eager?: boolean
}

export function PieceCard({ product, role, warnings = [], back, extra, eager = false }: PieceCardProps) {
  const { open } = useStore()
  const openDetail = (): void => open({ kind: "product", productId: product.id, back })
  const press = useLongPress(openDetail)
  const cover = product.images[0] ?? null
  return (
    <li className="relative min-w-0">
      <button
        type="button"
        className="sa-cardbtn block w-full text-left"
        onClick={() => {
          if (!press.consumed()) openDetail()
        }}
        onPointerDown={press.onPointerDown}
        onPointerUp={press.onPointerUp}
        onPointerLeave={press.onPointerLeave}
        onPointerCancel={press.onPointerCancel}
        onContextMenu={press.onContextMenu}
        aria-label={`${product.name}, ${priceText(product)}, ${product.partner.name}. Ver detalhes`}
      >
        <div className="sa-photo relative" style={{ aspectRatio: "3 / 4" }}>
          <Photo image={cover} alt="" className="absolute inset-0 h-full w-full" eager={eager} sizes="(min-width: 1024px) 20vw, 50vw" />
          {product.availability === "unavailable" ? (
            <span className="sa-badge sa-badge-photo absolute" style={{ left: 8, bottom: 8 }}>
              Indisponível
            </span>
          ) : null}
        </div>
        <div className="pt-3">
          <p className="sa-title-sm sa-clamp2">{product.name}</p>
          <p className="sa-caption sa-muted mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="sa-num font-semibold" style={{ color: "var(--text1)" }}>
              {priceText(product)}
            </span>
            <span>{product.partner.name}</span>
          </p>
          {role ? <p className="sa-caption sa-accent-text mt-1">{ROLE_LABEL[role]}</p> : null}
          {extra ? <p className="sa-caption sa-muted mt-1">{extra}</p> : null}
          {warnings.length > 0 ? <p className="sa-caption sa-warning-text mt-1">{warnings[0]}</p> : null}
        </div>
      </button>
      <div className="absolute" style={{ top: 6, right: 6 }}>
        <FavButton product={product} onPhoto />
      </div>
    </li>
  )
}

/** Grid placeholders while a page of products loads. */
export function PieceCardSkeletons({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="min-w-0" aria-hidden="true">
          <Skeleton className="w-full" style={{ aspectRatio: "3 / 4", borderRadius: "var(--r-card)" }} />
          <Skeleton className="mt-3" style={{ height: 14, width: "80%" }} />
          <Skeleton className="mt-2" style={{ height: 12, width: "50%" }} />
        </li>
      ))}
    </>
  )
}

function RatingLine({ product }: { product: Product }) {
  if (product.rating === null) return <p className="sa-body-sm sa-muted">Sem avaliações informadas pela loja (não é nota zero)</p>
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sa-body-sm">
      <StarRating value={product.rating} />
      <span className="sa-muted">
        nota do produto
        {product.reviewsCount !== null ? (
          <>
            {" "}
            · <span className="sa-num">{formatInt(product.reviewsCount)}</span> avaliações
          </>
        ) : (
          " · quantidade não informada"
        )}
      </span>
    </div>
  )
}

const FIT_LABEL = { ajustado: "Ajustado", regular: "Regular", amplo: "Amplo" } as const

export function ProductDetailSheet({ productId, back, role, warnings }: { productId: string; back?: Overlay; role?: PieceRole; warnings?: string[] }) {
  const { close } = useStore()
  const query = useProduct(productId)
  const product = query.data
  const [size, setSize] = useState<string | null>(null)
  const [imageIndex, setImageIndex] = useState(0)
  const studio = useSendToStudio(product)
  const self: Overlay = { kind: "product", productId, back }

  if (!product) {
    return (
      <Sheet title="Detalhe da peça" onClose={close}>
        {query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <div className="grid gap-4" aria-busy="true">
            <Skeleton className="mx-auto w-full" style={{ aspectRatio: "3 / 4", maxWidth: 320, borderRadius: "var(--r-card)" }} />
            <Skeleton style={{ height: 22, width: "70%" }} />
            <Skeleton style={{ height: 14, width: "40%" }} />
          </div>
        )}
      </Sheet>
    )
  }

  const rows: { label: string; value: string }[] = []
  if (product.material) rows.push({ label: "Material", value: product.material })
  if (product.color) rows.push({ label: "Cor", value: product.color })
  if (product.fit) rows.push({ label: "Caimento", value: FIT_LABEL[product.fit] })
  if (product.deliveryDays !== null) rows.push({ label: "Prazo informado", value: `${product.deliveryDays} dias` })
  if (product.sellerRating !== null) rows.push({ label: "Nota do vendedor", value: `${formatRating(product.sellerRating)} de 5` })
  const image = product.images[imageIndex] ?? product.images[0] ?? null
  const updated = formatDay(product.updatedAt)

  return (
    <Sheet
      title="Detalhe da peça"
      onClose={close}
      footer={
        <div className="grid gap-2">
          <StoreCta product={product} back={self} />
          <div className="flex gap-2">
            <button type="button" className="sa-btn sa-btn-secondary flex-1" onClick={studio.send} aria-disabled={studio.full || undefined}>
              <PenNib size={18} aria-hidden="true" />
              {studio.inStudio ? "Ver no Estúdio" : "Levar ao Estúdio"}
            </button>
            <div className="sa-btn sa-btn-secondary" style={{ padding: 0, width: 48 }}>
              <FavButton product={product} />
            </div>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 md:gap-5">
        <div className="sa-photo relative mx-auto w-full" style={{ aspectRatio: "3 / 4", maxWidth: 320 }}>
          <Photo image={image} alt={image?.alt ?? product.name} className="absolute inset-0 h-full w-full" eager sizes="320px" />
        </div>
        {product.images.length > 1 ? (
          <div role="radiogroup" aria-label="Fotos da peça" className="flex justify-center gap-2">
            {product.images.map((img, i) => (
              <button key={img.url} type="button" role="radio" aria-checked={i === imageIndex} aria-label={`Foto ${i + 1} de ${product.images.length}`} className="sa-thumbbtn" onClick={() => setImageIndex(i)}>
                <Photo image={img} alt="" className="h-full w-full" />
              </button>
            ))}
          </div>
        ) : null}
        <div>
          <h3 className="sa-subheading">{product.name}</h3>
          <p className="sa-caption sa-muted mt-1">
            {product.partner.name}
            {product.category ? ` · ${product.category.label}` : ""}
          </p>
          <p className="sa-num mt-2 text-lg font-semibold">{priceText(product)}</p>
          {role ? <p className="sa-caption sa-muted mt-1">{ROLE_NOTE[role]}</p> : null}
        </div>
        <RatingLine product={product} />
        {warnings && warnings.length > 0 ? (
          <Notice tone="warning">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </Notice>
        ) : null}

        <div>
          <p className="sa-title-sm">Tamanhos</p>
          {product.variants.length > 0 ? (
            <>
              <div role="radiogroup" aria-label="Tamanho" className="mt-2 flex flex-wrap gap-2">
                {product.variants.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    role="radio"
                    aria-checked={size === s.label}
                    aria-label={s.available ? `Tamanho ${s.label}` : `Tamanho ${s.label}, indisponível`}
                    className="sa-chip"
                    style={s.available ? undefined : { color: "var(--text2)", textDecoration: "line-through" }}
                    onClick={() => setSize(s.label)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {size && !product.variants.find((s) => s.label === size)?.available ? <p className="sa-caption sa-warning-text mt-2">Tamanho {size} indisponível nesta loja.</p> : null}
              <p className="sa-caption sa-muted mt-2">A escolha de tamanho acontece na loja; aqui serve para conferir a disponibilidade.</p>
            </>
          ) : (
            <p className="sa-body-sm sa-muted mt-1">Tamanhos não informados pela loja.</p>
          )}
        </div>

        <div>
          <p className="sa-title-sm">Medidas da peça</p>
          {product.measurements.length > 0 ? (
            <dl className="sa-divided mt-2">
              {product.measurements.map((m) => (
                <div key={m.label} className="flex justify-between gap-4 py-2 sa-body-sm">
                  <dt className="sa-muted">{m.label}</dt>
                  <dd className="sa-num m-0 font-semibold">{m.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="sa-body-sm sa-muted mt-1">Medidas não informadas pela loja.</p>
          )}
        </div>

        {rows.length > 0 ? (
          <dl className="sa-divided">
            {rows.map((r) => (
              <div key={r.label} className="flex justify-between gap-4 py-2 sa-body-sm">
                <dt className="sa-muted">{r.label}</dt>
                <dd className="m-0 text-right font-semibold">{r.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {updated ? <Hint>Preço e estoque conferidos na loja em {updated}; podem ter mudado desde então.</Hint> : null}
        <StoreLinkNote product={product} />
      </div>
    </Sheet>
  )
}

/** When the API has no usable link for a piece: says so instead of opening anything. */
export function GoToPieceSheet({ product, back }: { product: Product; back?: Overlay }) {
  const { close } = useStore()
  const link = resolvePartnerLink(product.links)
  return (
    <Sheet
      title={`Ver na ${product.partner.name}`}
      onClose={close}
      footer={
        <button type="button" className="sa-btn sa-btn-primary sa-btn-block" onClick={close}>
          {back ? "Voltar ao detalhe" : "Fechar"}
        </button>
      }
    >
      <div className="grid gap-4">
        <p className="sa-body-sm">
          <strong>{product.name}</strong> · {product.partner.name}
        </p>
        {link.kind === "none" ? (
          <Notice tone="info">
            <p className="font-semibold">Link da loja indisponível.</p>
            <p className="mt-1">A loja ainda não enviou um endereço válido para esta peça. Nada foi aberto. Tente de novo mais tarde.</p>
          </Notice>
        ) : (
          <StoreCta product={product} />
        )}
        <p className="sa-caption sa-muted flex gap-2">
          <Info size={16} className="flex-none" aria-hidden="true" />A compra acontece sempre no site do parceiro; o StylAI não processa pagamento.
        </p>
      </div>
    </Sheet>
  )
}
