import { createServer } from "node:http"

/** An idle scaffold with honest readiness, not a queue consumer. */
export function buildWorkerServer() {
  return createServer((request, response) => {
    const path = request.url?.split("?")[0]
    const live = request.method === "GET" && path === "/health/live"
    const ready = request.method === "GET" && path === "/health/ready"
    response.writeHead(live ? 200 : ready ? 503 : 404, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
    response.end(JSON.stringify(live ? { status: "ok", service: "worker" } : ready ? { status: "not_ready", service: "worker", dependencies: { queue: "not_implemented" } } : { error: { code: "not_found", message: "Rota não encontrada." } }))
  })
}
