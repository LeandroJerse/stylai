/**
 * Perfil: body photos (PUT/DELETE /me/body-photos/:angle, analysed by the server) and optional
 * measurements (GET/PUT /me/measurements). Limits for files come from GET /studio/config.
 * Account, theme and privacy live in Configurações (gear in the header of this screen).
 */
import { useEffect, useId, useRef, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { ArrowsClockwise, CaretDown, CircleNotch, GearSix, Trash } from "@phosphor-icons/react"
import { messageOf } from "../api/errors"
import { useBalance, useBodyPhotos, useCapability, useCloset, useDeleteBodyPhoto, useMeasurements, useSaveMeasurements, useStudioConfig, useUploadBodyPhoto } from "../api/queries"
import type { BodyAngle, BodyPhoto, Measurements, StudioConfig } from "../api/types"
import { useStore } from "../app/store"
import { useAuth } from "../auth/AuthProvider"
import { brand } from "../assets/brand"
import { formatMB, plural } from "../lib/format"
import { checkImageFile, typesText } from "../lib/images"
import { ErrorState, LoadingState, Notice, Photo, Skeleton, Switch } from "../components/ui"
import { api } from "../api/client"
import { isApiError } from "../api/errors"
import { keys } from "../api/queries"
import { normalizePhoto } from "../lib/photo"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

/** Consent copy for policy "dev-v1". Describes today's technical behaviour; retention is not a final rule. */
const CONSENT_VERSION = "dev-v1"
const CONSENT_TEXT =
  "Autorizo o StylAI a guardar minha foto de forma privada e a enviar um link temporário dela ao provedor de prova virtual somente para gerar as prévias que eu pedir. Nesta fase de testes a foto expira em até 7 dias (regra provisória) e pode ser apagada por mim a qualquer momento."

/* ------------------------------------------------------------------ body photos */

const SLOTS: { id: BodyAngle; title: string; degrees: string; hint: string }[] = [
  { id: "front", title: "Frente", degrees: "0°", hint: "Peito e rosto para a câmera, braços soltos" },
  { id: "side", title: "Três quartos", degrees: "45°", hint: "Gire meio passo: um ombro mais perto da câmera" },
  { id: "profile", title: "Perfil", degrees: "90°", hint: "Totalmente de lado, olhar à frente" },
]

/**
 * Pose glyph inside each empty photo area: a geometric figure whose torso narrows as the body
 * turns, from Frente (0°) to Perfil (90°). Decorative only: the visible title and hint instruct.
 */
const POSE: Record<BodyAngle, { torso: number; turn: number; legGap: number }> = {
  front: { torso: 18, turn: 0, legGap: 5 },
  side: { torso: 13, turn: 45, legGap: 3.5 },
  profile: { torso: 8, turn: 90, legGap: 1.5 },
}

function PoseGlyph({ angle }: { angle: BodyAngle }) {
  const { torso, turn, legGap } = POSE[angle]
  const rad = (turn * Math.PI) / 180
  const dot = { x: 24 + 14 * Math.sin(rad), y: 64 + 3.5 * Math.cos(rad) }
  return (
    <svg className="sa-pose" width="48" height="72" viewBox="0 0 48 72" aria-hidden="true" focusable="false" data-pose={angle}>
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <circle cx="24" cy="10" r="6" />
        <rect x={24 - torso / 2} y="19" width={torso} height="24" rx={torso / 2.2} />
        <path d={`M${24 - legGap} 43v17M${24 + legGap} 43v17`} />
        <ellipse cx="24" cy="64" rx="14" ry="3.5" strokeWidth="1" strokeDasharray="2 3" />
      </g>
      <circle cx={dot.x.toFixed(2)} cy={dot.y.toFixed(2)} r="1.8" fill="currentColor" />
    </svg>
  )
}

/** The four states the owner asked for, from the server's validation of the exact stored photo. */
type SlotState = { label: string; tone: "muted" | "ok" | "warn" | "error"; testId: string }
function slotState(photo: BodyPhoto | null, busy: boolean): SlotState | null {
  if (busy || photo?.status === "processing") return { label: "Analisando…", tone: "muted", testId: "analyzing" }
  if (!photo) return null
  if (photo.inUse) return { label: "Aprovada", tone: "ok", testId: "approved" }
  if (photo.validation?.status === "needs_adjustment") return { label: "Precisa de ajuste", tone: "warn", testId: "needs-adjustment" }
  return { label: "Não foi possível validar", tone: "error", testId: "not-validated" }
}

const FRAMING_NOTE: Record<string, string> = {
  to_knees: "Mostra o corpo até os joelhos: serve para peças de cima. Para calças, saias e vestidos, use uma foto de corpo inteiro.",
}

interface SlotProps {
  meta: (typeof SLOTS)[number]
  /** Approved photo of this angle (used by the Estúdio when the provider needs this angle). */
  current: BodyPhoto | null
  /** Newer photo that did not pass (or is still being checked); the current one stays in use. */
  candidate: BodyPhoto | null
  config: StudioConfig | undefined
  /** True when the current provider needs this angle to generate. */
  required: boolean
  /** False: consent missing, uploads are blocked until it is given. */
  allowed: boolean
}

function PhotoSlot({ meta, current, candidate, config, required, allowed }: SlotProps) {
  const { notify } = useStore()
  const qc = useQueryClient()
  const upload = useUploadBodyPhoto()
  const remove = useDeleteBodyPhoto()
  const revalidate = useMutation({ mutationFn: () => api.me.revalidateBodyPhoto(meta.id), onSettled: () => qc.invalidateQueries({ queryKey: keys.bodyPhotos }) })
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const errorId = useId()

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const busy = upload.isPending || remove.isPending || revalidate.isPending
  const shown = candidate ?? current
  const state = slotState(shown, upload.isPending || revalidate.isPending)

  const onChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !config) return
    const problem = await checkImageFile(file, config)
    if (problem) {
      setError(problem)
      return
    }
    // Applies the camera orientation and removes metadata (EXIF/GPS) before anything leaves the device.
    let prepared: File
    try {
      prepared = await normalizePhoto(file)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível preparar a foto.")
      return
    }
    setError(null)
    setPreview(URL.createObjectURL(prepared))
    upload.mutate(
      { angle: meta.id, file: prepared },
      {
        onError: (err) => setError(isApiError(err) && err.code === "consent_required" ? "Autorize o uso da foto acima antes de enviar." : messageOf(err)),
        onSettled: () => setPreview(null),
      },
    )
  }

  // QA-012: deleting asks first (bytes are removed, there is no undo) and sends at most one request.
  const [confirmDelete, setConfirmDelete] = useState(false)
  const removing = useRef(false)
  const onRemove = (): void => {
    if (removing.current || remove.isPending) return
    removing.current = true
    remove.mutate(meta.id, {
      onSuccess: () => { setConfirmDelete(false); notify(`Foto ${meta.title} apagada`) },
      onError: (err) => setError(messageOf(err)),
      onSettled: () => { removing.current = false },
    })
  }

  const image = preview ? { url: preview, width: null, height: null, alt: null, focus: "50% 25%" } : (shown?.image ?? null)
  const accept = config?.acceptedImageTypes.join(",") || "image/*"
  const toneClass = state?.tone === "ok" ? "sa-badge sa-badge-success" : state?.tone === "warn" ? "sa-badge sa-badge-warning" : state?.tone === "error" ? "sa-badge sa-badge-error" : "sa-badge sa-badge-quiet"
  const framing = current?.validation?.framing ? FRAMING_NOTE[current.validation.framing] : undefined

  return (
    <li className="min-w-0" data-testid={`photo-slot-${meta.id}`}>
      <input ref={inputRef} type="file" accept={accept} className="sa-sr" tabIndex={-1} aria-hidden="true" onChange={(e) => void onChange(e)} data-testid={`photo-input-${meta.id}`} />
      <div className="sa-photo relative" style={{ aspectRatio: "3 / 4", boxShadow: error || state?.tone === "warn" || state?.tone === "error" ? "inset 0 0 0 2px var(--error)" : undefined }}>
        {image ? (
          <>
            <Photo image={{ ...image, focus: image.focus ?? "50% 25%" }} alt={`Foto ${meta.title}`} className="h-full w-full" />
            {state?.testId === "analyzing" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 sa-caption font-semibold" style={{ background: "var(--photo-control)" }} role="status">
                <CircleNotch size={20} className="sa-spin" aria-hidden="true" />
                {upload.isPending ? "Enviando e analisando…" : "Analisando…"}
              </div>
            ) : (
              <button type="button" className="sa-iconbtn sa-photo-ctrl absolute" style={{ top: 6, right: 6 }} onClick={() => !busy && setConfirmDelete(true)} disabled={busy} aria-expanded={confirmDelete} aria-label={`Apagar foto ${meta.title}`}>
                <Trash size={20} />
              </button>
            )}
          </>
        ) : (
          <button type="button" className="sa-poseslot sa-caption" onClick={() => inputRef.current?.click()} aria-label={`Adicionar foto ${meta.title} ${meta.degrees}`} aria-describedby={error ? errorId : undefined} disabled={!config || !allowed} data-testid={`add-photo-${meta.id}`}>
            <PoseGlyph angle={meta.id} />
            <span className="font-semibold">{allowed ? "Adicionar" : "Autorize acima"}</span>
          </button>
        )}
      </div>
      <div className="sa-posecap mt-2">
        <p className="sa-title-sm">
          {meta.title} <span className="sa-num sa-muted font-medium">{meta.degrees}</span>
        </p>
        <p className="sa-caption sa-muted">{meta.hint}</p>
        {/* "Usada para gerar" only when this photo is really eligible: approved and in use for a required angle. */}
        <p className="sa-caption mt-1" data-testid={`photo-role-${meta.id}`}>
          {!required ? (
            <span className="sa-muted">Guardada no Perfil; o provador atual usa só a frente</span>
          ) : current?.inUse && current.validation?.status !== "error" ? (
            <strong>Usada para gerar</strong>
          ) : (
            <span className="sa-warning-text">Necessária para gerar: envie uma foto aprovada</span>
          )}
        </p>
        {state && state.testId !== "analyzing" ? (
          <p className="mt-1" role="status">
            <span className={toneClass} data-testid={`photo-state-${meta.id}`} data-state={state.testId}>{state.label}</span>
          </p>
        ) : null}
      </div>
      {confirmDelete ? (
        <div className="sa-well mt-2 p-3 sa-caption" role="alertdialog" aria-label={`Apagar foto ${meta.title}?`} data-testid={`confirm-delete-${meta.id}`}>
          <p className="font-semibold">Apagar a foto {meta.title}?</p>
          <p className="mt-1">Ela deixa de ser usada na hora e o arquivo é removido do armazenamento. Não é possível desfazer.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={onRemove} disabled={remove.isPending} aria-label={`Confirmar exclusão da foto ${meta.title}`}>
              {remove.isPending ? "Apagando…" : "Apagar foto"}
            </button>
            <button type="button" className="sa-btn-quiet sa-btn-sm" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>Cancelar</button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p id={errorId} className="sa-caption sa-error-text mt-1" role="alert">
          {error}
        </p>
      ) : null}
      {candidate && !candidate.inUse && candidate.status !== "processing" && !error ? (
        <div className="sa-caption mt-1" role="alert" data-testid={`photo-issues-${meta.id}`}>
          {candidate.issues.map((i) => (
            <p key={i} className={candidate.validation?.status === "needs_adjustment" ? "sa-error-text" : ""}>{i}</p>
          ))}
          {current ? <p className="sa-muted mt-1">Sua foto anterior continua em uso até uma nova ser aprovada.</p> : null}
          {candidate.revalidatable ? (
            <button type="button" className="sa-btn-quiet sa-caption mt-1 font-semibold" style={{ paddingLeft: 0 }} aria-disabled={busy || undefined} onClick={() => !busy && revalidate.mutate()}>
              {candidate.validation?.status === "error" ? "Tentar validar de novo" : "Validar de novo com as regras atuais"}
            </button>
          ) : null}
        </div>
      ) : null}
      {framing && !candidate ? <p className="sa-caption sa-muted mt-1">{framing}</p> : null}
      {current && !candidate && current.advice.length > 0 ? (
        <p className="sa-caption mt-1" data-testid={`photo-advice-${meta.id}`}>
          <span className="font-semibold">Recomendação: </span>{current.advice.join(" ")}
        </p>
      ) : null}
      {image && state?.testId !== "analyzing" ? (
        <button type="button" className="sa-btn-quiet sa-caption mt-1 flex items-center gap-1 font-semibold" style={{ paddingLeft: 0 }} onClick={() => inputRef.current?.click()} aria-label={`Trocar foto ${meta.title}`} disabled={!allowed}>
          <ArrowsClockwise size={18} aria-hidden="true" /> Trocar foto
        </button>
      ) : null}
    </li>
  )
}

