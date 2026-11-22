# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["mediapipe==1.2.3", "pillow==11.3.0", "numpy<2.3"]
# ///
"""
Local body-photo analyzer for StylAI (no paid API, no network after the model download).

It only MEASURES: MediaPipe Pose Landmarker (IMAGE mode, up to 3 poses) + image quality
(mean luminance, Laplacian sharpness). The decision rules live in TypeScript
(packages/contracts/src/photo-validation.ts) so the API and the browser demo apply the same rules.

  uv run tools/pose-validator/analyzer.py serve [port]      -> loopback HTTP service (default 54391)
      POST /v1/analyze  (body = image bytes, JPEG/PNG/WebP)  -> JSON measurements
      GET  /health
  uv run tools/pose-validator/analyzer.py file <image>...   -> JSON measurements per file (evaluation)

Model: pose_landmarker_full.task (Apache-2.0, litert-community/MediaPipe-PoseLandmarker-Full),
downloaded once to .cache/models/. Images are processed in memory and never written or logged.
"""
from __future__ import annotations

import io
import json
import os
import sys
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import mediapipe as mp
import numpy as np
from PIL import Image, ImageOps

MODEL_URL = "https://huggingface.co/litert-community/MediaPipe-PoseLandmarker-Full/resolve/main/pose_landmarker_full.task"
MODEL_BYTES = 9398198
ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = Path(os.environ.get("STYLAI_POSE_MODEL", ROOT / ".cache" / "models" / "pose_landmarker_full.task"))
# a2: also measures the head against the top border with the person segmentation mask (hair included).
ANALYZER_VERSION = "mp-pose-full-1.2.3/a2"
MAX_BYTES = 12 * 1024 * 1024
MAX_SIDE = 1600  # downscale before analysis (the landmarker itself runs at 256 px)
MAX_PIXELS = 24_000_000  # same limit as the API (packages/ai imageLimits.maxPixels)
Image.MAX_IMAGE_PIXELS = MAX_PIXELS  # decompression-bomb guard


def ensure_model() -> Path:
    if MODEL_PATH.exists() and MODEL_PATH.stat().st_size == MODEL_BYTES:
        return MODEL_PATH
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = MODEL_PATH.with_suffix(".part")
    urllib.request.urlretrieve(MODEL_URL, tmp)
    if tmp.stat().st_size != MODEL_BYTES:
        tmp.unlink(missing_ok=True)
        raise RuntimeError("model download size mismatch")
    tmp.replace(MODEL_PATH)
    return MODEL_PATH


_lock = threading.Lock()          # guards lazy creation only
_landmarker = None
# One PoseLandmarker instance is shared; MediaPipe does not document concurrent detect() on one
# instance as safe, so inference is serialized with a SEPARATE lock (never nested with _lock).
# Waiting is bounded: when busy longer than INFER_WAIT_S the request fails fast (503) and the API
# records a technical "could not validate" with retry, instead of an unbounded queue.
_infer_lock = threading.Lock()
INFER_WAIT_S = float(os.environ.get("STYLAI_POSE_INFER_WAIT_S", "8"))


class AnalyzerBusy(RuntimeError):
    pass


def landmarker():
    global _landmarker
    with _lock:
        if _landmarker is None:
            opts = mp.tasks.vision.PoseLandmarkerOptions(
                base_options=mp.tasks.BaseOptions(model_asset_path=str(ensure_model())),
                running_mode=mp.tasks.vision.RunningMode.IMAGE,
                num_poses=3,
                min_pose_detection_confidence=0.5,
                min_pose_presence_confidence=0.5,
                output_segmentation_masks=True,
            )
            _landmarker = mp.tasks.vision.PoseLandmarker.create_from_options(opts)
        return _landmarker


def quality(gray: np.ndarray) -> dict:
    """Mean luminance (0-255) and variance of the 4-neighbour Laplacian at a 512 px height."""
    h, w = gray.shape
    scale = 512 / h
    img = Image.fromarray(gray.astype(np.uint8)).resize((max(1, round(w * scale)), 512), Image.BILINEAR)
    g = np.asarray(img, dtype=np.float32)
    lap = -4 * g[1:-1, 1:-1] + g[:-2, 1:-1] + g[2:, 1:-1] + g[1:-1, :-2] + g[1:-1, 2:]
    return {
        "meanLuma": round(float(gray.mean()), 2),
        "p5Luma": round(float(np.percentile(gray, 5)), 2),
        "p95Luma": round(float(np.percentile(gray, 95)), 2),
        "sharpness": round(float(lap.var()), 2),
    }


HEAD_POINTS = (0, 2, 5, 7, 8)  # nose, eyes, ears


