// Regression: the API kept only landmarks/world from the analyzer and silently dropped the a2 head
// evidence (zod strips unknown keys), so every tight-top photo fell back to "unconfirmed" in the official app.
import { expect, test } from "bun:test"
import { analysisSchema } from "../src/modules/photos/pose-analyzer"

const lm = Array.from({ length: 33 }, () => [0.5, 0.5, 0, 1, 1])
test("analyzer response keeps the head mask evidence", () => {
  const parsed = analysisSchema.parse({ analyzer: "mp-pose-full-1.2.3/a2", width: 720, height: 807, quality: { meanLuma: 150, p5Luma: 90, p95Luma: 220, sharpness: 100 },
    poses: [{ landmarks: lm, world: [], head: { maskTop: 0.0186, topTouch: 0 } }] })
  expect(parsed.poses[0]!.head).toEqual({ maskTop: 0.0186, topTouch: 0 })
  // Older analyzers (a1) still parse, without head evidence.
  expect(analysisSchema.parse({ analyzer: "x/a1", width: 1, height: 1, quality: { meanLuma: 1, p5Luma: 1, p95Luma: 1, sharpness: 1 }, poses: [{ landmarks: lm, world: [] }] }).poses[0]!.head).toBeUndefined()
})
