import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { apiError } from "@stylai/contracts"

export interface PrivacyDeps {
  appOrigin: string
  resolveActor: (request: FastifyRequest) => Promise<string | null>
  requestDeletion: (actor: string) => Promise<string>
}

const deletionBody = z.object({ confirm: z.literal(true) }).strict()

export async function registerPrivacyRoutes(app: FastifyInstance, deps: PrivacyDeps) {
  app.post("/v1/privacy/deletion-requests", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (request.headers.origin !== deps.appOrigin) {
      return reply.code(403).send(apiError("forbidden", "Origem não permitida."))
    }
    try {
      const actor = await deps.resolveActor(request)
      if (!actor) return reply.code(401).send(apiError("unauthorized", "Entre na sua conta para continuar."))
      if (!deletionBody.safeParse(request.body).success) {
        return reply.code(422).send(apiError("validation", "Confirme o pedido de exclusão da sua conta."))
      }
      const requestId = await deps.requestDeletion(actor)
      // Acceptance is not proof that physical erasure or backup expiry has completed.
      return reply.code(202).send({ requestId, status: "pending" })
    } catch {
      return reply.code(503).send(apiError("service_unavailable", "Não foi possível confirmar o pedido. Contate o suporte antes de tentar novamente."))
    }
  })
}
