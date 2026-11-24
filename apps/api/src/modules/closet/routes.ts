/**
 * Closet and Match on generated looks (docs/API-CONTRACT.md):
 *   GET /v1/closet · PUT|DELETE /v1/closet/looks/:id · PUT|DELETE /v1/closet/pieces/:id
 *   GET /v1/studio/match/deck · POST /v1/studio/match/decisions · DELETE /v1/studio/match/decisions/:id
 * Saving keeps the image (a generated image expires in 168 hours; a saved one does not) and its pieces, frozen at
 * generation time. Nothing here generates images or spends coins. Piece snapshots are built by the server, never sent in.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { apiError } from "@stylai/contracts"
import type { AliExpressCatalogService } from "@stylai/commerce"
import { PrivateDatabaseError, type Json, type PrivateDatabase } from "@stylai/supabase"
import type { SessionKeys } from "../auth/session-crypto.js"
import { presentAliExpressProduct, presentProduct, productRow } from "../catalog/routes.js"
import { presentPieceCard } from "../outfits/pieces.js"
import { planSchema } from "../outfits/search.js"
import { presentLook, versionRow, type ActorResolver } from "../studio/routes.js"

const uuid = z.string().uuid()
const pieceKey = z.string().regex(/^([0-9a-f-]{36}|[a-z_]{2,24}:[A-Za-z0-9_-]{1,120}|[0-9a-f-]{36}:\d)$/)
const savedLook = z.object({ version_id: uuid, saved_at: z.string() })
const savedPiece = z.object({ key: z.string(), snapshot: z.object({ id: z.string(), name: z.string() }).passthrough(), saved_at: z.string() })
const DECK_LIMIT = 30
const CLOSET_LIMIT = 60
const RECENT_SEARCHES = 5

type Product = { id: string; name: string } & Record<string, unknown>
type Look = ReturnType<typeof presentLook>
export interface ClosetDeps {
  db: PrivateDatabase<"api">
  keys: SessionKeys
  resolveActor: ActorResolver
  publicBaseUrl: string
  aliexpressCatalog?: AliExpressCatalogService | null
}

/** Finds a piece the person can see: catalog row, active store search, their saved pieces, looks or recent outfits. */
export function createPieceResolver(deps: Omit<ClosetDeps, "resolveActor">) {
  return async (user: string, id: string): Promise<Product | null> => {
    if (uuid.safeParse(id).success) {
      const raw = await deps.db.call("read_catalog_product", id)
      const row = productRow.safeParse(raw)
      if (row.success) return presentProduct(row.data, deps.publicBaseUrl) as Product
    }
    if (/^aliexpress:\d{1,20}$/.test(id) && deps.aliexpressCatalog) {
      const fresh = await deps.aliexpressCatalog.findFresh(id)
      if (fresh) return presentAliExpressProduct(fresh) as Product
    }
    const favourite = z.array(savedPiece).parse((await deps.db.call("list_saved_pieces", user)) ?? []).find((p) => p.key === id)
    if (favourite) return favourite.snapshot as Product
    for (const s of z.array(savedLook).parse((await deps.db.call("list_saved_looks", user, CLOSET_LIMIT)) ?? [])) {
      const raw = await deps.db.call("read_look_version", user, s.version_id)
      const look = raw ? presentLook(versionRow.parse(raw), deps.publicBaseUrl, deps.keys, user) : null
      const piece = look?.pieces.find((p) => p.product.id === id)
      if (piece) return piece.product as unknown as Product
    }
    const recent = z.array(z.object({ id: uuid })).parse((await deps.db.call("list_outfit_searches", user, RECENT_SEARCHES)) ?? [])
    for (const { id: search } of recent.slice(0, RECENT_SEARCHES)) {
      const raw = z.object({ plan: z.unknown() }).safeParse(await deps.db.call("read_outfit_search", user, search))
      const plan = raw.success ? planSchema.safeParse(raw.data.plan) : null
      if (!plan?.success) continue
      for (const list of Object.values(plan.data.pools)) {
        const found = list?.find((p) => p.id === id)
        if (found) return presentPieceCard(found, deps.publicBaseUrl).product as unknown as Product
      }
    }
    return null
  }
}