/* ------------------------------------------------------------------ section frame */

function Section({ id, title, description, children, collapsible = false, defaultOpen = true, aside }: { id: string; title: string; description: string; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean; aside?: ReactNode }) {
  const [openState, setOpen] = useState(defaultOpen)
  const panelId = useId()
  const isOpen = !collapsible || openState
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="grid gap-4 border-t py-8 lg:grid-cols-12 lg:gap-8" style={{ borderColor: "var(--border)" }}>
      <div className="lg:col-span-4">
        {collapsible ? (
          <button type="button" className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpen(!openState)} style={{ minHeight: 44 }}>
            <span>
              <h2 id={`${id}-t`} className="sa-subheading">
                {title}
              </h2>
              <span className="sa-body-sm sa-muted mt-1 block sa-pretty">{description}</span>
            </span>
            <CaretDown size={20} aria-hidden="true" style={{ transform: isOpen ? "rotate(180deg)" : undefined, transition: "transform var(--dur-fast) var(--ease)", marginTop: 4, flex: "none" }} />
          </button>
        ) : (
          <>
            <h2 id={`${id}-t`} className="sa-subheading">
              {title}
            </h2>
            <p className="sa-body-sm sa-muted mt-1 sa-pretty">{description}</p>
          </>
        )}
        {aside ? <div className="mt-3">{aside}</div> : null}
      </div>
      <div id={panelId} hidden={!isOpen} className="lg:col-span-8">
        {children}
      </div>
    </section>
  )
}

