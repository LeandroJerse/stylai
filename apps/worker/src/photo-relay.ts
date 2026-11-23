/**
 * Restricted single-job HTTPS photo relay for the worker (local Supabase -> real provider).
 * - Serves ONLY the exact signed path for ONE authorized job's body photo bytes in memory.
 * - Never exposes the web app, API, database, filesystem folders, or a generic proxy.
 * - Uses `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate` to obtain an ephemeral
 *   public https://*.trycloudflare.com origin, and tears down both the tunnel process and HTTP
 *   server immediately on close() or maxLifetimeMs expiry.
 * - Never logs the signed URL, token or photo bytes.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer, type Server } from "node:http"

export interface PhotoRelayLease {
  readonly publicUrl: string
  readonly expiresAtMs: number
  close(): Promise<void>
}

export interface PhotoRelay {
  expose(input: {
    jobId: string
    bytes: Uint8Array
    mime: "image/jpeg" | "image/png" | "image/webp"
    maxLifetimeMs: number
  }): Promise<PhotoRelayLease>
}

/** Local loopback HTTP server serving ONLY one signed path for one image with hard TTL. */
export async function startSinglePhotoServer(input: {
  jobId: string
  bytes: Uint8Array
  mime: "image/jpeg" | "image/png" | "image/webp"
  maxLifetimeMs: number
}): Promise<{ port: number; signedPath: string; expiresAtMs: number; close(): Promise<void> }> {
  const ttlMs = Math.min(Math.max(input.maxLifetimeMs, 5_000), 15 * 60_000)
  const secret = randomBytes(32)
  const tokenId = randomBytes(16).toString("hex")
  const expiresAtMs = Date.now() + ttlMs
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
    const ok = url.pathname === expectedPath && qExp === expSec && expectedBuf.length === givenBuf.length && timingSafeEqual(expectedBuf, givenBuf)
    if (!ok) {
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
    server.listen(0, "127.0.0.1", () => resolveReady())
  })
  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("Failed to bind local photo relay")

  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    await new Promise<void>((r) => {
      server.closeAllConnections?.()
      server.close(() => r())
    })
  }
  const timer = setTimeout(() => { void close() }, ttlMs)
  timer.unref?.()

  return { port: addr.port, signedPath: `${expectedPath}?e=${expSec}&s=${sig}`, expiresAtMs, close }
}

function resolveCloudflaredBinary(explicit?: string): string {
  if (explicit) return explicit
  if (process.platform === "win32") {
    const known = "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe"
    if (existsSync(known)) return known
  }
  return "cloudflared"
}

/** Spawns a restricted ephemeral cloudflared quick tunnel bound ONLY to the single-photo server port. */
export function createCloudflaredPhotoRelay(opts: { binary?: string; startupTimeoutMs?: number } = {}): PhotoRelay {
  const binary = resolveCloudflaredBinary(opts.binary)
  const startupTimeoutMs = opts.startupTimeoutMs ?? 20_000

  return {
    async expose(input): Promise<PhotoRelayLease> {
      const local = await startSinglePhotoServer(input)
      const child = spawn(binary, ["tunnel", "--url", `http://127.0.0.1:${local.port}`, "--no-autoupdate"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      })

      let closed = false
      const close = async (): Promise<void> => {
        if (closed) return
        closed = true
        clearTimeout(hardTimer)
        if (child.pid && child.exitCode === null) {
          if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true })
          else child.kill("SIGTERM")
        }
        await local.close()
      }

      const hardTimer = setTimeout(() => { void close() }, Math.max(1_000, local.expiresAtMs - Date.now()))
      hardTimer.unref?.()

      try {
        const publicOrigin = await new Promise<string>((resolveOrigin, rejectOrigin) => {
          const timer = setTimeout(() => rejectOrigin(new Error("cloudflared_startup_timeout")), startupTimeoutMs)
          let buf = ""
          let foundOrigin: string | null = null
          let registered = false
          const onData = (chunk: Buffer) => {
            buf += chunk.toString("utf8")
            if (!foundOrigin) {
              const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(buf)
              if (m) foundOrigin = m[0]
            }
            if (!registered && /Registered tunnel connection/i.test(buf)) {
              registered = true
            }
            if (foundOrigin && registered) {
              clearTimeout(timer)
              child.stdout?.off("data", onData)
              child.stderr?.off("data", onData)
              resolveOrigin(foundOrigin)
            }
          }
          child.stdout?.on("data", onData)
          child.stderr?.on("data", onData)
          child.once("error", (err) => { clearTimeout(timer); rejectOrigin(err) })
          child.once("exit", (code) => { clearTimeout(timer); rejectOrigin(new Error(`cloudflared_exited_${code ?? "null"}`)) })
        })

        // Wait briefly after tunnel registration before first DNS lookup to avoid OS negative-DNS caching.
        await new Promise((r) => setTimeout(r, 1_500))
        // Brief DNS/edge propagation check on the exact signed URL (HEAD only; no bytes logged).
        const publicUrl = `${publicOrigin}${local.signedPath}`
        const deadline = Date.now() + 25_000
        let reachable = false
        while (Date.now() < deadline) {
          try {
            const probe = await fetch(publicUrl, { method: "HEAD", signal: AbortSignal.timeout(4_000) })
            if (probe.ok) { reachable = true; break }
          } catch { /* wait for trycloudflare DNS propagation */ }
          await new Promise((r) => setTimeout(r, 1_000))
        }
        if (!reachable) throw new Error("cloudflared_not_reachable")

        return { publicUrl, expiresAtMs: local.expiresAtMs, close }
      } catch (err) {
        await close()
        throw err
      }
    },
  }
}
