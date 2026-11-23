import { hkdfSync, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"
import { z } from "zod"
import { exchangeCreatorAuthCode, refreshCreatorToken, REQUIRED_CREATOR_COLLAB_SCOPE, type FetchLike, type TikTokCreatorTokenGrant } from "@stylai/commerce"
import { openTokens, sealTokens, type SessionKeys } from "../../auth/session-crypto.js"

export interface ConnectionOptions {
  file: string
  keys: SessionKeys
  appKey: string
  appSecret: string
  fetch?: FetchLike
  now?: () => number
}

const grantSchema = z.object({
  accessToken: z.string().min(1), refreshToken: z.string().min(1),
  accessTokenExpireIn: z.number().int().positive(), refreshTokenExpireIn: z.number().int().positive(),
  openId: z.string().min(1), userType: z.literal(1), grantedScopes: z.array(z.string()),
  sellerBaseRegion: z.string().nullable(), requestId: z.string().nullable(),
})

/** Single-process pilot vault. Use a persistent root key and a private path outside the repository. */
export function createTikTokConnection(options: ConnectionOptions) {
  if (!isAbsolute(options.file)) throw new Error("TikTok vault path must be absolute")
  const now = options.now ?? Date.now
  const keys = { ...options.keys, tokenKey: Buffer.from(hkdfSync("sha256", options.keys.tokenKey, Buffer.alloc(0), "stylai/tiktok-creator/v1", 32)) }
  let tail: Promise<unknown> = Promise.resolve()
  let generation = 0
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation)
    tail = result.catch(() => undefined)
    return result
  }
  const valid = (grant: TikTokCreatorTokenGrant) => grant.userType === 1
    && grant.grantedScopes.includes(REQUIRED_CREATOR_COLLAB_SCOPE)
    && Number.isSafeInteger(grant.accessTokenExpireIn) && Number.isSafeInteger(grant.refreshTokenExpireIn)
    && grant.accessTokenExpireIn * 1000 > now() && grant.refreshTokenExpireIn * 1000 > now()
    && (grant.sellerBaseRegion === null || grant.sellerBaseRegion === "BR")
  async function load(): Promise<TikTokCreatorTokenGrant | null> {
    try {
      const envelope = z.object({ version: z.string(), ciphertext: z.string() }).parse(JSON.parse(await readFile(options.file, "utf8")))
      const plain = openTokens(keys, envelope.ciphertext, envelope.version)
      if (!plain) return null
      const parsed = grantSchema.safeParse(JSON.parse(plain))
      return parsed.success ? parsed.data : null
    } catch { return null }
  }
  async function save(grant: TikTokCreatorTokenGrant | null): Promise<void> {
    await mkdir(dirname(options.file), { recursive: true, mode: 0o700 })
    const temporary = `${options.file}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ version: keys.version, ciphertext: sealTokens(keys, JSON.stringify(grant)) }), { mode: 0o600, flag: "wx" })
    await rename(temporary, options.file)
  }
  return {
    generation: () => generation,
    async authorize(code: string, expectedGeneration = generation): Promise<{ ok: boolean }> {
      return serial(async () => {
        if (expectedGeneration !== generation) return { ok: false }
        const result = await exchangeCreatorAuthCode({ appKey: options.appKey, appSecret: options.appSecret, authCode: code, fetch: options.fetch })
        if (!result.ok || !valid(result.grant) || expectedGeneration !== generation) return { ok: false }
        await save(result.grant)
        return { ok: true }
      })
    },
    async getAccessToken(): Promise<string | null> {
      const started = generation
      return serial(async () => {
        if (started !== generation) return null
        const grant = await load()
        if (!grant) return null
        if (grant.refreshTokenExpireIn * 1000 <= now() || !grant.grantedScopes.includes(REQUIRED_CREATOR_COLLAB_SCOPE)) { await save(null); return null }
        if (grant.accessTokenExpireIn * 1000 > now() + 60_000) return valid(grant) ? grant.accessToken : null
        const result = await refreshCreatorToken({ appKey: options.appKey, appSecret: options.appSecret, refreshToken: grant.refreshToken, fetch: options.fetch })
        if (started !== generation) return null
        if (!result.ok) {
          const definitive = result.reason === "wrong_user_type" || result.reason === "missing_required_scope"
            || (result.reason === "business_error" && [105001, 105002, 105003, 105005].includes(result.code ?? -1))
          if (definitive) await save(null)
          return null
        }
        if (!valid(result.grant) || result.grant.openId !== grant.openId) { await save(null); return null }
        await save(result.grant)
        return result.grant.accessToken
      }).catch(() => null)
    },
    async disconnect(): Promise<void> {
      generation++ // Invalidate pending exchanges/refreshes before waiting for file writes.
      await serial(() => save(null))
    },
    async invalidate(rejectedToken: string): Promise<void> {
      await serial(async () => {
        const current = await load()
        if (current?.accessToken !== rejectedToken) return
        generation++
        await save(null)
      })
    },
  }
}

export type TikTokConnection = ReturnType<typeof createTikTokConnection>
