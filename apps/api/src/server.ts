import { resolve } from "node:path"
import { readServiceConfig } from "@stylai/config"
import { PHOTO_POLICY_VERSION, type CatalogSourceMode } from "@stylai/contracts"
import { createAliExpressAffiliateClient, createAliExpressCatalogService, createTikTokCatalogCache, createTikTokCreatorClient } from "@stylai/commerce"
import { VERTEX_OUTFIT_MODEL, VERTEX_OUTFIT_RESERVE, segmindOutfitProfile, createAnthropicComposer, createAnthropicOutfitAgents, createInterpretationCache, createReferenceDownloader, DEFAULT_COMPOSER_MODEL, FAL_FASHN_MODEL, findPrice } from "@stylai/ai"
import { buildApp } from "./app.js"
import {
  readSupabaseConfig, probeFoundation, readPrivateDatabaseConfig, createPrivateDatabase, createLocalObjectStore, createSupabaseObjectStore, createAdminClient, defaultLocalStoreDir,
} from "@stylai/supabase"
import { createSupabaseAuthProvider } from "./modules/auth/provider.js"
import { readSessionKeys } from "./modules/auth/session-crypto.js"
import { createSessionService } from "./modules/auth/session-service.js"
import { createPoseAnalyzer } from "./modules/photos/pose-analyzer.js"
import { listLocalCatalog } from "./modules/catalog/routes.js"
import { createReferencePreparer } from "./modules/outfits/references.js"
import { createOutfitSearch, type OutfitSourceKind } from "./modules/outfits/search.js"
import { createTikTokConnection } from "./modules/integrations/tiktok/connection.js"

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
const photoPolicyVersion = process.env.STYLAI_PHOTO_POLICY_VERSION ?? PHOTO_POLICY_VERSION
// Local pose analyzer (tools/pose-validator). Absent = photos end as "não foi possível validar".
const analyzer = createPoseAnalyzer(process.env.STYLAI_POSE_ANALYZER_URL?.trim() || undefined)
const modeEnv = process.env.STYLAI_GENERATION_MODE?.trim()
if (modeEnv && !["simulated", "real", "disabled"].includes(modeEnv)) throw new Error("Invalid STYLAI_GENERATION_MODE")
const generationMode = (modeEnv ?? "simulated") as "simulated" | "real" | "disabled"
const catalogModeRaw = process.env.STYLAI_CATALOG_MODE?.trim() || "test_catalog"
if (!["curated_pilot", "tiktok_shop", "aliexpress_affiliate", "test_catalog"].includes(catalogModeRaw)) throw new Error("Invalid STYLAI_CATALOG_MODE")
const catalogMode = catalogModeRaw as CatalogSourceMode
const pilotCatalogOnly = catalogMode === "curated_pilot"

const tiktokAppKey = process.env.TIKTOK_SHOP_APP_KEY?.trim() || null
const tiktokAppSecret = process.env.TIKTOK_SHOP_APP_SECRET?.trim() || null
const tiktokCreatorToken = process.env.TIKTOK_SHOP_CREATOR_ACCESS_TOKEN?.trim() || null
const tiktokOperatorId = process.env.STYLAI_TIKTOK_OPERATOR_ID?.trim() || undefined
const tiktokVaultFile = process.env.STYLAI_TIKTOK_VAULT_PATH?.trim()
const tiktokConnection = tiktokVaultFile && tiktokOperatorId && keys && tiktokAppKey && tiktokAppSecret && sessions
  ? createTikTokConnection({ file: tiktokVaultFile, keys, appKey: tiktokAppKey, appSecret: tiktokAppSecret }) : null
