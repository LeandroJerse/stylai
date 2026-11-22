// Local Segmind v2 simulator for development/test journeys. NOT the provider:
// it never calls Segmind, costs nothing and returns a synthetic striped PNG
// whose colour depends on the garment image URL (so v1 and v2 differ visibly).
// It does fetch the signed photo URL it receives, proving the private-storage
// link works, and fails on purpose for garment URLs containing "/fail/".
//   node --import tsx scripts/segmind-simulator.ts [port]   (default 54390, loopback only)
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { deflateSync } from "node:zlib"

const port = Number(process.argv[2] ?? process.env.SEGMIND_SIMULATOR_PORT ?? 54390)
const delayMs = Number(process.env.SEGMIND_SIMULATOR_DELAY_MS ?? 2500)

function crc32(bytes: Uint8Array): number {
  let c = ~0
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}
function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii")
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}
/** 384x512 RGB: neutral backdrop, silhouette, garment block in the garment's colour, diagonal "simulated" stripes. */
function render(seed: string): Buffer {
  const h = createHash("sha256").update(seed).digest()
  const [r, g, b] = [h[0]! | 0x30, h[1]! | 0x30, h[2]! | 0x30]
  const w = 384, ht = 512
  const raw = Buffer.alloc((w * 3 + 1) * ht)
  for (let y = 0; y < ht; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      let px: [number, number, number] = [236, 232, 226]
      const cx = Math.abs(x - w / 2)
      if (y > 40 && y < 110 && cx < 34) px = [200, 170, 150] // head
      if (y >= 110 && y < 480 && cx < 70 + (y < 150 ? (y - 110) : 40) * 0.6) px = [200, 170, 150] // body
      if (y >= 140 && y < 330 && cx < 95) px = [r, g, b] // garment
      if (((x + y) >> 4) % 6 === 0) px = [px[0] * 0.85, px[1] * 0.85, px[2] * 0.85].map(Math.round) as [number, number, number]
      raw[o] = px[0]; raw[o + 1] = px[1]; raw[o + 2] = px[2]
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(ht, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())])
}

interface Job { createdAt: number; seed: string; fail: boolean; photoStatus: number | string }
const jobs = new Map<string, Job>()
const stats = { submits: 0, photoFetches: 0, photoOk: 0, keys: [] as string[] }

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)) }
  const url = new URL(req.url ?? "/", "http://127.0.0.1")
  if (url.pathname === "/__stats") return send(200, { ...stats, jobs: jobs.size })
  if (!req.headers["x-api-key"]) return send(401, { error: "missing key" })
  if (req.method === "POST" && url.pathname === "/v2/try-on-diffusion") {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    let body: Record<string, unknown>
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> } catch { return send(400, { error: "bad json" }) }
    const model = typeof body.model_image === "string" ? body.model_image : ""
    const cloth = typeof body.cloth_image === "string" ? body.cloth_image : ""
    if (!model || !cloth || !["Upper body", "Lower body", "Dress"].includes(String(body.category))) return send(400, { error: "invalid input" })
    stats.submits++
    stats.keys.push(String(req.headers["x-request-id"] ?? ""))
    let photoStatus: number | string = "not_fetched"
    try {
      stats.photoFetches++
      const r = await fetch(model, { signal: AbortSignal.timeout(5000) })
      photoStatus = r.status
      if (r.ok) stats.photoOk++
      await r.arrayBuffer()
    } catch { photoStatus = "unreachable" }
    const id = randomUUID()
    jobs.set(id, { createdAt: Date.now(), seed: cloth, fail: cloth.includes("/fail/"), photoStatus })
    return send(200, { request_id: id, status: "QUEUED" })
  }
  const m = /^\/v2\/requests\/([0-9a-f-]{36})(\/status)?$/.exec(url.pathname)
  if (req.method === "GET" && m) {
    const job = jobs.get(m[1]!)
    if (!job) return send(404, { error: "not found" })
    const done = Date.now() - job.createdAt >= delayMs
    // Zero GPU time: the computed cost of a simulated call is exactly zero.
    const metrics = { inference_time: 0, cost: 0, simulated: true }
    if (m[2]) {
      if (!done) return send(200, { status: Date.now() - job.createdAt < delayMs / 2 ? "QUEUED" : "PROCESSING" })
      if (job.fail || job.photoStatus !== 200) return send(422, { status: "FAILED", metrics })
      return send(200, { status: "COMPLETED", metrics })
    }
    if (!done) return send(409, { error: "not ready" })
    return send(200, { output: render(job.seed).toString("base64"), metrics })
  }
  return send(404, { error: "unknown route" })
})
server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ simulator: "segmind", listening: `http://127.0.0.1:${port}`, delayMs })))
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close())
