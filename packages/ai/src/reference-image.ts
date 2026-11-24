/**
 * Server-side download of a product image that may become a try-on reference. The URL comes from a store response, so
 * it is untrusted: https on an allow-listed host, default port, no credentials, every resolved address public, the
 * connection PINNED to the address that was checked (no DNS rebinding), no redirects, bounded time and bytes, and the
 * file judged by its own container (never by name or content-type). Errors are short codes without URLs or addresses.
 */
import { createHash } from "node:crypto"
import { lookup } from "node:dns/promises"
import { request } from "node:https"
import { isIPv4, isIPv6 } from "node:net"
import { sniffImage, imageLimits, type ImageInfo } from "./image.js"

export const REFERENCE_MAX_BYTES = 4_194_304
export const REFERENCE_MIN_SIDE = 300
export const REFERENCE_TIMEOUT_MS = 12_000

export type ReferenceImageCode = "host_not_allowed" | "private_address" | "redirect_refused" | "too_large" | "not_image" | "too_small"
  | "dimensions_invalid" | "not_found" | "download_failed" | "timeout"
export class ReferenceImageError extends Error {
  constructor(readonly code: ReferenceImageCode) { super(code); this.name = "ReferenceImageError" }
}
export interface ReferenceImage extends ImageInfo { bytes: Uint8Array; sha256: string }
export type ReferenceTransport = (url: URL, address: string, signal: AbortSignal) => Promise<{
  status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array>
}>
export type ReferenceDownloader = (url: string) => Promise<ReferenceImage>

/** Globally reachable unicast only. IPv6 is limited to 2000::/3 minus ranges that tunnel or embed other addresses. */
export function isPublicAddress(address: string): boolean {
  if (isIPv4(address)) {
    const [a, b, c] = address.split(".").map(Number) as [number, number, number]
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false
    if (a === 169 && b === 254) return false
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) return false
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false
    return !(a === 203 && b === 0 && c === 113)
  }
  if (!isIPv6(address) || address.includes("%")) return false
  const head = address.toLowerCase().split(":")
  const first = parseInt(head[0] || "0", 16), second = parseInt(head[1] || "0", 16)
  if ((first & 0xe000) !== 0x2000) return false
  if (first === 0x2002) return false
  return !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
}

/** Connects to the already-checked address; TLS still validates the certificate of the host name. */
const httpsTransport: ReferenceTransport = (url, address, signal) => new Promise((resolve, reject) => {
  const family = isIPv4(address) ? 4 : 6
  const req = request(url, {
    method: "GET", signal, headers: { Accept: "image/jpeg,image/png,image/webp", "User-Agent": "image-reference-check/1.0" },
    lookup: (_host, options, done) => { if (options.all) done(null, [{ address, family }]); else done(null, address, family) },
  }, (res) => {
    // A refused body is destroyed without being read: its late error must not become an uncaught exception.
    res.on("error", () => undefined)
    resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res })
  })
  req.on("error", reject)
  req.end()
})

export function createReferenceDownloader(options: {
  hosts: readonly string[]; resolve?: (host: string) => Promise<string[]>; transport?: ReferenceTransport; timeoutMs?: number
}): ReferenceDownloader {
  const resolveHost = options.resolve ?? (async (host) => (await lookup(host, { all: true })).map((x) => x.address))
  const transport = options.transport ?? httpsTransport
  const allowed = (u: URL) => u.protocol === "https:" && !u.username && !u.password && !u.port
    && options.hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))

  async function fetchImage(url: URL, signal: AbortSignal, aborted: Promise<never>): Promise<ReferenceImage> {
    const addresses = await Promise.race([resolveHost(url.hostname), aborted])
    if (!addresses.length) throw new ReferenceImageError("download_failed")
    if (!addresses.every(isPublicAddress)) throw new ReferenceImageError("private_address")
    const response = await Promise.race([transport(url, addresses[0]!, signal), aborted])
    if (response.status >= 300 && response.status < 400) throw new ReferenceImageError("redirect_refused")
    if (response.status === 404 || response.status === 410) throw new ReferenceImageError("not_found")
    if (response.status !== 200) throw new ReferenceImageError("download_failed")
    if (Number(response.headers["content-length"] ?? 0) > REFERENCE_MAX_BYTES) throw new ReferenceImageError("too_large")
    const parts: Uint8Array[] = []
    let size = 0
    const iterator = response.body[Symbol.asyncIterator]()
    for (;;) {
      const part = await Promise.race([iterator.next(), aborted])
      if (part.done) break
      size += part.value.length
      if (size > REFERENCE_MAX_BYTES) throw new ReferenceImageError("too_large")
      parts.push(part.value)
    }
    const bytes = new Uint8Array(Buffer.concat(parts))
    const info = sniffImage(bytes)
    if (!info) throw new ReferenceImageError("not_image")
    if (info.width < REFERENCE_MIN_SIDE || info.height < REFERENCE_MIN_SIDE) throw new ReferenceImageError("too_small")
    if (info.width * info.height > imageLimits.maxPixels) throw new ReferenceImageError("dimensions_invalid")
    return { ...info, bytes, sha256: createHash("sha256").update(bytes).digest("hex") }
  }

  return async (raw) => {
    let url: URL
    try { url = new URL(raw) } catch { throw new ReferenceImageError("host_not_allowed") }
    if (!allowed(url)) throw new ReferenceImageError("host_not_allowed")
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const aborted = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { reject(new ReferenceImageError("timeout")); controller.abort() }, options.timeoutMs ?? REFERENCE_TIMEOUT_MS)
    })
    aborted.catch(() => undefined)
    try {
      return await fetchImage(url, controller.signal, aborted)
    } catch (error) {
      if (error instanceof ReferenceImageError) throw error
      throw new ReferenceImageError(controller.signal.aborted ? "timeout" : "download_failed")
    } finally {
      clearTimeout(timer)
      // Stops a body still streaming (size limit, bad status): the socket is destroyed, never drained.
      controller.abort()
    }
  }
}
