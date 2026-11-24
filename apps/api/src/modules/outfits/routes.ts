/**
 * Autonomous outfit flow (docs/API-CONTRACT.md):
 *   POST /v1/studio/outfit-searches { prompt } (Idempotency-Key) -> 202; the search runs on the server
 *   GET  /v1/studio/outfit-searches · GET .../:id (stage, sets) · POST .../:id/cancel
 *   GET  /v1/studio/outfit-sets/:id (alternatives and versions)
 *   POST /v1/studio/outfit-sets/:id/{piece,locks,suggest,restore}  (optimistic `base` revision; 409 when another tab changed it)
 * Choices are validated against what the server itself retrieved; the client never sends prices, links or images.
 */
import { createHash } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { countFilters, MAX_FILTER_BRL, normalizeFilters, apiError, OUTFIT_SLOT_LABEL, OUTFIT_SLOTS, SLOT_LABEL, type SlotId } from "@stylai/contracts"
import { PrivateDatabaseError, type Json, type PrivateDatabase } from "@stylai/supabase"
import { blockedMessage, orderPieces, overBudget, pieceSchema, presentPieceCard, slotSchema, totalOf, type StoredPiece } from "./pieces.js"
import { planSchema, type OutfitSearch, type OutfitSourceKind, type StoredPlan } from "./search.js"

export interface OutfitRouteDeps {
  db: PrivateDatabase<"api">
  resolveActor: (request: FastifyRequest) => Promise<string | null>
  publicBaseUrl: string
  source: OutfitSourceKind
  model: string | null
  search: OutfitSearch
  /** Test hook: background work of the process (awaited on close). */
  track?: (work: Promise<void>) => void
}

const uuid = z.string().uuid()
export const idempotencyKey = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)
const brl = z.number().positive().max(MAX_FILTER_BRL).nullable().optional()
export const filtersBody = z.object({
  audience: z.enum(["feminino", "masculino"]).nullable().optional(), minPieceBrl: brl, maxPieceBrl: brl, maxTotalBrl: brl,
  minRatingPercent: z.number().positive().max(100).nullable().optional(), minSales: z.number().int().positive().max(1_000_000).nullable().optional(),
}).strict()
const searchBody = z.object({ prompt: z.string().trim().min(1).max(500), filters: filtersBody.optional() }).strict()
const base = z.number().int().min(1)
const pieceBody = z.object({ slot: slotSchema, productId: z.string().min(1).max(200), variantId: uuid.nullable().optional(), base }).strict()
const locksBody = z.object({ locked: z.array(slotSchema).max(3), base }).strict()
const suggestBody = z.object({ locked: z.array(slotSchema).max(3), base }).strict()
const restoreBody = z.object({ revision: z.number().int().min(1), base }).strict()

export const setRow = z.object({
  id: uuid, search_id: uuid, position: z.number(), kind: z.enum(["bundle", "assembled"]), recommended: z.boolean(), title: z.string(), rationale: z.string(),
  missing_slots: z.array(z.string()), revision: z.number().int(), created_at: z.string(), pieces: z.array(pieceSchema), locked: z.array(slotSchema),
  total_minor: z.number().nullable(), origin: z.string(),
})
export const fullSetRow = setRow.extend({
  plan: planSchema, source: z.string(),
  revisions: z.array(z.object({ revision: z.number().int(), origin: z.string(), pieces: z.array(pieceSchema), locked: z.array(slotSchema), total_minor: z.number().nullable(), created_at: z.string() })),
})
const searchRow = z.object({
  id: uuid, prompt: z.string(), source: z.string(), model: z.string().nullable(), status: z.enum(["running", "interrupted", "succeeded", "empty", "failed", "cancelled"]),
  stage: z.string(), stage_detail: z.record(z.string(), z.unknown()), selection_method: z.enum(["agent", "rules_fallback"]).nullable(), error_code: z.string().nullable(),
  plan: z.unknown(), created_at: z.string(), finished_at: z.string().nullable(), sets: z.array(setRow),
})
const listRow = z.object({ id: uuid, prompt: z.string(), created_at: z.string(), status: z.string(), sets: z.number().int() })

