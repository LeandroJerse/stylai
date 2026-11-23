import { describe, expect, test } from "bun:test"
import { startRestrictedPhotoRelay } from "../photo-relay.js"

describe("restricted single-job photo relay", () => {
  test("serves ONLY the exact signed path, rejects tampering/other paths/POST, and closes cleanly", async () => {
    const sample = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])
    const relay = await startRestrictedPhotoRelay({
      bytes: sample,
      mime: "image/jpeg",
      jobId: "10000000-0000-4000-8000-000000000001",
      maxLifetimeMs: 60_000,
    })
    try {
      const base = `http://127.0.0.1:${relay.port}`
      const ok = await fetch(base + relay.signedPath())
      expect(ok.status).toBe(200)
      expect(ok.headers.get("content-type")).toBe("image/jpeg")
      expect(ok.headers.get("cache-control")).toBe("no-store")
      expect(new Uint8Array(await ok.arrayBuffer())).toEqual(sample)

      // Arbitrary path / directory traversal / tampered signature must return 404.
      expect((await fetch(base + "/")).status).toBe(404)
      expect((await fetch(base + "/etc/passwd")).status).toBe(404)
      expect((await fetch(base + relay.signedPath() + "x")).status).toBe(404)
      expect((await fetch(base + relay.signedPath(), { method: "POST" })).status).toBe(405)
    } finally {
      await relay.close()
    }
    // After close, connection is refused.
    await expect(fetch(`http://127.0.0.1:${relay.port}${relay.signedPath()}`)).rejects.toThrow()
  })
})
