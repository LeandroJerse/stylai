/**
 * Body photos per angle (front / side = three-quarter 45° / profile 90°) with explicit, versioned consent.
 *   POST /v1/privacy/consents              { version, purpose: "body_photo_try_on" } -> 201
 *   GET  /v1/me/body-photos                -> { items: BodyPhoto[], consent, requiredAngles, validator }
 *   PUT  /v1/me/body-photos/:angle         multipart "file" -> BodyPhoto (stored private, metadata stripped,
 *                                             then validated on the server by the LOCAL pose analyzer)
 *   POST /v1/me/body-photos/:angle/revalidate -> BodyPhoto (after a technical validator error, or when the
 *                                             candidate was judged by older rules: same stored bytes, current rules)
 *   DELETE /v1/me/body-photos/:angle       -> 204; that angle stops being usable at once
 *   GET  /v1/media/photos/:id?u&e&s        -> bytes (short-lived signed link; owner checked in the DB)
 *   GET  /v1/media/looks/:id?u&e&s         -> bytes of a rendered version (same rules)
 * A new photo is a CANDIDATE until the validator approves it; the previous approved photo of that
 * angle stays in use meanwhile. Generation uses only the approved front photo (database rule).
 */
import { createHash, randomUUID } from "node:crypto"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { analyzerFailure, apiError, evaluatePose, POSE_RULES_VERSION, type PhotoAngle, type PhotoValidation } from "@stylai/contracts"
import { imageLimits, sniffImage, stripImageMetadata } from "@stylai/ai"
import { PrivateDatabaseError, type PrivateDatabase, type PrivateObjectStore } from "@stylai/supabase"
import { signMediaUrl, verifyMediaSignature, type SessionKeys } from "../auth/session-crypto.js"
import type { PoseAnalyzer } from "./pose-analyzer.js"

export interface PhotoRouteDeps {
  db: PrivateDatabase<"api">
  store: PrivateObjectStore
  keys: SessionKeys
  resolveActor: (request: FastifyRequest) => Promise<string | null>
  photoPolicyVersion: string
  publicBaseUrl: string
  /** Local pose analyzer; absent = every photo ends as a technical validation error (never approved). */
  analyzer?: PoseAnalyzer
}

