/**
 * Server-only key material for the app-session vault and private media links.
 * One 32-byte root key (STYLAI_SESSION_KEY, base64) is split with HKDF into a
 * token-encryption key and a media-URL signing key, so a leaked media signature
 * says nothing about the vault. Values are never logged.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto"

export interface SessionKeys {
  readonly version: string
  readonly tokenKey: Buffer
  readonly mediaKey: Buffer
}

export function readSessionKeys(env: Record<string, string | undefined>): SessionKeys | null {
  const raw = env.STYLAI_SESSION_KEY?.trim()
  if (!raw) return null
  const root = Buffer.from(raw, "base64")
  if (root.length !== 32) throw new Error("STYLAI_SESSION_KEY must be 32 random bytes encoded as base64")
  const version = env.STYLAI_SESSION_KEY_VERSION?.trim() || "v1"
  if (!/^[a-z0-9-]{1,32}$/.test(version)) throw new Error("Invalid STYLAI_SESSION_KEY_VERSION")
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", root, Buffer.alloc(0), info, 32))
  return { version, tokenKey: derive("stylai/session-tokens/v1"), mediaKey: derive("stylai/media-urls/v1") }
}

const b64 = (b: Buffer) => b.toString("base64url")

/** AES-256-GCM; the key version is bound as additional authenticated data. */
export function sealTokens(keys: SessionKeys, plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", keys.tokenKey, iv)
  cipher.setAAD(Buffer.from(`stylai-session:${keys.version}`))
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return `${b64(iv)}.${b64(body)}.${b64(cipher.getAuthTag())}`
}

/** Null on any tampering, wrong key or unknown key version. */
export function openTokens(keys: SessionKeys, sealed: string, version: string): string | null {
  if (version !== keys.version) return null
  const parts = sealed.split(".")
  if (parts.length !== 3) return null
  try {
    const [iv, body, tag] = parts.map((p) => Buffer.from(p, "base64url")) as [Buffer, Buffer, Buffer]
    const decipher = createDecipheriv("aes-256-gcm", keys.tokenKey, iv)
    decipher.setAAD(Buffer.from(`stylai-session:${version}`))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")
  } catch {
    return null
  }
}

/** Opaque cookie value (256 bits). Only its SHA-256 is stored. */
export const newCookieValue = (): string => b64(randomBytes(32))
export const cookieHash = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex")

export type MediaKind = "look" | "photo" | "comparison"
const MEDIA_PATH: Record<MediaKind, string> = { look: "looks", photo: "photos", comparison: "comparisons" }

function mediaSignature(keys: SessionKeys, kind: MediaKind, id: string, user: string, exp: number): string {
  return createHmac("sha256", keys.mediaKey).update(`${kind}\n${id}\n${user}\n${exp}`).digest("base64url")
}

/**
 * Short-lived link for an <img> (which cannot send the Bearer token). Expiry is
 * rounded up to a 5-minute bucket so the URL stays stable between polls.
 */
export function signMediaUrl(base: string, keys: SessionKeys, kind: MediaKind, id: string, user: string, nowMs = Date.now(), ttlSeconds = 900): string {
  const bucket = 300
  const exp = Math.ceil((Math.floor(nowMs / 1000) + ttlSeconds) / bucket) * bucket
  const params = new URLSearchParams({ u: user, e: String(exp), s: mediaSignature(keys, kind, id, user, exp) })
  return `${base}/media/${MEDIA_PATH[kind]}/${id}?${params.toString()}`
}

export function verifyMediaSignature(keys: SessionKeys, kind: MediaKind, id: string, user: string, exp: number, signature: string, nowMs = Date.now()): boolean {
  if (!Number.isSafeInteger(exp) || exp * 1000 <= nowMs || exp * 1000 > nowMs + 3_600_000) return false
  const expected = Buffer.from(mediaSignature(keys, kind, id, user, exp))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