const STAGE_LABEL: Record<string, string> = {
  interpreting: "Entendendo seu pedido", planning: "Planejando a busca", searching: "Buscando peças na loja", selecting: "Combinando os conjuntos",
  preparing: "Preparando as imagens das peças", done: "Concluído",
}
const ORIGIN_LABEL: Record<string, string> = { suggested: "Sugestão original", swap: "Peça trocada por você", resuggest: "Nova combinação", refresh: "Dados atualizados" }
const removedByFilters = (plan: StoredPlan | null): number => Object.entries(plan?.rejected ?? {}).reduce((a, [k, n]) => a + (k.startsWith("filter_") ? n : 0), 0)
function outcomeMessage(row: z.infer<typeof searchRow>, plan: StoredPlan | null): string | null {
  const missing = (plan?.missingSlots ?? []).filter((s) => s !== "outer").map((s) => SLOT_LABEL[s as SlotId] ?? s)
  switch (row.status) {
    case "interrupted": return "A busca foi interrompida antes de terminar. Busque de novo: nada foi gerado nem cobrado."
    case "cancelled": return "Busca cancelada."
    case "failed": return row.error_code === "source_unavailable" ? "A loja não respondeu agora. Nenhum conjunto foi montado; tente de novo em instantes." : "A busca falhou por um erro interno. Tente de novo."
    case "empty": if (removedByFilters(plan) > 0) return `Com estes filtros, ${removedByFilters(plan) === 1 ? "1 anúncio ficou de fora" : `${removedByFilters(plan)} anúncios ficaram de fora`} e não sobrou um conjunto completo. Afrouxe um filtro e busque de novo.`
      return row.error_code === "missing_pieces" && missing.length ? `A loja não devolveu opções compatíveis para: ${missing.join(", ")}. Tente descrever de outro jeito.`
      : row.error_code === "agent_abstained" ? "Nenhuma combinação do que a loja devolveu combina de verdade com o pedido. Tente detalhar estilo, cor ou ocasião."
      : "Não encontramos conjuntos compatíveis com este pedido. Tente descrever de outro jeito."
    default: return null
  }
}

export function presentSet(row: z.infer<typeof setRow>, plan: StoredPlan | null, publicBase: string) {
  const total = totalOf(row.pieces)
  return {
    id: row.id, searchId: row.search_id, position: row.position, kind: row.pieces.some((p) => p.slot === "set") ? "bundle" as const : "assembled" as const,
    recommended: row.recommended, title: row.title, rationale: row.rationale, missingSlots: row.missing_slots.map((s) => SLOT_LABEL[s as SlotId] ?? s),
    revision: row.revision, locked: row.locked, pieces: row.pieces.map((p) => presentPieceCard(p, publicBase)),
    total: total === null ? null : { amount: total / 100, currency: "BRL" }, overBudget: plan ? overBudget(plan.intent, total) : null,
    origin: { id: row.origin, label: ORIGIN_LABEL[row.origin] ?? "Versão" },
  }
}

