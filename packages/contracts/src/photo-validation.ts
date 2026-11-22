/**
 * Body-photo validation rules (browser-safe, no I/O). The same function runs on the server
 * (measurements from tools/pose-validator/analyzer.py, MediaPipe Pose Landmarker Full in Python)
 * and in the demo (measurements from @mediapipe/tasks-vision in the browser).
 *
 * What it checks: one person, framing, approximate body rotation for the requested slot,
 * minimum light/sharpness. What it does NOT check: identity, authenticity, that the three
 * photos show the same person, or garment fit. Thresholds were calibrated on real photos
 * (Unsplash License) - see docs/qa/2026-11-21-validacao-fotos.md for data and known errors.
 */

export type PhotoAngle = "front" | "side" | "profile"
export type PhotoValidationStatus = "approved" | "needs_adjustment" | "inconclusive" | "error"
/** full_body: head to ankles. to_knees: head to knees ("grande parte do corpo"). partial: less. */
export type PhotoFraming = "full_body" | "to_knees" | "partial" | "none"

/** [x, y, z, visibility, presence]; x/y normalized to the image (0..1). */
export type Landmark = [number, number, number, number, number]
export interface PoseAnalysis {
  analyzer: string
  width: number
  height: number
  poses: {
    landmarks: Landmark[]
    world: [number, number, number][]
    /**
     * Analyzer a2+: person-mask evidence above the head (hair included). maskTop = first row with the person
     * in the head column band (fraction of height); topTouch = share of that band touching the top border.
     * Absent/null = no mask evidence (older measurement or mask unavailable).
     */
    head?: { maskTop: number | null; topTouch: number } | null
  }[]
  quality: { meanLuma: number; p5Luma: number; p95Luma: number; sharpness: number }
}

/** level "advice": shown as a recommendation, never blocks approval. */
export interface PhotoIssue { code: string; message: string; level?: "advice" }
export interface PhotoValidation {
  status: PhotoValidationStatus
  version: string
  framing: PhotoFraming
  /** Garment groups this photo can serve, from its framing (a waist-to-knee photo cannot show trousers). */
  supports: { upper: boolean; lower: boolean; dress: boolean }
  requestedAngle: PhotoAngle
  measuredAngle: PhotoAngle | null
  yawDeg: number | null
  persons: number
  issues: PhotoIssue[]
}

/** v3: conservative head margin using visible head landmarks, including occluded-nose profiles. */
/** v4 (QA head margin): head decided by the person mask; small margin = advice; no evidence = unconfirmed. */
export const POSE_RULES_VERSION = "pose-rules/4"
export const ANGLE_LABEL: Record<PhotoAngle, string> = { front: "frente (0°)", side: "três quartos (45°)", profile: "perfil (90°)" }

/** Calibrated thresholds (degrees of body yaw from world landmarks; luminance 0-255). */
export const POSE_THRESHOLDS = {
  visible: 0.5, uncertain: 0.3,
  frontMaxYaw: 22, sideMinYaw: 28, sideMaxYaw: 62, profileMinYaw: 66,
  /** Shoulder vs hip rotation disagreeing more than this = twisted pose, angle not confirmed. */
  maxTwist: 30,
  darkP95: 70, blurSharpness: 8,
  /** A detected pose counts as a person only with this many clearly visible points. */
  personMinPoints: 8,
  /**
   * Geometry, as fractions of the torso (shoulder-to-hip height). Heuristics calibrated on the
   * authorized set in packages/contracts/tests (standing 0.65-0.90; seated -0.10-0.56). They do not
   * prove a limb is visible, they only refuse poses inconsistent with standing.
   */
  standingKneeMin: 0.62, seatedKneeMax: 0.45,
  /** Ankle at least this far below the knee for "full body" (standing set: 0.66-0.85). */
  ankleBelowKneeMin: 0.45,
  /** Estimated top of the head (image fraction): below = cut; between = not confirmed (measured positives >= 0.0615; not a segmentation guarantee). */
  /**
   * Head margin. With mask evidence: touching the top border in >= headTouchCut of the head band = cut;
   * margin < headAdvice = accepted with a recommendation. Calibrated on progressive top crops (cuts touch
   * 9-97%, whole heads 0%). Without mask: the landmark estimate (highest facial point - 0.5 x face-to-shoulder)
   * only says "unconfirmed" below headTopUnsure; a face itself above faceAtTop means the skull is outside.
   */
  headTouchCut: 0.05, headAdvice: 0.06, headTopUnsure: 0.06, faceAtTop: 0.03, headConflict: 0,
} as const

const HEAD = [0, 2, 5, 7, 8], SHOULDERS = [11, 12], HIPS = [23, 24], KNEES = [25, 26], ANKLES = [27, 28, 29, 30]

