import Fastify from "fastify"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import rateLimit from "@fastify/rate-limit"
import cookie from "@fastify/cookie"
import multipart from "@fastify/multipart"
import { apiError, type CatalogSourceMode, type HealthStatus } from "@stylai/contracts"
import type { AliExpressCatalogService, TikTokCatalogCache } from "@stylai/commerce"
import type { FoundationProbe, PrivateDatabaseStatus } from "@stylai/supabase"
import { registerStudioRoutes, type StudioDeps } from "./modules/studio/routes.js"
import { registerAuthRoutes, type AuthRouteDeps } from "./modules/auth/routes.js"
import { parseCatalogPage, registerCatalogRoutes } from "./modules/catalog/routes.js"
import { registerSearchRoutes, type SearchDeps } from "./modules/catalog/search.js"
import { registerPhotoRoutes, type PhotoRouteDeps } from "./modules/photos/routes.js"
import { registerTikTokIntegrationRoutes, type TikTokRouteDeps } from "./modules/integrations/tiktok/routes.js"
import { registerCompositionRoutes, type CompositionDeps } from "./modules/studio/compositions.js"
import { registerAliExpressIntegrationRoutes, type AliExpressRouteDeps } from "./modules/integrations/aliexpress/routes.js"
import type { PrivateDatabase } from "@stylai/supabase"
import { registerPrivacyRoutes, type PrivacyDeps } from "./modules/privacy/routes.js"

export interface AppDependencies {
  appOrigin: string
  logger?: boolean
  rateLimitPerMinute?: number
  probeSupabase?: () => Promise<FoundationProbe>
  probePrivateDatabase?: () => Promise<PrivateDatabaseStatus>
  studio?: StudioDeps
  auth?: AuthRouteDeps
  photos?: PhotoRouteDeps
  catalog?: { db: PrivateDatabase<"api">; publicBaseUrl?: string; pilotOnly?: boolean; catalogMode?: CatalogSourceMode; tiktokCache?: TikTokCatalogCache | null; aliexpressCatalog?: AliExpressCatalogService | null; resolveActor?: (request: import("fastify").FastifyRequest) => Promise<string | null> }
  search?: SearchDeps
  compositions?: CompositionDeps
  tiktok?: TikTokRouteDeps
  aliexpress?: AliExpressRouteDeps
  privacy?: PrivacyDeps
}

/** Testable foundation. Auth, catalog, photo and studio slice routes; other /v1 routes stay 503. */
export async function buildApp(deps: AppDependencies) {
  const app = Fastify({
    bodyLimit: 1_048_576,
    requestTimeout: 15_000,
    trustProxy: false,
    logger: deps.logger ? {
      redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']", "req.headers['asaas-access-token']", "req.headers['x-api-key']"],
      serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split("?")[0] }) },
    } : false,
  })
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store")
    const origin = request.headers.origin
    if (origin && origin !== deps.appOrigin) return reply.code(403).send(apiError("forbidden", "Origem não permitida."))
  })
  await app.register(cors, { origin: deps.appOrigin, credentials: true, allowedHeaders: ["Authorization", "Content-Type", "Accept", "Idempotency-Key"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] })
  await app.register(helmet, { crossOriginResourcePolicy: { policy: "same-site" } })
  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 12_582_912, files: 1, fields: 4, parts: 6 } })
  // The builder's return value is thrown: it must carry statusCode, or Fastify turns it into a 500.
  await app.register(rateLimit, {
    max: deps.rateLimitPerMinute ?? 120, timeWindow: "1 minute",
    errorResponseBuilder: (_request, context) => ({ statusCode: context.statusCode, ...apiError("rate_limited", "Muitas requisições. Tente novamente em instantes.") }),
  })
  app.get("/health/live", async (): Promise<HealthStatus> => ({ status: "ok", service: "api" }))
  app.get("/health/ready", async (_request, reply) => {
    let probe: FoundationProbe = { status: "not_configured" }
    let privateDatabase: PrivateDatabaseStatus|"not_configured" = "not_configured"
    try { if (deps.probeSupabase) probe = await deps.probeSupabase() } catch { probe = { status: "unreachable" } }
    try { if (deps.probePrivateDatabase) privateDatabase = await deps.probePrivateDatabase() } catch { privateDatabase = "unavailable" }
    const ready = probe.status === "ready" && privateDatabase === "ready"
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ok" : "not_ready", service: "api", dependencies: { supabase: probe.status, privateDatabase } })
  })
  if (deps.auth) await registerAuthRoutes(app, deps.auth)
  if (deps.catalog) await registerCatalogRoutes(app, deps.catalog)
  if (deps.search) await registerSearchRoutes(app, deps.search, parseCatalogPage)
  if (deps.compositions) await registerCompositionRoutes(app, deps.compositions)
  if (deps.photos) await registerPhotoRoutes(app, deps.photos)
  if (deps.studio) await registerStudioRoutes(app, deps.studio)
  if (deps.tiktok) await registerTikTokIntegrationRoutes(app, deps.tiktok)
  if (deps.aliexpress) await registerAliExpressIntegrationRoutes(app, deps.aliexpress)
  if (deps.privacy) await registerPrivacyRoutes(app, deps.privacy)
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? ""
    const isApi = path === "/v1" || path.startsWith("/v1/")
    return reply.code(isApi ? 503 : 404).send(apiError(isApi ? "service_unavailable" : "not_found", isApi ? "Esta funcionalidade ainda não foi implementada." : "Rota não encontrada."))
  })
  app.setErrorHandler((error, _request, reply) => {
    const suppliedStatus = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500
    const status = suppliedStatus >= 400 && suppliedStatus < 500 ? suppliedStatus : 500
    const code = status === 413 ? "payload_too_large" : status === 429 ? "rate_limited" : status < 500 ? "validation" : "server"
    const message = status === 429 ? "Muitas requisições. Tente novamente em instantes." : status < 500 ? "Revise a requisição enviada." : "Não foi possível atender à requisição."
    return reply.code(status).send(apiError(code, message))
  })
  return app
}