if ((tiktokVaultFile || tiktokOperatorId) && !tiktokConnection) throw new Error("Incomplete TikTok OAuth configuration; static-token fallback is disabled")
const tiktokClient = tiktokAppKey && tiktokAppSecret ? createTikTokCreatorClient({ appKey: tiktokAppKey, appSecret: tiktokAppSecret }) : null
const tiktokAllowed = async () => database ? Boolean(await database.call("tiktok_access_allowed").catch(() => false)) : false
const getTikTokToken = async () => {
  if (!await tiktokAllowed()) return null
  // Never fall back to a static token after a vault connection is disconnected.
  return tiktokConnection ? tiktokConnection.getAccessToken() : tiktokCreatorToken
}
const tiktokCache = tiktokClient ? createTikTokCatalogCache({ client: tiktokClient, getAccessToken: getTikTokToken,
  onAuthorizationFailure: async (token) => { await tiktokConnection?.invalidate(token) },
}) : null
// Shown before a paid call. Estimate: mean public inference ~8.06 s x US$ 0.0072/GPU-s; reserve per call = worker ceiling.
const nativeGemini = process.env.STYLAI_TRYON_PROVIDER === "gemini"
const vertexGemini = nativeGemini && process.env.STYLAI_GOOGLE_BACKEND === "vertex"
const segmindModel = process.env.SEGMIND_MODEL?.trim() || (generationMode === "real" ? "flux-3-klein-image-edit" : "try-on-diffusion")
const outfitProfile = (process.env.STYLAI_TRYON_PROVIDER?.trim() || "segmind") === "segmind" ? segmindOutfitProfile(segmindModel) : null
const segmindOutfit = Boolean(outfitProfile)
const realProvider = segmindOutfit ? {provider:"Segmind",model:outfitProfile!.model,callsPerGeneration:1,estimatedUsdPerCall:Number(outfitProfile!.priceMicros)/1e6,maxUsdPerCall:Number(outfitProfile!.reserveMicros)/1e6} : vertexGemini ? {provider:"Google Cloud Vertex",model:VERTEX_OUTFIT_MODEL,callsPerGeneration:1,estimatedUsdPerCall:0.04,maxUsdPerCall:Number(VERTEX_OUTFIT_RESERVE)/1e6} : nativeGemini ? {provider:"Google Gemini",model:"gemini-3-pro-image",callsPerGeneration:1,estimatedUsdPerCall:0.15,maxUsdPerCall:0.35} : { provider: "Segmind", model: "try-on-diffusion", callsPerGeneration: 1, estimatedUsdPerCall: 0.06, maxUsdPerCall: 0.5 }

// AliExpress Affiliates API: app-level signature only (no seller OAuth). Values come from the process environment.
const aliexpressAppKey = process.env.ALIEXPRESS_APP_KEY?.trim() || null
const aliexpressAppSecret = process.env.ALIEXPRESS_APP_SECRET?.trim() || null
const aliexpressTrackingId = process.env.ALIEXPRESS_TRACKING_ID?.trim() || null
const aliexpressOperatorId = process.env.STYLAI_ALIEXPRESS_OPERATOR_ID?.trim() || undefined
// Server-side tracking ID only (clients can never override it). Syntax check only: ownership is not provable here.
if (aliexpressTrackingId && (!/^[A-Za-z0-9_-]{1,64}$/.test(aliexpressTrackingId) || aliexpressTrackingId === aliexpressAppKey)) {
  throw new Error("Invalid ALIEXPRESS_TRACKING_ID")
}
const callsPerMinute = (name: string, fallback: number) => {
  const n = Number(process.env[name] ?? fallback)
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new Error(`Invalid ${name}`)
  return n
}
const aliexpressCallsPerMinute = callsPerMinute("ALIEXPRESS_CALLS_PER_MINUTE", 60)
const composerCallsPerMinute = callsPerMinute("STYLAI_COMPOSER_CALLS_PER_MINUTE", 30)
const composerCallsPerDay = callsPerMinute("STYLAI_COMPOSER_CALLS_PER_DAY", 2000)
const aliexpressCallsPerDay = callsPerMinute("ALIEXPRESS_CALLS_PER_DAY", 5000)
const aliexpressClient = aliexpressAppKey && aliexpressAppSecret
  ? createAliExpressAffiliateClient({ appKey: aliexpressAppKey, appSecret: aliexpressAppSecret, trackingId: aliexpressTrackingId,
    // Without the private database there is no global budget: refuse to call rather than run unbounded.
    acquire: async () => Boolean(database && await database.call("take_provider_call_slot", "aliexpress", aliexpressCallsPerMinute)
      && await database.call("take_provider_daily_slot", "aliexpress", aliexpressCallsPerDay)) }) : null
// Only the aliexpress_affiliate mode searches the provider; other modes never call it.
const aliexpressCatalog = catalogMode === "aliexpress_affiliate" && aliexpressClient
  ? createAliExpressCatalogService({ client: aliexpressClient, trackingId: aliexpressTrackingId }) : null

