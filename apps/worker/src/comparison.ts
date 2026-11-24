/**
 * Comparison montage: the finished panels side by side, assembled on the server WITHOUT any AI call. The layout is fixed
 * by the number of panels, every panel keeps its own proportions (letterbox, never cropped) and labels are drawn here.
 */
import sharp from "sharp"
import { z } from "zod"
import { MAX_PANELS, MIN_PANELS } from "@stylai/contracts"
import type { Json, PrivateDatabase, PrivateObjectStore } from "@stylai/supabase"

const PANEL = { width: 768, height: 1024 }
const GAP = 24
const LABEL_HEIGHT = 72
const BACKGROUND = { r: 246, g: 244, b: 240 }
const MAX_OUTPUT_BYTES = 12_582_912

export interface ComparisonLayout {
  columns: number; rows: number; width: number; height: number; labelHeight: number
  panels: { x: number; y: number; width: number; height: number }[]
}

/** 2 -> one row of two, 3 -> one row of three, 4 -> two rows of two. */
export function comparisonLayout(n: number): ComparisonLayout {
  if (!Number.isInteger(n) || n < MIN_PANELS || n > MAX_PANELS) throw new Error("invalid_panels")
  const columns = n === 3 ? 3 : 2
  const rows = Math.ceil(n / columns)
  return {
    columns, rows, labelHeight: LABEL_HEIGHT,
    width: columns * PANEL.width + (columns + 1) * GAP, height: rows * (PANEL.height + LABEL_HEIGHT) + (rows + 1) * GAP,
    panels: Array.from({ length: n }, (_, i) => ({ x: GAP + (i % columns) * (PANEL.width + GAP), y: GAP + Math.floor(i / columns) * (PANEL.height + LABEL_HEIGHT + GAP), ...PANEL })),
  }
}

const ENTITIES: Record<string, string> = { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }
/** Text only: control characters dropped, XML metacharacters escaped. */
export const escapeSvg = (text: string): string =>
  [...text].filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127).join("").replace(/[<>&"']/g, (ch) => ENTITIES[ch]!)

export async function assembleComparison(panels: readonly { label: string; bytes: Uint8Array }[]): Promise<{ bytes: Uint8Array; layout: ComparisonLayout }> {
  const layout = comparisonLayout(panels.length)
  const labels = panels.map((p, i) => {
    const cell = layout.panels[i]!
    const text = `${i + 1} · ${p.label}`
    return `<text x="${cell.x + cell.width / 2}" y="${cell.y + cell.height + 46}" text-anchor="middle" font-family="Segoe UI, Helvetica, Arial, DejaVu Sans, sans-serif" font-size="30" fill="#2b2622">${escapeSvg(text.length > 44 ? `${text.slice(0, 43)}…` : text)}</text>`
  }).join("")
  const images = await Promise.all(panels.map(async (p, i) => ({
    input: await sharp(p.bytes, { limitInputPixels: 24_000_000, failOn: "error" }).rotate().flatten({ background: BACKGROUND })
      .resize(PANEL.width, PANEL.height, { fit: "contain", background: BACKGROUND }).png().toBuffer(),
    left: layout.panels[i]!.x, top: layout.panels[i]!.y,
  })))
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}">${labels}</svg>`)
  const bytes = await sharp({ create: { width: layout.width, height: layout.height, channels: 3, background: BACKGROUND } })
    .composite([...images, { input: overlay, left: 0, top: 0 }]).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer()
  return { bytes: new Uint8Array(bytes), layout }
}

const claimed = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), fence: z.string().regex(/^\d+$/),
  panels: z.array(z.object({ panel: z.number().int(), label: z.string(), bucket: z.literal("generated-looks"), object_key: z.string() }).passthrough()),
})

/** One montage per call; true when there was something to do. Leased and fenced by the database, retried up to three times. */
export function createComparisonBuilder(deps: { db: PrivateDatabase<"ai_worker">; store: PrivateObjectStore }) {
  return async function buildOnce(): Promise<boolean> {
    const raw = await deps.db.call("claim_outfit_comparison")
    if (!raw) return false
    const job = claimed.parse(raw)
    const key = `${job.user_id}/${job.id}/comparison-${job.fence}.jpg`
    try {
      const panels = await Promise.all(job.panels.map(async (p) => ({ label: p.label, bytes: await deps.store.get(p.bucket, p.object_key) })))
      const { bytes, layout } = await assembleComparison(panels)
      if (bytes.byteLength > MAX_OUTPUT_BYTES) throw new Error("montage_too_large")
      await deps.store.put("generated-looks", key, bytes, "image/jpeg")
      const described = { ...layout, panels: layout.panels.map((cell, i) => ({ panel: job.panels[i]!.panel, label: job.panels[i]!.label, ...cell })) }
      const published = await deps.db.call("complete_outfit_comparison", job.id, job.fence, key, bytes.byteLength, "image/jpeg", layout.width, layout.height, described as unknown as Json)
      // Lease lost or photo removed meanwhile: nothing was published, so nothing may stay behind.
      if (!published) await deps.store.remove("generated-looks", key).catch(() => undefined)
    } catch {
      await deps.db.call("fail_outfit_comparison", job.id, job.fence, "montage_failed").catch(() => undefined)
    }
    return true
  }
}
