// Copies what the demo serves locally (nothing is fetched from a CDN at runtime):
//   - MediaPipe WASM (node_modules/@mediapipe/tasks-vision/wasm) -> demo/public/mediapipe/wasm
//   - Pose Landmarker Full model (Apache-2.0) -> demo/public/mediapipe/pose_landmarker_full.task
//     (reuses <repo>/.cache/models from tools/pose-validator, downloads it once if missing)
//   - test-catalog illustrations (packages/contracts/assets/test-catalog) -> demo/public/test-catalog
// Generated folders are git-ignored. Run automatically by `dev:demo`, `build:demo` and `e2e:demo`.
import { copyFileSync, cpSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../..")
const out = join(here, "public")
const MODEL_URL = "https://huggingface.co/litert-community/MediaPipe-PoseLandmarker-Full/resolve/main/pose_landmarker_full.task"
const MODEL_BYTES = 9398198

const wasm = join(dirname(createRequire(import.meta.url).resolve("@mediapipe/tasks-vision")), "wasm")
mkdirSync(join(out, "mediapipe"), { recursive: true })
cpSync(wasm, join(out, "mediapipe", "wasm"), { recursive: true })

const cached = join(repo, ".cache", "models", "pose_landmarker_full.task")
if (!existsSync(cached) || statSync(cached).size !== MODEL_BYTES) {
  mkdirSync(dirname(cached), { recursive: true })
  const r = await fetch(MODEL_URL)
  if (!r.ok) throw new Error(`model download failed: ${r.status}`)
  const bytes = new Uint8Array(await r.arrayBuffer())
  if (bytes.byteLength !== MODEL_BYTES) throw new Error("model size mismatch")
  writeFileSync(cached, bytes)
}
copyFileSync(cached, join(out, "mediapipe", "pose_landmarker_full.task"))
cpSync(join(repo, "packages/contracts/assets/test-catalog"), join(out, "test-catalog"), { recursive: true })
console.log("demo assets ready: mediapipe wasm + model, test-catalog images")
