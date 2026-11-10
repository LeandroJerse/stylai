/**
 * Configurações (gear in Perfil): Conta, Plano, Aparência and Privacidade. Every action talks to
 * the API (PATCH /me, password change, verification e-mail, body data, account deletion).
 * Sub-sheets (senha, excluir conta, saldo) return here when closed.
 */
import { useId, useState } from "react"
import type { ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { SignOut } from "@phosphor-icons/react"
import { api } from "../api/client"
import { isApiError, messageOf } from "../api/errors"
import { keys, useBalance, useMeasurements, useSaveMeasurements } from "../api/queries"
import { useStore, type Overlay, type ThemePref } from "../app/store"
import { useAuth } from "../auth/AuthProvider"
import { nameError, NAME_MAX, newPasswordError, passwordChecks } from "../auth/validation"
import { formatDay, plural } from "../lib/format"
import { ErrorState, LoadingState, Notice, Segmented, Sheet, Switch } from "./ui"

const SECTIONS = [
  { id: "cfg-conta", label: "Conta" },
  { id: "cfg-plano", label: "Plano" },
  { id: "cfg-aparencia", label: "Aparência" },
  { id: "cfg-privacidade", label: "Privacidade" },
] as const

function Group({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="sa-cfg-group">
      <h3 id={`${id}-t`} className="sa-subheading">
        {title}
      </h3>
      {description ? <p className="sa-caption sa-muted mt-1 sa-pretty">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function AccountGroup({ self }: { self: Overlay }) {
  const { user, setUser, signOut } = useAuth()
  const { open, notify, go } = useStore()
  const [name, setName] = useState<string | null>(null)
  const [nameErr, setNameErr] = useState<string | null>(null)
  const nameId = useId()
  const emailId = useId()
  const update = useMutation({ mutationFn: (n: string) => api.me.update({ name: n }) })
  const resend = useMutation({ mutationFn: () => api.auth.resendVerification() })
  const [leaving, setLeaving] = useState(false)
  if (!user) return null
  const value = name ?? user.name
  const dirty = name !== null && name.trim() !== user.name
  const hasPassword = user.providers.includes("password")

  const saveName = (): void => {
    const err = nameError(value)
    setNameErr(err)
    if (err || !dirty || update.isPending) return
    update.mutate(value.trim(), {
      onSuccess: (u) => {
        setUser(u)
        setName(null)
        notify("Nome atualizado")
      },
      onError: (e) => setNameErr(isApiError(e) ? (e.fields.name ?? e.message) : messageOf(e)),
    })
  }

  return (
    <div className="grid gap-4">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          saveName()
        }}
      >
        <label htmlFor={nameId} className="sa-fieldlabel">
          Nome
        </label>
        <div className="flex gap-2">
          <input
            id={nameId}
            name="name"
            className="sa-field min-w-0 flex-1"
            value={value}
            maxLength={NAME_MAX}
            autoComplete="name"
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameErr ? `${nameId}-e` : undefined}
            onChange={(e) => {
              setName(e.target.value)
              setNameErr(null)
            }}
          />
          {dirty ? (
            <button type="submit" className="sa-btn sa-btn-primary sa-btn-sm flex-none" aria-disabled={update.isPending || undefined}>
              {update.isPending ? "Salvando…" : "Salvar"}
            </button>
          ) : null}
        </div>
        {nameErr ? (
          <p id={`${nameId}-e`} className="sa-caption sa-error-text mt-1">
            {nameErr}
          </p>
        ) : null}
      </form>
      <div>
        <label htmlFor={emailId} className="sa-fieldlabel">
          E-mail
        </label>
        <input id={emailId} className="sa-field" value={user.email} readOnly aria-describedby={`${emailId}-h`} />
        <p id={`${emailId}-h`} className="sa-caption sa-muted mt-1">
          {user.emailVerified ? "E-mail confirmado." : "E-mail ainda não confirmado."}
          {user.providers.includes("google") ? " Conta ligada ao Google." : ""}
        </p>
        {!user.emailVerified ? (
          <button
            type="button"
            className="sa-btn sa-btn-secondary sa-btn-sm mt-2"
            aria-disabled={resend.isPending || resend.isSuccess || undefined}
            onClick={() => {
              if (resend.isPending || resend.isSuccess) return
              resend.mutate(undefined, { onSuccess: () => notify(`Enviamos um novo link para ${user.email}`), onError: (e) => notify(messageOf(e)) })
            }}
          >
            {resend.isPending ? "Enviando…" : resend.isSuccess ? "Link enviado" : "Reenviar confirmação"}
          </button>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="sa-body-sm">Senha</p>
        {hasPassword ? (
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => open({ kind: "password", back: self })}>
            Alterar senha
          </button>
        ) : (
          <span className="sa-caption sa-muted text-right">Você entra com o Google; não há senha nesta conta.</span>
        )}
      </div>
      {user.createdAt ? <p className="sa-caption sa-muted">Conta criada em {formatDay(user.createdAt)}.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="sa-btn sa-btn-secondary sa-btn-sm"
          aria-disabled={leaving || undefined}
          onClick={() => {
            if (leaving) return
            setLeaving(true)
            void signOut().finally(() => {
              go("explorar")
              notify("Você saiu da conta")
            })
          }}
        >
          <SignOut size={18} aria-hidden="true" /> {leaving ? "Saindo…" : "Sair da conta"}
        </button>
        <button type="button" className="sa-btn sa-btn-danger sa-btn-sm" onClick={() => open({ kind: "deleteAccount", back: self })}>
          Excluir conta
        </button>
      </div>
    </div>
  )
}

function PlanGroup({ self }: { self: Overlay }) {
  const { open } = useStore()
  const balance = useBalance(true)
  if (balance.isPending) return <LoadingState />
  if (balance.isError) return <ErrorState error={balance.error} onRetry={() => void balance.refetch()} compact />
  const b = balance.data
  const renews = formatDay(b.renewsAt)
  return (
    <div className="grid gap-3">
      <p className="sa-body-sm">
        Plano <strong>{b.plan.name}</strong>
        {b.plan.tokensPerPeriod !== null && b.plan.period ? ` · ${plural(b.plan.tokensPerPeriod, "token", "tokens")} por ${b.plan.period === "day" ? "dia" : "mês"}` : ""}
      </p>
      <p className="sa-body-sm">
        Saldo: <strong className="sa-num">{plural(b.tokens, "token", "tokens")}</strong>
        {renews ? <span className="sa-muted"> · renova em {renews}</span> : null}
      </p>
      <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm justify-self-start" onClick={() => open({ kind: "tokens", back: self })}>
        Ver custos e planos
      </button>
    </div>
  )
}

function PrivacyGroup() {
  const { notify } = useStore()
  const qc = useQueryClient()
  const measurements = useMeasurements(true)
  const save = useSaveMeasurements()
  const [confirmWipe, setConfirmWipe] = useState(false)
  const wipe = useMutation({
    mutationFn: () => api.me.deleteAllBodyData(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.bodyPhotos })
      void qc.invalidateQueries({ queryKey: keys.measurements })
    },
  })
  const m = measurements.data
  return (
    <div className="grid gap-2">
      {m ? (
        <Switch
          checked={m.useInSearch}
          disabled={save.isPending}
          onChange={(v) => save.mutate({ ...m, useInSearch: v }, { onSuccess: () => notify(v ? "Medidas consideradas na seleção" : "Medidas ignoradas na seleção"), onError: (e) => notify(messageOf(e)) })}
          label="Usar medidas na seleção de tamanhos"
          description="Desligar faz a busca ignorar suas medidas; elas continuam salvas até você apagá-las."
        />
      ) : measurements.isError ? (
        <ErrorState error={measurements.error} onRetry={() => void measurements.refetch()} compact />
      ) : null}
      {confirmWipe ? (
        <Notice tone="warning">
          <p>Apagar as fotos do corpo e as medidas da sua conta? Isso não pode ser desfeito. O Closet e as preferências de compra continuam.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="sa-btn sa-btn-danger sa-btn-sm"
              aria-disabled={wipe.isPending || undefined}
              onClick={() => {
                if (wipe.isPending) return
                wipe.mutate(undefined, {
                  onSuccess: () => {
                    setConfirmWipe(false)
                    notify("Fotos do corpo e medidas apagadas")
                  },
                  onError: (e) => notify(messageOf(e)),
                })
              }}
            >
              {wipe.isPending ? "Apagando…" : "Apagar"}
            </button>
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm" onClick={() => setConfirmWipe(false)}>
              Cancelar
            </button>
          </div>
        </Notice>
      ) : (
        <button type="button" className="sa-btn sa-btn-danger sa-btn-sm justify-self-start" onClick={() => setConfirmWipe(true)}>
          Apagar fotos do corpo e medidas
        </button>
      )}
    </div>
  )
}

export function SettingsSheet() {
  const { theme, setTheme, close } = useStore()
  const self: Overlay = { kind: "settings" }
  return (
    <Sheet title="Configurações" onClose={close} description="Conta, plano, aparência e privacidade.">
      <nav aria-label="Seções das configurações" className="sa-cfg-nav">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className="sa-chip" onClick={() => document.getElementById(s.id)?.scrollIntoView({ block: "start" })}>
            {s.label}
          </button>
        ))}
      </nav>

      <div className="sa-divided">
        <Group id="cfg-conta" title="Conta">
          <AccountGroup self={self} />
        </Group>
        <Group id="cfg-plano" title="Plano e tokens" description="Gerar, editar e provar consomem tokens; busca, Match e Closet não.">
          <PlanGroup self={self} />
        </Group>
        <Group id="cfg-aparencia" title="Aparência" description="Vale neste aparelho. O botão de tema no topo também alterna claro e escuro.">
          <Segmented<ThemePref>
            label="Tema"
            value={theme}
            onChange={setTheme}
            options={[
              { id: "light", label: "Claro" },
              { id: "dark", label: "Escuro" },
              { id: "system", label: "Sistema" },
            ]}
            block
          />
        </Group>
        <Group id="cfg-privacidade" title="Privacidade e dados" description="Fotos do corpo e medidas ficam na sua conta e só são usadas para montar e provar looks.">
          <PrivacyGroup />
        </Group>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ password */

