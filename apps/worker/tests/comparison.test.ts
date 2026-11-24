import { describe, expect, test } from "bun:test"
import sharp from "sharp"
import type { PrivateObjectStore } from "@stylai/supabase"
import { assembleComparison, comparisonLayout, createComparisonBuilder, escapeSvg } from "../src/comparison"
import { createGarmentLoader } from "../src/garments"
import { createReferencePurger } from "../src/purge"

const RENDER = "90000000-0000-4000-8000-000000000001"
const USER = "20000000-0000-4000-8000-0000000000a1"
const panel = (r: number, g: number, b: number, width = 300, height = 400) => sharp({ create: { width, height, channels: 3, background: { r, g, b } } }).png().toBuffer().then((x) => new Uint8Array(x))

describe("deterministic montage", () => {
  test.each([[2, 2, 1], [3, 3, 1], [4, 2, 2]])("%i panels use a %i x %i grid, in order and without overlap", (n, columns, rows) => {
    const l = comparisonLayout(n)
    expect([l.columns, l.rows, l.panels.length]).toEqual([columns, rows, n])
    const cells = new Set(l.panels.map((p) => `${p.x},${p.y}`))
    expect(cells.size).toBe(n)
    expect(l.panels.every((p) => p.x + p.width <= l.width && p.y + p.height + l.labelHeight <= l.height)).toBe(true)
  })
  test("each panel keeps its own pixels and proportions; the same input gives the same bytes", async () => {
    const input = [{ label: "Milano", bytes: await panel(200, 0, 0) }, { label: "Roma", bytes: await panel(0, 200, 0, 400, 400) }]
    const out = await assembleComparison(input)
    const again = await assembleComparison(input)
    expect(Buffer.compare(Buffer.from(out.bytes), Buffer.from(again.bytes))).toBe(0)
    const meta = await sharp(out.bytes).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", out.layout.width, out.layout.height])
    const raw = await sharp(out.bytes).raw().toBuffer()
    const at = (x: number, y: number) => [...raw.subarray((y * out.layout.width + x) * 3, (y * out.layout.width + x) * 3 + 3)]
    const centre = (i: number) => { const p = out.layout.panels[i]!; return at(p.x + p.width / 2, p.y + p.height / 2) }
    expect(centre(0)[0]).toBeGreaterThan(180); expect(centre(0)[1]).toBeLessThan(40)
    expect(centre(1)[1]).toBeGreaterThan(180); expect(centre(1)[0]).toBeLessThan(40)
    // A square result is letterboxed, never cropped or stretched.
    const square = out.layout.panels[1]!
    expect(Math.min(...at(square.x + square.width / 2, square.y + 4))).toBeGreaterThan(200)
  })
  test("labels are text drawn by the app, never markup", () => {
    expect(escapeSvg(`<script>&"'`)).toBe("&lt;script&gt;&amp;&quot;&apos;")
    expect(escapeSvg("a\u0000b\u0008")).toBe("ab")
  })
  test("refuses fewer than two or more than four panels", async () => {
    await expect(assembleComparison([{ label: "x", bytes: await panel(1, 1, 1) }])).rejects.toThrow("invalid_panels")
    expect(() => comparisonLayout(5)).toThrow("invalid_panels")
  })
})

