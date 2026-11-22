import { readServiceConfig } from "@stylai/config"
import { createOtlpExporter, createSegmindClient, readLangfuseConfig } from "@stylai/ai"
import {
  createAdminClient, createLocalObjectStore, createPrivateDatabase, createSupabaseObjectStore, readPrivateDatabaseConfig, readSupabaseConfig,
} from "@stylai/supabase"
import { buildWorkerServer, createWorkerLoop } from "./app.js"
import { createEngine } from "./engine.js"
import { createPurger } from "./purge.js"
import { flushTelemetryOnce } from "./telemetry-flush.js"
import { readWorkerConfig } from "./worker-config.js"

const service = readServiceConfig(process.env)
const runtime = readWorkerConfig(process.env)
const databaseConfig = readPrivateDatabaseConfig(process.env, "ai_worker")
const db = databaseConfig ? createPrivateDatabase(databaseConfig) : null

const store = runtime.objectStore.kind === "local"
  ? createLocalObjectStore(runtime.objectStore.dir)
  : (() => {
      const supabase = readSupabaseConfig(process.env)
      if (!supabase) throw new Error("STYLAI_OBJECT_STORE=supabase requires SUPABASE_URL/keys")
      return createSupabaseObjectStore(createAdminClient(supabase, "worker"))
    })()
// Real provider: explicit paid opt-in + key. Simulator: loopback only, dev/test only, no key sent.
const segmind = runtime.segmind.simulated
  ? createSegmindClient({ apiKey: "simulator-no-key", model: runtime.segmind.model, baseUrl: runtime.segmind.baseUrl })
  : runtime.paidCallsEnabled && runtime.segmind.apiKey
    ? createSegmindClient({ apiKey: runtime.segmind.apiKey, model: runtime.segmind.model, baseUrl: runtime.segmind.baseUrl })
    : null
const langfuse = readLangfuseConfig(process.env)
const exporter = langfuse ? createOtlpExporter(langfuse) : null

const engine = db && runtime.engine.pseudonymKey
  ? createEngine({ db, store, segmind, config: { ...runtime.engine, pseudonymKey: runtime.engine.pseudonymKey } })
  : null
const loop = createWorkerLoop({
  engine,
  nextJob: async () => db ? db.call("next_ai_job") : null,
  flushTelemetry: async () => db ? flushTelemetryOnce(db, exporter) : undefined,
  probe: async () => db ? db.probe() : "unavailable",
  ...(db ? { purge: createPurger({ db, store }) } : {}),
  idleMs: runtime.pollIdleMs,
  log: (line) => console.log(line),
})

// Presence only, never values.
console.log(JSON.stringify({
  worker: "starting", database: Boolean(db), objectStore: store.kind, paidCallsEnabled: runtime.paidCallsEnabled,
  segmindKey: Boolean(runtime.segmind.apiKey), segmindActive: Boolean(segmind), segmindSimulated: runtime.segmind.simulated,
  langfuse: Boolean(exporter), telemetryEnvironment: runtime.engine.telemetryEnvironment,
  pseudonymKey: Boolean(runtime.engine.pseudonymKey), consuming: Boolean(engine),
}))

const server = buildWorkerServer({ probe: async () => db ? db.probe() : "unavailable", consuming: () => loop.running && engine !== null })
server.on("error", () => { console.error("Worker startup failed; check port and configuration."); process.exitCode = 1 })
server.listen(service.workerPort, service.host, () => {
  console.log(`Worker listening on ${service.host}:${service.workerPort}`)
  if (engine) loop.start()
})
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void (async () => {
    await loop.stop()
    server.closeAllConnections()
    server.close()
    await db?.close()
  })()
})
