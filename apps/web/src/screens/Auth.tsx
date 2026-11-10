/**
 * Account screens (hash routes, see app/routes.ts): entrar, criar-conta, recuperar-senha and
 * redefinir-senha (reached from the e-mail link `#/redefinir-senha?token=…`).
 * E-mail/senha go to /auth/*; "Continuar com Google" sends the GIS ID token to POST /auth/google.
 * The forgot-password answer never says whether an e-mail has an account.
 */
import { useId, useRef, useState } from "react"
import type { ReactNode, Ref } from "react"
import { useMutation } from "@tanstack/react-query"
import { ArrowLeft, Eye, EyeSlash } from "@phosphor-icons/react"
import { api } from "../api/client"
import { isApiError, messageOf } from "../api/errors"
import type { AuthScreen, MainTab } from "../app/routes"
import { useStore } from "../app/store"
import { useAuth } from "../auth/AuthProvider"
import { GoogleButton, googleEnabled } from "../auth/GoogleButton"
import { emailError, nameError, NAME_MAX, newPasswordError, PASSWORD_MAX, passwordChecks } from "../auth/validation"
import { BrandLockup, Notice } from "../components/ui"

type Errors = Partial<Record<"name" | "email" | "password" | "confirm" | "form", string>>

/** Maps an API failure onto the form: field messages first, then a form-level message. */
function apiErrors(e: unknown, fallbackField?: keyof Errors): Errors {
  if (!isApiError(e)) return { form: messageOf(e) }
  const out: Errors = {}
  for (const k of ["name", "email", "password"] as const) if (e.fields[k]) out[k] = e.fields[k]
  if (Object.keys(out).length === 0) {
    if (fallbackField && (e.code === "invalid_credentials" || e.code === "unauthorized")) out.form = e.message
    else if (e.code === "conflict" || e.code === "email_taken") out.email = e.message
    else out.form = e.message
  }
  return out
}

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="sa-fieldlabel">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-e`} className="sa-caption sa-error-text mt-1">
          {error}
        </p>
      ) : hint ? (
        <div id={`${id}-e`} className="mt-1">
          {hint}
        </div>
      ) : null}
    </div>
  )
}

function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy, inputRef }: { id: string; value: string; onChange: (v: string) => void; autoComplete: "current-password" | "new-password"; invalid: boolean; describedBy?: string; inputRef?: Ref<HTMLInputElement> }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="sa-pwfield">
      <input
        ref={inputRef}
        id={id}
        name={autoComplete === "new-password" ? "new-password" : "password"}
        type={visible ? "text" : "password"}
        className="sa-field"
        autoComplete={autoComplete}
        maxLength={PASSWORD_MAX}
        spellCheck={false}
        autoCapitalize="none"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="sa-iconbtn sa-pwtoggle" aria-label={visible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={visible} onClick={() => setVisible(!visible)}>
        {visible ? <EyeSlash size={20} /> : <Eye size={20} />}
      </button>
    </div>
  )
}

function PasswordChecklist({ value }: { value: string }) {
  return (
    <ul className="grid gap-1 sa-caption" aria-label="Requisitos da senha">
      {passwordChecks(value).map((c) => (
        <li key={c.id} className={c.ok ? "sa-success-text" : "sa-muted"}>
          {c.ok ? "✓" : "•"} {c.label}
          <span className="sa-sr">{c.ok ? " (atendido)" : " (pendente)"}</span>
        </li>
      ))}
    </ul>
  )
}

function Divider() {
  return (
    <div className="sa-authdivider" role="separator" aria-label="ou">
      <span>ou</span>
    </div>
  )
}

function Frame({ title, lede, children, footer }: { title: string; lede: string; children: ReactNode; footer?: ReactNode }) {
  const { go, resolvedTheme } = useStore()
  const { connected } = useAuth()
  return (
    <div className="sa-auth">
      <div className="sa-auth-top">
        <button type="button" className="sa-btn-quiet sa-body-sm -ml-2 flex items-center gap-2" onClick={() => go("explorar")}>
          <ArrowLeft size={18} aria-hidden="true" /> Voltar ao Explorar
        </button>
      </div>
      <main id="conteudo" className="sa-auth-card" tabIndex={-1}>
        <BrandLockup dark={resolvedTheme === "dark"} />
        <h1 className="sa-display mt-8">{title}</h1>
        <p className="sa-body-sm sa-muted mt-2 sa-pretty">{lede}</p>
        {!connected ? (
          <Notice tone="warning" className="mt-5">
            Este app ainda não foi ligado ao servidor do StylAI, então não é possível entrar ou criar conta agora.
          </Notice>
        ) : null}
        <div className="mt-6 grid gap-5">{children}</div>
        {footer ? <div className="sa-auth-foot">{footer}</div> : null}
      </main>
    </div>
  )
}

function useAfterAuth(next: MainTab | null): () => void {
  const { go } = useStore()
  return () => go(next ?? "explorar")
}

function GoogleBlock({ mode, onError, next }: { mode: "signin" | "signup"; onError: (m: string) => void; next: MainTab | null }) {
  const { signInWithGoogle } = useAuth()
  const { resolvedTheme, notify } = useStore()
  const done = useAfterAuth(next)
  const [busy, setBusy] = useState(false)
  if (!googleEnabled()) return null
  return (
    <>
      <GoogleButton
        mode={mode}
        dark={resolvedTheme === "dark"}
        disabled={busy}
        onCredential={(token) => {
          setBusy(true)
          signInWithGoogle(token)
            .then((u) => {
              notify(`Olá${u.name ? `, ${u.name.split(" ")[0]}` : ""}`)
              done()
            })
            .catch((e: unknown) => onError(messageOf(e)))
            .finally(() => setBusy(false))
        }}
      />
      <Divider />
    </>
  )
}

/* ------------------------------------------------------------------ sign in */

function SignIn({ next }: { next: MainTab | null }) {
  const { signIn } = useAuth()
  const { go, notify } = useStore()
  const done = useAfterAuth(next)
  const ids = { email: useId(), password: useId() }
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<HTMLInputElement | null>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)

  const submit = async (): Promise<void> => {
    const e: Errors = {}
    const em = emailError(email)
    if (em) e.email = em
    if (!password) e.password = "Informe sua senha."
    setErrors(e)
    if (e.email) return emailRef.current?.focus()
    if (e.password) return passwordRef.current?.focus()
    setBusy(true)
    try {
      const u = await signIn(email, password)
      notify(`Olá${u.name ? `, ${u.name.split(" ")[0]}` : ""}`)
      done()
    } catch (err) {
      setErrors(apiErrors(err, "password"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame
      title="Entrar"
      lede="Entre para usar o Estúdio, guardar peças no Closet e salvar suas preferências."
      footer={
        <p className="sa-body-sm">
          Não tem conta?{" "}
          <button type="button" className="sa-link" onClick={() => go({ kind: "auth", screen: "criar-conta", next, token: null })}>
            Criar conta
          </button>
        </p>
      }
    >
      <GoogleBlock mode="signin" next={next} onError={(m) => setErrors({ form: m })} />
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}
        <Field id={ids.email} label="E-mail" error={errors.email}>
          <input ref={emailRef} id={ids.email} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} className="sa-field" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? `${ids.email}-e` : undefined} />
        </Field>
        <Field id={ids.password} label="Senha" error={errors.password}>
          <PasswordInput inputRef={passwordRef} id={ids.password} value={password} onChange={setPassword} autoComplete="current-password" invalid={!!errors.password} describedBy={errors.password ? `${ids.password}-e` : undefined} />
        </Field>
        <button type="button" className="sa-link justify-self-start sa-body-sm" onClick={() => go({ kind: "auth", screen: "recuperar-senha", next, token: null })}>
          Esqueci minha senha
        </button>
        <button type="submit" className="sa-btn sa-btn-primary sa-btn-block" aria-disabled={busy || undefined}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </Frame>
  )
}

/* ------------------------------------------------------------------ sign up */

function SignUp({ next }: { next: MainTab | null }) {
  const { signUp } = useAuth()
  const { go, notify } = useStore()
  const done = useAfterAuth(next)
  const ids = { name: useId(), email: useId(), password: useId() }
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    const e: Errors = {}
    const n = nameError(name)
    const em = emailError(email)
    const pw = newPasswordError(password)
    if (n) e.name = n
    if (em) e.email = em
    if (pw) e.password = pw
    setErrors(e)
    if (Object.keys(e).length > 0) {
      const first = e.name ? ids.name : e.email ? ids.email : ids.password
      document.getElementById(first)?.focus()
      return
    }
    setBusy(true)
    try {
      await signUp({ name, email, password })
      notify("Conta criada. Enviamos um link de confirmação para o seu e-mail.")
      done()
    } catch (err) {
      setErrors(apiErrors(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Frame
      title="Criar conta"
      lede="Grátis. Você recebe tokens para gerar looks e pode guardar peças e looks no Closet."
      footer={
        <p className="sa-body-sm">
          Já tem conta?{" "}
          <button type="button" className="sa-link" onClick={() => go({ kind: "auth", screen: "entrar", next, token: null })}>
            Entrar
          </button>
        </p>
      }
    >
      <GoogleBlock mode="signup" next={next} onError={(m) => setErrors({ form: m })} />
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}
        <Field id={ids.name} label="Nome" error={errors.name}>
          <input id={ids.name} name="name" autoComplete="name" className="sa-field" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? `${ids.name}-e` : undefined} />
        </Field>
        <Field id={ids.email} label="E-mail" error={errors.email}>
          <input id={ids.email} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} className="sa-field" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? `${ids.email}-e` : undefined} />
        </Field>
        <Field id={ids.password} label="Senha" error={errors.password} hint={<PasswordChecklist value={password} />}>
          <PasswordInput id={ids.password} value={password} onChange={setPassword} autoComplete="new-password" invalid={!!errors.password} describedBy={`${ids.password}-e`} />
        </Field>
        <button type="submit" className="sa-btn sa-btn-primary sa-btn-block" aria-disabled={busy || undefined}>
          {busy ? "Criando conta…" : "Criar conta"}
        </button>
      </form>
    </Frame>
  )
}

/* ------------------------------------------------------------------ forgot */

function Forgot({ next }: { next: MainTab | null }) {
  const { go } = useStore()
  const id = useId()
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const send = useMutation({ mutationFn: (v: string) => api.auth.forgotPassword(v.trim()) })
  const back = (
    <button type="button" className="sa-link sa-body-sm" onClick={() => go({ kind: "auth", screen: "entrar", next, token: null })}>
      Voltar para Entrar
    </button>
  )

  if (send.isSuccess) {
    return (
      <Frame title="Confira seu e-mail" lede={`Se existir uma conta com ${email.trim()}, enviamos um link para criar uma nova senha. Ele vale por tempo limitado.`} footer={back}>
        <p className="sa-body-sm sa-muted sa-pretty">Não chegou? Veja a caixa de spam ou tente de novo em alguns minutos.</p>
        <button type="button" className="sa-btn sa-btn-secondary sa-btn-block" onClick={() => send.reset()}>
          Usar outro e-mail
        </button>
      </Frame>
    )
  }

  return (
    <Frame title="Recuperar senha" lede="Informe o e-mail da sua conta. Enviaremos um link para criar uma nova senha." footer={back}>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const err = emailError(email)
          setError(err)
          if (err || send.isPending) return
          send.mutate(email, { onError: (er) => setError(isApiError(er) ? (er.fields.email ?? er.message) : messageOf(er)) })
        }}
      >
        <Field id={id} label="E-mail" error={error ?? undefined}>
          <input id={id} name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} className="sa-field" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-e` : undefined} />
        </Field>
        <button type="submit" className="sa-btn sa-btn-primary sa-btn-block" aria-disabled={send.isPending || undefined}>
          {send.isPending ? "Enviando…" : "Enviar link"}
        </button>
      </form>
    </Frame>
  )
}

