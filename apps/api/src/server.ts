import { readServiceConfig } from "@stylai/config"
import { buildApp } from "./app.js"
import { readSupabaseConfig, probeFoundation, readPrivateDatabaseConfig, createPrivateDatabase } from "@stylai/supabase"

const config = readServiceConfig(process.env)
const supabase = readSupabaseConfig(process.env)
const databaseConfig = readPrivateDatabaseConfig(process.env, "api")
const database = databaseConfig ? createPrivateDatabase(databaseConfig) : null
const app = await buildApp({ appOrigin: config.appOrigin, logger: true, probeSupabase: () => probeFoundation(supabase), ...(database ? { probePrivateDatabase: () => database.probe() } : {}) })
app.addHook("onClose", async () => { await database?.close() })
const stop = async () => { await app.close() }
process.once("SIGINT", stop)
process.once("SIGTERM", stop)
try { await app.listen({ host: config.host, port: config.apiPort }) }
catch { app.log.error("API startup failed; check port and configuration."); process.exitCode = 1; await app.close() }
