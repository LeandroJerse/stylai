import { readServiceConfig } from "@stylai/config"
import {
  segmindOutfitProfile, createSegmindHistory, createSegmindOutfitClient, createReferenceDownloader, createGeminiOutfitClient, createFalClient, createOtlpExporter, createSegmindClient, FAL_FASHN_MODEL, FAL_IMAGE_APPS_MODEL, readLangfuseConfig,
  type FalClient, type FalTryOnModel,
} from "@stylai/ai"
import {
  createAdminClient, createLocalObjectStore, createPrivateDatabase, createSupabaseObjectStore, readPrivateDatabaseConfig, readSupabaseConfig,
} from "@stylai/supabase"
import { buildWorkerServer, createWorkerLoop } from "./app.js"
import { createComparisonBuilder } from "./comparison.js"
import { createEngine } from "./engine.js"
import { createGarmentLoader } from "./garments.js"
import { createCloudflaredPhotoRelay } from "./photo-relay.js"
import { createPurger, createReferencePurger } from "./purge.js"
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
const fal = runtime.fal.simulated
  ? createFalClient({ apiKey: "simulator-no-key", model: runtime.fal.model, baseUrl: runtime.fal.baseUrl, fashnMode: runtime.fal.fashnMode })
  : runtime.paidCallsEnabled && runtime.fal.apiKey
    ? createFalClient({ apiKey: runtime.fal.apiKey, model: runtime.fal.model, baseUrl: runtime.fal.baseUrl, fashnMode: runtime.fal.fashnMode })
    : null
const falReconcilers: Partial<Record<FalTryOnModel, FalClient>> = runtime.fal.apiKey
  ? {
      [FAL_FASHN_MODEL]: createFalClient({ apiKey: runtime.fal.apiKey, model: FAL_FASHN_MODEL, baseUrl: runtime.fal.baseUrl }),
      [FAL_IMAGE_APPS_MODEL]: createFalClient({ apiKey: runtime.fal.apiKey, model: FAL_IMAGE_APPS_MODEL, baseUrl: runtime.fal.baseUrl }),
    }
  : {}
const langfuse = readLangfuseConfig(process.env)
const exporter = langfuse ? createOtlpExporter(langfuse) : null

// Joint outfits: the loopback simulator (free, labelled) or, with explicit opt-in and key, the real API.
const segmindOutfit = runtime.provider !== "segmind" || !segmindOutfitProfile(runtime.segmind.model) ? null
  : runtime.segmind.simulated ? createSegmindOutfitClient({ apiKey: "simulator-no-key", model: runtime.segmind.model, simulatorUrl: runtime.segmind.baseUrl })
  : runtime.paidCallsEnabled && runtime.segmind.apiKey ? createSegmindOutfitClient({ apiKey: runtime.segmind.apiKey, model: runtime.segmind.model }) : null
const segmindHistory = runtime.segmind.apiKey && !runtime.segmind.simulated ? createSegmindHistory({ apiKey: runtime.segmind.apiKey }) : null
const segmindReconcilers = runtime.segmind.apiKey && !runtime.segmind.simulated ? {"try-on-diffusion":createSegmindClient({apiKey:runtime.segmind.apiKey,model:"try-on-diffusion"})} : {}
const vertexProject = process.env.STYLAI_GOOGLE_BACKEND === 'vertex' ? process.env.GOOGLE_CLOUD_PROJECT : undefined
if(process.env.STYLAI_GOOGLE_BACKEND === 'vertex' && !vertexProject) throw new Error('vertex_project_required')
const gemini = runtime.paidCallsEnabled && runtime.gemini.apiKey ? createGeminiOutfitClient({apiKey:runtime.gemini.apiKey,...(vertexProject?{vertexProject}:{})}) : null
const activeSimulated = runtime.provider === "gemini" ? false : runtime.provider === "fal" ? runtime.fal.simulated : runtime.segmind.simulated
const photoRelay = runtime.provider !== "gemini" && runtime.photoRelay === "cloudflared" && !activeSimulated ? createCloudflaredPhotoRelay() : null
const garments = segmindOutfit ? createGarmentLoader({ store, download: createReferenceDownloader({ hosts: ["alicdn.com", "aliexpress-media.com"] }),
  fallback: (url) => segmindOutfit.garment(url), testImages: runtime.segmind.simulated }) : undefined
const engine = db && runtime.engine.pseudonymKey
  ? createEngine({ db, store, segmind, gemini, segmindOutfit, ...(garments ? { garments } : {}), segmindReconcilers, segmindHistory, fal, falReconcilers, photoRelay, config: { ...runtime.engine, pseudonymKey: runtime.engine.pseudonymKey } })
  : null
const loop = createWorkerLoop({
  engine,
  nextJob: async () => db ? db.call("next_ai_job") : null,
  flushTelemetry: async () => db ? flushTelemetryOnce(db, exporter) : undefined,
  probe: async () => db ? db.probe() : "unavailable",
  ...(db ? {
    comparison: createComparisonBuilder({ db, store }),
    purge: async () => { await createPurger({ db, store })(); await createReferencePurger({ db, store })() },
  } : {}),
  idleMs: runtime.pollIdleMs,
  log: (line) => console.log(line),
})

// Presence only, never values.
console.log(JSON.stringify({
  worker: "starting", database: Boolean(db), objectStore: store.kind, provider: runtime.provider, paidCallsEnabled: runtime.paidCallsEnabled,
  segmindKey: Boolean(runtime.segmind.apiKey), segmindActive: Boolean(segmind), segmindSimulated: runtime.segmind.simulated, jointOutfitModel: segmindOutfit?.model ?? null,
  falKey: Boolean(runtime.fal.apiKey), falActive: Boolean(fal), falModel: runtime.fal.model, falSimulated: runtime.fal.simulated,
  photoRelay: runtime.photoRelay,
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
