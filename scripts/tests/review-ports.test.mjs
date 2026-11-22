import { expect, test } from "bun:test"
import { createServer } from "node:net"
import { assertReviewPortsAvailable } from "../review-ports.mjs"

test("review startup refuses occupied ports without stopping their owner", async () => {
  const server = createServer()
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  try {
    const port = server.address().port
    await expect(assertReviewPortsAvailable([port])).rejects.toThrow("unavailable")
    expect(server.listening).toBe(true)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
