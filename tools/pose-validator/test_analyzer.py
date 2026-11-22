# QA-004: inference on the shared PoseLandmarker never overlaps, and waiting is bounded.
# Run: uv run --python 3.12 --with mediapipe==1.2.3 --with pillow==11.3.0 --with "numpy<2.3" python -m unittest tools/pose-validator/test_analyzer.py
import importlib.util
import io
import threading
import time
import unittest
from pathlib import Path

from PIL import Image

spec = importlib.util.spec_from_file_location("analyzer", Path(__file__).with_name("analyzer.py"))
analyzer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(analyzer)


class FakeResult:
    pose_landmarks = []
    pose_world_landmarks = []


class OverlapDetector:
    """Stub landmarker: records how many detect() calls run at the same time."""
    def __init__(self, delay):
        self.delay, self.active, self.max_active, self.calls = delay, 0, 0, 0
        self.guard = threading.Lock()

    def detect(self, _image):
        with self.guard:
            self.active += 1
            self.calls += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(self.delay)
        with self.guard:
            self.active -= 1
        return FakeResult()


def png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (64, 96), (120, 120, 120)).save(buf, format="PNG")
    return buf.getvalue()


class InferenceLockTest(unittest.TestCase):
    def setUp(self):
        self.saved = (analyzer._landmarker, analyzer.INFER_WAIT_S)

    def tearDown(self):
        analyzer._landmarker, analyzer.INFER_WAIT_S = self.saved

    def test_concurrent_requests_never_overlap_in_detect(self):
        stub = OverlapDetector(delay=0.05)
        analyzer._landmarker = stub
        data = png_bytes()
        errors = []
        def run():
            try:
                analyzer.analyze(data)
            except Exception as e:  # pragma: no cover - reported below
                errors.append(e)
        threads = [threading.Thread(target=run) for _ in range(8)]
        t0 = time.perf_counter()
        for t in threads: t.start()
        for t in threads: t.join()
        elapsed = time.perf_counter() - t0
        self.assertEqual(errors, [])
        self.assertEqual(stub.calls, 8)
        self.assertEqual(stub.max_active, 1, "detect() ran concurrently on the shared instance")
        print(f"8 concurrent requests, serialized: {elapsed:.2f}s total")

    def test_waiting_is_bounded(self):
        stub = OverlapDetector(delay=0.5)
        analyzer._landmarker = stub
        analyzer.INFER_WAIT_S = 0.1
        data = png_bytes()
        results = []
        def run():
            try:
                analyzer.analyze(data); results.append("ok")
            except analyzer.AnalyzerBusy:
                results.append("busy")
        threads = [threading.Thread(target=run) for _ in range(3)]
        for t in threads: t.start()
        for t in threads: t.join()
        self.assertEqual(sorted(results), ["busy", "busy", "ok"])


if __name__ == "__main__":
    unittest.main()


class NormalizeTest(unittest.TestCase):
    def test_exif_orientation_applied_once_and_metadata_dropped(self):
        upright = Image.new("RGB", (60, 100), (200, 30, 30))
        upright.paste((30, 30, 200), (0, 0, 60, 20))  # blue band at the TOP when upright
        stored = upright.rotate(90, expand=True)       # pixels sideways, as a phone stores them
        exif = Image.Exif(); exif[0x0112] = 6          # "rotate 90 CW to display"
        buf = io.BytesIO(); stored.save(buf, format="JPEG", exif=exif.tobytes(), quality=95)
        out = Image.open(io.BytesIO(analyzer.normalize(buf.getvalue())))
        self.assertEqual(out.size, (60, 100))
        self.assertEqual(out.getexif().get(0x0112), None)
        r, g, b = out.convert("RGB").getpixel((30, 5))
        self.assertGreater(b, r, "orientation not applied (blue band should be on top)")
        # Already upright input (e.g. normalized by the browser) is not rotated again.
        plain = io.BytesIO(); upright.save(plain, format="JPEG", quality=95)
        self.assertEqual(Image.open(io.BytesIO(analyzer.normalize(plain.getvalue()))).size, (60, 100))

    def test_pixel_limit(self):
        huge = io.BytesIO(); Image.new("L", (6000, 4100)).save(huge, format="PNG")
        with self.assertRaises((ValueError, Image.DecompressionBombError)):
            analyzer.normalize(huge.getvalue())
