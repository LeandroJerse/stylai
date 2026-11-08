import { useEffect, useId, useRef, useState } from "react"
import type { CSSProperties, ReactNode, RefObject } from "react"
import { ArrowClockwise, Info, Warning, WarningCircle, CheckCircle, X, WifiSlash } from "@phosphor-icons/react"
import { brand } from "../assets/brand"
import type { ImageAsset } from "../api/types"
import { isApiError, messageOf } from "../api/errors"

/* ------------------------------------------------------------------ hooks */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = (): void => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return reduced
}

export function useMediaQuery(q: string): boolean {
  const [match, setMatch] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(q).matches))
  useEffect(() => {
    const query = window.matchMedia(q)
    const update = (): void => setMatch(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [q])
  return match
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Focus trap + Escape for a modal panel. Focus return is handled by the store (it knows the opener). */
export function useModal(panelRef: RefObject<HTMLElement | null>, onClose: () => void, initialFocus?: RefObject<HTMLElement | null>): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const panel = panelRef.current
    const items = (): HTMLElement[] => (panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : [])
    ;(initialFocus?.current ?? items()[0] ?? panel)?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== "Tab") return
      const list = items()
      const first = list[0]
      const last = list[list.length - 1]
      if (!first || !last) return
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [panelRef, initialFocus])
}

/** Long press (450ms) as an optional shortcut; click still works. */
export function useLongPress(onLong: () => void, ms = 450) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const clear = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  return {
    onPointerDown: () => {
      fired.current = false
      clear()
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLong()
      }, ms)
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: (e: { preventDefault: () => void }) => {
      if (fired.current) e.preventDefault()
    },
    /** True when the long press already opened; the following click should be ignored. */
    consumed: () => {
      const was = fired.current
      fired.current = false
      return was
    },
  }
}

/* ------------------------------------------------------------------ media */

interface PhotoProps {
  image: ImageAsset | null
  alt: string
  className?: string
  style?: CSSProperties
  fit?: "cover" | "contain"
  eager?: boolean
  /** Hint for the browser's choice of resolution when the server sends a resizable URL. */
  sizes?: string
}

/**
 * Image from the API. Reserves its box (aspect ratio from width/height when known), shows the
 * surface colour while loading and a quiet "Imagem indisponível" when the URL fails or is missing.
 */
export function Photo({ image, alt, className = "", style, fit = "cover", eager = false, sizes }: PhotoProps) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [image?.url])
  if (!image || failed) {
    return (
      <div role="img" aria-label={alt || "Imagem indisponível"} className={`flex flex-col items-center justify-center gap-2 ${className}`} style={{ background: "var(--surface2)", ...style }}>
        <img src={brand.monogram} alt="" width={240} height={398} style={{ height: 28, width: "auto", opacity: 0.5 }} />
        <span className="sa-caption sa-muted">Imagem indisponível</span>
      </div>
    )
  }
  return (
    <img
      src={image.url}
      alt={alt}
      width={image.width ?? undefined}
      height={image.height ?? undefined}
      sizes={sizes}
      loading={eager ? undefined : "lazy"}
      fetchPriority={eager ? "high" : undefined}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      className={className}
      style={{ objectFit: fit, objectPosition: image.focus ?? "50% 50%", width: "100%", height: "100%", background: "var(--surface2)", ...style }}
    />
  )
}

export function BrandLockup({ dark, compact = false }: { dark: boolean; compact?: boolean }) {
  return (
    <span className="flex items-center gap-2" translate="no">
      <img src={dark ? brand.monogramOnDark : brand.monogram} alt="" width={240} height={398} style={{ height: compact ? 26 : 30, width: "auto" }} />
      <img src={dark ? brand.wordmarkOnDark : brand.wordmark} alt="StylAI" width={560} height={197} style={{ height: compact ? 17 : 19, width: "auto" }} />
    </span>
  )
}

/* ------------------------------------------------------------------ overlays */

interface SheetProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  leading?: ReactNode
  description?: string
}