/** Versioned consent for the body photo (purpose: virtual try-on). Required before any upload. */
function PhotoConsent() {
  const qc = useQueryClient()
  const config = useStudioConfig()
  const state = useQuery({ queryKey: [...keys.bodyPhotos, "state"], queryFn: api.me.bodyPhotosState })
  const [agree, setAgree] = useState(false)
  const accept = useMutation({
    mutationFn: () => api.me.acceptPhotoConsent(config.data?.photoPolicyVersion ?? CONSENT_VERSION),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.bodyPhotos }),
  })
  if (state.isPending) return <Skeleton style={{ height: 96 }} />
  if (state.isError) return <ErrorState error={state.error} onRetry={() => void state.refetch()} compact />
  if (state.data.consent?.accepted) return <p className="sa-caption sa-muted" data-testid="consent-accepted">Uso da foto autorizado (termo {state.data.consent.policyVersion}).</p>
  if ((state.data.consent?.policyVersion ?? config.data?.photoPolicyVersion) !== CONSENT_VERSION) return <Notice tone="warning">O termo de uso da foto foi atualizado. Recarregue a página para ler a versão atual.</Notice>
  return (
    <div className="sa-well grid gap-3 p-4" data-testid="photo-consent">
      <p className="sa-body-sm sa-pretty">{CONSENT_TEXT}</p>
      <label className="flex items-start gap-3 sa-body-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" data-testid="consent-checkbox" />
        <span>Li e autorizo o uso da minha foto como descrito acima.</span>
      </label>
      {accept.isError ? <Notice tone="error">{messageOf(accept.error)}</Notice> : null}
      <button type="button" className="sa-btn sa-btn-primary sa-btn-sm justify-self-start" aria-disabled={!agree || accept.isPending || undefined} onClick={() => agree && !accept.isPending && accept.mutate()} data-testid="consent-accept">
        {accept.isPending ? "Salvando…" : "Autorizar"}
      </button>
    </div>
  )
}

