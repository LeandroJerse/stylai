import { setTimeout as sleep } from "node:timers/promises"
import { createAliExpressAffiliateClient } from "@stylai/commerce"
import { createPrivateDatabase, readPrivateDatabaseConfig, type Json } from "@stylai/supabase"
import { readAffiliateCatalogConfig } from "./affiliate-catalog-config.js"
import { createAffiliateCatalogWorker } from "./affiliate-catalog.js"

async function main() {
  const config = readAffiliateCatalogConfig(process.env)
  const databaseConfig = readPrivateDatabaseConfig(process.env, "catalog_worker")
  if (!databaseConfig) throw new Error("Missing STYLAI_CATALOG_WORKER_DATABASE_URL")
  const db = createPrivateDatabase(databaseConfig)
  const shutdown = new AbortController()
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => shutdown.abort())

  try {
    if (await db.probe() !== "ready") throw new Error("Catalog database boundary is unavailable")
    const client = createAliExpressAffiliateClient({
      appKey: config.appKey,
      appSecret: config.appSecret,
      trackingId: config.trackingId,
      acquire: () => db.call("take_affiliate_catalog_slot", config.minuteLimit, config.dailyLimit),
    })
    const worker = createAffiliateCatalogWorker({
      client, config,
      store: {
        async claim(slug, leaseSeconds) {
          const lease = await db.call("claim_affiliate_collection", slug, leaseSeconds)
          if (!lease || typeof lease !== "object" || Array.isArray(lease) || typeof lease.token !== "string") return null
          return { token: lease.token }
        },
        publish(snapshot) {
          return db.call(
            "publish_affiliate_collection",
            snapshot.slug, snapshot.token, snapshot.label, snapshot.observedAt, snapshot.expiresAt, snapshot.nextDueAt,
            snapshot.offers as unknown as Json, snapshot.withdrawn,
          )
        },
        retry: (slug, token, nextDueAt) => db.call("retry_affiliate_collection", slug, token, nextDueAt),
      },
    })

    console.info(JSON.stringify({ worker: "affiliate_catalog", status: "started", collections: config.collections.length }))
    while (!shutdown.signal.aborted) {
      try {
        const result = await worker.refreshNext()
        if (result.status !== "idle") console.info(JSON.stringify({ worker: "affiliate_catalog", ...result }))
        if (result.status === "published") continue
      } catch {
        // The durable lease expires if the DB connection fails mid-refresh. Do not log provider data or credentials.
        console.error(JSON.stringify({ worker: "affiliate_catalog", status: "refresh_failed" }))
      }
      await sleep(config.pollMs, undefined, { signal: shutdown.signal }).catch((error: unknown) => {
        if (!shutdown.signal.aborted) throw error
      })
    }
  } finally {
    await db.close()
  }
}

await main().catch((error: unknown) => {
  const message = error instanceof Error && /^(Missing|Invalid) [A-Z_]+$/.test(error.message)
    ? error.message
    : "Confira a configuração e a versão da migração de catálogo."
  console.error(JSON.stringify({ worker: "affiliate_catalog", status: "startup_failed", message }))
  process.exitCode = 1
})
