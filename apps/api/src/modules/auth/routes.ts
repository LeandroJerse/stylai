/**
 * Auth routes (docs/API-CONTRACT.md §1 as changed by the Supabase MVP matrix):
 *   POST /v1/auth/sign-up              -> 202 { status: "verification_required" } (never a session)
 *   POST /v1/auth/email/verify         { tokenHash } -> 200 Session (email confirmation link)
 *   POST /v1/auth/email/verify/resend  { email } -> 204 always
 *   POST /v1/auth/sign-in              -> 200 Session | 401 invalid_credentials | 403 email_not_verified
 *   POST /v1/auth/refresh              (cookie) -> 200 Session | 401
 *   POST /v1/auth/sign-out             -> 204
 *   GET  /v1/me                        -> User
 * Cookie-authenticated routes require an exact Origin (CSRF); answers are no-store.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { apiError } from "@stylai/contracts"
import type { AuthProvider } from "./provider.js"
import type { IssuedSession, SessionService } from "./session-service.js"

export interface AuthRouteDeps {
  provider: AuthProvider
  sessions: SessionService
  appOrigin: string
  secureCookie: boolean
}

export const SESSION_COOKIE = "stylai_session"
const COOKIE_PATH = "/v1/auth"

const email = z.string().trim().toLowerCase().email().max(254)
const password = z.string().min(8).max(128).regex(/[A-Za-zÀ-ÿ]/).regex(/[0-9]/)
const signUpBody = z.object({ name: z.string().trim().min(1).max(80), email, password }).strict()
const signInBody = z.object({ email, password: z.string().min(1).max(128) }).strict()
const verifyBody = z.object({ tokenHash: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/) }).strict()
const resendBody = z.object({ email }).strict()

const strict = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps) {
  const redirectTo = `${deps.appOrigin}/#/confirmar-email`

  function setCookie(reply: FastifyReply, value: string) {
    reply.setCookie(SESSION_COOKIE, value, { path: COOKIE_PATH, httpOnly: true, sameSite: "lax", secure: deps.secureCookie, maxAge: 30 * 24 * 3600 })
  }
  function clearCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: "lax", secure: deps.secureCookie })
  }
  const sendSession = (reply: FastifyReply, issued: IssuedSession) => {
    setCookie(reply, issued.cookie)
    return reply.code(200).send({ accessToken: issued.accessToken, user: issued.user })
  }
  /** Cookie-bearing requests must come from the app origin (blocks cross-site POSTs). */
  const sameOrigin = (request: FastifyRequest) => request.headers.origin === deps.appOrigin
  const unavailable = (reply: FastifyReply) => reply.code(503).send(apiError("service_unavailable", "Não foi possível falar com o serviço de contas. Tente novamente."))

  app.post("/v1/auth/sign-up", strict, async (request, reply) => {
    const body = signUpBody.safeParse(request.body)
    if (!body.success) {
      const fields: Record<string, string> = {}
      for (const issue of body.error.issues) {
        const key = String(issue.path[0] ?? "")
        if (key === "password") fields.password = "Use de 8 a 128 caracteres, com pelo menos uma letra e um número."
        else if (key === "email") fields.email = "Informe um e-mail válido."
        else if (key === "name") fields.name = "Informe seu nome (até 80 caracteres)."
      }
      return reply.code(422).send({ error: { code: "validation", message: "Revise os campos destacados.", fields } })
    }
    const result = await deps.provider.signUp({ ...body.data, redirectTo })
    if (result === "weak_password") return reply.code(422).send({ error: { code: "validation", message: "Revise os campos destacados.", fields: { password: "Escolha uma senha mais forte." } } })
    if (result === "rate_limited") return reply.code(429).send(apiError("rate_limited", "Muitas tentativas. Aguarde alguns minutos."))
    if (result === "unavailable") return unavailable(reply)
    // Same answer for new and existing addresses: accounts are not enumerable.
    return reply.code(202).send({ status: "verification_required" })
  })

  app.post("/v1/auth/email/verify", strict, async (request, reply) => {
    const body = verifyBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send(apiError("invalid_token", "Link de confirmação inválido."))
    const result = await deps.provider.verifyEmail(body.data.tokenHash)
    if (result.kind === "unavailable") return unavailable(reply)
    if (result.kind === "rate_limited") return reply.code(429).send(apiError("rate_limited", "Muitas tentativas. Aguarde alguns minutos."))
    if (result.kind !== "ok") return reply.code(400).send(apiError("invalid_token", "Este link de confirmação é inválido ou já foi usado. Entre com sua senha ou peça um novo link."))
    return sendSession(reply, await deps.sessions.issue(result.session))
  })

  app.post("/v1/auth/email/verify/resend", strict, async (request, reply) => {
    const body = resendBody.safeParse(request.body)
    if (body.success) await deps.provider.resendConfirmation(body.data.email, redirectTo)
    return reply.code(204).send()
  })

  app.post("/v1/auth/sign-in", strict, async (request, reply) => {
    const body = signInBody.safeParse(request.body)
    if (!body.success) return reply.code(401).send(apiError("invalid_credentials", "E-mail ou senha incorretos."))
    const result = await deps.provider.signIn(body.data.email, body.data.password)
    if (result.kind === "invalid") return reply.code(401).send(apiError("invalid_credentials", "E-mail ou senha incorretos."))
    if (result.kind === "unverified") return reply.code(403).send(apiError("email_not_verified", "Confirme seu e-mail pelo link que enviamos antes de entrar."))
    if (result.kind === "rate_limited") return reply.code(429).send(apiError("rate_limited", "Muitas tentativas. Aguarde alguns minutos."))
    if (result.kind === "unavailable") return unavailable(reply)
    return sendSession(reply, await deps.sessions.issue(result.session))
  })

  app.post("/v1/auth/refresh", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!sameOrigin(request)) return reply.code(403).send(apiError("forbidden", "Origem não permitida."))
    const cookie = request.cookies[SESSION_COOKIE]
    if (!cookie || cookie.length > 128) return reply.code(401).send(apiError("unauthorized", "Sessão encerrada. Entre novamente."))
    const result = await deps.sessions.refresh(cookie)
    if (result.kind === "unavailable") return unavailable(reply)
    if (result.kind === "invalid") { clearCookie(reply); return reply.code(401).send(apiError("unauthorized", "Sessão encerrada. Entre novamente.")) }
    return reply.code(200).send({ accessToken: result.accessToken, user: result.user })
  })

  app.post("/v1/auth/sign-out", async (request, reply) => {
    if (!sameOrigin(request)) return reply.code(403).send(apiError("forbidden", "Origem não permitida."))
    const cookie = request.cookies[SESSION_COOKIE]
    if (cookie && cookie.length <= 128) await deps.sessions.revoke(cookie)
    clearCookie(reply)
    return reply.code(204).send()
  })

  app.get("/v1/me", async (request, reply) => {
    const actor = await deps.sessions.resolve(request)
    if (!actor) return reply.code(401).send(apiError("unauthorized", "Entre na sua conta para continuar."))
    return deps.sessions.userFor(actor)
  })
}