function BodyPhotosSection() {
  const config = useStudioConfig()
  // Same query (and polling) the Estúdio uses: one source for the photos of this account.
  const state = useQuery({
    queryKey: [...keys.bodyPhotos, "state"],
    queryFn: api.me.bodyPhotosState,
    refetchInterval: (q) => (q.state.data?.items.some((p) => p.status === "processing") ? 2500 : false),
  })
  const items = state.data?.items ?? []
  const current = (a: BodyAngle): BodyPhoto | null => items.find((p) => p.angle === a && p.inUse) ?? null
  const candidate = (a: BodyAngle): BodyPhoto | null => items.find((p) => p.angle === a && !p.inUse) ?? null
  const requiredPhoto = config.data?.capabilities.bodyPhotoRequired === true
  const requiredAngles = state.data?.requiredAngles ?? ["front"]
  const allowed = !requiredPhoto || state.data?.consent?.accepted === true
  return (
    <Section id="fotos" title="Fotos do corpo" description="Cadastre até três fotos suas: frente, três quartos e perfil. Para gerar, o provador atual precisa só da foto de frente aprovada. São diferentes das fotos de roupas do Estúdio.">
      <div className="grid gap-5">
        {requiredPhoto ? <PhotoConsent /> : null}
        {state.isPending ? (
          <ul className="sa-photo-slots" aria-hidden="true">
            {SLOTS.map((s) => (
              <li key={s.id}>
                <Skeleton style={{ aspectRatio: "3 / 4", borderRadius: "var(--r-card)" }} />
              </li>
            ))}
          </ul>
        ) : state.isError ? (
          <ErrorState error={state.error} onRetry={() => void state.refetch()} compact />
        ) : (
          <ul className="sa-photo-slots">
            {SLOTS.map((m) => (
              <PhotoSlot key={m.id} meta={m} current={current(m.id)} candidate={candidate(m.id)} config={config.data} required={requiredAngles.includes(m.id)} allowed={allowed} />
            ))}
          </ul>
        )}
        {config.isError ? <ErrorState error={config.error} onRetry={() => void config.refetch()} compact /> : null}
        {state.data?.validator && !state.data.validator.available ? (
          <Notice tone="warning">O validador de fotos está indisponível agora. As fotos enviadas ficam como “Não foi possível validar” até você tentar de novo; isso é uma falha técnica, não um problema da sua foto.</Notice>
        ) : null}
        <div className="sa-well p-4">
          <p className="sa-title-sm">Como validamos</p>
          <p className="sa-caption sa-muted mt-1">
            {state.data?.validator?.where === "browser"
              ? "Nesta demonstração, um modelo de detecção de pose roda no seu navegador (a foto não sai do aparelho), sem serviço pago."
              : "Um modelo de detecção de pose roda nos servidores do StylAI, sem serviço pago."}{" "}
            Ele confere se há uma pessoa só, em pé, com a cabeça inteira na foto e o corpo pelo menos até os joelhos, se a posição combina com o espaço escolhido e se a foto não está escura ou desfocada. Não confere identidade nem se as três fotos são da mesma pessoa.
          </p>
        </div>
        <ul className="sa-divided sa-body-sm">
          {["Corpo inteiro, da cabeça aos pés, com um palmo de folga", "Luz natural de frente; evite janela atrás de você", "Roupa justa e lisa; cabelo preso se cobrir os ombros", "Câmera na altura do peito, a dois ou três passos"].map((t) => (
            <li key={t} className="py-2">
              {t}
            </li>
          ))}
        </ul>
        {config.data ? (
          <p className="sa-caption sa-muted">
            {typesText(config.data.acceptedImageTypes)}
            {config.data.maxImageBytes > 0 ? ` · até ${formatMB(config.data.maxImageBytes)}` : ""}
            {config.data.minImageHeight > 0 ? ` · pelo menos ${config.data.minImageHeight}px de altura` : ""}. As fotos ficam guardadas de forma privada na sua conta. Ao apagar pela lixeira, a foto deixa de ser usada imediatamente.
          </p>
        ) : null}
      </div>
    </Section>
  )
}

