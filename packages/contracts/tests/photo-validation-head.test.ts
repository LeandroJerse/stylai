// Head margin (pose-rules/4). Measurements by tools/pose-validator analyzer a2 (MediaPipe Pose Landmarker
// Full + person segmentation mask) on authorized photos (Unsplash License) and synthetic top crops of the
// fixture photos (sweep/*_cutNN = NN% removed from the top). Labels checked on the ORIGINAL images with the
// mask overlaid (docs/qa/2026-11-21-cabeca-margem.md). No personal photo is stored here.
import { expect, test } from "bun:test"
import { evaluatePose, type PhotoAngle, type PoseAnalysis } from "../src/photo-validation"
import data from "./fixtures/pose-eval-a2.json"

const m = data as unknown as Record<string, PoseAnalysis>
const run = (name: string, angle: PhotoAngle) => evaluatePose(m[name]!, angle)
const codes = (name: string, angle: PhotoAngle) => run(name, angle).issues.map((i) => i.code)

// Whole head, little room above it (hair inside the image): accept, recommend more space.
const WHOLE_SMALL_MARGIN: [string, PhotoAngle][] = [
  ["nohead18_front", "front"], ["front_cut19", "front"], ["front_cut20", "front"], ["front_cut21", "front"],
  ["nohead12_profile", "profile"], ["profile_cut12", "profile"], ["profile_cut13", "profile"],
  ["side_cut04", "side"], ["side_cut05", "side"], ["side_cut06", "side"],
]
// Head (hair) crosses the top border: ask for another photo.
const REALLY_CUT: [string, PhotoAngle][] = [
  ["front_cut22", "front"], ["front_cut23", "front"], ["front_cut24", "front"], ["front_cut25", "front"], ["nohead25_front", "front"],
  ["profile_cut14", "profile"], ["profile_cut15", "profile"], ["profile_cut16", "profile"], ["profile_cut17", "profile"],
  ["side_cut07", "side"], ["side_cut08", "side"], ["side_cut09", "side"], ["nohead12_side", "side"], ["nohead8_side", "side"],
]

test("whole head with a small margin is approved, with a recommendation (not a block)", () => {
  for (const [n, a] of WHOLE_SMALL_MARGIN) {
    const r = run(n, a)
    expect([n, r.status]).toEqual([n, "approved"])
    expect([n, r.issues.map((i) => [i.code, i.level])]).toEqual([n, [["head_margin_small", "advice"]]])
    expect(r.supports.upper).toBe(true)
  }
})

test("a head really cut at the top asks for another photo", () => {
  for (const [n, a] of REALLY_CUT) {
    const r = run(n, a)
    expect([n, r.status]).toEqual([n, "needs_adjustment"])
    expect([n, codes(n, a).includes("head_cut")]).toEqual([n, true])
    expect(r.supports).toEqual({ upper: false, lower: false, dress: false })
  }
})

test("existing positives stay approved, without head advice when there is room", () => {
  for (const [n, a] of [["upscaled_front", "front"], ["upscaled_side", "side"], ["upscaled_profile", "profile"], ["front_a12", "front"],
    ["front_a13", "front"], ["front_b17", "front"], ["front_t32", "front"], ["front_t47", "front"], ["front_b00dark", "front"],
    ["mirror_front_a12", "front"], ["tq_a08", "side"], ["profile_t01", "profile"], ["mirror_profile_t01", "profile"], ["nohead8_front", "front"]] as const) {
    const r = run(n, a)
    expect([n, r.status, r.issues.map((i) => i.code)]).toEqual([n, "approved", []])
  }
})

test("without mask evidence the head is reported as unconfirmed, never as cut (unless the face itself is at the border)", () => {
  const noMask = (n: string) => { const x = structuredClone(m[n]!); for (const p of x.poses) delete (p as { head?: unknown }).head; return x }
  for (const n of ["nohead18_front", "front_cut21", "front_cut22"]) {
    const r = evaluatePose(noMask(n), "front")
    expect([n, r.status, r.issues.map((i) => i.code)]).toEqual([n, "inconclusive", ["head_unconfirmed"]])
    expect(r.issues[0]!.message).not.toMatch(/cortad/i)
  }
  // Face at the very top of the image: the skull is necessarily outside (front_cut25: eyes at 1.2%).
  expect(evaluatePose(noMask("front_cut25"), "front").issues.map((i) => i.code)).toContain("head_cut")
})

test("conflicting evidence (mask says room, landmarks say beyond the border) is unconfirmed, not approved", () => {
  const x = structuredClone(m.front_cut23!)
  x.poses[0]!.head = { maskTop: 0.02, topTouch: 0 } // mask missed the hair; face landmarks place the skull above the image
  const r = evaluatePose(x, "front")
  expect(r.status).toBe("inconclusive")
  expect(r.issues.map((i) => i.code)).toEqual(["head_unconfirmed"])
})