const MSG = {
  noPerson: "Não encontramos uma pessoa na foto. Use uma foto sua, de corpo inteiro.",
  multiple: "Use uma foto com apenas uma pessoa.",
  tooClose: "Afaste a câmera para incluir as pernas.",
  head: "Enquadre do topo da cabeça até os pés.",
  turn: (a: PhotoAngle) => `Gire um pouco o corpo para a posição indicada: ${ANGLE_LABEL[a]}.`,
  unsure: "Não conseguimos confirmar a posição; tente outra foto.",
  dark: "A foto está escura. Tire outra com mais luz, de frente para a claridade.",
  blurry: "A foto está desfocada. Apoie o celular e tire outra.",
  blurryOrEmpty: "Não encontramos uma pessoa nítida: a foto parece desfocada ou sem pessoa. Tire outra, de corpo inteiro e com o celular apoiado.",
  lowConfidence: "Partes do corpo ficaram pouco nítidas para confirmar o enquadramento; tente outra foto.",
  notStanding: "Fique em pé, com as pernas à vista e nada na frente do corpo (mesa, cadeira, objetos).",
  postureUnsure: "Não conseguimos confirmar que você está em pé com as pernas à vista; tente outra foto.",
  headCut: "A cabeça ficou cortada. Tire outra foto deixando um espaço acima da cabeça.",
  headUnsure: "Não conseguimos confirmar se a cabeça aparece inteira. Tente outra foto com um pouco de espaço acima da cabeça.",
  headAdvice: "Foto aceita. A cabeça está bem perto da borda de cima; numa próxima foto, deixe um pouco mais de espaço.",
} as const

/** Strictly inside the image: points inferred beyond the border are never visible body. */
function inFrame(p: Landmark): boolean { return p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1 }
/** Clearly visible: confident AND inside the image (points inferred off-frame never count as visible body). */
const seen = (p: Landmark | undefined): boolean => !!p && p[3] >= POSE_THRESHOLDS.visible && p[4] >= POSE_THRESHOLDS.visible && inFrame(p)
const doubtful = (p: Landmark | undefined): boolean => !!p && !seen(p) && inFrame(p) && Math.min(p[3], p[4]) >= POSE_THRESHOLDS.uncertain

function yawOf(world: [number, number, number][], a: number, b: number): number | null {
  const p = world[a], q = world[b]
  if (!p || !q) return null
  return (Math.atan2(Math.abs(p[2] - q[2]), Math.abs(p[0] - q[0])) * 180) / Math.PI
}

export function classifyYaw(yaw: number | null): PhotoAngle | null {
  if (yaw === null) return null
  const t = POSE_THRESHOLDS
  if (yaw <= t.frontMaxYaw) return "front"
  if (yaw >= t.sideMinYaw && yaw <= t.sideMaxYaw) return "side"
  if (yaw >= t.profileMinYaw) return "profile"
  return null
}

