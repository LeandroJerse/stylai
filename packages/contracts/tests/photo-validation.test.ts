// Rules on REAL measurements: MediaPipe Pose Landmarker Full (Python, tools/pose-validator) run on
// photos under the Unsplash License (assets-src/unsplash) plus derived mirror/dark/blur/composite
// variants. Only landmark measurements are stored here, no image. Labels = human judgement.
import { expect, test } from "bun:test"
import { analyzerFailure, evaluatePose, type PhotoAngle, type PoseAnalysis } from "../src/photo-validation"
import data from "./fixtures/pose-eval-unsplash.json"
import auditCrop from "./fixtures/pose-head-audit.json"

const m = data as unknown as Record<string, PoseAnalysis>
const run = (name: string, angle: PhotoAngle) => evaluatePose(m[name]!, angle)
const codes = (name: string, angle: PhotoAngle) => run(name, angle).issues.map((i) => i.code)

// These measurements predate the mask (analyzer a1): without head evidence they must stay "unconfirmed".
// On the original images the head is whole with a small margin (see photo-validation-head.test.ts, a2 data).
test("QA-001 residual: tight-top photos without mask evidence are never approved (head unconfirmed)", () => {
  for (const [analysis, angle] of [[m.nohead12_profile!, "profile"], [auditCrop as PoseAnalysis, "front"]] as const) {
    const result = evaluatePose(analysis, angle)
    expect(result.status).not.toBe("approved")
    expect(result.supports).toEqual({ upper: false, lower: false, dress: false })
  }
})

test("head margin is checked with eyes or ears when the nose is occluded", () => {
  for (const earsOnly of [false, true]) {
    const cropped = structuredClone(m.nohead12_profile!)
    const valid = structuredClone(m.profile_t01!)
    for (const analysis of [cropped, valid]) {
      for (const index of earsOnly ? [0, 2, 5] : [0]) analysis.poses[0]!.landmarks[index]![3] = 0
    }
    expect(evaluatePose(cropped, "profile").status).not.toBe("approved")
    expect(evaluatePose(valid, "profile").status).toBe("approved")
  }
})

test("full-body frontal photos are approved for the front slot (incl. dark studio background and mirrored)", () => {
  for (const n of ["front_a12", "front_a13", "front_b17", "front_b00dark", "front_t32", "front_t47", "mirror_front_a12"]) {
    const r = run(n, "front")
    expect([n, r.status, r.framing]).toEqual([n, "approved", "full_body"])
    expect(r.supports).toEqual({ upper: true, lower: true, dress: true })
  }
})

test("a frontal photo cut at the knees serves tops only", () => {
  const r = run("front_t34", "front")
  expect(r.status).toBe("approved")
  expect(r.framing).toBe("to_knees")
  expect(r.supports).toEqual({ upper: true, lower: false, dress: false })
})

test("profile, three-quarter and mirrored profile are told apart from the body, not the face", () => {
  expect(run("profile_t01", "profile").status).toBe("approved")
  expect(run("mirror_profile_t01", "profile").status).toBe("approved")
  expect(run("tq_a08", "side").status).toBe("approved")
  expect(codes("front_a12", "profile")).toContain("wrong_angle")
  expect(codes("profile_t01", "front")).toContain("wrong_angle")
})

test("close selfies and waist-up photos are not approved for body try-on", () => {
  for (const n of ["selfie_a03", "selfie_b03", "selfie_t33"]) {
    const r = run(n, "front")
    expect([n, r.status]).toEqual([n, "needs_adjustment"])
    expect(r.issues.map((i) => i.code)).toContain("too_close")
  }
  // Cut at the thighs with the knees only faintly detected at the edge: doubt, not approval.
  expect(run("profile_a00", "profile").status).toBe("inconclusive")
  expect(codes("profile_b10", "profile")).toContain("too_close")
})

test("two people are refused with a specific message", () => {
  for (const n of ["two_t43", "two_t48", "two_composite"]) {
    const r = run(n, "front")
    expect(r.persons).toBe(2)
    expect(r.issues.map((i) => i.code)).toContain("multiple_people")
    expect(r.status).toBe("needs_adjustment")
  }
})

test("no person, dark and blurred photos ask for another photo", () => {
  for (const n of ["none_t12", "none_t46", "cropped_t25legs"]) expect(codes(n, "front")).toContain("no_person")
  // A flat, low-detail object photo cannot be told from a blurred one: one combined message.
  expect(run("none_t11", "front").status).toBe("needs_adjustment")
  expect(codes("dark_front_a13", "front")).toContain("dark")
  expect(codes("blur_front_t32", "front")).toContain("blurry")
})

test("borderline rotation is reported as unconfirmed, not as a wrong photo", () => {
  // tq_a04 (~25° measured): between the front and three-quarter bands.
  const r = run("tq_a04", "side")
  expect(r.status).toBe("inconclusive")
  expect(r.issues.map((i) => i.code)).toEqual(["angle_unconfirmed"])
})

test("analyzer failure is a technical error, never a rejection of the photo", () => {
  const r = analyzerFailure("front")
  expect(r.status).toBe("error")
  expect(r.issues[0]!.message).toContain("falha técnica")
})

/* ---------------- QA-001 / QA-005 regressions (rules v2). Negatives are authorized: seated Unsplash
   photos and synthetic crops/occlusions of the fixture photos (no personal photo stored). */

test("QA-001: seated people are never approved (knee not clearly below the hip)", () => {
  // t30: knee measured ABOVE the hip, the exact pattern reported by the audit.
  for (const n of ["seated_t29", "seated_t30", "seated_t41", "seated_t42"]) {
    const r = run(n, "front")
    expect([n, r.status === "approved"]).toEqual([n, false])
  }
  expect(codes("seated_t30", "front")).toContain("not_standing")
})

test("QA-001: a head cut at the top is never approved", () => {
  for (const [n, a] of [["nohead25_front", "front"], ["nohead12_side", "side"], ["nohead18_front", "front"]] as const) {
    expect([n, run(n, a).status === "approved"]).toEqual([n, false])
  }
  expect(codes("nohead25_front", "front")).toContain("head_cut")
})

test("QA-001: the positive set stays approved (front, three-quarter, profile, mirrored, upscaled)", () => {
  for (const [n, a] of [["front_a12", "front"], ["front_a13", "front"], ["front_b17", "front"], ["front_t32", "front"], ["front_t47", "front"], ["front_b00dark", "front"],
    ["mirror_front_a12", "front"], ["tq_a08", "side"], ["profile_t01", "profile"], ["mirror_profile_t01", "profile"],
    ["upscaled_front", "front"], ["upscaled_side", "side"], ["upscaled_profile", "profile"], ["nohead8_front", "front"]] as const) {
    expect([n, run(n, a).status]).toEqual([n, "approved"])
  }
})

test("QA-005: a photo that is not approved supports no garment group", () => {
  for (const n of ["two_composite", "dark_front_a13", "selfie_a03", "seated_t30", "nohead25_front"]) {
    expect([n, run(n, "front").supports]).toEqual([n, { upper: false, lower: false, dress: false }])
  }
  expect(analyzerFailure("front").supports).toEqual({ upper: false, lower: false, dress: false })
})
