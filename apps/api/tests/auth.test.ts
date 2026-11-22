import { expect, test } from "bun:test"
import { randomBytes } from "node:crypto"
import { stripImageMetadata, sniffImage } from "@stylai/ai"
import { buildApp } from "../src/app"
import type { AuthProvider } from "../src/modules/auth/provider"
import { cookieHash, openTokens, readSessionKeys, sealTokens, signMediaUrl, verifyMediaSignature } from "../src/modules/auth/session-crypto"
import type { SessionService } from "../src/modules/auth/session-service"
import { readWorkerConfig } from "../../worker/src/worker-config"

const keys = readSessionKeys({ STYLAI_SESSION_KEY: randomBytes(32).toString("base64") })!

test("session key must be exactly 32 bytes; vault tokens are authenticated", () => {
  expect(() => readSessionKeys({ STYLAI_SESSION_KEY: randomBytes(16).toString("base64") })).toThrow()
  expect(readSessionKeys({})).toBeNull()
  const sealed = sealTokens(keys, "secret-tokens")
  expect(sealed.includes("secret-tokens")).toBe(false)
  expect(openTokens(keys, sealed, keys.version)).toBe("secret-tokens")
  expect(openTokens(keys, sealed, "v2")).toBeNull()
  const [iv, body, tag] = sealed.split(".")
  expect(openTokens(keys, `${iv}.${body!.slice(0, -2)}AA.${tag}`, keys.version)).toBeNull()
  const other = readSessionKeys({ STYLAI_SESSION_KEY: randomBytes(32).toString("base64") })!
  expect(openTokens(other, sealed, other.version)).toBeNull()
  expect(cookieHash("abc")).toMatch(/^[0-9a-f]{64}$/)
})

test("media links are bound to kind, id, user and expiry", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 30)
  const id = "70000000-0000-4000-8000-000000000001", user = "10000000-0000-4000-8000-000000000001"
  const url = new URL(signMediaUrl("http://localhost:5190/v1", keys, "look", id, user, now))
  expect(url.pathname).toBe(`/v1/media/looks/${id}`)
  const e = Number(url.searchParams.get("e")), s = url.searchParams.get("s")!
  expect(verifyMediaSignature(keys, "look", id, user, e, s, now)).toBe(true)
  expect(verifyMediaSignature(keys, "photo", id, user, e, s, now)).toBe(false)
  expect(verifyMediaSignature(keys, "look", id, "10000000-0000-4000-8000-000000000002", e, s, now)).toBe(false)
  expect(verifyMediaSignature(keys, "look", id, user, e, s, e * 1000 + 1)).toBe(false)
  // Stable within a 5-minute bucket, so polling does not reload the image.
  expect(signMediaUrl("http://x/v1", keys, "look", id, user, now)).toBe(signMediaUrl("http://x/v1", keys, "look", id, user, now + 60_000))
})

function jpegWithExif(orientation: number): Uint8Array {
  // SOI, APP1 Exif (big-endian TIFF, one IFD entry: Orientation), COM, SOF0 (2x600), SOS + data, EOI.
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0]
  const exif = [...Buffer.from("Exif\0\0"), ...tiff]
  const app1 = [0xff, 0xe1, (exif.length + 2) >> 8, (exif.length + 2) & 0xff, ...exif]
  const com = [0xff, 0xfe, 0, 7, ...Buffer.from("gps!!")]
  const sof = [0xff, 0xc0, 0, 11, 8, 0x02, 0x58, 0, 2, 1, 1, 0x11, 0]
  const sos = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9]
  return new Uint8Array([0xff, 0xd8, ...app1, ...com, ...sof, ...sos])
}

test("photo metadata (EXIF/GPS, comments) is removed; rotated JPEGs are refused", () => {
  const upright = stripImageMetadata(jpegWithExif(1))
  expect(upright.ok).toBe(true)
  if (upright.ok) {
    expect(upright.removed).toBe(2)
    expect(Buffer.from(upright.bytes).includes(Buffer.from("Exif"))).toBe(false)
    expect(Buffer.from(upright.bytes).includes(Buffer.from("gps!!"))).toBe(false)
    expect(sniffImage(upright.bytes)).toEqual({ mime: "image/jpeg", width: 2, height: 600 })
  }
  expect(stripImageMetadata(jpegWithExif(6))).toEqual({ ok: false, reason: "rotated" })
  expect(stripImageMetadata(new Uint8Array([1, 2, 3]))).toEqual({ ok: false, reason: "malformed" })
})

