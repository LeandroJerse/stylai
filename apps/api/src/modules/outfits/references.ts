/**
 * Turns a store listing into a try-on reference WITHOUT any manual step: safe download (reference-image.ts), private
 * copy by content hash, and registration under the ACTIVE, revocable policy of that source (the database decides).
 * One failing piece never blocks another; a blocked piece carries a code, never a silent substitute.
 */
import { z } from "zod"
import { ReferenceImageError, type ReferenceDownloader } from "@stylai/ai"
import type { NormalizedAliExpressCatalogItem } from "@stylai/commerce"
import { outfitSlotOfCategory } from "@stylai/contracts"
import { PrivateDatabaseError, type Json, type PrivateDatabase, type PrivateObjectStore } from "@stylai/supabase"

export const REFERENCE_BATCH = 24
const DEFAULT_CONCURRENCY = 4
const NEGATIVE_TTL_MS = 5 * 60_000
const NEGATIVE_MAX = 500
/** Verdicts about the file itself: asking again within minutes gives the same answer. */
const PERMANENT = new Set(["host_not_allowed", "private_address", "redirect_refused", "too_large", "not_image", "too_small", "dimensions_invalid", "not_found"])

export interface PieceReference { productId: string; variantId: string; imageUrl: string; sha256: string }
export type PreparedReference = { status: "ready"; reference: PieceReference } | { status: "blocked"; code: string }
export interface ReferencePreparer { prepare(items: readonly NormalizedAliExpressCatalogItem[]): Promise<Map<string, PreparedReference>> }

const row = z.object({ externalProductId: z.string(), imageUrl: z.string(), productId: z.string().uuid(), variantId: z.string().uuid() })
const cachedRow = row.extend({ sha256: z.string().regex(/^[0-9a-f]{64}$/) })

function databaseCode(error: unknown): string {
  if (!(error instanceof PrivateDatabaseError) || error.outcome !== "rejected") return "reference_unavailable"
  return error.sqlState === "SA003" ? "rights_unavailable" : error.sqlState === "SA006" ? "review_required" : "reference_rejected"
}

export function createReferencePreparer(deps: {
  db: PrivateDatabase<"api">; store: PrivateObjectStore; download: ReferenceDownloader; concurrency?: number; now?: () => number
}): ReferencePreparer {
  const now = deps.now ?? Date.now
  const inFlight = new Map<string, Promise<PreparedReference>>()
  const negative = new Map<string, { code: string; until: number }>()

  async function prepareOne(item: NormalizedAliExpressCatalogItem): Promise<PreparedReference> {
    if (outfitSlotOfCategory(item.category) === null) return { status: "blocked", code: "category_not_renderable" }
    if (!item.productUrl) return { status: "blocked", code: "product_link_missing" }
    if (!/^aliexpress-shop-\d+$/.test(item.seller)) return { status: "blocked", code: "seller_unidentified" }
    const known = negative.get(item.image)
    if (known && known.until > now()) return { status: "blocked", code: known.code }
    let image
    try { image = await deps.download(item.image) } catch (error) {
      const code = error instanceof ReferenceImageError ? error.code : "download_failed"
      if (PERMANENT.has(code)) {
        while (negative.size >= NEGATIVE_MAX) negative.delete(negative.keys().next().value!)
        negative.set(item.image, { code, until: now() + NEGATIVE_TTL_MS })
      }
      return { status: "blocked", code }
    }
    const objectKey = `catalog/${image.sha256}.${image.mime === "image/png" ? "png" : image.mime === "image/webp" ? "webp" : "jpg"}`
    try { await deps.store.put("references", objectKey, image.bytes, image.mime) } catch { return { status: "blocked", code: "reference_unavailable" } }
    try {
      const registered = row.parse(await deps.db.call("register_source_reference", item.source, {
        externalProductId: item.externalProductId, seller: item.seller, sellerName: item.sellerName, name: item.name, category: item.category,
        imageUrl: item.image, productUrl: item.productUrl, priceMinor: item.priceMinor, observedAt: item.priceObservedAt ?? new Date(now()).toISOString(),
      }, { sha256: image.sha256, objectKey, mime: image.mime, bytes: image.bytes.byteLength, width: image.width, height: image.height }))
      return { status: "ready", reference: { productId: registered.productId, variantId: registered.variantId, imageUrl: registered.imageUrl, sha256: image.sha256 } }
    } catch (error) { return { status: "blocked", code: databaseCode(error) } }
  }

  function shared(item: NormalizedAliExpressCatalogItem): Promise<PreparedReference> {
    const key = `${item.canonicalKey} ${item.image}`
    const running = inFlight.get(key)
    if (running) return running
    const started = prepareOne(item).finally(() => inFlight.delete(key))
    inFlight.set(key, started)
    return started
  }

  return {
    async prepare(items) {
      const out = new Map<string, PreparedReference>()
      const unique = [...new Map(items.map((i) => [i.canonicalKey, i])).values()]
      for (const item of unique) out.set(item.canonicalKey, { status: "blocked", code: "not_attempted" })
      const batch = unique.slice(0, REFERENCE_BATCH)
      if (!batch.length) return out
      const requested = batch.map((i) => ({ externalProductId: i.externalProductId, imageUrl: i.image }))
      const cached = z.array(cachedRow).catch([]).parse(await deps.db.call("read_cached_source_references", "aliexpress", requested as Json).catch(() => []))
      const pending = batch.filter((item) => {
        const hit = cached.find((c) => c.externalProductId === item.externalProductId && c.imageUrl === item.image)
        if (hit) out.set(item.canonicalKey, { status: "ready", reference: { productId: hit.productId, variantId: hit.variantId, imageUrl: hit.imageUrl, sha256: hit.sha256 } })
        return !hit
      })
      let next = 0
      await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? DEFAULT_CONCURRENCY, pending.length) }, async () => {
        while (next < pending.length) {
          const item = pending[next++]!
          out.set(item.canonicalKey, await shared(item))
        }
      }))
      return out
    },
  }
}
