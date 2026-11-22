/**
 * Client for the LOCAL pose analyzer (tools/pose-validator/analyzer.py, MediaPipe in Python).
 * Loopback only: photos never leave the machine/network boundary of the API for validation.
 * Failure (down, timeout, bad answer) returns null = technical error, never a verdict on the photo.
 */
import { z } from "zod"
import type { PoseAnalysis } from "@stylai/contracts"

const landmark = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number()])
export const analysisSchema = z.object({
  analyzer: z.string().min(1).max(60),
  width: z.number().int().positive(), height: z.number().int().positive(),
  poses: z.array(z.object({
    landmarks: z.array(landmark).length(33), world: z.array(z.tuple([z.number(), z.number(), z.number()])),
    // Analyzer a2+: head evidence from the person mask. Must be declared: zod drops unknown keys.
    head: z.object({ maskTop: z.number().min(0).max(1).nullable(), topTouch: z.number().min(0).max(1) }).nullable().optional(),
  })).max(5),
  quality: z.object({ meanLuma: z.number(), p5Luma: z.number(), p95Luma: z.number(), sharpness: z.number() }),
})

export interface PoseAnalyzer {
  /** Analyzer version reported by the service (null when unreachable). */
  version(): Promise<string | null>
  analyze(bytes: Uint8Array): Promise<PoseAnalysis | null>
  /** QA-006: applies EXIF orientation once and drops metadata (JPEG). Null = unavailable/unreadable. */
  normalize(bytes: Uint8Array): Promise<Uint8Array | null>
}

export function createPoseAnalyzer(baseUrl: string | undefined, timeoutMs = 12_000): PoseAnalyzer {
  let url: URL | null = null
  if (baseUrl) {
    const u = new URL(baseUrl)
    if (u.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("STYLAI_POSE_ANALYZER_URL must be a loopback http URL")
    url = u
  }
  let cached: string | null = null
  return {
    async version() {
      if (!url) return null
      if (cached) return cached
      try {
        const r = await fetch(new URL("/health", url), { signal: AbortSignal.timeout(3000) })
        const body = z.object({ analyzer: z.string() }).safeParse(await r.json())
        cached = r.ok && body.success ? body.data.analyzer : null
      } catch { cached = null }
      return cached
    },
    async analyze(bytes) {
      if (!url) return null
      try {
        const r = await fetch(new URL("/v1/analyze", url), {
          method: "POST", body: Buffer.from(bytes), headers: { "content-type": "application/octet-stream" }, signal: AbortSignal.timeout(timeoutMs),
        })
        if (!r.ok) return null
        const parsed = analysisSchema.safeParse(await r.json())
        if (!parsed.success) return null
        cached = parsed.data.analyzer
        return parsed.data as PoseAnalysis
      } catch { return null }
    },
    async normalize(bytes) {
      if (!url) return null
      try {
        const r = await fetch(new URL("/v1/normalize", url), {
          method: "POST", body: Buffer.from(bytes), headers: { "content-type": "application/octet-stream" }, signal: AbortSignal.timeout(timeoutMs),
        })
        if (!r.ok || r.headers.get("content-type") !== "image/jpeg") return null
        return new Uint8Array(await r.arrayBuffer())
      } catch { return null }
    },
  }
}
