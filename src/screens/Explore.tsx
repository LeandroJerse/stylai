/**
 * Explorar (home, public): editorial hero + catalog of partner stores, both from the API
 * (GET /explore/hero, GET /catalog/facets, GET /catalog/products). Filters live in the store and
 * are sent to the server; nothing is filtered or invented on the client.
 */
import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowDown, FunnelSimple, Heart, MagnifyingGlass, PenNib, X } from "@phosphor-icons/react"
import type { CatalogQuery, CatalogSort } from "../api/client"
import { useCatalog, useFacets, useHero } from "../api/queries"
import type { Facet } from "../api/types"
import { DEFAULT_EXPLORE, useStore, type ExploreQuery } from "../app/store"
import { useAuth } from "../auth/AuthProvider"
import { brand } from "../assets/brand"
import { formatMoney, plural } from "../lib/format"
import { INTRO_WORDS, introMode, introTotal, isTypingKey, markIntroSeen, playIntro, shouldRunIntro, type IntroController, type IntroMode } from "../lib/intro"
import { PieceCard, PieceCardSkeletons, priceText, useRequireAccount } from "../components/pieces"
import { EmptyState, ErrorState, LoadingState, Photo, Sheet, Skeleton, useReducedMotion } from "../components/ui"

// "O look" keeps a no-break space so the line breaks after "peça.".
const TITLE_WORDS = ["Escolha", "a", "peça.", "O look", "vem", "junto."]
const SEARCH_ID = "explorar-busca"
const SEARCH_MAX = 80

const SORT_OPTIONS: { id: CatalogSort; label: string }[] = [
  { id: "relevance", label: "Relevância" },
  { id: "newest", label: "Novidades" },
  { id: "price_asc", label: "Menor preço" },
  { id: "price_desc", label: "Maior preço" },
]

/** Price filter choices. They are only bounds sent to the API, not data about the catalog. */
const PRICE_BANDS: { id: string; min: number | null; max: number | null }[] = [
  { id: "all", min: null, max: null },
  { id: "0-150", min: null, max: 150 },
  { id: "150-300", min: 150, max: 300 },
  { id: "300-600", min: 300, max: 600 },
  { id: "600+", min: 600, max: null },
]

function bandLabel(b: { min: number | null; max: number | null }, currency: string): string {
  const m = (v: number): string => formatMoney(v, currency).replace(/,00$/, "")
  if (b.min === null && b.max === null) return "Qualquer preço"
  if (b.min === null && b.max !== null) return `Até ${m(b.max)}`
  if (b.max === null && b.min !== null) return `Acima de ${m(b.min)}`
  return `${m(b.min ?? 0)} a ${m(b.max ?? 0)}`
}

