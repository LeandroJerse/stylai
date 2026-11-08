/**
 * Perfil: body photos (PUT/DELETE /me/body-photos/:angle, analysed by the server) and optional
 * measurements (GET/PUT /me/measurements). Limits for files come from GET /studio/config.
 * Account, theme and privacy live in Configurações (gear in the header of this screen).
 */
import { useEffect, useId, useRef, useState } from "react"
import type { ChangeEvent, ReactNode } from "react"
import { ArrowsClockwise, CaretDown, Check, CircleNotch, GearSix, Trash } from "@phosphor-icons/react"
import { messageOf } from "../api/errors"
import { useBalance, useBodyPhotos, useCloset, useDeleteBodyPhoto, useMeasurements, useSaveMeasurements, useStudioConfig, useUploadBodyPhoto } from "../api/queries"
import type { BodyAngle, BodyPhoto, Measurements, StudioConfig } from "../api/types"
import { useStore } from "../app/store"
import { useAuth } from "../auth/AuthProvider"
import { brand } from "../assets/brand"
import { formatMB, plural } from "../lib/format"
import { checkImageFile, typesText } from "../lib/images"
import { ErrorState, LoadingState, Notice, Photo, Skeleton, Switch } from "../components/ui"

/* ------------------------------------------------------------------ body photos */