export async function registerOutfitRoutes(app: FastifyInstance, deps: OutfitRouteDeps) {
  const background = new Set<Promise<void>>()
  const track = (work: Promise<void>) => { background.add(work); void work.finally(() => background.delete(work)); deps.track?.(work) }
  app.addHook("onClose", async () => { await Promise.race([Promise.allSettled([...background]), new Promise((r) => setTimeout(r, 2_000).unref())]) })

  async function actor(request: FastifyRequest, reply: FastifyReply) {
    const id = await deps.resolveActor(request)
    if (!id) { await reply.code(401).send(apiError("unauthorized", "Entre na sua conta para usar o Estúdio.")); return null }
    return id
  }
  const notFound = (reply: FastifyReply, what: string) => reply.code(404).send(apiError("not_found", `${what} não encontrado.`))
  const failure = (request: FastifyRequest, reply: FastifyReply, error: unknown) => {
    if (error instanceof PrivateDatabaseError && error.outcome === "rejected") {
      if (error.sqlState === "40001") return reply.code(409).send(apiError("stale_revision", "Este conjunto mudou em outra aba. Recarregamos a versão atual; confira e tente de novo."))
      if (error.sqlState === "42501") return notFound(reply, "Conjunto")
      if (error.sqlState === "23514") return reply.code(422).send(apiError("unprocessable", "Não foi possível aplicar esta mudança ao conjunto."))
    }
    request.log.warn({ stage: "outfits", reason: error instanceof Error ? error.name : "unknown" }, "outfit route failed")
    return reply.code(503).send(apiError("service_unavailable", "Serviço temporariamente indisponível."))
  }
  async function readSearch(user: string, id: string) {
    const raw = await deps.db.call("read_outfit_search", user, id)
    if (!raw) return null
    const row = searchRow.parse(raw)
    const parsed = planSchema.safeParse(row.plan)
    const plan = parsed.success ? parsed.data : null
    return {
      id: row.id, prompt: row.prompt, source: row.source, status: row.status, createdAt: row.created_at, finishedAt: row.finished_at,
      stage: { id: row.stage, label: STAGE_LABEL[row.stage] ?? row.stage, detail: row.stage_detail },
      selection: row.selection_method ? { method: row.selection_method, model: row.selection_method === "agent" ? row.model : null } : null,
      message: outcomeMessage(row, plan), errorCode: row.error_code, filters: plan?.filters ?? null,
      sets: row.sets.map((s) => presentSet(s, plan, deps.publicBaseUrl)),
      // Why these results: queries sent, what came back and what the filters removed.
      report: plan ? {
        interpretedBy: plan.interpretedBy, plannedBy: plan.plannedBy, style: plan.intent.style ?? [], occasion: plan.intent.occasion, audience: plan.intent.audience ?? null,
        climate: plan.intent.climate ?? null, budget: plan.intent.budgetTotalBrl,
        queries: plan.queries.map((q) => ({ slot: OUTFIT_SLOT_LABEL[q.slot], query: q.query, outcome: q.outcome, returned: q.returned, kept: q.kept })),
        filtered: plan.rejected, missingSlots: plan.missingSlots.map((s) => SLOT_LABEL[s as SlotId] ?? s),
        agent: { calls: plan.agent.calls, estimatedUsd: plan.agent.costMicros === null ? null : Number(plan.agent.costMicros) / 1_000_000 }, notes: plan.notes,
      } : null,
    }
  }
  async function readSet(user: string, id: string) {
    const raw = await deps.db.call("read_outfit_set", user, id)
    return raw ? fullSetRow.parse(raw) : null
  }
  type FullSet = z.infer<typeof fullSetRow>
  const presentFull = (row: FullSet) => ({
    ...presentSet(row, row.plan, deps.publicBaseUrl),
    alternatives: Object.fromEntries(OUTFIT_SLOTS.filter((slot) => row.pieces.some((p) => p.slot === slot)).map((slot) => [slot,
      (row.plan.pools[slot] ?? []).filter((p) => !row.pieces.some((x) => x.id === p.id)).map((p) => presentPieceCard(p, deps.publicBaseUrl))])),
    revisions: row.revisions.map((r) => ({ revision: r.revision, label: ORIGIN_LABEL[r.origin] ?? "Versão", createdAt: r.created_at, current: r.revision === row.revision,
      total: r.total_minor === null ? null : { amount: r.total_minor / 100, currency: "BRL" }, pieces: r.pieces.map((p) => presentPieceCard(p, deps.publicBaseUrl)) })),
  })
  async function save(user: string, row: FullSet, origin: "swap" | "resuggest" | "refresh", pieces: StoredPiece[], locked: string[]) {
    const ordered = orderPieces(pieces)
    const total = totalOf(ordered)
    await deps.db.call("save_outfit_set_revision", user, row.id, row.revision, origin, JSON.parse(JSON.stringify(ordered)) as Json,
      locked.filter((s) => ordered.some((p) => p.slot === s)), total === null ? null : String(total))
    return presentFull((await readSet(user, row.id))!)
  }

  app.post("/v1/studio/outfit-searches", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const key = idempotencyKey.safeParse(request.headers["idempotency-key"])
    if (!key.success) return reply.code(400).send(apiError("validation", "Cabeçalho Idempotency-Key ausente ou inválido."))
    const body = searchBody.safeParse(request.body)
    if (!body.success) return reply.code(422).send(apiError("validation", body.error.issues.some((i) => i.path[0] === "filters") ? "Confira os filtros: os valores precisam ser números válidos." : "Descreva o look que você quer (até 500 caracteres)."))
    try {
      const filters = normalizeFilters(body.data.filters)
      const hash = createHash("sha256").update(JSON.stringify({ v: 1, prompt: body.data.prompt, source: deps.source, ...(countFilters(filters) ? { filters } : {}) })).digest("hex")
      const created = z.object({ id: uuid, created: z.boolean() }).parse(await deps.db.call("create_outfit_search", user, key.data, hash, body.data.prompt, deps.source, deps.model))
      if (created.created) track(deps.search.run(user, created.id, body.data.prompt, filters))
      return reply.code(created.created ? 202 : 200).send(await readSearch(user, created.id))
    } catch (error) {
      if (error instanceof PrivateDatabaseError && error.sqlState === "23505") return reply.code(409).send(apiError("search_in_progress", "Já existe uma busca em andamento. Aguarde ou cancele."))
      if (error instanceof PrivateDatabaseError && error.sqlState === "23514") return reply.code(429).send(apiError("search_limit", "Você atingiu o limite diário de buscas. Tente amanhã."))
      return failure(request, reply, error)
    }
  })
  app.get("/v1/studio/outfit-searches", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    try {
      const rows = z.array(listRow).parse((await deps.db.call("list_outfit_searches", user, 20)) ?? [])
      return { items: rows.map((r) => ({ id: r.id, prompt: r.prompt, createdAt: r.created_at, status: r.status, sets: r.sets })) }
    } catch (error) { return failure(request, reply, error) }
  })
  app.get<{ Params: { id: string } }>("/v1/studio/outfit-searches/:id", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return notFound(reply, "Pedido")
    try { return (await readSearch(user, request.params.id)) ?? notFound(reply, "Pedido") } catch (error) { return failure(request, reply, error) }
  })
  app.post<{ Params: { id: string } }>("/v1/studio/outfit-searches/:id/cancel", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return notFound(reply, "Pedido")
    try {
      await deps.db.call("cancel_outfit_search", user, request.params.id)
      return (await readSearch(user, request.params.id)) ?? notFound(reply, "Pedido")
    } catch (error) { return failure(request, reply, error) }
  })

  app.get<{ Params: { id: string } }>("/v1/studio/outfit-sets/:id", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    if (!uuid.safeParse(request.params.id).success) return notFound(reply, "Conjunto")
    try { const row = await readSet(user, request.params.id); return row ? presentFull(row) : notFound(reply, "Conjunto") } catch (error) { return failure(request, reply, error) }
  })

  /** Loads the set for a change; a stale base is refused before any work (the database refuses it again). */
  async function forChange(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, baseRevision: number): Promise<{ user: string; row: FullSet } | null> {
    const user = await actor(request, reply); if (!user) return null
    const row = uuid.safeParse(request.params.id).success ? await readSet(user, request.params.id) : null
    if (!row) { await notFound(reply, "Conjunto"); return null }
    if (row.revision !== baseRevision) { await failure(request, reply, new PrivateDatabaseError("rejected", "40001")); return null }
    return { user, row }
  }

  app.post<{ Params: { id: string } }>("/v1/studio/outfit-sets/:id/piece", async (request, reply) => {
    const body = pieceBody.safeParse(request.body)
    if (!body.success) return reply.code(422).send(apiError("validation", "Escolha uma das opções encontradas."))
    try {
      const found = await forChange(request, reply, body.data.base); if (!found) return reply
      const { user, row } = found
      const { slot, productId } = body.data
      const current = row.pieces.find((p) => p.slot === slot)
      const picked = current?.id === productId ? current : row.plan.pools[slot]?.find((p) => p.id === productId)
      if (!current || !picked) return reply.code(422).send(apiError("validation", "Esta peça não está entre as opções encontradas para este conjunto."))
      const next: StoredPiece = { ...picked, reason: picked === current ? current.reason : "Escolhida por você" }
      if (body.data.variantId !== undefined) {
        if (body.data.variantId !== null && !next.variants.some((v) => v.id === body.data.variantId)) return reply.code(422).send(apiError("validation", "Tamanho indisponível para esta peça."))
        next.variantId = body.data.variantId
        if (next.reference) next.reference = { ...next.reference, variantId: body.data.variantId }
      }
      await deps.search.prepare([next])
      if (next.blocked !== null && next.source === "aliexpress") return reply.code(409).send(apiError("piece_blocked", `${blockedMessage(next.blocked)} A peça anterior foi mantida.`))
      return await save(user, row, "swap", row.pieces.map((p) => (p.slot === slot ? next : p)), row.locked)
    } catch (error) { return failure(request, reply, error) }
  })
  app.post<{ Params: { id: string } }>("/v1/studio/outfit-sets/:id/locks", async (request, reply) => {
    const body = locksBody.safeParse(request.body)
    if (!body.success) return reply.code(422).send(apiError("validation", "Trava inválida."))
    try {
      const found = await forChange(request, reply, body.data.base); if (!found) return reply
      await deps.db.call("set_outfit_locks", found.user, found.row.id, body.data.base, [...new Set(body.data.locked)])
      return presentFull((await readSet(found.user, found.row.id))!)
    } catch (error) { return failure(request, reply, error) }
  })
  app.post<{ Params: { id: string } }>("/v1/studio/outfit-sets/:id/suggest", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = suggestBody.safeParse(request.body)
    if (!body.success) return reply.code(422).send(apiError("validation", "Trava inválida."))
    try {
      const found = await forChange(request, reply, body.data.base); if (!found) return reply
      const { user, row } = found
      const locked = [...new Set(body.data.locked)]
      const seen = [...new Set(row.revisions.flatMap((r) => r.pieces.map((p) => p.id)))]
      const next = locked.length >= row.pieces.length ? null : await deps.search.resuggest(row.plan, row.pieces, locked, seen)
      if (!next) return reply.code(409).send(apiError("no_alternative", "Não há outra combinação compatível entre as peças já encontradas. Destrave uma peça ou faça um novo pedido."))
      return await save(user, row, "resuggest", next.pieces, locked)
    } catch (error) { return failure(request, reply, error) }
  })
  app.post<{ Params: { id: string } }>("/v1/studio/outfit-sets/:id/restore", async (request, reply) => {
    const body = restoreBody.safeParse(request.body)
    if (!body.success) return reply.code(422).send(apiError("validation", "Versão inválida."))
    try {
      const found = await forChange(request, reply, body.data.base); if (!found) return reply
      const old = found.row.revisions.find((r) => r.revision === body.data.revision)
      if (!old || old.revision === found.row.revision) return reply.code(422).send(apiError("validation", "Escolha uma versão anterior deste conjunto."))
      return await save(found.user, found.row, "swap", old.pieces, found.row.locked)
    } catch (error) { return failure(request, reply, error) }
  })
}