// Outfit composer (Claude). Off unless explicitly enabled AND a key exists: otherwise the labelled rules fallback runs.
const composerEnabled = process.env.STYLAI_COMPOSER_ENABLED?.trim() === "true"
// Owner decision 2026-11-23: cheapest capable model (Haiku) for interpretation/selection unless explicitly overridden.
const composerModel = process.env.STYLAI_COMPOSER_MODEL?.trim() || DEFAULT_COMPOSER_MODEL
if (composerEnabled && !process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("STYLAI_COMPOSER_ENABLED requires ANTHROPIC_API_KEY")
const composer = composerEnabled ? createAnthropicComposer({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), model: composerModel }) : null
const composerPriceEntry = findPrice("anthropic", composerModel)
if (composer && composerPriceEntry?.kind !== "tokens") throw new Error(`No versioned price for composer model ${composerModel}: cost could not be measured`)
const composerPrice = composerPriceEntry?.kind === "tokens" ? { inputPerMTok: composerPriceEntry.inputPerMTok, outputPerMTok: composerPriceEntry.outputPerMTok } : null
// One shared, hash-keyed interpretation cache for the simple search and the composition (quota only on a miss).
const interpretationCache = composer ? createInterpretationCache() : null
// Render estimate shown before confirmation must match the worker's provider and per-layer reservation (P04).
const renderProvider = nativeGemini ? "gemini" as const : process.env.STYLAI_TRYON_PROVIDER?.trim() === "fal" ? "fal" as const : "segmind" as const
const reservePerLayerMicros = segmindOutfit ? outfitProfile!.reserveMicros : vertexGemini ? VERTEX_OUTFIT_RESERVE : nativeGemini ? 350_000n : BigInt(renderProvider === "fal"
  ? (process.env.FAL_RESERVE_USD_MICROS?.trim() || "75000") : (process.env.SEGMIND_RESERVE_USD_MICROS?.trim() || "500000"))
const renderPrice = findPrice("fal", FAL_FASHN_MODEL)

// Autonomous outfits: the curated catalog or real AliExpress search (the TikTok source is not supported by this flow).
const acquireAgentCall = async () => Boolean(database && await database.call("take_provider_call_slot", "anthropic", composerCallsPerMinute)
  && await database.call("take_provider_daily_slot", "anthropic", composerCallsPerDay))
const outfitSource: OutfitSourceKind | null = catalogMode === "tiktok_shop" ? null : catalogMode === "aliexpress_affiliate" ? "aliexpress_affiliate" : "curated"
const outfitSearch = database && store && outfitSource ? createOutfitSearch({
  db: database, source: outfitSource, aliexpressCatalog, listCatalog: () => listLocalCatalog(database, catalogMode),
  composer, interpretationCache, agents: composerEnabled ? createAnthropicOutfitAgents({ apiKey: process.env.ANTHROPIC_API_KEY!.trim(), model: composerModel }) : null,
  acquireAgentCall, agentPrice: composerPrice,
  preparer: createReferencePreparer({ db: database, store, download: createReferenceDownloader({ hosts: ["alicdn.com", "aliexpress-media.com"] }) }),
  log: (event) => app.log.warn(event, "outfit search fallback"),
}) : null
// Batches run on the one-call-per-outfit models of Segmind (FLUX 3 Klein by default); simulated = loopback, free.
const outfitRender = generationMode !== "disabled" && outfitProfile ? {
  mode: generationMode, provider: "segmind", providerLabel: "Segmind", model: outfitProfile.model, reserveMicros: outfitProfile.reserveMicros, priceMicros: outfitProfile.priceMicros,
  pilotId: generationMode === "real" ? process.env.STYLAI_PILOT_ID?.trim() || null : null,
} : null
if (outfitRender?.mode === "real" && !outfitRender.pilotId) console.warn("STYLAI_PILOT_ID is not set for the API: real outfit batches are disabled.")

