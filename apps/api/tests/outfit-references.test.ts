import { describe, expect, test } from "bun:test"
import type { NormalizedAliExpressCatalogItem } from "@stylai/commerce"
import { PrivateDatabaseError, type PrivateDatabase, type PrivateObjectStore } from "@stylai/supabase"
import { ReferenceImageError } from "@stylai/ai"
import { createReferencePreparer } from "../src/modules/outfits/references"

const item = (n: number, over: Partial<NormalizedAliExpressCatalogItem> = {}): NormalizedAliExpressCatalogItem => ({
  source: "aliexpress", canonicalKey: `aliexpress:${n}`, seller: "aliexpress-shop-9", sellerName: "Loja", externalProductId: String(n), category: "pants", categoryLabel: "Calças",
  name: `Calça ${n}`, color: null, variants: [], priceMinor: 9000, currency: "BRL", priceObservedAt: "2026-11-24T10:00:00.000Z",
  productUrl: `https://pt.aliexpress.com/item/${n}.html`, affiliateUrl: "https://s.click.aliexpress.com/e/x", image: `https://ae01.alicdn.com/kf/${n}.jpg`,
  rights: { basis: "unconfirmed", evidence: "x", tryOnAllowed: false }, capabilities: { displayAndLink: true, aiTryOn: false, aiTryOnBlockedReason: "ai_image_rights_unconfirmed" },
  fixture: false, ...over,
} as NormalizedAliExpressCatalogItem)
const sha = "a".repeat(64)
const image = { bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg" as const, width: 800, height: 800, sha256: sha }

function make(opts: { cached?: string[]; download?: (url: string) => Promise<typeof image>; register?: (item: { externalProductId: string }) => unknown; put?: () => Promise<void>; concurrency?: number } = {}) {
  const registered: { source: unknown; item: Record<string, unknown>; check: Record<string, unknown> }[] = []
  const puts: string[] = []
  const downloads: string[] = []
  const db = { call: async (op: string, ...args: unknown[]) => {
    if (op === "read_cached_source_references") return (args[1] as { externalProductId: string; imageUrl: string }[]).filter((x) => opts.cached?.includes(x.externalProductId))
      .map((x) => ({ ...x, productId: "31000000-0000-4000-8000-000000000001", variantId: "32000000-0000-4000-8000-000000000001", referenceKind: "image_reference", sha256: sha }))
    if (op === "register_source_reference") {
      const i = args[1] as { externalProductId: string; imageUrl: string }
      const custom = opts.register?.(i)
      if (custom instanceof Error) throw custom
      registered.push({ source: args[0], item: i as never, check: args[2] as never })
      return { externalProductId: i.externalProductId, imageUrl: i.imageUrl, productId: "31000000-0000-4000-8000-000000000002", variantId: "32000000-0000-4000-8000-000000000002", referenceKind: "image_reference" }
    }
    throw new Error(op)
  } } as unknown as PrivateDatabase<"api">
  const store = { kind: "local", put: async (bucket: string, key: string) => { if (opts.put) await opts.put(); puts.push(`${bucket}/${key}`) } } as unknown as PrivateObjectStore
  const preparer = createReferencePreparer({ db, store, concurrency: opts.concurrency, download: async (url) => { downloads.push(url); return opts.download ? opts.download(url) : image } })
  return { preparer, registered, puts, downloads }
}
const rejected = (state: string) => new PrivateDatabaseError("rejected", state)

describe("automatic reference preparation", () => {
  test("downloads, stores privately by content hash and registers under the source policy", async () => {
    const t = make()
    const out = await t.preparer.prepare([item(1)])
    expect(out.get("aliexpress:1")).toEqual({ status: "ready", reference: { productId: "31000000-0000-4000-8000-000000000002", variantId: "32000000-0000-4000-8000-000000000002",
      imageUrl: "https://ae01.alicdn.com/kf/1.jpg", sha256: sha } })
    expect(t.puts).toEqual([`references/catalog/${sha}.jpg`])
    expect(t.registered[0]).toMatchObject({ source: "aliexpress",
      item: { externalProductId: "1", seller: "aliexpress-shop-9", category: "pants", priceMinor: 9000, productUrl: "https://pt.aliexpress.com/item/1.html", imageUrl: "https://ae01.alicdn.com/kf/1.jpg", observedAt: "2026-11-24T10:00:00.000Z" },
      check: { sha256: sha, objectKey: `catalog/${sha}.jpg`, mime: "image/jpeg", bytes: 3, width: 800, height: 800 } })
    // The affiliate link is not catalog data.
    expect(JSON.stringify(t.registered[0]!.item)).not.toContain("s.click")
  })
  test("fresh cached references are reused without a download", async () => {
    const t = make({ cached: ["1"] })
    const out = await t.preparer.prepare([item(1), item(2)])
    expect(out.get("aliexpress:1")).toMatchObject({ status: "ready", reference: { sha256: sha } })
    expect(t.downloads).toEqual(["https://ae01.alicdn.com/kf/2.jpg"])
  })
  test("each failure blocks only its own piece with an explicit code; nothing is registered for it", async () => {
    const t = make({ download: async (url) => { if (url.endsWith("/2.jpg")) throw new ReferenceImageError("redirect_refused"); return image } })
    const out = await t.preparer.prepare([item(1), item(2), item(3, { productUrl: null }), item(4, { seller: "aliexpress-unidentified-shop" }), item(5, { category: "uncategorized" })])
    expect([...out].map(([k, v]) => [k, v.status === "ready" ? "ready" : v.code])).toEqual([
      ["aliexpress:1", "ready"], ["aliexpress:2", "redirect_refused"], ["aliexpress:3", "product_link_missing"], ["aliexpress:4", "seller_unidentified"], ["aliexpress:5", "category_not_renderable"]])
    expect(t.registered).toHaveLength(1)
    expect(t.downloads).toHaveLength(2)
  })
  test("revoked policy, operator withdrawal and review cases are blocked without exposing database text", async () => {
    for (const [state, code] of [["SA003", "rights_unavailable"], ["SA006", "review_required"], ["23514", "reference_rejected"], ["57014", "reference_unavailable"]] as const) {
      const t = make({ register: () => state === "57014" ? new PrivateDatabaseError("unknown", state) : rejected(state) })
      expect((await t.preparer.prepare([item(1)])).get("aliexpress:1")).toEqual({ status: "blocked", code })
    }
  })
  test("a failed store write registers nothing", async () => {
    const t = make({ put: async () => { throw new Error("disk") } })
    expect((await t.preparer.prepare([item(1)])).get("aliexpress:1")).toEqual({ status: "blocked", code: "reference_unavailable" })
    expect(t.registered).toEqual([])
  })
  test("concurrent requests for one image share one download; a permanent failure is remembered, a transient one is not", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => { release = r })
    const t = make({ download: async () => { await gate; return image } })
    const both = [t.preparer.prepare([item(1)]), t.preparer.prepare([item(1)])]
    release()
    await Promise.all(both)
    expect(t.downloads).toHaveLength(1)
    for (const [failure, again] of [["not_image", 1], ["timeout", 2]] as const) {
      const f = make({ download: async () => { throw new ReferenceImageError(failure) } })
      await f.preparer.prepare([item(1)]); await f.preparer.prepare([item(1)])
      expect([failure, f.downloads.length]).toEqual([failure, again])
    }
  })
  test("bounded parallelism and bounded batch", async () => {
    let active = 0, peak = 0
    const t = make({ concurrency: 2, download: async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return image } })
    const out = await t.preparer.prepare(Array.from({ length: 30 }, (_, i) => item(i + 1)))
    expect(peak).toBe(2)
    expect(t.downloads).toHaveLength(24)
    expect(out.get("aliexpress:30")).toEqual({ status: "blocked", code: "not_attempted" })
  })
})
