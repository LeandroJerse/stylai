import { createServer } from "node:net"

// Refuse before seeding/rotating local role passwords or spawning any child.
export async function assertReviewPortsAvailable(ports) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const server = createServer()
      server.once("error", () => reject(new Error(`Review port ${port} is unavailable; no local credentials or processes were changed.`)))
      server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(resolve))
    })
  }
}