const unusedSessions = {} as SessionService
function provider(overrides: Partial<AuthProvider> = {}): AuthProvider {
  return {
    signUp: async () => "ok", signIn: async () => ({ kind: "invalid" }), verifyEmail: async () => ({ kind: "invalid" }),
    resendConfirmation: async () => undefined, refresh: async () => ({ kind: "invalid" }), signOut: async () => undefined,
    verifyAccessToken: async () => null, ...overrides,
  }
}
const origin = "http://localhost:5190"

test("sign-up never returns a session and does not reveal existing accounts", async () => {
  let calls = 0
  const app = await buildApp({ appOrigin: origin, auth: { provider: provider({ signUp: async () => { calls++; return "ok" } }), sessions: unusedSessions, appOrigin: origin, secureCookie: false } })
  try {
    const ok = await app.inject({ method: "POST", url: "/v1/auth/sign-up", payload: { name: "Ana", email: "ana@example.com", password: "senha1234" } })
    expect(ok.statusCode).toBe(202)
    expect(ok.json()).toEqual({ status: "verification_required" })
    expect(ok.headers["set-cookie"]).toBeUndefined()
    const weak = await app.inject({ method: "POST", url: "/v1/auth/sign-up", payload: { name: "Ana", email: "ana@example.com", password: "senhasemnumero" } })
    expect(weak.statusCode).toBe(422)
    expect(weak.json().error.fields.password).toBeTruthy()
    expect(calls).toBe(1)
  } finally { await app.close() }
})

test("sign-in maps provider outcomes; cookie routes require the app origin", async () => {
  const app = await buildApp({ appOrigin: origin, auth: { provider: provider({ signIn: async (email) => ({ kind: email.startsWith("new") ? "unverified" : "invalid" }) }), sessions: unusedSessions, appOrigin: origin, secureCookie: false } })
  try {
    expect((await app.inject({ method: "POST", url: "/v1/auth/sign-in", payload: { email: "x@example.com", password: "a" } })).statusCode).toBe(401)
    const unverified = await app.inject({ method: "POST", url: "/v1/auth/sign-in", payload: { email: "new@example.com", password: "a" } })
    expect(unverified.statusCode).toBe(403)
    expect(unverified.json().error.code).toBe("email_not_verified")
    expect((await app.inject({ method: "POST", url: "/v1/auth/refresh" })).statusCode).toBe(403)
    expect((await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: { origin } })).statusCode).toBe(401)
    expect((await app.inject({ method: "POST", url: "/v1/auth/sign-out", headers: { origin: "https://evil.example" } })).statusCode).toBe(403)
    expect((await app.inject({ method: "POST", url: "/v1/auth/email/verify", payload: { tokenHash: "x" } })).statusCode).toBe(400)
  } finally { await app.close() }
})

test("Segmind simulator is loopback-only and never allowed in staging/production", () => {
  const sim = readWorkerConfig({ SEGMIND_BASE_URL: "http://127.0.0.1:54390" })
  expect(sim.segmind.simulated).toBe(true)
  expect(sim.engine.simulatedProvider).toBe(true)
  expect(() => readWorkerConfig({ SEGMIND_BASE_URL: "http://127.0.0.1:54390", STYLAI_ENVIRONMENT: "staging" })).toThrow()
  expect(() => readWorkerConfig({ SEGMIND_BASE_URL: "https://evil.example" })).toThrow()
  expect(readWorkerConfig({}).segmind.simulated).toBe(false)
  expect(readWorkerConfig({}).engine.submitRetries).toBe(0)
  expect(() => readWorkerConfig({ SEGMIND_SUBMIT_RETRIES: "5" })).toThrow()
  expect(readWorkerConfig({ LANGFUSE_TRACING_ENVIRONMENT: "integration-test" }).engine.telemetryEnvironment).toBe("integration-test")
})