describe("comparison builder", () => {
  async function make(o: { complete?: boolean | "throw"; bytes?: Uint8Array; claim?: boolean } = {}) {
    const ops: unknown[][] = []
    const stored: string[] = [], removed: string[] = []
    const good = await panel(9, 9, 9)
    const db = { call: async (op: string, ...args: unknown[]) => {
      ops.push([op, ...args])
      if (op === "claim_outfit_comparison") return o.claim === false ? null : { id: RENDER, user_id: USER, fence: "3", panels: [1, 2].map((n) => ({ panel: n, label: `C${n}`, set_id: RENDER, version_id: RENDER, bucket: "generated-looks", object_key: `k${n}` })) }
      if (op === "complete_outfit_comparison") { if (o.complete === "throw") throw new Error("db"); return o.complete ?? true }
      return true
    } }
    const store = { get: async () => o.bytes ?? good, put: async (_b: string, k: string) => { stored.push(k) }, remove: async (_b: string, k: string) => { removed.push(k) } } as unknown as PrivateObjectStore
    return { build: createComparisonBuilder({ db: db as never, store }), ops, stored, removed }
  }
  test("claims, assembles, stores under the render and publishes with the same fence", async () => {
    const t = await make()
    expect(await t.build()).toBe(true)
    const done = t.ops.find((x) => x[0] === "complete_outfit_comparison")!
    expect(done.slice(1, 4)).toEqual([RENDER, "3", `${USER}/${RENDER}/comparison-3.jpg`])
    expect(done[5]).toBe("image/jpeg")
    expect((done[8] as { panels: { panel: number; label: string }[] }).panels.map((p) => [p.panel, p.label])).toEqual([[1, "C1"], [2, "C2"]])
    expect(t.removed).toEqual([])
  })
  test("nothing to do, lost lease and unreadable panels leave no orphan image", async () => {
    expect(await (await make({ claim: false })).build()).toBe(false)
    const lost = await make({ complete: false })
    await lost.build()
    expect(lost.removed).toEqual(lost.stored)
    const bad = await make({ bytes: new Uint8Array([1, 2, 3]) })
    await bad.build()
    expect(bad.ops.at(-1)).toEqual(["fail_outfit_comparison", RENDER, "3", "montage_failed"])
    expect(bad.stored).toEqual([])
  })
})

describe("garment images", () => {
  const sha = (n: string) => n.repeat(64)
  const bytes = new Uint8Array([1, 2, 3])
  const HASH = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"
  function make(o: { cached?: Uint8Array | null; downloaded?: { sha256: string } } = {}) {
    const downloads: string[] = []
    const loader = createGarmentLoader({
      store: { get: async () => { if (!o.cached) throw new Error("gone"); return o.cached } } as unknown as PrivateObjectStore,
      download: async (url) => { downloads.push(url); return { bytes, mime: "image/jpeg", width: 800, height: 800, sha256: o.downloaded?.sha256 ?? HASH } },
      fallback: async () => ({ bytes, mime: "image/webp" }), testImages: false,
    })
    return { loader, downloads }
  }
  const ref = { sha256: HASH, object_key: `catalog/${HASH}.jpg`, mime: "image/jpeg" as const }
  test("verified cached bytes are used without any download", async () => {
    const t = make({ cached: bytes })
    expect(await t.loader("https://ae01.alicdn.com/a.jpg", ref)).toMatchObject({ mime: "image/jpeg" })
    expect(t.downloads).toEqual([])
  })
  test("a missing or tampered copy is downloaded again and must be the very image that was confirmed", async () => {
    for (const cached of [null, new Uint8Array([9])]) {
      const t = make({ cached })
      expect((await t.loader("https://ae01.alicdn.com/a.jpg", ref)).bytes).toEqual(bytes)
      expect(t.downloads).toHaveLength(1)
    }
    await expect(make({ downloaded: { sha256: sha("b") } }).loader("https://ae01.alicdn.com/a.jpg", ref)).rejects.toThrow("garment_image_changed")
  })
  test("without a cached reference the previous path is kept", async () => {
    expect((await make().loader("https://ae01.alicdn.com/a.jpg", undefined)).mime).toBe("image/webp")
  })
  test("local test-catalog images are only readable in simulation, inside their folder", async () => {
    const sim = createGarmentLoader({ store: {} as never, download: async () => { throw new Error("x") }, fallback: async () => { throw new Error("network") }, testImages: true })
    await expect(sim("https://test-catalog.stylai.invalid/../../package.json", undefined)).rejects.toThrow()
    await expect(make().loader("https://test-catalog.stylai.invalid/x.png", undefined)).resolves.toMatchObject({ mime: "image/webp" })
  })
})

test("expired reference bytes are removed before their record; a failure keeps the record", async () => {
  const finished: unknown[][] = []
  const db = { call: async (op: string, ...args: unknown[]) => { if (op === "claim_reference_purges") return ["catalog/a.jpg", "catalog/b.jpg"]; finished.push(args); return true } }
  const purge = createReferencePurger({ db: db as never, store: { remove: async (_b: string, k: string) => { if (k.endsWith("b.jpg")) throw new Error("x") } } as never })
  expect(await purge()).toEqual({ claimed: 2, removed: 1, failed: 1 })
  expect(finished).toEqual([["catalog/a.jpg", true]])
})