export const MIN_PHOTO_HEIGHT = 600
/** Angles the current provider needs for a generation. Side/profile are stored but not sent. */
export const REQUIRED_ANGLES: readonly PhotoAngle[] = ["front"]
const ANGLES = ["front", "side", "profile"] as const
const angleParam = z.enum(ANGLES)
const photoRow = z.object({
  id: z.string().uuid(), angle: angleParam, state: z.enum(["ready", "processing", "rejected"]), mime: z.string().nullable(),
  width: z.number().nullable(), height: z.number().nullable(), created_at: z.string(), expires_at: z.string().nullable(),
  validation_status: z.enum(["approved", "needs_adjustment", "inconclusive", "error"]).nullable().optional(),
  validator_version: z.string().nullable().optional(), validation: z.record(z.string(), z.unknown()).nullable().optional(),
})
const assetRow = z.object({ bucket: z.enum(["body-photos", "generated-looks"]), object_key: z.string(), mime: z.enum(["image/png", "image/jpeg", "image/webp"]) })
const consentBody = z.object({ version: z.string().min(1).max(100), purpose: z.literal("body_photo_try_on") }).strict()
const mediaQuery = z.object({ u: z.string().uuid(), e: z.coerce.number().int(), s: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
const TITLE: Record<PhotoAngle, string> = { front: "Frente", side: "Três quartos", profile: "Perfil" }

export async function registerPhotoRoutes(app: FastifyInstance, deps: PhotoRouteDeps) {
  const base = deps.publicBaseUrl.replace(/\/+$/, "")
  const unavailable = (reply: FastifyReply, error?: unknown) => {
    if (error instanceof PrivateDatabaseError && error.outcome === "rejected" && error.sqlState === "42501") {
      return reply.code(403).send(apiError("consent_required", "Aceite o termo de uso da foto antes de enviar."))
    }
    return reply.code(503).send(apiError("service_unavailable", "Serviço temporariamente indisponível."))
  }
  async function actor(request: FastifyRequest, reply: FastifyReply) {
    const id = await deps.resolveActor(request)
    if (!id) await reply.code(401).send(apiError("unauthorized", "Entre na sua conta para continuar."))
    return id
  }
  const present = (user: string, p: z.infer<typeof photoRow>) => {
    const v = p.validation as Partial<PhotoValidation> | null | undefined
    return {
      id: p.id,
      angle: p.angle,
      // ready = approved and in use; processing = being validated; rejected = needs adjustment / unconfirmed / technical error
      status: p.state,
      inUse: p.state === "ready",
      image: { url: signMediaUrl(base, deps.keys, "photo", p.id, user), width: p.width, height: p.height, alt: `Sua foto: ${TITLE[p.angle]}` },
      // Blocking findings vs. recommendations on an accepted photo (e.g. little room above the head).
      issues: (v?.issues ?? []).filter((i) => i.level !== "advice").map((i) => i.message),
      advice: (v?.issues ?? []).filter((i) => i.level === "advice").map((i) => i.message),
      revalidatable: p.state === "rejected" && (p.validation_status === "error" || stale(p.validator_version)),
      validation: p.validation_status ? {
        status: p.validation_status,
        framing: v?.framing ?? null,
        supports: v?.supports ?? null,
        measuredAngle: v?.measuredAngle ?? null,
        persons: v?.persons ?? null,
        version: p.validator_version ?? null,
        issues: v?.issues ?? [],
      } : null,
      uploadedAt: p.created_at,
      expiresAt: p.expires_at,
    }
  }
  /** Judged by rules older than the current ones (the person can re-run the current rules on the same bytes). */
  const stale = (version: string | null | undefined): boolean => !version || version.split("+")[1] !== POSE_RULES_VERSION
  const listRows = async (user: string) => z.array(photoRow).parse((await deps.db.call("list_body_photos", user)) ?? [])

  /** Validates the stored bytes of one candidate and records the result for that exact version (sha256). */
  async function validate(user: string, asset: string, angle: PhotoAngle, bytes: Uint8Array, sha: string) {
    const analyzerVersion = deps.analyzer ? await deps.analyzer.version() : null
    let result: PhotoValidation | null = null
    if (analyzerVersion) {
      const cached = z.object({ status: z.string(), result: z.record(z.string(), z.unknown()) }).nullable()
        .safeParse(await deps.db.call("read_cached_photo_validation", user, sha, `${analyzerVersion}+${POSE_RULES_VERSION}`, angle))
      if (cached.success && cached.data) result = cached.data.result as unknown as PhotoValidation
    }
    if (!result) {
      const measured = deps.analyzer ? await deps.analyzer.analyze(bytes) : null
      result = measured ? evaluatePose(measured, angle) : analyzerFailure(angle)
    }
    // Only the decision is stored (no landmarks, no image data).
    await deps.db.call("settle_body_photo_validation", user, asset, sha, result.status, result.version, JSON.parse(JSON.stringify(result)))
  }

  app.post("/v1/privacy/consents", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const body = consentBody.safeParse(request.body)
    if (!body.success || body.data.version !== deps.photoPolicyVersion) {
      return reply.code(409).send(apiError("consent_version_mismatch", "O termo foi atualizado. Recarregue a página e leia a versão atual."))
    }
    try {
      const id = await deps.db.call("record_photo_consent", user, deps.photoPolicyVersion)
      return reply.code(201).send({ id, version: deps.photoPolicyVersion, purpose: body.data.purpose })
    } catch (error) { return unavailable(reply, error) }
  })

  app.get("/v1/me/body-photos", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    try {
      const rows = await listRows(user)
      const consent = z.object({ policy_version: z.string() }).nullable().parse(await deps.db.call("read_photo_consent", user))
      return {
        items: rows.map((r) => present(user, r)),
        consent: { policyVersion: deps.photoPolicyVersion, accepted: consent?.policy_version === deps.photoPolicyVersion },
        requiredAngles: REQUIRED_ANGLES,
        validator: { kind: "local_pose_model", available: deps.analyzer ? (await deps.analyzer.version()) !== null : false },
      }
    } catch (error) { return unavailable(reply, error) }
  })

  app.put<{ Params: { angle: string } }>("/v1/me/body-photos/:angle", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const angle = angleParam.safeParse(request.params.angle)
    if (!angle.success) return reply.code(404).send(apiError("not_found", "Posição de foto desconhecida."))
    if (!request.isMultipart()) return reply.code(400).send(apiError("validation", "Envie a foto como arquivo."))
    let bytes: Uint8Array
    try {
      const file = await request.file({ limits: { fileSize: imageLimits.maxBytes, files: 1 } })
      if (!file) return reply.code(400).send(apiError("validation", "Escolha uma foto."))
      bytes = new Uint8Array(await file.toBuffer())
      if (file.file.truncated) throw new Error("too_large")
    } catch {
      return reply.code(413).send(apiError("payload_too_large", "A foto passa de 12 MB. Escolha uma menor."))
    }
    let stripped = stripImageMetadata(bytes)
    // QA-006: a camera JPEG whose EXIF says "rotated" is normalized ONCE on the server (local analyzer),
    // then checked again; the normalized bytes are what is stored, hashed and analyzed.
    if (!stripped.ok && stripped.reason === "rotated" && deps.analyzer) {
      const upright = await deps.analyzer.normalize(bytes)
      if (upright) stripped = stripImageMetadata(upright)
    }
    if (!stripped.ok) {
      return reply.code(422).send(apiError("invalid_image", stripped.reason === "rotated"
        ? "Esta foto precisa ser girada. Abra-a no celular, salve na posição em pé e envie de novo."
        : "Use uma foto JPEG, PNG ou WebP."))
    }
    const info = sniffImage(stripped.bytes)
    if (!info) return reply.code(422).send(apiError("invalid_image", "Use uma foto JPEG, PNG ou WebP."))
    if (info.height < MIN_PHOTO_HEIGHT || info.width * info.height > imageLimits.maxPixels) {
      return reply.code(422).send(apiError("invalid_image", `A foto precisa ter pelo menos ${MIN_PHOTO_HEIGHT} px de altura.`))
    }
    const ext = info.mime === "image/png" ? "png" : info.mime === "image/webp" ? "webp" : "jpg"
    const key = `${user}/${angle.data}-${randomUUID()}.${ext}`
    const sha = createHash("sha256").update(stripped.bytes).digest("hex")
    let asset: string
    try {
      asset = await deps.db.call("begin_body_photo_at", user, angle.data, deps.photoPolicyVersion, key, stripped.bytes.byteLength, info.mime, info.width, info.height)
    } catch (error) { return unavailable(reply, error) }
    try {
      await deps.store.put("body-photos", key, stripped.bytes, info.mime)
    } catch {
      await deps.db.call("finish_body_photo", user, asset, false).catch(() => undefined)
      return reply.code(503).send(apiError("service_unavailable", "Não conseguimos guardar a foto agora. Tente novamente."))
    }
    try {
      await deps.db.call("set_body_photo_hash", user, asset, sha)
      await validate(user, asset, angle.data, stripped.bytes, sha)
      const row = (await listRows(user)).find((r) => r.id === asset)
      if (!row) return unavailable(reply)
      return reply.code(200).send(present(user, row))
    } catch (error) { return unavailable(reply, error) }
  })

  // Retry only after a technical validator failure (same stored bytes, no new upload).
  app.post<{ Params: { angle: string } }>("/v1/me/body-photos/:angle/revalidate", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const angle = angleParam.safeParse(request.params.angle)
    if (!angle.success) return reply.code(404).send(apiError("not_found", "Posição de foto desconhecida."))
    try {
      const row = (await listRows(user)).find((r) => r.angle === angle.data && r.state === "rejected" && (r.validation_status === "error" || stale(r.validator_version)))
      if (!row) return reply.code(409).send(apiError("conflict", "Não há validação pendente para esta foto."))
      const asset = assetRow.safeParse(await deps.db.call("read_body_photo_asset", user, row.id))
      if (!asset.success) return reply.code(404).send(apiError("not_found", "Foto indisponível. Envie outra."))
      const bytes = await deps.store.get(asset.data.bucket, asset.data.object_key)
      const sha = createHash("sha256").update(bytes).digest("hex")
      // Bind the result to the bytes read now (older photos may predate hashing).
      await deps.db.call("set_body_photo_hash", user, row.id, sha)
      await validate(user, row.id, angle.data, bytes, sha)
      const fresh = (await listRows(user)).find((r) => r.id === row.id)
      return fresh ? present(user, fresh) : reply.code(404).send(apiError("not_found", "Foto indisponível. Envie outra."))
    } catch (error) { return unavailable(reply, error) }
  })

  app.delete<{ Params: { angle: string } }>("/v1/me/body-photos/:angle", async (request, reply) => {
    const user = await actor(request, reply); if (!user) return reply
    const angle = angleParam.safeParse(request.params.angle)
    if (!angle.success) return reply.code(404).send(apiError("not_found", "Posição de foto desconhecida."))
    try {
      await deps.db.call("remove_body_photo_at", user, angle.data)
      return reply.code(204).send()
    } catch (error) { return unavailable(reply, error) }
  })

  async function stream(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply, kind: "photo" | "look") {
    const q = mediaQuery.safeParse(request.query)
    const id = request.params.id
    if (!q.success || !z.string().uuid().safeParse(id).success || !verifyMediaSignature(deps.keys, kind, id, q.data.u, q.data.e, q.data.s)) {
      return reply.code(404).send(apiError("not_found", "Imagem não encontrada ou link expirado."))
    }
    try {
      const raw = kind === "photo" ? await deps.db.call("read_body_photo_asset", q.data.u, id) : await deps.db.call("read_version_asset", q.data.u, id)
      const asset = assetRow.safeParse(raw)
      if (!asset.success) return reply.code(404).send(apiError("not_found", "Imagem não encontrada ou expirada."))
      const bytes = await deps.store.get(asset.data.bucket, asset.data.object_key)
      return reply.header("Content-Type", asset.data.mime).header("Cache-Control", "private, max-age=300")
        .header("Cross-Origin-Resource-Policy", "same-site").header("Referrer-Policy", "no-referrer").send(Buffer.from(bytes))
    } catch {
      return reply.code(503).send(apiError("service_unavailable", "Imagem temporariamente indisponível."))
    }
  }
  app.get<{ Params: { id: string } }>("/v1/media/photos/:id", (request, reply) => stream(request, reply, "photo"))
  app.get<{ Params: { id: string } }>("/v1/media/looks/:id", (request, reply) => stream(request, reply, "look"))
}