const SLOTS: { id: BodyAngle; title: string; degrees: string; hint: string }[] = [
  { id: "front", title: "Frente", degrees: "0°", hint: "Peito e rosto para a câmera, braços soltos" },
  { id: "side", title: "Lateral", degrees: "45°", hint: "Gire meio passo: ombro direito mais perto da câmera" },
  { id: "profile", title: "Perfil", degrees: "90°", hint: "Totalmente de lado: lado direito para a câmera, olhar à frente" },
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

interface SlotProps {
  meta: (typeof SLOTS)[number]
  photo: BodyPhoto | null
  config: StudioConfig | undefined
}

function PhotoSlot({ meta, photo, config }: SlotProps) {
  const { notify } = useStore()
  const upload = useUploadBodyPhoto()
  const remove = useDeleteBodyPhoto()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const errorId = useId()

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const busy = upload.isPending || remove.isPending
  const processing = upload.isPending || photo?.status === "processing"
  const rejected = photo?.status === "rejected"

  const onChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file || !config) return
    const problem = await checkImageFile(file, config)
    if (problem) {
      setError(problem)
      return
    }
    setError(null)
    setPreview(URL.createObjectURL(file))
    upload.mutate(
      { angle: meta.id, file },
      {
        onError: (err) => setError(messageOf(err)),
        onSettled: () => setPreview(null),
      },
    )
  }

  const onRemove = (): void =>
    remove.mutate(meta.id, {
      onSuccess: () => notify(`Foto ${meta.title} apagada`),
      onError: (err) => notify(messageOf(err)),
    })

  const image = preview ? { url: preview, width: null, height: null, alt: null, focus: "50% 25%" } : (photo?.image ?? null)
  const accept = config?.acceptedImageTypes.join(",") || "image/*"

  return (
    <li className="min-w-0">
      <input ref={inputRef} type="file" accept={accept} className="sa-sr" tabIndex={-1} aria-hidden="true" onChange={(e) => void onChange(e)} />
      <div className="sa-photo relative" style={{ aspectRatio: "3 / 4", boxShadow: error || rejected ? "inset 0 0 0 2px var(--error)" : undefined }}>
        {image ? (
          <>
            <Photo image={{ ...image, focus: image.focus ?? "50% 25%" }} alt={`Foto ${meta.title}`} className="h-full w-full" />
            {processing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 sa-caption font-semibold" style={{ background: "var(--photo-control)" }} role="status">
                <CircleNotch size={20} className="sa-spin" aria-hidden="true" />
                {upload.isPending ? "Enviando…" : "Analisando…"}
              </div>
            ) : (
              <button type="button" className="sa-iconbtn sa-photo-ctrl absolute" style={{ top: 6, right: 6 }} onClick={onRemove} aria-disabled={busy || undefined} aria-label={`Apagar foto ${meta.title}`}>
                <Trash size={20} />
              </button>
            )}
          </>
        ) : (
          <button type="button" className="sa-poseslot sa-caption" onClick={() => inputRef.current?.click()} aria-label={`Adicionar foto ${meta.title} ${meta.degrees}`} aria-describedby={error ? errorId : undefined} disabled={!config}>
            <PoseGlyph angle={meta.id} />
            <span className="font-semibold">Adicionar</span>
          </button>
        )}
      </div>
      <div className="sa-posecap mt-2">
        <p className="sa-title-sm">
          {meta.title} <span className="sa-num sa-muted font-medium">{meta.degrees}</span>
        </p>
        <p className="sa-caption sa-muted">{meta.hint}</p>
      </div>
      {error ? (
        <p id={errorId} className="sa-caption sa-error-text mt-1" role="alert">
          {error}
        </p>
      ) : null}
      {rejected && !error ? (
        <div className="sa-caption sa-error-text mt-1" role="alert">
          <p className="font-semibold">Foto recusada na análise.</p>
          {photo.issues.map((i) => (
            <p key={i}>{i}</p>
          ))}
        </div>
      ) : null}
      {image && !processing ? (
        <button type="button" className="sa-btn-quiet sa-caption mt-1 flex items-center gap-1 font-semibold" style={{ paddingLeft: 0 }} onClick={() => inputRef.current?.click()} aria-label={`Trocar foto ${meta.title}`}>
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

function BodyPhotosSection() {
  const photos = useBodyPhotos(true)
  const config = useStudioConfig()
  const byAngle = (a: BodyAngle): BodyPhoto | null => photos.data?.find((p) => p.angle === a) ?? null
  const ready = photos.data?.filter((p) => p.status === "ready") ?? []
  return (
    <Section id="fotos" title="Fotos do corpo" description="Opcionais. Usadas para a prova no corpo; diferentes das referências de roupa do Estúdio. Siga a pose desenhada em cada espaço.">
      <div className="grid gap-5">
        {photos.isPending ? (
          <ul className="grid grid-cols-3 gap-3" style={{ maxWidth: 520 }} aria-hidden="true">
            {SLOTS.map((s) => (
              <li key={s.id}>
                <Skeleton style={{ aspectRatio: "3 / 4", borderRadius: "var(--r-card)" }} />
              </li>
            ))}
          </ul>
        ) : photos.isError ? (
          <ErrorState error={photos.error} onRetry={() => void photos.refetch()} compact />
        ) : (
          <ul className="grid grid-cols-3 gap-3" style={{ maxWidth: 520 }}>
            {SLOTS.map((m) => (
              <PhotoSlot key={m.id} meta={m} photo={byAngle(m.id)} config={config.data} />
            ))}
          </ul>
        )}
        {config.isError ? <ErrorState error={config.error} onRetry={() => void config.refetch()} compact /> : null}
        {ready.length > 0 ? (
          <div className="sa-well p-4">
            <p className="sa-title-sm">Aprovadas na análise</p>
            <ul className="mt-2 grid gap-1 sa-caption">
              {ready.map((p) => (
                <li key={p.angle} className="flex gap-2">
                  <Check size={16} className="mt-px flex-none" aria-hidden="true" />
                  {SLOTS.find((s) => s.id === p.angle)?.title}
                  {p.issues.length > 0 ? ` · ${p.issues.join("; ")}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
            {config.data.minImageHeight > 0 ? ` · pelo menos ${config.data.minImageHeight}px de altura` : ""}. As fotos são guardadas na sua conta e podem ser apagadas a qualquer momento em Configurações.
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
      <MeasurementsSection />
    </div>
  )
}
