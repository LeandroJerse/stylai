/**
 * Restricted temporary HTTP relay for a SINGLE authorized pilot job's body photo.
 * - Never exposes the web app, API, database, filesystem folders, or a generic proxy.
 * - Serves ONLY the exact signed token registered for the authorized job image.
 * - Garment images on public HTTPS (e.g. Wikimedia CC0) are fetched directly by the provider (never relayed).
 * - Enforces an explicit maximum lifetime (default 10 minutes) and supports immediate shutdown on job completion/failure.
 * - Expiry does NOT authorize a provider resubmit.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { createServer, type Server } from "node:http"

export interface RestrictedPhotoRelay {
  readonly port: number
  readonly expiresAtMs: number
  /** Returns the relative signed path for the single authorized photo (never log the full public URL). */
  signedPath(): string
  close(): Promise<void>
}

export async function startRestrictedPhotoRelay(input: {
  bytes: Uint8Array
  mime: "image/jpeg" | "image/png" | "image/webp"
  jobId: string
  /** Hard lifetime ceiling (ms). Defaults to 10 minutes; covers queue + processing, never open indefinitely. */
  maxLifetimeMs?: number
  host?: string
  port?: number
}): Promise<RestrictedPhotoRelay> {
  const maxLifetimeMs = Math.min(Math.max(input.maxLifetimeMs ?? 10 * 60_000, 5_000), 20 * 60_000)
  const secret = randomBytes(32)
  const tokenId = randomBytes(16).toString("hex")
  const expiresAtMs = Date.now() + maxLifetimeMs
  const expSec = Math.floor(expiresAtMs / 1000)
  const sig = createHmac("sha256", secret).update(`${input.jobId}\n${tokenId}\n${expSec}`).digest("base64url")
  const expectedPath = `/pilot-photo/${tokenId}`

  let closed = false
  const server: Server = createServer((req, res) => {
    if (closed || Date.now() > expiresAtMs) {
      res.writeHead(410, { "content-type": "application/json", "cache-control": "no-store" })
      res.end(JSON.stringify({ error: "relay_expired" }))
      return
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { "content-type": "application/json", "cache-control": "no-store" })
      res.end(JSON.stringify({ error: "method_not_allowed" }))
      return
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1")
    const qExp = Number(url.searchParams.get("e"))
    const qSig = url.searchParams.get("s") ?? ""
    const expectedBuf = Buffer.from(sig)
    const givenBuf = Buffer.from(qSig)
    const sigOk = url.pathname === expectedPath && qExp === expSec && expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf)
    if (!sigOk) {
      res.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" })
      res.end(JSON.stringify({ error: "not_found" }))
      return
    }
    res.writeHead(200, {
      "content-type": input.mime,
      "content-length": String(input.bytes.byteLength),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    })
    if (req.method === "HEAD") res.end()
    else res.end(Buffer.from(input.bytes))
  })

  await new Promise<void>((resolveReady, rejectReady) => {
    server.once("error", rejectReady)
    server.listen(input.port ?? 0, input.host ?? "127.0.0.1", () => resolveReady())
  })
  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("Failed to bind restricted photo relay")

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    await new Promise<void>((r) => {
      server.closeAllConnections?.()
      server.close(() => r())
    })
  }
  const timer = setTimeout(() => { void close() }, maxLifetimeMs)
  timer.unref?.()

  return {
    port: addr.port,
    expiresAtMs,
    signedPath: () => `${expectedPath}?e=${expSec}&s=${sig}`,
    close,
  }
}
