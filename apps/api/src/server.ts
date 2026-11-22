import { resolve } from "node:path"
import { readServiceConfig } from "@stylai/config"
import { buildApp } from "./app.js"
import {
  readSupabaseConfig, probeFoundation, readPrivateDatabaseConfig, createPrivateDatabase, createLocalObjectStore, createSupabaseObjectStore, createAdminClient, defaultLocalStoreDir,
} from "@stylai/supabase"
import { createSupabaseAuthProvider } from "./modules/auth/provider.js"
import { readSessionKeys } from "./modules/auth/session-crypto.js"
import { createSessionService } from "./modules/auth/session-service.js"
import { createPoseAnalyzer } from "./modules/photos/pose-analyzer.js"

const config = readServiceConfig(process.env)
const supabase = readSupabaseConfig(process.env)
const databaseConfig = readPrivateDatabaseConfig(process.env, "api")
const database = databaseConfig ? createPrivateDatabase(databaseConfig) : null
const keys = readSessionKeys(process.env)
if (process.env.STYLAI_DEV_ACTOR_ID) console.warn("STYLAI_DEV_ACTOR_ID is ignored: the API only accepts real sessions.")

const storeKind = process.env.STYLAI_OBJECT_STORE ?? "local"
const store = storeKind === "supabase"
  ? (supabase?.secretKey ? createSupabaseObjectStore(createAdminClient(supabase, "worker")) : null)
  : config.nodeEnv === "production" ? null : createLocalObjectStore(process.env.STYLAI_LOCAL_STORE_DIR ? resolve(process.env.STYLAI_LOCAL_STORE_DIR) : defaultLocalStoreDir(process.cwd()))

// Auth needs Supabase (identity authority), the restricted database (vault) and the session key.
const provider = supabase ? createSupabaseAuthProvider(supabase) : null
const sessions = database && provider && keys ? createSessionService({ db: database, provider, keys }) : null
const resolveActor = sessions ? async (request: Parameters<typeof sessions.resolve>[0]) => (await sessions.resolve(request))?.userId ?? null : null
const publicBaseUrl = process.env.API_PUBLIC_BASE_URL ?? `http://${config.host}:${config.apiPort}/v1`
const photoPolicyVersion = process.env.STYLAI_PHOTO_POLICY_VERSION ?? "dev-v1"
// Local pose analyzer (tools/pose-validator). Absent = photos end as "não foi possível validar".
const analyzer = createPoseAnalyzer(process.env.STYLAI_POSE_ANALYZER_URL?.trim() || undefined)
const modeEnv = process.env.STYLAI_GENERATION_MODE?.trim()
if (modeEnv && !["simulated", "real", "disabled"].includes(modeEnv)) throw new Error("Invalid STYLAI_GENERATION_MODE")
const generationMode = (modeEnv ?? "simulated") as "simulated" | "real" | "disabled"
// Shown before a paid call. Estimate: mean public inference ~8.06 s x US$ 0.0072/GPU-s; reserve per call = worker ceiling.
const realProvider = { provider: "Segmind", model: "try-on-diffusion", callsPerGeneration: 1, estimatedUsdPerCall: 0.06, maxUsdPerCall: 0.5 }

const rateLimitPerMinute = Number(process.env.STYLAI_RATE_LIMIT_PER_MINUTE ?? 120)
if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 10 || rateLimitPerMinute > 5000) throw new Error("Invalid STYLAI_RATE_LIMIT_PER_MINUTE")
const app = await buildApp({
  appOrigin: config.appOrigin, logger: true, rateLimitPerMinute, probeSupabase: () => probeFoundation(supabase),
  ...(database ? { probePrivateDatabase: () => database.probe(), catalog: { db: database, publicBaseUrl } } : {}),
  ...(sessions && provider ? { auth: { provider, sessions, appOrigin: config.appOrigin, secureCookie: config.nodeEnv === "production" } } : {}),
  ...(database && store && keys && resolveActor ? {
    photos: { db: database, store, keys, resolveActor, photoPolicyVersion, publicBaseUrl, analyzer },
    studio: { db: database, keys, resolveActor, photoPolicyVersion, publicBaseUrl, generationEnabled: generationMode !== "disabled", generationMode, realProvider },
    search: { db: database, resolveActor, publicBaseUrl },
  } : {}),
})
app.log.info({
  auth: Boolean(sessions), catalog: Boolean(database), studio: Boolean(database && store && keys && resolveActor),
  store: store?.kind ?? null, supabase: Boolean(supabase), sessionKey: Boolean(keys), generationMode,
  poseAnalyzer: Boolean(process.env.STYLAI_POSE_ANALYZER_URL),
}, "API configuration (presence only)")
app.addHook("onClose", async () => { await database?.close() })
const stop = async () => { await app.close() }
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
try { await app.listen({ host: config.host, port: config.apiPort }) }
catch { app.log.error("API startup failed; check port and configuration."); process.exitCode = 1; await app.close() }