function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="mt-2 grid gap-1 sa-caption" aria-label="Requisitos da senha">
      {passwordChecks(value).map((c) => (
        <li key={c.id} className={c.ok ? "sa-success-text" : "sa-muted"}>
          {c.ok ? "✓" : "•"} {c.label}
          <span className="sa-sr">{c.ok ? " (atendido)" : " (pendente)"}</span>
        </li>
      ))}
    </ul>
  )
}

export function PasswordSheet() {
  const { close, notify } = useStore()
  const ids = { current: useId(), next: useId(), confirm: useId() }
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string; form?: string }>({})
  const change = useMutation({ mutationFn: () => api.auth.changePassword(current, next) })

  const submit = (): void => {
    const e: typeof errors = {}
    if (!current) e.current = "Informe a senha atual."
    const n = newPasswordError(next)
    if (n) e.next = n
    else if (next === current) e.next = "A nova senha precisa ser diferente da atual."
    if (confirm !== next) e.confirm = "As senhas não coincidem."
    setErrors(e)
    if (Object.keys(e).length > 0 || change.isPending) return
    change.mutate(undefined, {
      onSuccess: () => {
        notify("Senha alterada")
        close()
      },
      onError: (err) => {
        if (isApiError(err) && (err.fields.currentPassword || err.code === "invalid_credentials")) setErrors({ current: err.fields.currentPassword ?? err.message })
        else if (isApiError(err) && err.fields.newPassword) setErrors({ next: err.fields.newPassword })
        else setErrors({ form: messageOf(err) })
      },
    })
  }

  return (
    <Sheet
      title="Alterar senha"
      onClose={close}
      footer={
        <button type="submit" form="password-form" className="sa-btn sa-btn-primary sa-btn-block" aria-disabled={change.isPending || undefined}>
          {change.isPending ? "Alterando…" : "Alterar senha"}
        </button>
      }
    >
      <form
        id="password-form"
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}
        <div>
          <label htmlFor={ids.current} className="sa-fieldlabel">
            Senha atual
          </label>
          <input id={ids.current} type="password" className="sa-field" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} aria-invalid={errors.current ? true : undefined} aria-describedby={errors.current ? `${ids.current}-e` : undefined} />
          {errors.current ? (
            <p id={`${ids.current}-e`} className="sa-caption sa-error-text mt-1">
              {errors.current}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={ids.next} className="sa-fieldlabel">
            Nova senha
          </label>
          <input id={ids.next} type="password" className="sa-field" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={errors.next ? true : undefined} aria-describedby={`${ids.next}-e`} />
          {errors.next ? (
            <p id={`${ids.next}-e`} className="sa-caption sa-error-text mt-1">
              {errors.next}
            </p>
          ) : (
            <div id={`${ids.next}-e`}>
              <PasswordChecklist value={next} />
            </div>
          )}
        </div>
        <div>
          <label htmlFor={ids.confirm} className="sa-fieldlabel">
            Confirmar nova senha
          </label>
          <input id={ids.confirm} type="password" className="sa-field" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={errors.confirm ? true : undefined} aria-describedby={errors.confirm ? `${ids.confirm}-e` : undefined} />
          {errors.confirm ? (
            <p id={`${ids.confirm}-e`} className="sa-caption sa-error-text mt-1">
              {errors.confirm}
            </p>
          ) : null}
        </div>
        <p className="sa-caption sa-muted">Por segurança, as outras sessões abertas desta conta são encerradas.</p>
      </form>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ delete account */

const CONFIRM_WORD = "EXCLUIR"

export function DeleteAccountSheet() {
  const { close, go, notify, resetDraft } = useStore()
  const { user, signOut } = useAuth()
  const [typed, setTyped] = useState("")
  const fieldId = useId()
  const del = useMutation({ mutationFn: () => api.me.delete() })
  const ok = typed.trim().toUpperCase() === CONFIRM_WORD

  const run = (): void => {
    if (!ok || del.isPending) return
    del.mutate(undefined, {
      onSuccess: () => {
        resetDraft()
        void signOut().finally(() => {
          go("explorar")
          notify("Sua conta foi excluída")
        })
      },
      onError: (e) => notify(messageOf(e)),
    })
  }

  return (
    <Sheet
      title="Excluir conta"
      onClose={close}
      footer={
        <div className="grid gap-2">
          <button type="button" className="sa-btn sa-btn-danger sa-btn-block" aria-disabled={!ok || del.isPending || undefined} onClick={run}>
            {del.isPending ? "Excluindo…" : "Excluir conta definitivamente"}
          </button>
          <button type="button" className="sa-btn sa-btn-secondary sa-btn-block" onClick={close}>
            Cancelar
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
        <Notice tone="warning">
          <p className="font-semibold">Isso não pode ser desfeito.</p>
          <p className="mt-1">Apagamos a conta {user?.email ? <strong>{user.email}</strong> : null}, o Closet, os looks, as preferências, as fotos do corpo, as medidas e o saldo de tokens.</p>
        </Notice>
        <div>
          <label htmlFor={fieldId} className="sa-fieldlabel">
            Digite {CONFIRM_WORD} para confirmar
          </label>
          <input id={fieldId} className="sa-field" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      </div>
    </Sheet>
  )
}
