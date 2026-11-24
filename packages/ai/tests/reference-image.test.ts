import { describe, expect, test } from "bun:test"
import { createReferenceDownloader, isPublicAddress, ReferenceImageError, type ReferenceTransport } from "../src/reference-image"

/** Minimal PNG header: enough for the container sniffer (never decoded). */
function png(width: number, height: number, size = 64): Uint8Array {
  const b = new Uint8Array(size)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, width)
  new DataView(b.buffer).setUint32(20, height)
  return b
}
async function* chunks(...parts: Uint8Array[]) { for (const p of parts) yield p }
const HOSTS = ["alicdn.com", "aliexpress-media.com"]
const URL_OK = "https://ae01.alicdn.com/kf/a.jpg"
const ok = (bytes: Uint8Array): ReferenceTransport => async () => ({ status: 200, headers: {}, body: chunks(bytes) })
function make(transport: ReferenceTransport = ok(png(800, 800)), addresses: string[] = ["47.246.1.1"]) {
  const calls: { url: string; address: string }[] = []
  const download = createReferenceDownloader({
    hosts: HOSTS, resolve: async () => addresses, timeoutMs: 200,
    transport: async (url, address, signal) => { calls.push({ url: url.toString(), address }); return transport(url, address, signal) },
  })
  return { download, calls }
}
const code = async (p: Promise<unknown>) => p.then(() => "ok", (e: unknown) => e instanceof ReferenceImageError ? e.code : `other:${String(e)}`)

describe("safe reference download", () => {
  test("returns verified bytes, mime, size and hash, connecting to the checked address", async () => {
    const { download, calls } = make()
    const r = await download(URL_OK)
    expect(r).toMatchObject({ mime: "image/png", width: 800, height: 800 })
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(calls).toEqual([{ url: URL_OK, address: "47.246.1.1" }])
  })
  test.each([
    ["http://ae01.alicdn.com/a.jpg"], ["https://user:pw@ae01.alicdn.com/a.jpg"], ["https://ae01.alicdn.com:8443/a.jpg"], ["https://evil.com/a.jpg"],
    ["https://alicdn.com.evil.com/a.jpg"], ["https://notalicdn.com/a.jpg"], ["https://127.0.0.1/a.jpg"], ["https://[::1]/a.jpg"], ["file:///etc/passwd"], ["nonsense"],
  ])("refuses %s before any connection", async (url) => {
    const { download, calls } = make()
    expect(await code(download(url))).toBe("host_not_allowed")
    expect(calls).toEqual([])
  })
  test("an allowed host resolving to any private address is refused before connecting (DNS rebinding)", async () => {
    for (const addresses of [["127.0.0.1"], ["47.246.1.1", "10.0.0.1"], ["::1"], ["169.254.169.254"], ["fd00::1"], []]) {
      const { download, calls } = make(undefined, addresses)
      expect(await code(download(URL_OK))).toBe(addresses.length ? "private_address" : "download_failed")
      expect(calls).toEqual([])
    }
  })
  test("redirects are never followed", async () => {
    const { download, calls } = make(async () => ({ status: 302, headers: { location: "https://ae02.alicdn.com/b.jpg" }, body: chunks() }))
    expect(await code(download(URL_OK))).toBe("redirect_refused")
    expect(calls).toHaveLength(1)
  })
  test("declared and streamed size limits", async () => {
    expect(await code(make(async () => ({ status: 200, headers: { "content-length": "5000000" }, body: chunks(png(800, 800)) })).download(URL_OK))).toBe("too_large")
    expect(await code(make(async () => ({ status: 200, headers: {}, body: chunks(png(800, 800, 3_000_000), new Uint8Array(1_500_000)) })).download(URL_OK))).toBe("too_large")
  })
  test("html, svg, tiny and oversized images, http errors and empty bodies are refused", async () => {
    expect(await code(make(ok(new TextEncoder().encode("<html>login</html>"))).download(URL_OK))).toBe("not_image")
    expect(await code(make(ok(new TextEncoder().encode("<svg onload=alert(1)>"))).download(URL_OK))).toBe("not_image")
    expect(await code(make(ok(png(120, 120))).download(URL_OK))).toBe("too_small")
    expect(await code(make(ok(png(9000, 9000))).download(URL_OK))).toBe("dimensions_invalid")
    expect(await code(make(async () => ({ status: 404, headers: {}, body: chunks() })).download(URL_OK))).toBe("not_found")
    expect(await code(make(async () => ({ status: 503, headers: {}, body: chunks() })).download(URL_OK))).toBe("download_failed")
    expect(await code(make(ok(new Uint8Array())).download(URL_OK))).toBe("not_image")
  })
  test("a hanging store times out and transport errors are sanitized", async () => {
    const hang: ReferenceTransport = (_u, _a, signal) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted 10.1.2.3"))))
    expect(await code(make(hang).download(URL_OK))).toBe("timeout")
    expect(await code(make(async () => { throw new Error("ECONNRESET secret") }).download(URL_OK))).toBe("download_failed")
    async function* stall(): AsyncGenerator<Uint8Array> { yield png(800, 800); await new Promise(() => undefined) }
    expect(await code(make(async () => ({ status: 200, headers: {}, body: stall() })).download(URL_OK))).toBe("timeout")
  })
})

test("address classification", () => {
  for (const a of ["0.0.0.0", "10.1.1.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "172.31.9.9", "192.0.2.1", "192.168.0.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "fe80::1", "fc00::1", "fd12::1", "ff02::1", "2002:7f00:1::", "bad"]) expect([a, isPublicAddress(a)]).toEqual([a, false])
  for (const a of ["47.246.1.1", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect([a, isPublicAddress(a)]).toEqual([a, true])
})
