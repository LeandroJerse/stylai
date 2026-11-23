/**
 * Read-only diagnostic & opt-in live query CLI for TikTok Shop Creator Collaborations (BR).
 * Never prints App Secret, auth_code, access_token or refresh_token.
 *
 * Usage:
 *   node --conditions=development --import tsx scripts/check-tiktok-access.ts
 *   node --conditions=development --import tsx scripts/check-tiktok-access.ts --live "camisa"
 */
import { createHmac } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  createTikTokCatalogCache, createTikTokCreatorClient, REQUIRED_CREATOR_COLLAB_SCOPE, signTikTokRequest,
} from "@stylai/commerce"

async function main() {
  const args = process.argv.slice(2)
  const live = args.includes("--live")
  const queryText = args.filter((a) => a !== "--live").join(" ").trim() || "camisa"

  const appKey = process.env.TIKTOK_SHOP_APP_KEY?.trim() || null
  const appSecret = process.env.TIKTOK_SHOP_APP_SECRET?.trim() || null
  const accessToken = process.env.TIKTOK_SHOP_CREATOR_ACCESS_TOKEN?.trim() || null

  // Independent offline HMAC-SHA256 self-check (never uses real secrets).
  const sampleSecret = "test_secret_vector_only"
  const samplePath = "/affiliate_creator/202405/open_collaborations/products/search"
  const sampleBody = JSON.stringify({ title_keywords: ["camisa"] })
  const expected = createHmac("sha256", sampleSecret)
    .update(`${sampleSecret}${samplePath}app_key123page_size5timestamp1700000000${sampleBody}${sampleSecret}`, "utf8")
    .digest("hex")
  const computed = signTikTokRequest(
    { path: samplePath, query: { timestamp: 1700000000, app_key: "123", page_size: 5, sign: "ignored", access_token: "ignored" }, rawBody: sampleBody, contentType: "application/json" },
    sampleSecret,
  )

  const missing: string[] = []
  if (!appKey) missing.push("TIKTOK_SHOP_APP_KEY")
  if (!appSecret) missing.push("TIKTOK_SHOP_APP_SECRET")
  if (!accessToken) missing.push("TIKTOK_SHOP_CREATOR_ACCESS_TOKEN")

  const report: Record<string, unknown> = {
    provider: "tiktok_shop",
    modality: "Colaborações do criador",
    appServiceId: "7710474909072181044",
    market: "BR",
    currency: "BRL",
    requiredScope: REQUIRED_CREATOR_COLLAB_SCOPE,
    signatureSelfCheckPassed: computed === expected,
    configured: missing.length === 0,
    presence: {
      TIKTOK_SHOP_APP_KEY: Boolean(appKey),
      TIKTOK_SHOP_APP_SECRET: Boolean(appSecret),
      TIKTOK_SHOP_CREATOR_ACCESS_TOKEN: Boolean(accessToken),
    },
    missingPrerequisites: missing,
    checkedAt: new Date().toISOString(),
  }

  if (live && appKey && appSecret && accessToken) {
    const client = createTikTokCreatorClient({ appKey, appSecret })
    const cache = createTikTokCatalogCache({ client, getAccessToken: async () => accessToken })
    const result = await cache.search({ keywords: queryText.split(/\s+/).filter(Boolean), pageSize: 5 })
    report.liveQuery = {
      query: queryText,
      state: result.state,
      requestId: result.requestId,
      errorKind: result.errorKind ?? null,
      acceptedCount: result.items.length,
      rejectedCount: result.rejectedCount,
      nextCursorPresent: Boolean(result.nextCursor),
      sampleItems: result.items.slice(0, 5).map((item) => ({
        canonicalKey: item.canonicalKey,
        externalProductId: item.externalProductId,
        name: item.name,
        region: item.region,
        currency: item.currency,
        priceMinor: item.priceMinor,
        priceRangeMinor: item.priceRangeMinor,
        hasProductUrl: Boolean(item.productUrl),
        capabilities: item.capabilities,
      })),
    }
  } else if (live) {
    report.liveQuery = { skipped: true, reason: "missing_credentials_or_creator_token" }
  }

  console.log(JSON.stringify(report, null, 2))
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isMain) void main()