/* ------------------------------------------------------------------ measurements */

type Draft = { size: string; bust: string; waist: string; hips: string; height: string; useInSearch: boolean }

const RANGES = { bust: [60, 160], waist: [40, 160], hips: [60, 180], height: [120, 220] } as const
type NumKey = keyof typeof RANGES

const toDraft = (m: Measurements): Draft => ({
  size: m.size ?? "",
  bust: m.bustCm?.toString() ?? "",
  waist: m.waistCm?.toString() ?? "",
  hips: m.hipsCm?.toString() ?? "",
  height: m.heightCm?.toString() ?? "",
  useInSearch: m.useInSearch,
})

const fieldError = (k: NumKey, v: string): string | null => {
  if (v === "") return null
  const n = Number(v)
  const [min, max] = RANGES[k]
  return Number.isFinite(n) && n >= min && n <= max ? null : `Use um valor entre ${min} e ${max} cm.`
}

const toMeasurements = (d: Draft): Measurements => ({
  size: d.size || null,
  bustCm: d.bust ? Number(d.bust) : null,
  waistCm: d.waist ? Number(d.waist) : null,
  hipsCm: d.hips ? Number(d.hips) : null,
  heightCm: d.height ? Number(d.height) : null,
  useInSearch: d.useInSearch,
})

