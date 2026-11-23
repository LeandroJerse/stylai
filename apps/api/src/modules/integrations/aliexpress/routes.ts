/**
 * AliExpress Affiliates API integration routes.
 *
 * Catalog and affiliate-link APIs are signed with App Key + App Secret only (no seller OAuth; see
 * packages/commerce/src/sources/aliexpress/client.ts for the official evidence). The callback below
 * exists because the app registration form requires a Callback URL; it never exchanges codes and
 * never reports a connection. Responses never carry secrets, tracking IDs, codes or provider text.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { apiError } from "@stylai/contracts"
import type { AliExpressAffiliateClient, AliExpressErrorKind } from "@stylai/commerce"

export const ALIEXPRESS_CALLBACK_PATH = "/api/integrations/aliexpress/callback"

export type AliExpressCatalogState = "not_configured" | "configured_unverified" | "validated" | "verification_failed"

export interface AliExpressVerification {
  ok: boolean
  checkedAt: string
  productCount: number | null
  requestId: string | null
  errorKind: AliExpressErrorKind | null
  errorCode: string | null
}

export interface AliExpressRouteDeps {
  appKey: string | null
  appSecret: string | null
  trackingId: string | null
  client?: AliExpressAffiliateClient | null
  operatorId?: string
  resolveOperator?: (request: FastifyRequest) => Promise<{ userId: string; sessionId: string } | null>
  appOrigin?: string
  now?: () => Date
}

export interface AliExpressIntegrationStatus {
  provider: "aliexpress"
  modality: "Affiliates API"
  region: "BR"
  authentication: { catalogRequiresOAuth: false; method: "app_key_signature"; evidence: string[] }
  hasAppKey: boolean
  hasAppSecret: boolean
  hasTrackingId: boolean
  state: AliExpressCatalogState
  /** Account permissions are only "verified" after a real signed call succeeds in this process. */
  permissions: "unverified" | "verified_by_real_call" | "rejected_by_provider"
  lastVerification: AliExpressVerification | null
  callback: { path: string; purpose: "app_registration_only"; oauthEnabled: false }
  capabilities: { displayAndLink: boolean; affiliateLinks: boolean; aiTryOn: false; aiTryOnBlockedReason: "ai_image_rights_unconfirmed" }
  /** Needed for catalog queries (App Key + App Secret). */
  missingPrerequisites: string[]
  /** Tracking ID is optional for product.query but required to generate affiliate links. */
  missingForAffiliateLinks: string[]
}

const EVIDENCE = [
  "https://openservice.aliexpress.com/doc/api.htm#/api?cid=21407&path=aliexpress.affiliate.product.query&methodType=GET/POST",
  "https://openservice.aliexpress.com/doc/doc.htm#/?docId=1364",
  "https://openservice.aliexpress.com/doc/doc.htm#/?docId=1386",
]

export function buildAliExpressStatus(deps: Pick<AliExpressRouteDeps, "appKey" | "appSecret" | "trackingId">, verification: AliExpressVerification | null): AliExpressIntegrationStatus {
  const missing: string[] = []
  if (!deps.appKey) missing.push("ALIEXPRESS_APP_KEY")
  if (!deps.appSecret) missing.push("ALIEXPRESS_APP_SECRET")
  const configured = missing.length === 0
  const state: AliExpressCatalogState = !configured ? "not_configured" : !verification ? "configured_unverified" : verification.ok ? "validated" : "verification_failed"
  // Only gateway `error_response` (signature/app/permission layer) counts as a rejection. A non-200
  // `resp_result.resp_code` comes from the business API; its meaning (e.g. 405) is not documented.
  const rejected = verification && !verification.ok && verification.errorKind === "provider_error"
  return {
    provider: "aliexpress",
    modality: "Affiliates API",
    region: "BR",
    authentication: { catalogRequiresOAuth: false, method: "app_key_signature", evidence: EVIDENCE },
    hasAppKey: Boolean(deps.appKey),
    hasAppSecret: Boolean(deps.appSecret),
    hasTrackingId: Boolean(deps.trackingId),
    state,
    permissions: state === "validated" ? "verified_by_real_call" : rejected && configured ? "rejected_by_provider" : "unverified",
    lastVerification: configured ? verification : null,
    callback: { path: ALIEXPRESS_CALLBACK_PATH, purpose: "app_registration_only", oauthEnabled: false },
    capabilities: { displayAndLink: state === "validated", affiliateLinks: state === "validated" && Boolean(deps.trackingId), aiTryOn: false, aiTryOnBlockedReason: "ai_image_rights_unconfirmed" },
    missingPrerequisites: missing,
    missingForAffiliateLinks: deps.trackingId ? [] : ["ALIEXPRESS_TRACKING_ID"],
  }
}

export async function registerAliExpressIntegrationRoutes(app: FastifyInstance, deps: AliExpressRouteDeps) {
  const now = deps.now ?? (() => new Date())
  // Process-local diagnostic only: it never gates catalog access and is recomputed after restarts.
  let verification: AliExpressVerification | null = null
  let verifying: Promise<AliExpressVerification> | null = null
  const configured = () => Boolean(deps.appKey && deps.appSecret && deps.client)

  app.get("/v1/integrations/aliexpress/status", async () => buildAliExpressStatus(deps, verification))

  app.post("/v1/integrations/aliexpress/verify", { config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!deps.operatorId || !deps.resolveOperator || request.headers.origin !== deps.appOrigin) {
      return reply.code(403).send(apiError("forbidden", "Acesso restrito ao operador da integração."))
    }
    const actor = await deps.resolveOperator(request).catch(() => null)
    if (actor?.userId !== deps.operatorId) return reply.code(403).send(apiError("forbidden", "Acesso restrito ao operador da integração."))
    if (!configured()) return reply.code(503).send(apiError("service_unavailable", "Credenciais AliExpress ausentes no servidor."))
    verifying ??= (async () => {
      const result = await deps.client!.queryProducts({ keywords: "vestido", pageSize: 1 })
        .catch(() => ({ ok: false as const, kind: "network" as const, code: null, requestId: null }))
      return result.ok
        ? { ok: true, checkedAt: now().toISOString(), productCount: result.products.length, requestId: result.requestId, errorKind: null, errorCode: null }
        : { ok: false, checkedAt: now().toISOString(), productCount: null, requestId: result.requestId, errorKind: result.kind, errorCode: result.code }
    })().finally(() => { verifying = null })
    verification = await verifying
    return reply.code(verification.ok ? 200 : 502).send(buildAliExpressStatus(deps, verification))
  })

  // Registration callback. The query string is never logged (app logger strips it), stored or echoed.
  const callback = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header("Referrer-Policy", "no-referrer")
    reply.header("X-Robots-Tag", "noindex, nofollow")
    const query = new URL(request.url, "http://callback.invalid").searchParams
    if (request.url.length > 2048 || ["code", "state", "error", "error_code"].some((key) => query.getAll(key).length > 1)) {
      return reply.code(400).send(apiError("validation", "Revise a requisição enviada."))
    }
    if (query.has("error") || query.has("error_code")) {
      return reply.code(400).send(apiError("authorization_not_completed", "A autorização no AliExpress não foi concluída."))
    }
    if (query.has("code")) {
      return reply.code(503).send(apiError("oauth_not_enabled", "O StylAI não usa autorização de vendedor do AliExpress; nenhum código é trocado ou armazenado."))
    }
    return reply.code(200).send({ ok: true, provider: "aliexpress", purpose: "app_registration_only", oauthEnabled: false })
  }
  app.get(ALIEXPRESS_CALLBACK_PATH, callback)
}
