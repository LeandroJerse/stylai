/**
 * Demo only: measures a body photo IN THIS BROWSER with MediaPipe Pose Landmarker (Full model,
 * @mediapipe/tasks-vision 1.2.3, WASM and model served locally from demo/public/mediapipe).
 * Produces the same PoseAnalysis shape as tools/pose-validator/analyzer.py so the SAME rules
 * (packages/contracts/src/photo-validation.ts) decide. The photo never leaves the browser.
 * Failure to load the model returns null = technical error, never a verdict on the photo.
 */
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision"
import type { Landmark, PoseAnalysis } from "../../../packages/contracts/src/index"

// a2: person-mask evidence above the head, same computation as tools/pose-validator/analyzer.py head_margin().
const ANALYZER = "mp-pose-full-web-1.2.3/a2"
const MAX_SIDE = 1600
let landmarker: Promise<PoseLandmarker> | null = null

function load(): Promise<PoseLandmarker> {
  if (!landmarker) {
    const base = new URL("mediapipe/", document.baseURI).href
    landmarker = FilesetResolver.forVisionTasks(base + "wasm")
      .then((fileset) => PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: base + "pose_landmarker_full.task", delegate: "CPU" },
        runningMode: "IMAGE", numPoses: 3, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, outputSegmentationMasks: true,
      }))
    landmarker.catch(() => { landmarker = null })
  }
  return landmarker
}

/** Same formulas as analyzer.py: mean/p5/p95 luminance and Laplacian variance at a 512 px height. */
function quality(canvas: HTMLCanvasElement): PoseAnalysis["quality"] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const hist = new Array<number>(256).fill(0)
  let sum = 0
  const n = canvas.width * canvas.height
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    sum += y; hist[Math.min(255, Math.round(y))]!++
  }
  const pct = (q: number): number => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]!; if (acc >= q * n) return v } return 255 }
  const h = 512, w = Math.max(1, Math.round((canvas.width * h) / canvas.height))
  const small = document.createElement("canvas")
  small.width = w; small.height = h
  const sctx = small.getContext("2d", { willReadFrequently: true })!
  sctx.drawImage(canvas, 0, 0, w, h)
  const px = sctx.getImageData(0, 0, w, h).data
  const g = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!
  let mean = 0, m2 = 0, k = 0
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x
    const lap = -4 * g[i]! + g[i - w]! + g[i + w]! + g[i - 1]! + g[i + 1]!
    k++; const d = lap - mean; mean += d / k; m2 += d * (lap - mean)
  }
  return { meanLuma: Math.round((sum / n) * 100) / 100, p5Luma: pct(0.05), p95Luma: pct(0.95), sharpness: Math.round((m2 / Math.max(1, k)) * 100) / 100 }
}

type Lm = { x: number; y: number; visibility?: number }
/** maskTop / topTouch in a column band around the visible head landmarks (hair included in the mask). */
function headMargin(lms: Lm[], mask: { width: number; height: number; getAsFloat32Array(): Float32Array } | undefined): { maskTop: number | null; topTouch: number } | null {
  if (!mask) return null
  const head = [0, 2, 5, 7, 8].map((i) => lms[i]!).filter((p) => (p.visibility ?? 0) >= 0.5 && p.x >= 0 && p.x <= 1)
  if (head.length === 0) return null
  const w = mask.width, h = mask.height, data = mask.getAsFloat32Array()
  const xs = head.map((p) => p.x)
  const span = Math.max(Math.abs(lms[11]!.x - lms[12]!.x), Math.max(...xs) - Math.min(...xs), 0.04)
  const x0 = Math.max(0, Math.floor((Math.min(...xs) - 0.6 * span) * w)), x1 = Math.min(w, Math.floor((Math.max(...xs) + 0.6 * span) * w) + 1)
  if (x1 - x0 < 2) return null
  let top: number | null = null
  for (let y = 0; y < h && top === null; y++) for (let x = x0; x < x1; x++) if (data[y * w + x]! > 0.5) { top = y / h; break }
  const rows = Math.max(2, Math.floor(0.006 * h))
  let touching = 0
  for (let x = x0; x < x1; x++) { for (let y = 0; y < rows; y++) if (data[y * w + x]! > 0.5) { touching++; break } }
  return { maskTop: top === null ? null : Math.round(top * 10_000) / 10_000, topTouch: Math.round((touching / (x1 - x0)) * 1000) / 1000 }
}

export async function analyzeInBrowser(file: Blob): Promise<PoseAnalysis | null> {
  try {
    // Orientation from EXIF is applied by the browser decoder; metadata is not read further.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const result = (await load()).detect(canvas)
    const r4 = (v: number): number => Math.round(v * 10_000) / 10_000
    const out: PoseAnalysis = {
      analyzer: ANALYZER, width: canvas.width, height: canvas.height,
      poses: result.landmarks.map((lms, i) => ({
        head: (() => { try { return headMargin(lms, result.segmentationMasks?.[i]) } catch { return null } })(),
        // Contract difference (QA-013): the Web SDK may omit `presence` ("Unset when the model does not output a
        // presence score", vision.d.ts); then visibility is used for both. The Python SDK always fills it.
        // Measured parity on the authorized fixtures: same verdicts (scripts/e2e-demo.mjs vs e2e-studio-official.mjs).
        landmarks: lms.map((p): Landmark => [r4(p.x), r4(p.y), r4(p.z), r4(p.visibility ?? 0), r4(p.presence ?? p.visibility ?? 0)]),
        world: (result.worldLandmarks[i] ?? []).map((p): [number, number, number] => [r4(p.x), r4(p.y), r4(p.z)]),
      })),
      quality: quality(canvas),
    }
    result.close() // releases the segmentation masks (WASM memory)
    return out
  } catch {
    return null
  }
}
