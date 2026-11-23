/**
 * TikTok Shop Creator Collaborations integration routes (sanitized status + OAuth callback).
 * Never exposes app_secret, auth_code, access_token or refresh_token in responses or logs.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { randomBytes } from "node:crypto"
import { cookieHash } from "../../auth/session-crypto.js"
import { apiError } from "@stylai/contracts"
import {
  buildCreatorAuthorizationUrl, createOAuthStateStore, REQUIRED_CREATOR_COLLAB_SCOPE,
  type OAuthStateRecord,
} from "@stylai/commerce"

export interface TikTokIntegrationStatus {
  provider: "tiktok_shop"
  modality: "Colaborações do criador"
  region: "BR"
  appServiceId: string
  configuredCallbackPath: string
  configured: boolean
  hasAppKey: boolean
  hasAppSecret: boolean
  hasCreatorToken: boolean
  requiredScope: string
  capabilities: {
    displayAndLink: boolean
    aiTryOn: false
    aiTryOnBlockedReason: "ai_image_rights_unconfirmed"
  }
  missingPrerequisites: string[]
}

export interface TikTokRouteDeps {
  appKey: string | null
  appSecret: string | null
  hasCreatorToken: boolean
  tokenAvailable?: () => Promise<boolean>
  stateStore?: ReturnType<typeof createOAuthStateStore>
  onAuthorizedCode?: (input: { code: string; state: OAuthStateRecord }) => Promise<{ ok: boolean; reason?: string }>
  operatorId?: string
  resolveOperator?: (request: FastifyRequest) => Promise<{ userId: string; sessionId: string } | null>
  isSessionActive?: (userId: string, sessionId: string) => Promise<boolean>
  appOrigin?: string
  secureCookie?: boolean
  onDisconnect?: () => Promise<void>
  authorizationAllowed?: () => Promise<boolean>
  generation?: () => number
}

export function buildTikTokStatus(deps: Pick<TikTokRouteDeps, "appKey" | "appSecret" | "hasCreatorToken">): TikTokIntegrationStatus {
  const hasAppKey = Boolean(deps.appKey)
  const hasAppSecret = Boolean(deps.appSecret)
  const hasCreatorToken = deps.hasCreatorToken
  const missing: string[] = []
  if (!hasAppKey) missing.push("TIKTOK_SHOP_APP_KEY")
  if (!hasAppSecret) missing.push("TIKTOK_SHOP_APP_SECRET")
  if (!hasCreatorToken) missing.push("TIKTOK_SHOP_CREATOR_ACCESS_TOKEN (OAuth de criador BR com escopo creator.affiliate_collaboration.read)")
  const configured = hasAppKey && hasAppSecret && hasCreatorToken
  return {
    provider: "tiktok_shop",
    modality: "Colaborações do criador",
    region: "BR",
    appServiceId: "7710474909072181044",
    configuredCallbackPath: "/api/integrations/tiktok/callback",
    configured,
    hasAppKey,
    hasAppSecret,
    hasCreatorToken,
    requiredScope: REQUIRED_CREATOR_COLLAB_SCOPE,
    capabilities: {
      displayAndLink: configured,
      aiTryOn: false,
      aiTryOnBlockedReason: "ai_image_rights_unconfirmed",
    },
    missingPrerequisites: missing,
  }
}

export async function registerTikTokIntegrationRoutes(app: FastifyInstance, deps: TikTokRouteDeps) {
  const stateStore = deps.stateStore ?? createOAuthStateStore()
  const cookieName = "stylai_tiktok_oauth"
  const cookieOptions = { path: "/api/integrations/tiktok/callback", httpOnly: true, sameSite: "lax" as const, secure: deps.secureCookie ?? true, maxAge: 600 }
  const operator = async (request: FastifyRequest) => {
    if (!deps.operatorId || !deps.resolveOperator || request.headers.origin !== deps.appOrigin) return null
    const actor = await deps.resolveOperator(request)
    return actor?.userId === deps.operatorId ? actor : null
  }
  const allowed = async () => deps.authorizationAllowed ? deps.authorizationAllowed().catch(() => false) : true

  app.get("/v1/integrations/tiktok/management", async (request) => {
    const actor = await deps.resolveOperator?.(request)
    const canManage = Boolean(deps.operatorId && actor?.userId === deps.operatorId)
    if (!canManage) return { canManage: false }
    return { canManage: true, oauthReady: Boolean(deps.onAuthorizedCode && deps.appKey && deps.appSecret && await allowed()),
      connected: Boolean(await deps.tokenAvailable?.().catch(() => false)) }
  })

  app.post("/v1/integrations/tiktok/connect", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const actor = await operator(request)
    if (!actor) return reply.code(403).send(apiError("forbidden", "Acesso restrito ao operador da integração."))
    if (!deps.appKey || !deps.appSecret || !deps.onAuthorizedCode || !await allowed()) return reply.code(503).send(apiError("service_unavailable", "OAuth indisponível ou bloqueado."))
    const binding = randomBytes(32).toString("base64url")
    const issued = stateStore.issue(actor.userId, `${cookieHash(binding)}:${deps.generation?.() ?? 0}:${actor.sessionId}`)
    reply.setCookie(cookieName, binding, cookieOptions)
    return { authorizationUrl: buildCreatorAuthorizationUrl({ appKey: deps.appKey, state: issued.state }) }
  })

  app.post("/v1/integrations/tiktok/disconnect", async (request, reply) => {
    if (!await operator(request)) return reply.code(403).send(apiError("forbidden", "Acesso restrito ao operador da integração."))
    if (!deps.onDisconnect) return reply.code(503).send(apiError("service_unavailable", "Desconexão indisponível."))
    try { await deps.onDisconnect() } catch { return reply.code(503).send(apiError("service_unavailable", "Não foi possível persistir a desconexão.")) }
    return { ok: true, localDisconnected: true, providerRevocationConfirmed: false }
  })

  app.get("/v1/integrations/tiktok/status", async () => buildTikTokStatus({ ...deps, hasCreatorToken: deps.tokenAvailable ? await deps.tokenAvailable().catch(() => false) : deps.hasCreatorToken }))

  // Public callback path matching Partner Center app 7710474909072181044 configuration.
  // Never logs raw query parameters (which carry `code`).
  app.get("/api/integrations/tiktok/callback", async (request, reply) => {
    const q = (request.query ?? {}) as Record<string, unknown>
    const state = typeof q.state === "string" ? q.state : ""
    const code = typeof q.code === "string" ? q.code.trim() : ""
    const errorParam = typeof q.error === "string" ? q.error.trim() : ""
    reply.header("Referrer-Policy", "no-referrer")
    reply.clearCookie(cookieName, cookieOptions)
    const consumed = stateStore.consume(state, deps.operatorId)
    const binding = request.cookies[cookieName]
    const sessionId = consumed.ok ? consumed.record.connectionId.split(":")[2] : undefined
    if (!consumed.ok || !binding || !sessionId
      || consumed.record.connectionId !== `${cookieHash(binding)}:${deps.generation?.() ?? 0}:${sessionId}`
      || !await deps.isSessionActive?.(consumed.record.operatorId, sessionId).catch(() => false)) {
      return reply.code(400).send(apiError("invalid_state", "Estado de autorização inválido, expirado ou já utilizado."))
    }
    if (errorParam) return reply.code(400).send(apiError("oauth_denied", "Autorização no TikTok Shop recusada ou cancelada."))
    if (!code || code.length > 512) {
      return reply.code(400).send(apiError("missing_code", "Código de autorização ausente na resposta do TikTok Shop."))
    }
    if (!deps.appKey || !deps.appSecret || !deps.onAuthorizedCode || !await allowed()) {
      return reply.code(503).send(apiError("service_unavailable", "Integração TikTok Shop não configurada no servidor para trocar o código."))
    }
    const result = await deps.onAuthorizedCode({ code, state: consumed.record }).catch(() => ({ ok: false }))
    if (!result.ok) {
      return reply.code(502).send(apiError("oauth_exchange_failed", "Não foi possível concluir a autorização do criador no TikTok Shop."))
    }
    return reply.code(200).send({ ok: true, provider: "tiktok_shop" })
  })
}
