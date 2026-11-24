import { createServer } from "node:http"
import type { Engine } from "./engine.js"

export interface WorkerLoopDeps {
  engine: Engine | null
  nextJob: () => Promise<string | null>
  flushTelemetry: () => Promise<unknown>
  probe: () => Promise<"ready" | "unavailable">
  /** Server-side montage of a finished comparison (no AI); true when one was processed. */
  comparison?: () => Promise<boolean>
  /** Physical removal of private objects queued for deletion (QA-002). */
  purge?: () => Promise<unknown>
  idleMs: number
  log?: (line: string) => void
}

/** Single-concurrency consumer. stop() lets the current job finish, then flushes telemetry. */
export function createWorkerLoop(deps: WorkerLoopDeps) {
  let running = false
  let current: Promise<void> | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastReconcile = 0
  let lastPurge = 0
  const log = deps.log ?? (() => undefined)

  async function tick() {
    if (!running || !deps.engine) return
    try {
      const jobId = await deps.nextJob()
      if (jobId) {
        const outcome = await deps.engine.processJob(jobId)
        log(`job ${jobId.slice(0, 8)}: ${outcome.status}${"code" in outcome ? ` (${outcome.code})` : ""}`)
      }
      const assembled = deps.comparison ? await deps.comparison() : false
      if (assembled) log("comparison montage processed")
      if (Date.now() - lastReconcile > 60_000) { lastReconcile = Date.now(); await deps.engine.reconcileOnce() }
      if (deps.purge && Date.now() - lastPurge > 5_000) { lastPurge = Date.now(); await deps.purge().catch(() => log("purge tick failed (sanitized)")) }
      await deps.flushTelemetry()
      if ((jobId || assembled) && running) { schedule(0); return }
    } catch (error) {
      // Sanitized: error class and, for database errors, outcome/SQLSTATE only (never messages or data).
      const e = error as { name?: string; outcome?: string; sqlState?: string }
      log(`worker tick failed (sanitized): ${e?.name ?? "Error"}${e?.outcome ? ` outcome=${e.outcome}` : ""}${e?.sqlState ? ` sqlstate=${e.sqlState}` : ""}`)
    }
    schedule(deps.idleMs)
  }
  function schedule(ms: number) {
    if (!running) return
    timer = setTimeout(() => { current = tick().finally(() => { current = null }) }, ms)
  }
  return {
    start() { if (!running) { running = true; schedule(0) } },
    async stop() {
      running = false
      if (timer) clearTimeout(timer)
      await current
      await deps.flushTelemetry().catch(() => undefined)
    },
    get running() { return running },
  }
}

export function buildWorkerServer(status: { probe?: () => Promise<"ready" | "unavailable">; consuming?: () => boolean } = {}) {
  return createServer(async (request, response) => {
    const path = request.url?.split("?")[0]
    const live = request.method === "GET" && path === "/health/live"
    const readyPath = request.method === "GET" && path === "/health/ready"
    let body: unknown = { error: { code: "not_found", message: "Rota não encontrada." } }
    let code = 404
    if (live) { code = 200; body = { status: "ok", service: "worker" } }
    if (readyPath) {
      const database = status.probe ? await status.probe().catch(() => "unavailable" as const) : "not_configured"
      const queue = status.consuming?.() ? "consuming" : "not_consuming"
      const ready = database === "ready" && queue === "consuming"
      code = ready ? 200 : 503
      body = { status: ready ? "ok" : "not_ready", service: "worker", dependencies: { database, queue } }
    }
    response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" })
    response.end(JSON.stringify(body))
  })
}
