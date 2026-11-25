import { z } from "zod"
import { ALIEXPRESS_LINK_BATCH_SIZE } from "@stylai/commerce"
import type { AffiliateCatalogConfig } from "./affiliate-catalog.js"

const collection = z.object({
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64),
  label: z.string().trim().min(1).max(100),
  searches: z.array(z.object({
    keywords: z.string().trim().min(2).max(100),
    categoryIds: z.array(z.string().regex(/^\d{1,20}$/)).min(1).max(10).optional(),
  }).strict()).min(1).max(5),
  categories: z.array(z.string().regex(/^[a-z0-9_]+$/).max(64)).min(1).max(20).optional(),
  minPriceMinor: z.number().int().positive().max(100_000_000).optional(),
  maxPriceMinor: z.number().int().positive().max(100_000_000).optional(),
}).strict().refine((value) => value.minPriceMinor === undefined || value.maxPriceMinor === undefined || value.minPriceMinor <= value.maxPriceMinor)

type Env = Record<string, string | undefined>

function required(env: Env, name: string) {
  const value = env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function integer(env: Env, name: string, min: number, max: number, fallback?: number) {
  const value = env[name]?.trim() ?? (fallback !== undefined ? String(fallback) : required(env, name))
  const parsed = Number(value)
  if (!/^\d+$/.test(value) || !Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid ${name}`)
  return parsed
}

function readCollections(env: Env) {
  const input = required(env, "STYLAI_CATALOG_COLLECTIONS")
  let data: unknown
  try { data = JSON.parse(input) } catch { throw new Error("Invalid STYLAI_CATALOG_COLLECTIONS") }
  const collections = z.array(collection).min(1).max(20).safeParse(data)
  if (!collections.success || new Set(collections.data.map((item) => item.slug)).size !== collections.data.length) {
    throw new Error("Invalid STYLAI_CATALOG_COLLECTIONS")
  }
  return collections.data
}

export function readAffiliateCatalogConfig(env: Env): AffiliateCatalogConfig & {
  appKey: string; appSecret: string; minuteLimit: number; dailyLimit: number; pollMs: number
} {
  const appKey = required(env, "ALIEXPRESS_APP_KEY")
  const appSecret = required(env, "ALIEXPRESS_APP_SECRET")
  const trackingId = required(env, "ALIEXPRESS_TRACKING_ID")
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trackingId) || appKey === trackingId) throw new Error("Invalid ALIEXPRESS_TRACKING_ID")
  const totalMinute = integer(env, "ALIEXPRESS_CALLS_PER_MINUTE", 4, 10000)
  const totalDay = integer(env, "ALIEXPRESS_CALLS_PER_DAY", 4, 10000)
  const ttlMinutes = integer(env, "STYLAI_CATALOG_OFFER_TTL_MINUTES", 2, 1440)
  const collections = readCollections(env)
  const pageSize = integer(env, "STYLAI_CATALOG_PAGE_SIZE", 1, 50, 25)
  const maxPagesPerSearch = integer(env, "STYLAI_CATALOG_PAGES_PER_SEARCH", 1, 5, 2)
  const maxOffers = integer(env, "STYLAI_CATALOG_MAX_OFFERS", 1, 200, 80)
  const discoveryCalls = Math.max(...collections.map((collection) => collection.searches.length)) * maxPagesPerSearch
  const refreshCalls = discoveryCalls + Math.ceil(Math.min(maxOffers, discoveryCalls * pageSize) / ALIEXPRESS_LINK_BATCH_SIZE)
  // Keep a complete product + link lookup available to the interactive API.
  const interactiveHeadroom = 2
  return {
    appKey, appSecret, trackingId, collections,
    minuteLimit: integer(env, "STYLAI_CATALOG_CALLS_PER_MINUTE", refreshCalls, totalMinute - interactiveHeadroom),
    dailyLimit: integer(env, "STYLAI_CATALOG_CALLS_PER_DAY", refreshCalls, totalDay - interactiveHeadroom),
    offerTtlMs: ttlMinutes * 60_000,
    refreshMs: integer(env, "STYLAI_CATALOG_REFRESH_MINUTES", 1, ttlMinutes - 1) * 60_000,
    pageSize, maxPagesPerSearch, maxOffers,
    pollMs: integer(env, "STYLAI_CATALOG_POLL_SECONDS", 1, 300, 15) * 1_000,
  }
}