export async function registerClosetRoutes(app: FastifyInstance, deps: ClosetDeps) {
  const resolve = createPieceResolver(deps)
  async function actor(request: FastifyRequest, reply: FastifyReply) {
    const id = await deps.resolveActor(request)
    if (!id) { await reply.code(401).send(apiError("unauthorized", "Entre na sua conta para usar o Closet.")); return null }
    return id
  }
  const notFound = (reply: FastifyReply) => reply.code(404).send(apiError("not_found", "Este look não existe mais ou a imagem expirou."))
  const failure = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if (error instanceof PrivateDatabaseError && error.outcome === "rejected") {
      if (error.sqlState === "42501") return notFound(reply)
      if (error.sqlState === "23514") return reply.code(422).send(apiError("unprocessable", "O Closet está cheio (300 peças). Remova alguma para guardar outra."))
    }
    request.log.warn({ stage: "closet", reason: error instanceof Error ? error.name : "unknown" }, "closet route failed")
    return reply.code(503).send(apiError("service_unavailable", "Closet temporariamente indisponível."))
  }
  async function look(user: string, id: string, saved: boolean): Promise<Look | null> {
    const raw = await deps.db.call("read_look_version", user, id)
    return raw ? { ...presentLook(versionRow.parse(raw), deps.publicBaseUrl, deps.keys, user), saved } : null
  }

  app.get("/v1/closet", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    try {
      const saved = z.array(savedLook).parse((await deps.db.call("list_saved_looks", user, CLOSET_LIMIT)) ?? [])
      const looks: Look[] = []
      const pieces = new Map<string, { product: Product; savedAt: string; via: "favorite" | "look" }>()
      for (const p of z.array(savedPiece).parse((await deps.db.call("list_saved_pieces", user)) ?? [])) pieces.set(p.key, { product: { ...p.snapshot, favorite: true } as Product, savedAt: p.saved_at, via: "favorite" })
      for (const s of saved) {
        const l = await look(user, s.version_id, true)
        if (!l) continue
        looks.push(l)
        for (const p of l.pieces) if (!pieces.has(p.product.id)) pieces.set(p.product.id, { product: p.product as unknown as Product, savedAt: s.saved_at, via: "look" })
      }
      return { looks, pieces: [...pieces.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)) }
    } catch (error) { return failure(request, reply, error) }
  })
  for (const [method, saved] of [["PUT", true], ["DELETE", false]] as const) {
    app.route<{ Params: { id: string } }>({ method, url: "/v1/closet/looks/:id", handler: async (request, reply) => {
      const user = await actor(request, reply); if (!user) return reply
      if (!uuid.safeParse(request.params.id).success) return notFound(reply)
      try { await deps.db.call("set_saved_look", user, request.params.id, saved); return reply.code(204).send() } catch (error) { return failure(request, reply, error) }
    } })
    app.route<{ Params: { id: string } }>({ method, url: "/v1/closet/pieces/:id", handler: async (request, reply) => {
      const user = await actor(request, reply); if (!user) return reply
      if (!pieceKey.safeParse(request.params.id).success) return reply.code(404).send(apiError("not_found", "Peça não encontrada."))
      try {
        const product = saved ? await resolve(user, request.params.id) : null
        if (saved && !product) return reply.code(404).send(apiError("not_found", "Este anúncio não está mais ativo na sua busca. Busque de novo para guardar a peça."))
        await deps.db.call("set_saved_piece", user, request.params.id, product ? (JSON.parse(JSON.stringify({ ...product, id: request.params.id })) as Json) : null)
        return reply.code(204).send()
      } catch (error) { return failure(request, reply, error) }
    } })
  }

  app.get<{ Querystring: { lookId?: string } }>("/v1/studio/match/deck", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const first = uuid.safeParse(request.query.lookId)
    try {
      const ids = z.array(uuid).parse((await deps.db.call("list_match_deck", user, first.success ? first.data : null, DECK_LIMIT)) ?? [])
      const items: Look[] = []
      for (const id of ids) { const l = await look(user, id, false); if (l) items.push(l) }
      return { items }
    } catch (error) { return failure(request, reply, error) }
  })
  app.post("/v1/studio/match/decisions", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const body = z.object({ lookId: uuid, decision: z.enum(["save", "pass"]) }).strict().safeParse(request.body)
    if (!body.success) return reply.code(422).send(apiError("validation", "Decisão inválida."))
    try {
      const id = uuid.parse(await deps.db.call("decide_look", user, body.data.lookId, body.data.decision))
      return { id, lookId: body.data.lookId, decision: body.data.decision }
    } catch (error) { return failure(request, reply, error) }
  })
  app.delete<{ Params: { id: string } }>("/v1/studio/match/decisions/:id", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return notFound(reply)
    try { return (await deps.db.call("undo_look_decision", user, request.params.id)) ? reply.code(204).send() : notFound(reply) } catch (error) { return failure(request, reply, error) }
  })
}
