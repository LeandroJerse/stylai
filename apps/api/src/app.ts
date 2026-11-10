import Fastify from "fastify"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import rateLimit from "@fastify/rate-limit"
import { apiError, type HealthStatus } from "@stylai/contracts"
import type { FoundationProbe } from "@stylai/supabase"

export interface AppDependencies { appOrigin: string; logger?: boolean; probeSupabase?: () => Promise<FoundationProbe> }

/** Testable foundation. Business routes and dependency readiness remain unimplemented. */
export async function buildApp(deps: AppDependencies) {
  const app = Fastify({
    bodyLimit: 1_048_576,
    requestTimeout: 15_000,
    trustProxy: false,
    logger: deps.logger ? {
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['asaas-access-token']", "req.headers['x-api-key']"],
      serializers: { req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split("?")[0] }) },
    } : false,
  })
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store")
    const origin = request.headers.origin
    if (origin && origin !== deps.appOrigin) return reply.code(403).send(apiError("forbidden", "Origem não permitida."))
  })
  await app.register(cors, { origin: deps.appOrigin, credentials: true, allowedHeaders: ["Authorization", "Content-Type", "Accept", "Idempotency-Key"], methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] })
  await app.register(helmet)
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute", errorResponseBuilder: () => apiError("rate_limited", "Muitas requisições. Tente novamente em instantes.") })
  app.get("/health/live", async (): Promise<HealthStatus> => ({ status: "ok", service: "api" }))
  app.get("/health/ready", async (_request, reply) => {
    let probe: FoundationProbe = { status: "not_configured" }
    try { if (deps.probeSupabase) probe = await deps.probeSupabase() } catch { probe = { status: "unreachable" } }
    const ready = probe.status === "ready"
    return reply.code(ready ? 200 : 503).send({ status: ready ? "ok" : "not_ready", service: "api", dependencies: { supabase: probe.status } })
  })
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split("?")[0] ?? ""
    const isApi = path === "/v1" || path.startsWith("/v1/")
    return reply.code(isApi ? 503 : 404).send(apiError(isApi ? "service_unavailable" : "not_found", isApi ? "Esta funcionalidade ainda não foi implementada." : "Rota não encontrada."))
  })
  app.setErrorHandler((error, _request, reply) => {
    const suppliedStatus = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500
    const status = suppliedStatus >= 400 && suppliedStatus < 500 ? suppliedStatus : 500
    const code = status === 413 ? "payload_too_large" : status === 429 ? "rate_limited" : status < 500 ? "validation" : "server"
    return reply.code(status).send(apiError(code, status < 500 ? "Revise a requisição enviada." : "Não foi possível atender à requisição."))
  })
  return app
}