export function Sheet({ title, onClose, children, footer, leading, description }: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()
  const descId = useId()
  useModal(panelRef, onClose)
  return (
    <div className="sa-overlay">
      <div className="sa-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1} className="sa-sheet">
        <div className="sa-grabber" aria-hidden="true" />
        <div className="flex items-center gap-1 py-2 pl-4 pr-2 md:pl-6 md:pt-5">
          {leading}
          <h2 id={titleId} className="sa-heading min-w-0 flex-1">
            {title}
          </h2>
          <button type="button" className="sa-iconbtn" aria-label="Fechar" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
        {description ? (
          <p id={descId} className="sa-body-sm sa-muted px-4 pb-3 md:px-6">
            {description}
          </p>
        ) : null}
        <div className="sa-sheet-body">{children}</div>
        {footer ? <div className="sa-sheet-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ small controls */

export function Notice({ tone = "info", children, className = "" }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode; className?: string }) {
  const Icon = tone === "error" ? WarningCircle : tone === "warning" ? Warning : tone === "success" ? CheckCircle : Info
  return (
    <div className={`sa-notice sa-notice-${tone} ${className}`} role={tone === "error" ? "alert" : undefined}>
      <Icon size={20} className="mt-px flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function Hint({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`sa-caption sa-muted flex items-start gap-2 ${className}`}>
      <Info size={16} className="mt-px flex-none" aria-hidden="true" />
      <span className="sa-pretty">{children}</span>
    </p>
  )
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
  block?: boolean
}

export function Segmented<T extends string>({ label, value, options, onChange, block = false }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={`sa-segmented ${block ? "sa-segmented-block" : ""}`}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          tabIndex={value === o.id ? 0 : -1}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return
            e.preventDefault()
            const i = options.findIndex((x) => x.id === value)
            const next = options[(i + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length]
            if (next) {
              onChange(next.id)
              const group = e.currentTarget.parentElement
              window.requestAnimationFrame(() => group?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
            }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label, description, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p id={`${id}-l`} className="sa-title-sm">
          {label}
        </p>
        {description ? (
          <p id={`${id}-d`} className="sa-caption sa-muted mt-1 sa-pretty">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={description ? `${id}-d` : undefined}
        aria-disabled={disabled || undefined}
        className="sa-switch -my-2"
        onClick={() => {
          if (!disabled) onChange(!checked)
        }}
      />
    </div>
  )
}

export interface ToastState {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

export function Toast({ toast, onDismiss, top = false }: { toast: ToastState | null; onDismiss: () => void; top?: boolean }) {
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(onDismiss, toast.action ? 6000 : 3800)
    return () => window.clearTimeout(t)
  }, [toast, onDismiss])
  return (
    <div className={`sa-toastwrap ${top ? "sa-toastwrap-top" : ""}`} aria-live="polite">
      {toast ? (
        <div key={toast.id} className="sa-toast" role="status">
          <span className="min-w-0 flex-1 py-2">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.run()
                onDismiss()
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" aria-label="Fechar aviso" onClick={onDismiss} style={{ textDecoration: "none", padding: 0, width: 44 }} className="flex items-center justify-center">
            <X size={18} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ data states */

/** Placeholder blocks while data loads (no fake content, just shapes). */
export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`sa-skeleton ${className}`} style={style} aria-hidden="true" />
}

export function LoadingState({ label = "Carregando…", className = "" }: { label?: string; className?: string }) {
  return (
    <p className={`sa-body-sm sa-muted flex items-center gap-2 ${className}`} role="status">
      <span className="sa-spinner" aria-hidden="true" />
      {label}
    </p>
  )
}

/**
 * Error block for a failed request. "Not connected" (no API URL) and offline get their own copy;
 * everything else shows the server message and a retry.
 */
export function ErrorState({ error, onRetry, className = "", compact = false }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  const notConfigured = isApiError(error) && error.code === "not_configured"
  const offline = isApiError(error) && error.code === "network"
  const Icon = notConfigured || offline ? WifiSlash : WarningCircle
  return (
    <div className={`sa-state ${compact ? "sa-state-compact" : ""} ${className}`} role="alert">
      <Icon size={compact ? 22 : 28} className="sa-state-icon" aria-hidden="true" />
      <p className="sa-title-sm">{notConfigured ? "Servidor não conectado" : offline ? "Sem conexão" : "Não foi possível carregar"}</p>
      <p className="sa-body-sm sa-muted sa-pretty">{notConfigured ? "Este app ainda não foi ligado ao servidor do StylAI. Nenhum dado é mostrado até que a conexão seja configurada." : messageOf(error)}</p>
      {onRetry && !notConfigured ? (
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm mt-2" onClick={onRetry}>
          <ArrowClockwise size={18} aria-hidden="true" /> Tentar de novo
        </button>
      ) : null}
    </div>
  )
}

export function EmptyState({ title, children, action, className = "" }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`sa-state ${className}`}>
      <img src={brand.monogram} alt="" width={240} height={398} className="sa-state-mark" />
      <p className="sa-title-sm">{title}</p>
      {children ? <div className="sa-body-sm sa-muted sa-pretty">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