const FIELDS: { k: NumKey; label: string }[] = [
  { k: "bust", label: "Busto (cm)" },
  { k: "waist", label: "Cintura (cm)" },
  { k: "hips", label: "Quadril (cm)" },
  { k: "height", label: "Altura (cm)" },
]

function MeasurementsSection() {
  const { notify } = useStore()
  const query = useMeasurements(true)
  const config = useStudioConfig()
  const save = useSaveMeasurements()
  const [draft, setDraft] = useState<Draft | null>(null)
  const ids = { size: useId(), bust: useId(), waist: useId(), hips: useId(), height: useId() }
  const server = query.data ? toDraft(query.data) : null
  const current = draft ?? server
  const dirty = !!draft && !!server && JSON.stringify(draft) !== JSON.stringify(server)
  const errors = current ? FIELDS.map((f) => fieldError(f.k, current[f.k])) : []
  const invalid = errors.some((e) => e !== null)
  const sizes = config.data?.sizes.top ?? []

  const set = (patch: Partial<Draft>): void => setDraft((d) => ({ ...(d ?? server ?? toDraft({ size: null, bustCm: null, waistCm: null, hipsCm: null, heightCm: null, useInSearch: true })), ...patch }))

  const submit = (): void => {
    if (!current || invalid || save.isPending) return
    save.mutate(toMeasurements(current), {
      onSuccess: () => {
        setDraft(null)
        notify("Medidas salvas")
      },
      onError: (e) => notify(messageOf(e)),
    })
  }

  return (
    <Section id="medidas" title="Medidas" description="Opcionais. A geração funciona sem elas; com elas, a busca prioriza peças no seu tamanho.">
      {query.isPending ? (
        <LoadingState />
      ) : query.isError || !current ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} compact />
      ) : (
        <form
          className="grid gap-4"
          style={{ maxWidth: 520 }}
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div>
            <label htmlFor={ids.size} className="sa-fieldlabel">
              Tamanho de roupa
            </label>
            <select id={ids.size} name="size" className="sa-field" value={current.size} onChange={(e) => set({ size: e.target.value })}>
              <option value="">Não informar</option>
              {/* Keep a saved size even if the server grid no longer lists it. */}
              {[...new Set([...(current.size && !sizes.includes(current.size) ? [current.size] : []), ...sizes])].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {FIELDS.map((f, i) => {
              const err = errors[i] ?? null
              const id = ids[f.k]
              return (
                <div key={f.k}>
                  <label htmlFor={id} className="sa-caption sa-muted mb-1 block">
                    {f.label}
                  </label>
                  <input id={id} name={f.k} autoComplete="off" className="sa-field sa-num" inputMode="numeric" value={current[f.k]} aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-e` : undefined} onChange={(e) => set({ [f.k]: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
                  {err ? (
                    <p id={`${id}-e`} className="sa-caption sa-error-text mt-1">
                      {err}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
          <Switch checked={current.useInSearch} onChange={(v) => set({ useInSearch: v })} label="Considerar medidas na seleção" description="Quando ligado, a busca usa suas medidas para escolher tamanhos. Não presumimos medidas pela foto." />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="sa-btn sa-btn-primary" aria-disabled={!dirty || invalid || save.isPending || undefined}>
              {save.isPending ? "Salvando…" : "Salvar medidas"}
            </button>
            {dirty ? (
              <button type="button" className="sa-btn-quiet sa-body-sm" onClick={() => setDraft(null)}>
                Descartar alterações
              </button>
            ) : null}
          </div>
        </form>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------------ screen */

export function ProfileScreen() {
  const { open, resolvedTheme } = useStore()
  const { user } = useAuth()
  const balance = useBalance(true)
  const closet = useCloset(true)
  const measurementsOn = useCapability("measurements")
  const photos = useBodyPhotos(true)
  const front = photos.data?.find((p) => p.angle === "front" && p.status === "ready")
  const avatar = user?.avatarUrl ? { url: user.avatarUrl, width: null, height: null, alt: null, focus: null } : null

  return (
    <div className="sa-page">
      <header className="mb-2 flex flex-wrap items-center gap-4">
        <div className="flex-none overflow-hidden rounded-full" style={{ width: 72, height: 72, background: "var(--surface2)", boxShadow: "0 0 0 1px var(--border)" }}>
          {avatar ? (
            <Photo image={avatar} alt="" className="h-full w-full" />
          ) : front ? (
            <img src={front.image.url} alt="" className="h-full w-full" style={{ objectFit: "cover", objectPosition: "50% 10%", transform: "scale(1.8)", transformOrigin: "50% 8%" }} />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <img src={resolvedTheme === "dark" ? brand.monogramOnDark : brand.monogram} alt="" width={240} height={398} style={{ height: 34, width: "auto" }} />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1" style={{ minWidth: 180 }}>
          <h1 className="sa-display">Perfil</h1>
          <p className="sa-body-sm sa-muted mt-1">
            {user?.name.trim() || user?.email || "Sua conta"}
            {balance.data ? ` · plano ${balance.data.plan.name}` : ""}
            {closet.data ? ` · ${plural(closet.data.looks.length, "look", "looks")} no Closet` : ""}
          </p>
        </div>
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm flex-none" onClick={() => open({ kind: "settings" })} aria-haspopup="dialog" aria-label="Configurações: conta, plano, aparência e privacidade">
          <GearSix size={20} aria-hidden="true" />
          <span className="sa-cfg-label">Configurações</span>
        </button>
      </header>

      {user && !user.emailVerified ? (
        <Notice tone="warning" className="mb-4">
          <p>Confirme seu e-mail ({user.email}) para proteger a conta. O link de confirmação pode ser reenviado em Configurações.</p>
        </Notice>
      ) : null}

      <BodyPhotosSection />
      {measurementsOn ? (
        <MeasurementsSection />
      ) : (
        <section aria-labelledby="medidas-off" className="border-t py-8" style={{ borderColor: "var(--border)" }}>
          <h2 id="medidas-off" className="sa-subheading">Medidas</h2>
          <p className="sa-body-sm sa-muted mt-1" data-testid="measurements-unavailable">As medidas do corpo ainda não estão disponíveis nesta versão. As fotos acima já bastam para gerar.</p>
        </section>
      )}
    </div>
  )
}