/* ------------------------------------------------------------------ reset */

function Reset({ token }: { token: string | null }) {
  const { go, notify } = useStore()
  const ids = { password: useId(), confirm: useId() }
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<Errors>({})
  const reset = useMutation({ mutationFn: () => api.auth.resetPassword(token ?? "", password) })
  const toForgot = (): void => go({ kind: "auth", screen: "recuperar-senha", next: null, token: null })

  if (!token) {
    return (
      <Frame title="Link inválido" lede="Este endereço não tem o código de redefinição. Abra o link do e-mail de novo ou peça um novo.">
        <button type="button" className="sa-btn sa-btn-primary sa-btn-block" onClick={toForgot}>
          Pedir um novo link
        </button>
      </Frame>
    )
  }

  const expired = reset.isError && isApiError(reset.error) && ["invalid_token", "token_expired", "not_found", "gone"].includes(reset.error.code)

  return (
    <Frame title="Criar nova senha" lede="Escolha uma senha nova para a sua conta. Depois, entre com ela.">
      <form
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          const er: Errors = {}
          const pw = newPasswordError(password)
          if (pw) er.password = pw
          if (confirm !== password) er.confirm = "As senhas não coincidem."
          setErrors(er)
          if (Object.keys(er).length > 0 || reset.isPending) return
          reset.mutate(undefined, {
            onSuccess: () => {
              notify("Senha redefinida. Entre com a nova senha.")
              // Drop the token from the address bar and history.
              window.history.replaceState(null, "", "#/entrar")
              go({ kind: "auth", screen: "entrar", next: null, token: null })
            },
            onError: (err) => setErrors(apiErrors(err)),
          })
        }}
      >
        {expired ? (
          <Notice tone="error">
            <p>{reset.error.message}</p>
            <button type="button" className="sa-btn sa-btn-secondary sa-btn-sm mt-3" onClick={toForgot}>
              Pedir um novo link
            </button>
          </Notice>
        ) : errors.form ? (
          <Notice tone="error">{errors.form}</Notice>
        ) : null}
        <Field id={ids.password} label="Nova senha" error={errors.password} hint={<PasswordChecklist value={password} />}>
          <PasswordInput id={ids.password} value={password} onChange={setPassword} autoComplete="new-password" invalid={!!errors.password} describedBy={`${ids.password}-e`} />
        </Field>
        <Field id={ids.confirm} label="Confirmar nova senha" error={errors.confirm}>
          <PasswordInput id={ids.confirm} value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!errors.confirm} describedBy={errors.confirm ? `${ids.confirm}-e` : undefined} />
        </Field>
        <button type="submit" className="sa-btn sa-btn-primary sa-btn-block" aria-disabled={reset.isPending || undefined}>
          {reset.isPending ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
    </Frame>
  )
}

export function AuthScreenView({ screen, next, token }: { screen: AuthScreen; next: MainTab | null; token: string | null }) {
  switch (screen) {
    case "entrar":
      return <SignIn next={next} />
    case "criar-conta":
      return <SignUp next={next} />
    case "recuperar-senha":
      return <Forgot next={next} />
    case "redefinir-senha":
      return <Reset token={token} />
  }
}