def head_margin(landmarks, mask) -> dict | None:
    """Person-mask evidence above the head, in a column band around the visible head landmarks.
    maskTop: first row with person pixels in the band (fraction of height); topTouch: share of band
    columns with person pixels in the top rows (hair/head crossing the border = cut)."""
    if mask is None:
        return None
    m = mask.numpy_view()
    m = m[..., 0] if m.ndim == 3 else m
    h, w = m.shape
    head = [landmarks[i] for i in HEAD_POINTS if (landmarks[i].visibility or 0) >= 0.5 and 0 <= landmarks[i].x <= 1]
    if not head:
        return None
    xs = [p.x for p in head]
    shoulders = abs(landmarks[11].x - landmarks[12].x)
    span = max(shoulders, max(xs) - min(xs), 0.04)
    x0, x1 = max(0, int((min(xs) - 0.6 * span) * w)), min(w, int((max(xs) + 0.6 * span) * w) + 1)
    if x1 - x0 < 2:
        return None
    band = m[:, x0:x1] > 0.5
    rows = np.where(band.any(axis=1))[0]
    top_rows = max(2, int(0.006 * h))
    return {
        "maskTop": round(float(rows[0] / h), 4) if len(rows) else None,
        "topTouch": round(float(band[:top_rows].any(axis=0).mean()), 3),
    }


def analyze(data: bytes) -> dict:
    if len(data) > MAX_BYTES:
        raise ValueError("too_large")
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img).convert("RGB")  # orientation applied, metadata dropped
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE))
    rgb = np.ascontiguousarray(np.asarray(img))
    gray = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])
    model = landmarker()  # created (once) outside the inference lock
    if not _infer_lock.acquire(timeout=INFER_WAIT_S):
        raise AnalyzerBusy("busy")
    try:
        result = model.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    finally:
        _infer_lock.release()
    poses = []
    masks = getattr(result, "segmentation_masks", None) or []
    for i, lms in enumerate(result.pose_landmarks):
        world = result.pose_world_landmarks[i] if i < len(result.pose_world_landmarks) else []
        try:
            head = head_margin(lms, masks[i] if i < len(masks) else None)
        except Exception:  # mask evidence is optional; rules fall back to "could not confirm"
            head = None
        poses.append({
            "head": head,
            "landmarks": [[round(p.x, 4), round(p.y, 4), round(p.z, 4), round(p.visibility or 0, 3), round(p.presence or 0, 3)] for p in lms],
            "world": [[round(p.x, 4), round(p.y, 4), round(p.z, 4)] for p in world],
        })
    return {"analyzer": ANALYZER_VERSION, "width": img.width, "height": img.height, "poses": poses, "quality": quality(gray)}


def normalize(data: bytes) -> bytes:
    """QA-006: apply the EXIF orientation ONCE and re-encode without any metadata (JPEG q92).
    The API calls this only for files whose EXIF says they are rotated; the result is what gets
    stored, hashed and analyzed."""
    if len(data) > MAX_BYTES:
        raise ValueError("too_large")
    img = Image.open(io.BytesIO(data))
    if img.width * img.height > MAX_PIXELS:
        raise ValueError("too_many_pixels")
    img = ImageOps.exif_transpose(img).convert("RGB")
    out = io.BytesIO()
    img.save(out, format="JPEG", quality=92, optimize=True)  # no exif/icc passed: metadata dropped
    return out.getvalue()


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            return self._send(200, {"status": "ok", "analyzer": ANALYZER_VERSION, "modelReady": MODEL_PATH.exists()})
        self._send(404, {"error": "not_found"})

    def do_POST(self):  # noqa: N802
        if self.path not in ("/v1/analyze", "/v1/normalize"):
            return self._send(404, {"error": "not_found"})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0 or length > MAX_BYTES:
            return self._send(413, {"error": "too_large"})
        data = self.rfile.read(length)
        if self.path == "/v1/normalize":
            try:
                body = normalize(data)
            except (OSError, ValueError, Image.DecompressionBombError):
                return self._send(422, {"error": "unreadable_image"})
            self.send_response(200)
            self.send_header("content-type", "image/jpeg")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            return self._send(200, analyze(data))
        except AnalyzerBusy:
            return self._send(503, {"error": "busy"})
        except (OSError, ValueError):
            return self._send(422, {"error": "unreadable_image"})
        except Exception:  # model/runtime failure: a technical error, never a verdict on the photo
            return self._send(500, {"error": "analyzer_failed"})

    def log_message(self, *args):  # never log request lines (no image data or user hints)
        return


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    if cmd == "file":
        out = {}
        for f in sys.argv[2:]:
            try:
                out[f] = analyze(Path(f).read_bytes())
            except Exception as e:  # evaluation output only
                out[f] = {"error": type(e).__name__}
        print(json.dumps(out))
        return
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 54391
    landmarker()  # load (and download) before accepting requests
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"pose analyzer ready on 127.0.0.1:{port} ({ANALYZER_VERSION})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