const rateLimitPerMinute = Number(process.env.STYLAI_RATE_LIMIT_PER_MINUTE ?? 120)
if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 10 || rateLimitPerMinute > 5000) throw new Error("Invalid STYLAI_RATE_LIMIT_PER_MINUTE")
const app = await buildApp({
  appOrigin: config.appOrigin, logger: true, rateLimitPerMinute, probeSupabase: () => probeFoundation(supabase),
  ...(database ? { probePrivateDatabase: () => database.probe(), catalog: { db: database, publicBaseUrl, pilotOnly: pilotCatalogOnly, catalogMode, tiktokCache, aliexpressCatalog, ...(resolveActor ? { resolveActor } : {}) } } : {}),
  ...(sessions && provider ? { auth: { provider, sessions, appOrigin: config.appOrigin, secureCookie: config.nodeEnv === "production" } } : {}),
  ...(database && resolveActor ? { privacy: {
    appOrigin: config.appOrigin, resolveActor,
    requestDeletion: (actor: string) => database.call("request_account_deletion", actor),
  } } : {}),
  ...(database && store && keys && resolveActor ? {
    photos: { db: database, store, keys, resolveActor, photoPolicyVersion, publicBaseUrl, analyzer },
    studio: { db: database, keys, resolveActor, photoPolicyVersion, publicBaseUrl, generationEnabled: generationMode !== "disabled", generationMode, realProvider,
      searchScope: catalogMode === "tiktok_shop" || catalogMode === "aliexpress_affiliate" ? "stores" : "curated_catalog",
      outfits: outfitSearch !== null,
      composer: { mode: composer ? "agent" : "rules", model: composer ? composerModel : null } },
    search: { db: database, resolveActor, publicBaseUrl, pilotOnly: pilotCatalogOnly, catalogMode, tiktokCache, aliexpressCatalog,
      agent: composer, interpretationCache, agentPrice: composerPrice,
      acquireAgentCall: async () => await database.call("take_provider_call_slot", "anthropic", composerCallsPerMinute)
        && await database.call("take_provider_daily_slot", "anthropic", composerCallsPerDay) },
    compositions: { db: database, resolveActor, publicBaseUrl, catalogMode, aliexpressCatalog, composer, interpretationCache, renderProvider, jointOutfit: segmindOutfit || nativeGemini, reservePerLayerMicros,
      acquireComposerCall: async () => await database.call("take_provider_call_slot", "anthropic", composerCallsPerMinute)
        && await database.call("take_provider_daily_slot", "anthropic", composerCallsPerDay),
      renderPricePerLayerMicros: renderPrice?.kind === "per_image" ? renderPrice.perImageMicros : 75_000n,
      composerPrice },
    ...(outfitSearch && outfitSource ? {
      outfits: { db: database, resolveActor, publicBaseUrl, source: outfitSource, model: composer ? composerModel : null, search: outfitSearch },
      outfitRenders: { db: database, store, keys, resolveActor, publicBaseUrl, photoPolicyVersion, search: outfitSearch, aliexpressCatalog,
        render: outfitRender && (outfitRender.mode === "simulated" || outfitRender.pilotId) ? outfitRender : null },
    } : {}),
  } : {}),
  tiktok: { appKey: tiktokAppKey, appSecret: tiktokAppSecret, hasCreatorToken: Boolean(tiktokCreatorToken), tokenAvailable: async () => Boolean(await getTikTokToken()),
    ...(tiktokConnection && resolveActor ? {
      operatorId: tiktokOperatorId, resolveOperator: (request) => sessions!.resolve(request),
      isSessionActive: async (userId, sessionId) => Boolean(await database!.call("check_app_session", userId, sessionId)),
      appOrigin: config.appOrigin, secureCookie: config.nodeEnv === "production",
      authorizationAllowed: tiktokAllowed, generation: tiktokConnection.generation,
      onAuthorizedCode: async ({ code, state }) => {
        const result = await tiktokConnection.authorize(code, Number(state.connectionId.split(":")[1]))
        if (result.ok) tiktokCache?.purgeOnRevocation()
        return result
      },
      onDisconnect: async () => { tiktokCache?.purgeOnRevocation(); await tiktokConnection.disconnect() },
    } : {}),
  },
  aliexpress: { appKey: aliexpressAppKey, appSecret: aliexpressAppSecret, trackingId: aliexpressTrackingId, client: aliexpressClient,
    ...(aliexpressOperatorId && sessions ? { operatorId: aliexpressOperatorId, resolveOperator: (request) => sessions.resolve(request), appOrigin: config.appOrigin } : {}),
  },
})
app.log.info({
  auth: Boolean(sessions), catalog: Boolean(database), catalogMode, studio: Boolean(database && store && keys && resolveActor),
  store: store?.kind ?? null, supabase: Boolean(supabase), sessionKey: Boolean(keys), generationMode,
  tiktokConfigured: Boolean(tiktokAppKey && tiktokAppSecret && tiktokCreatorToken),
  aliexpressConfigured: Boolean(aliexpressClient), composer: composer ? composerModel : "rules_fallback", aliexpressTrackingId: Boolean(aliexpressTrackingId),
  poseAnalyzer: Boolean(process.env.STYLAI_POSE_ANALYZER_URL),
}, "API configuration (presence only)")
app.addHook("onClose", async () => { await database?.close() })
const stop = async () => { await app.close() }
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
try { await app.listen({ host: config.host, port: config.apiPort }) }
catch { app.log.error("API startup failed; check port and configuration."); process.exitCode = 1; await app.close() }