const bandOf = (q: ExploreQuery): string => PRICE_BANDS.find((b) => b.min === q.price.min && b.max === q.price.max)?.id ?? "all"

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Store filters → API query (search text debounced so typing does not fire a request per key). */
function useCatalogQuery(): CatalogQuery {
  const { explore } = useStore()
  const text = useDebounced(explore.text.trim(), 300)
  return { q: text || undefined, category: explore.category, partner: explore.partner, priceMin: explore.price.min, priceMax: explore.price.max, favorites: explore.favoritesOnly, sort: explore.sort }
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  const { go, open } = useStore()
  const hero = useHero()
  const facets = useFacets()
  const reduced = useReducedMotion()
  const h = hero.data ?? null
  const total = facets.data?.total ?? null
  const stores = facets.data ? facets.data.partners.length : null

  const goToCatalog = (): void => {
    document.getElementById("catalogo")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })
    document.getElementById(SEARCH_ID)?.focus({ preventScroll: true })
  }

  return (
    <section className="sa-hero" aria-labelledby="hero-title">
      <div className="sa-hero-photo">
        {hero.isPending ? (
          <Skeleton className="h-full w-full" />
        ) : h ? (
          <>
            <Photo image={h.image} alt={h.image.alt ?? h.product.name} className="h-full w-full" eager sizes="(min-width: 1024px) 50vw, 100vw" />
            <button type="button" className="sa-hero-tag" onClick={() => open({ kind: "product", productId: h.product.id })} aria-label={`Na foto: ${h.product.name}, ${h.product.partner.name}, ${priceText(h.product)}. Ver peça`}>
              <span className="min-w-0">
                <span className="sa-caption block sa-truncate font-semibold">{h.product.name}</span>
                <span className="sa-caption sa-muted block">
                  {h.product.partner.name} · <span className="sa-num">{priceText(h.product)}</span>
                </span>
              </span>
            </button>
          </>
        ) : (
          // No hero from the server (or it failed): a quiet brand block, never a stock photo.
          <div className="sa-hero-blank" aria-hidden="true">
            <img src={brand.monogram} alt="" width={240} height={398} />
          </div>
        )}
      </div>
      <div className="sa-hero-copy">
        <h1 id="hero-title" className="sa-hero-title">
          {TITLE_WORDS.map((w, i) => (
            // The space stays outside the inline-block word: trailing spaces inside one collapse.
            <Fragment key={i}>
              <span data-word="" className="sa-word">
                {w}
              </span>
              {i < TITLE_WORDS.length - 1 ? " " : null}
            </Fragment>
          ))}
        </h1>
        <p className="sa-hero-lede sa-muted sa-pretty">Descubra roupas das lojas parceiras e leve qualquer peça ao Estúdio para montar uma combinação. A compra acontece na loja.</p>
        <div className="sa-hero-actions">
          <button type="button" className="sa-btn sa-btn-primary relative" onClick={goToCatalog}>
            Explorar peças <ArrowDown size={18} aria-hidden="true" />
            <span className="sa-seam" aria-hidden="true" />
          </button>
          <button type="button" className="sa-btn sa-btn-secondary" onClick={() => go("estudio")}>
            <PenNib size={18} aria-hidden="true" /> Criar meu look
          </button>
        </div>
        {total !== null && stores !== null && stores > 0 ? (
          <p className="sa-caption sa-muted sa-hero-meta">
            {plural(total, "peça", "peças")} de {plural(stores, "loja parceira", "lojas parceiras")}
          </p>
        ) : null}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ filters */

function SelectField<T extends string>({ label, value, options, onChange, className = "", disabled = false }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; className?: string; disabled?: boolean }) {
  const id = useId()
  return (
    <div className={`sa-selectwrap ${className}`}>
      <label htmlFor={id} className="sa-sr">
        {label}
      </label>
      <select id={id} className="sa-select" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

const ALL = "__all__"
const facetOptions = (facets: Facet[], allLabel: string): { id: string; label: string }[] => [{ id: ALL, label: allLabel }, ...facets.map((f) => ({ id: f.id, label: f.count !== null ? `${f.label} (${f.count})` : f.label }))]

function CategoryField() {
  const { explore, setExplore } = useStore()
  const facets = useFacets()
  return <SelectField label="Categoria" value={explore.category ?? ALL} disabled={!facets.data} options={facetOptions(facets.data?.categories ?? [], "Todas as categorias")} onChange={(v) => setExplore({ category: v === ALL ? null : v })} />
}

function PartnerField() {
  const { explore, setExplore } = useStore()
  const facets = useFacets()
  return <SelectField label="Loja parceira" value={explore.partner ?? ALL} disabled={!facets.data} options={facetOptions(facets.data?.partners ?? [], "Todas as lojas")} onChange={(v) => setExplore({ partner: v === ALL ? null : v })} />
}

function PriceField() {
  const { explore, setExplore } = useStore()
  const facets = useFacets()
  const currency = facets.data?.priceRange?.currency ?? "BRL"
  return (
    <SelectField
      label="Faixa de preço"
      value={bandOf(explore)}
      options={PRICE_BANDS.map((b) => ({ id: b.id, label: bandLabel(b, currency) }))}
      onChange={(id) => {
        const b = PRICE_BANDS.find((x) => x.id === id) ?? PRICE_BANDS[0]
        if (b) setExplore({ price: { min: b.min, max: b.max } })
      }}
    />
  )
}

function FavoritesToggle() {
  const { explore, setExplore } = useStore()
  const requireAccount = useRequireAccount()
  return (
    <button type="button" className="sa-chip" aria-pressed={explore.favoritesOnly} onClick={() => requireAccount("Entre para ver suas peças favoritas.", () => setExplore({ favoritesOnly: !explore.favoritesOnly }))}>
      <Heart size={18} weight={explore.favoritesOnly ? "fill" : "regular"} aria-hidden="true" />
      Favoritos
    </button>
  )
}

function SortField({ className = "" }: { className?: string }) {
  const { explore, setExplore } = useStore()
  return <SelectField<CatalogSort> label="Ordenar por" value={explore.sort} options={SORT_OPTIONS.map((o) => ({ id: o.id, label: `Ordenar: ${o.label}` }))} onChange={(v) => setExplore({ sort: v })} className={className} />
}

interface ActiveChip {
  key: "category" | "partner" | "price" | "favorites" | "text"
  label: string
}

function useActiveChips(): ActiveChip[] {
  const { explore } = useStore()
  const facets = useFacets()
  const chips: ActiveChip[] = []
  const labelOf = (list: Facet[] | undefined, id: string): string => list?.find((f) => f.id === id)?.label ?? id
  if (explore.text.trim()) chips.push({ key: "text", label: `“${explore.text.trim()}”` })
  if (explore.category) chips.push({ key: "category", label: labelOf(facets.data?.categories, explore.category) })
  if (explore.partner) chips.push({ key: "partner", label: labelOf(facets.data?.partners, explore.partner) })
  if (explore.price.min !== null || explore.price.max !== null) chips.push({ key: "price", label: bandLabel(explore.price, facets.data?.priceRange?.currency ?? "BRL") })
  if (explore.favoritesOnly) chips.push({ key: "favorites", label: "Favoritos" })
  return chips
}

const clearPatch = (key: ActiveChip["key"]): Partial<ExploreQuery> =>
  key === "text" ? { text: "" } : key === "category" ? { category: null } : key === "partner" ? { partner: null } : key === "price" ? { price: { min: null, max: null } } : { favoritesOnly: false }

export function ExploreFiltersSheet() {
  const { close } = useStore()
  const query = useCatalogQuery()
  const catalog = useCatalog(query)
  const total = catalog.data?.pages[0]?.total ?? null
  return (
    <Sheet
      title="Filtros"
      onClose={close}
      footer={
        <button type="button" className="sa-btn sa-btn-primary sa-btn-block" onClick={close}>
          {catalog.isFetching && !catalog.isFetchingNextPage ? "Atualizando…" : total !== null ? `Mostrar ${plural(total, "peça", "peças")}` : "Mostrar peças"}
        </button>
      }
    >
      <div className="grid gap-5">
        <div>
          <p className="sa-fieldlabel">Categoria</p>
          <CategoryField />
        </div>
        <div>
          <p className="sa-fieldlabel">Loja parceira</p>
          <PartnerField />
        </div>
        <div>
          <p className="sa-fieldlabel">Preço</p>
          <PriceField />
        </div>
        <div>
          <p className="sa-fieldlabel">Só favoritos</p>
          <FavoritesToggle />
        </div>
        <p className="sa-caption sa-muted">Os filtros valem junto com a busca e ficam guardados enquanto você navega.</p>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ catalog */

/** Loads the next page when the sentinel scrolls into view (the button stays as a fallback). */
function useAutoLoad(enabled: boolean, load: () => void): (el: HTMLElement | null) => void {
  const loadRef = useRef(load)
  loadRef.current = load
  const observer = useRef<IntersectionObserver | null>(null)
  useEffect(() => () => observer.current?.disconnect(), [])
  return useCallback(
    (el: HTMLElement | null) => {
      observer.current?.disconnect()
      if (!el || !enabled || typeof IntersectionObserver === "undefined") return
      observer.current = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadRef.current()
        },
        { rootMargin: "600px 0px" },
      )
      observer.current.observe(el)
    },
    [enabled],
  )
}

function Catalog() {
  const { explore, setExplore, open } = useStore()
  const { status } = useAuth()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const query = useCatalogQuery()
  const catalog = useCatalog(query, !query.favorites || status === "signed-in")
  const chips = useActiveChips()
  const panelFilters = chips.filter((c) => c.key === "category" || c.key === "partner" || c.key === "price").length
  const items = catalog.data?.pages.flatMap((p) => p.items) ?? []
  const total = catalog.data?.pages[0]?.total ?? null
  const sentinel = useAutoLoad(!!catalog.hasNextPage && !catalog.isFetchingNextPage, () => void catalog.fetchNextPage())
  const reset = (): void => setExplore({ ...DEFAULT_EXPLORE, sort: explore.sort })
  const refreshing = catalog.isFetching && !catalog.isFetchingNextPage && !catalog.isPending
  const onlyFavorites = explore.favoritesOnly && chips.length === 1

  return (
    <section id="catalogo" className="sa-catalog" aria-labelledby="catalog-title">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <h2 id="catalog-title" className="sa-heading">
          Peças das lojas parceiras
        </h2>
        {total !== null ? (
          <p className="sa-body-sm sa-muted sa-num" aria-live="polite">
            {plural(total, "peça", "peças")}
            {chips.length > 0 ? " com estes filtros" : ""}
          </p>
        ) : null}
      </div>

      <div className="sa-searchbar mt-4">
        <span className="sa-seam" aria-hidden="true" />
        <MagnifyingGlass size={20} className="sa-searchbar-icon" aria-hidden="true" />
        <label htmlFor={SEARCH_ID} className="sa-sr">
          Buscar por nome, categoria, estilo ou loja
        </label>
        <input
          ref={inputRef}
          id={SEARCH_ID}
          type="search"
          name="busca"
          autoComplete="off"
          enterKeyHint="search"
          className="sa-field sa-searchbar-input"
          placeholder="Buscar por peça, categoria, estilo ou loja"
          value={explore.text}
          maxLength={SEARCH_MAX}
          onChange={(e) => setExplore({ text: e.target.value.slice(0, SEARCH_MAX) })}
        />
        {explore.text ? (
          <button
            type="button"
            className="sa-iconbtn sa-searchbar-clear"
            aria-label="Limpar busca"
            onClick={() => {
              setExplore({ text: "" })
              inputRef.current?.focus()
            }}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

      {/* Mobile: compact row + sheet. Tablet and up: every control inline. */}
      <div className="sa-filterbar sa-filterbar-compact mt-3">
        <button type="button" className="sa-chip" aria-haspopup="dialog" onClick={() => open({ kind: "exploreFilters" })}>
          <FunnelSimple size={18} aria-hidden="true" />
          Filtros{panelFilters > 0 ? <span className="sa-num"> · {panelFilters}</span> : null}
        </button>
        <FavoritesToggle />
        <SortField className="min-w-0 flex-1" />
      </div>
      <div className="sa-filterbar sa-filterbar-full mt-3">
        <CategoryField />
        <PartnerField />
        <PriceField />
        <FavoritesToggle />
        <SortField className="sa-filterbar-sort" />
      </div>

      {chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtros ativos">
          {chips.map((c) => (
            <button key={c.key} type="button" className="sa-chip sa-chip-active" onClick={() => setExplore(clearPatch(c.key))} aria-label={`Remover filtro ${c.label}`}>
              {c.label}
              <X size={14} weight="bold" aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="sa-btn-quiet sa-body-sm font-semibold" onClick={reset}>
            Limpar filtros
          </button>
        </div>
      ) : null}

      <div className="mt-6" aria-busy={catalog.isPending || refreshing || undefined}>
        {catalog.isPending ? (
          <>
            <p className="sa-sr" role="status">
              Carregando catálogo
            </p>
            <ul className="sa-grid" aria-hidden="true">
              <PieceCardSkeletons count={8} />
            </ul>
          </>
        ) : catalog.isError && items.length === 0 ? (
          <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            title={onlyFavorites ? "Você ainda não favoritou peças" : chips.length > 0 ? "Nenhuma peça encontrada" : "O catálogo está vazio"}
            action={
              chips.length > 0 ? (
                <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={reset}>
                  Limpar filtros
                </button>
              ) : undefined
            }
          >
            {onlyFavorites
              ? "Toque no coração de uma peça para guardá-la no Closet. Ela aparece aqui e lá."
              : chips.length > 0
                ? "Nenhuma peça atende a todos os filtros ao mesmo tempo. Remova um filtro ou tente outra palavra."
                : "As lojas parceiras ainda não enviaram peças. Volte mais tarde."}
          </EmptyState>
        ) : (
          <>
            <ul className="sa-grid" style={{ opacity: refreshing ? 0.6 : undefined, transition: "opacity var(--dur-fast) var(--ease)" }}>
              {items.map((p, i) => (
                <PieceCard key={p.id} product={p} eager={i < 4} />
              ))}
              {catalog.isFetchingNextPage ? <PieceCardSkeletons count={4} /> : null}
            </ul>
            {catalog.isFetchNextPageError ? (
              <ErrorState error={catalog.error} onRetry={() => void catalog.fetchNextPage()} compact className="mt-6" />
            ) : catalog.hasNextPage ? (
              <div ref={sentinel} className="mt-8 flex justify-center">
                {catalog.isFetchingNextPage ? (
                  <LoadingState label="Carregando mais peças…" />
                ) : (
                  <button type="button" className="sa-btn sa-btn-secondary" onClick={() => void catalog.fetchNextPage()}>
                    Carregar mais peças
                  </button>
                )}
              </div>
            ) : items.length > 8 ? (
              <p className="sa-caption sa-muted mt-8 text-center">Você chegou ao fim do catálogo.</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ opening (src/lib/intro.ts) */

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function detectIntroMode(): IntroMode {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  return introMode({ width: window.innerWidth, cores: nav.hardwareConcurrency || undefined, memoryGb: nav.deviceMemory, saveData: nav.connection?.saveData === true })
}

/**
 * Decides on the first render (so the layer is in the very first paint, no flash of the page),
 * plays once per session and ends on any interaction. The page underneath is always mounted.
 */
function useIntro(layerRef: { current: HTMLDivElement | null }, pageRef: { current: HTMLDivElement | null }): { running: boolean; mode: IntroMode; host: HTMLElement | null; skip: () => void } {
  const { tab, route } = useStore()
  const [initial] = useState(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    return { run: route.kind === "tab" && shouldRunIntro({ reducedMotion: reduced, startTab: tab, storage: sessionStore() }), mode: detectIntroMode() }
  })
  const [running, setRunning] = useState(initial.run)
  // The layer is portalled into .sa-root (keeps theme tokens) because the screen section has an
  // enter animation with a transform, which would become the containing block of position:fixed.
  const [host, setHost] = useState<HTMLElement | null>(null)
  const controller = useRef<IntroController | null>(null)

  const skip = useCallback(() => {
    controller.current?.finish()
    controller.current = null
    setRunning(false)
  }, [])

  useLayoutEffect(() => {
    if (running && !host) setHost(pageRef.current?.closest<HTMLElement>(".sa-root") ?? document.body)
  }, [running, host, pageRef])

  useLayoutEffect(() => {
    const layer = layerRef.current
    const page = pageRef.current
    if (!running || !host || !layer || !page) return
    markIntroSeen(sessionStore())
    controller.current = playIntro(layer, page, initial.mode)
    const done = window.setTimeout(skip, introTotal(initial.mode))
    // Any interaction ends the opening at once. A printable key also moves focus to the search,
    // so the character the person typed lands there instead of being lost.
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      if (isTypingKey(e) && !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) document.getElementById(SEARCH_ID)?.focus()
      skip()
    }
    const stop = (): void => skip()
    const events = ["pointerdown", "touchstart", "touchmove", "wheel", "scroll", "focusin", "input"] as const
    events.forEach((e) => window.addEventListener(e, stop, { passive: true, capture: e === "scroll" }))
    window.addEventListener("keydown", onKey)
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    motion.addEventListener("change", stop)
    return () => {
      window.clearTimeout(done)
      events.forEach((e) => window.removeEventListener(e, stop, { capture: e === "scroll" }))
      window.removeEventListener("keydown", onKey)
      motion.removeEventListener("change", stop)
      controller.current?.finish()
      controller.current = null
    }
  }, [running, host, initial.mode, layerRef, pageRef, skip])

  return { running, mode: initial.mode, host, skip }
}

/** The full-screen opening layer. Decorative (aria-hidden): the page below holds the same title. */
function IntroLayer({ layerRef, mode }: { layerRef: { current: HTMLDivElement | null }; mode: IntroMode }) {
  const { resolvedTheme } = useStore()
  const [markReady, setMarkReady] = useState(true)
  return (
    <div ref={layerRef} className="sa-intro" data-mode={mode} aria-hidden="true">
      <div className="sa-intro-veil" />
      {mode === "full" ? <div className="sa-intro-panel" /> : null}
      <div className="sa-intro-message">
        {markReady ? (
          <img
            className="sa-intro-mark"
            src={resolvedTheme === "dark" ? brand.monogramOnDark : brand.monogram}
            alt=""
            width={240}
            height={398}
            decoding="async"
            ref={(img) => {
              if (img && img.complete && img.naturalWidth === 0) setMarkReady(false)
            }}
            onError={() => setMarkReady(false)}
          />
        ) : null}
        <p className="sa-intro-title">
          {INTRO_WORDS.map((w, i) => (
            <Fragment key={i}>
              <span className="sa-intro-word">{w}</span>
              {i < INTRO_WORDS.length - 1 ? " " : null}
            </Fragment>
          ))}
        </p>
        <span className="sa-intro-thread" />
      </div>
    </div>
  )
}

export function ExploreScreen() {
  const pageRef = useRef<HTMLDivElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const intro = useIntro(layerRef, pageRef)
  const skipControl = (
    <button
      type="button"
      className="sa-introskip"
      // Keep the global "any interaction ends it" listeners from removing this button mid-click.
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onFocus={(e) => e.stopPropagation()}
      onClick={() => {
        intro.skip()
        document.getElementById(SEARCH_ID)?.focus({ preventScroll: true })
      }}
    >
      Pular animação
    </button>
  )
  return (
    <div ref={pageRef} className="sa-page sa-page-wide" data-intro={intro.running ? "running" : undefined}>
      {intro.running && intro.host
        ? createPortal(
            <>
              <IntroLayer layerRef={layerRef} mode={intro.mode} />
              {skipControl}
            </>,
            intro.host,
          )
        : null}
      <Hero />
      <Catalog />
    </div>
  )
}
