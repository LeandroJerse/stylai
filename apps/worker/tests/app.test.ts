import { expect, test } from "bun:test"
import { once } from "node:events"
import { buildWorkerServer } from "../src/app"

test("idle worker is live but not a functioning queue consumer", async () => {
  const server = buildWorkerServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing test server address")
    const origin = `http://127.0.0.1:${address.port}`
    expect((await fetch(`${origin}/health/live`)).status).toBe(200)
    const ready = await fetch(`${origin}/health/ready`)
    expect(ready.status).toBe(503)
    expect(await ready.json()).toMatchObject({ status: "not_ready" })
    expect((await fetch(`${origin}/unrecognized`)).status).toBe(404)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