export function evaluatePose(a: PoseAnalysis, requested: PhotoAngle): PhotoValidation {
  const version = `${a.analyzer}+${POSE_RULES_VERSION}`
  const issues: PhotoIssue[] = []
  let hard = false, unsure = false
  const add = (code: string, message: string, kind: "hard" | "unsure" | "advice") => {
    issues.push(kind === "advice" ? { code, message, level: "advice" } : { code, message })
    if (kind === "hard") hard = true
    else if (kind === "unsure") unsure = true
  }
  const dark = a.quality.p95Luma < POSE_THRESHOLDS.darkP95
  const blurry = a.quality.sharpness < POSE_THRESHOLDS.blurSharpness

  const counted = a.poses.map((p) => ({ p, n: p.landmarks.filter(seen).length })).filter((x) => x.n >= POSE_THRESHOLDS.personMinPoints)
  const base = { version, requestedAngle: requested, persons: counted.length }
  if (counted.length === 0) {
    if (dark) add("dark", MSG.dark, "hard")
    if (blurry) add("blurry", MSG.blurryOrEmpty, "hard")
    // A pose found with too few clear points is doubt, not proof that there is no person.
    if (!dark && !blurry) a.poses.length > 0 ? add("low_confidence", MSG.lowConfidence, "unsure") : add("no_person", MSG.noPerson, "hard")
    return { ...base, status: hard ? "needs_adjustment" : "inconclusive", framing: "none", supports: { upper: false, lower: false, dress: false }, measuredAngle: null, yawDeg: null, issues }
  }
  if (counted.length > 1) add("multiple_people", MSG.multiple, "hard")

  const main = counted.sort((x, y) => y.n - x.n)[0]!.p
  const L = main.landmarks
  const any = (idx: number[]) => idx.some((i) => seen(L[i]))
  const maybe = (idx: number[]) => !any(idx) && idx.some((i) => doubtful(L[i]))
  const head = any(HEAD), shoulders = any(SHOULDERS), hips = any(HIPS), knees = any(KNEES)
  const ys = (idx: number[]) => idx.filter((i) => seen(L[i])).map((i) => L[i]![1])
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
  const torso = shoulders && hips ? mean(ys(HIPS)) - mean(ys(SHOULDERS)) : NaN
  // Knee clearly below the hip (fraction of torso); NaN when not measurable.
  const kneeDrop = knees && torso > 0 ? (mean(ys(KNEES)) - mean(ys(HIPS))) / torso : NaN
  const ankleDrop = knees && torso > 0 && any(ANKLES) ? (Math.max(...ys(ANKLES)) - Math.max(...ys(KNEES))) / torso : NaN
  const ankles = any(ANKLES) && ankleDrop >= POSE_THRESHOLDS.ankleBelowKneeMin
  const framing: PhotoFraming = head && shoulders && hips && knees && ankles ? "full_body" : head && shoulders && hips && knees ? "to_knees" : "partial"
  // Standing posture (seated people / hallucinated legs behind a table).
  if (framing !== "partial" && !Number.isNaN(kneeDrop)) {
    if (kneeDrop < POSE_THRESHOLDS.seatedKneeMax) add("not_standing", MSG.notStanding, "hard")
    else if (kneeDrop < POSE_THRESHOLDS.standingKneeMin) add("posture_unconfirmed", MSG.postureUnsure, "unsure")
  }
  // Head margin (v4). The person mask (hair included) is the evidence; the landmark estimate is only a
  // fallback and a cross-check, never enough to claim a cut on its own (except a face at the very top).
  if (head && shoulders) {
    const anchor = Math.min(...ys(HEAD))
    const estimate = anchor - 0.5 * (mean(ys(SHOULDERS)) - anchor)
    const t = POSE_THRESHOLDS
    const mask = main.head && typeof main.head.topTouch === "number" ? main.head : null
    if (mask) {
      if (mask.topTouch >= t.headTouchCut) add("head_cut", MSG.headCut, "hard")
      else if (estimate < t.headConflict) add("head_unconfirmed", MSG.headUnsure, "unsure")
      else if (mask.maskTop === null) add("head_unconfirmed", MSG.headUnsure, "unsure")
      else if (mask.maskTop < t.headAdvice) add("head_margin_small", MSG.headAdvice, "advice")
    } else if (anchor < t.faceAtTop) add("head_cut", MSG.headCut, "hard")
    else if (estimate < t.headTopUnsure) add("head_unconfirmed", MSG.headUnsure, "unsure")
  }
  if (framing === "partial") {
    if ([HIPS, KNEES].some(maybe) && head && shoulders) add("low_confidence", MSG.lowConfidence, "unsure")
    else if (!head && hips && knees) add("head_missing", MSG.head, "hard")
    else add("too_close", MSG.tooClose, "hard")
  }

  const sy = yawOf(main.world, 11, 12), hy = yawOf(main.world, 23, 24)
  const yaw = sy !== null && hy !== null ? (sy + hy) / 2 : sy ?? hy
  let measured = classifyYaw(yaw)
  if (sy !== null && hy !== null && Math.abs(sy - hy) > POSE_THRESHOLDS.maxTwist) measured = null
  if (measured === null) add("angle_unconfirmed", MSG.unsure, "unsure")
  else if (measured !== requested) add("wrong_angle", MSG.turn(requested), "hard")

  if (dark) add("dark", MSG.dark, "hard")
  if (blurry) add("blurry", MSG.blurry, "hard")

  const status: PhotoValidationStatus = hard ? "needs_adjustment" : unsure ? "inconclusive" : "approved"
  const ok = status === "approved"
  return {
    ...base, status, framing,
    // Fail closed: only an approved photo can serve any garment group.
    supports: { upper: ok && framing !== "partial", lower: ok && framing === "full_body", dress: ok && framing === "full_body" },
    measuredAngle: measured, yawDeg: yaw === null ? null : Math.round(yaw), issues,
  }
}

/** Analyzer unavailable/failed: a technical error, never a verdict on the photo. */
export function analyzerFailure(requested: PhotoAngle, version = `unavailable+${POSE_RULES_VERSION}`): PhotoValidation {
  return {
    status: "error", version, framing: "none", supports: { upper: false, lower: false, dress: false },
    requestedAngle: requested, measuredAngle: null, yawDeg: null, persons: 0,
    issues: [{ code: "validator_unavailable", message: "Não foi possível validar agora (falha técnica do validador, não da sua foto). Tente de novo em instantes." }],
  }
}

/** Garment group the provider renders for a catalog category (same map as the worker). */
export const CATEGORY_GROUP: Record<string, "upper" | "lower" | "dress"> = {
  tops: "upper", jackets: "upper", shirts: "upper", bottoms: "lower", pants: "lower", dresses: "dress",
}
