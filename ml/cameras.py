# ============================================================================
# SAMARITAN SHIELD — Camera workers
#
# One thread per camera: decode, track, score, annotate. The newest annotated
# frame is published under a lock for the MJPEG endpoint to serve; the HTTP
# layer never touches the VideoCapture itself.
# ============================================================================

from __future__ import annotations

import base64
import logging
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import numpy as np

from accident.classifier import AccidentClassifier
from accident.pipeline import DetectionPipeline
from accident.tracker import VEHICLE_CLASSES, VehicleTracker
from bridge import bridge
from config import settings

log = logging.getLogger("samaritan.camera")

STREAM_PREFIXES = ("rtsp://", "http://", "https://")


@dataclass
class CameraSpec:
    camera_id: str
    name: str
    source: str
    lat: float
    lng: float
    zone: str
    approach: Optional[str] = None
    signal_id: Optional[str] = None

    @property
    def is_stream(self) -> bool:
        return self.source.startswith(STREAM_PREFIXES)

    def resolve(self) -> str:
        """A stream URL is used as-is; anything else resolves under data/videos."""
        if self.is_stream:
            return self.source
        p = Path(self.source)
        return str(p if p.is_absolute() else settings.video_dir / p)


class CameraWorker(threading.Thread):
    def __init__(self, spec: CameraSpec, classifier: AccidentClassifier) -> None:
        super().__init__(name=f"cam-{spec.camera_id}", daemon=True)
        self.spec = spec
        self.stop_event = threading.Event()

        self._tracker = VehicleTracker(settings.yolo_model, settings.yolo_conf, settings.yolo_imgsz)
        self._pipeline = DetectionPipeline(spec.camera_id, classifier)

        self._frame_lock = threading.Lock()
        self._latest_jpeg: Optional[bytes] = None

        self.status = "OFFLINE"
        self.fps = 0.0
        self.last_error: Optional[str] = None
        self.counts: Dict[str, int] = {name: 0 for name in VEHICLE_CLASSES.values()}

    # --- published state -----------------------------------------------------
    def latest_jpeg(self) -> Optional[bytes]:
        with self._frame_lock:
            return self._latest_jpeg

    def snapshot(self) -> Dict[str, object]:
        return {
            "cameraId": self.spec.camera_id,
            "name": self.spec.name,
            "zone": self.spec.zone,
            "status": self.status,
            "fps": round(self.fps, 1),
            "source": self.spec.source,
            "isStream": self.spec.is_stream,
            "location": {"lat": self.spec.lat, "lng": self.spec.lng},
            "signalId": self.spec.signal_id,
            "approach": self.spec.approach,
            "stage1": round(self._pipeline.last_stage1.score, 3),
            "fused": round(self._pipeline.last_fused, 3),
            "counts": dict(self.counts),
            "lastError": self.last_error,
        }

    # --- main loop -----------------------------------------------------------
    def run(self) -> None:
        resolved = self.spec.resolve()

        if not self.spec.is_stream and not Path(resolved).exists():
            self.status = "OFFLINE"
            self.last_error = f"video file not found: {resolved}"
            log.error("[%s] %s", self.spec.camera_id, self.last_error)
            return

        cap = cv2.VideoCapture(resolved)
        if not cap.isOpened():
            self.status = "OFFLINE"
            self.last_error = f"could not open source: {resolved}"
            log.error("[%s] %s", self.spec.camera_id, self.last_error)
            return

        self.status = "ONLINE"
        log.info("[%s] online — %s", self.spec.camera_id, resolved)

        frame_interval = 1.0 / max(settings.target_fps, 1.0)
        frame_no = 0
        last_heartbeat = 0.0
        fps_window_start = time.monotonic()
        fps_frames = 0

        try:
            while not self.stop_event.is_set():
                tick = time.monotonic()
                ok, frame = cap.read()

                if not ok:
                    if self.spec.is_stream:
                        # A dropped stream is worth reporting and retrying.
                        self.status = "DEGRADED"
                        time.sleep(1.0)
                        cap.release()
                        cap = cv2.VideoCapture(resolved)
                        continue
                    # A file has simply ended. The reference implementation
                    # breaks here and the process stops detecting forever; a
                    # camera that stops after one playthrough is not a camera.
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue

                frame_no += 1
                fps_frames += 1

                if frame_no % settings.infer_every_n == 0:
                    tracks = self._tracker.update(frame)
                    self.counts = self._tracker.vehicle_counts()
                    event = self._pipeline.process(tracks, frame)
                    annotated = self._annotate(frame, tracks)
                    if event is not None:
                        self._report(event, annotated)
                else:
                    annotated = self._annotate(frame, [])

                self._publish(annotated)

                now = time.monotonic()
                if now - fps_window_start >= 1.0:
                    self.fps = fps_frames / (now - fps_window_start)
                    fps_window_start, fps_frames = now, 0

                if now - last_heartbeat >= settings.heartbeat_seconds:
                    last_heartbeat = now
                    bridge.post(
                        "/api/ml/heartbeat",
                        {"cameraId": self.spec.camera_id, "status": self.status, "fps": round(self.fps, 1)},
                    )
                    if self.spec.signal_id:
                        total = sum(self.counts.values())
                        bridge.post(
                            "/api/ml/traffic",
                            {
                                "cameraId": self.spec.camera_id,
                                "counts": dict(self.counts),
                                "total": total,
                                "observedAt": _now_iso(),
                            },
                        )

                elapsed = time.monotonic() - tick
                if elapsed < frame_interval:
                    time.sleep(frame_interval - elapsed)
        finally:
            cap.release()
            self.status = "OFFLINE"
            log.info("[%s] stopped", self.spec.camera_id)

    # --- helpers -------------------------------------------------------------
    def _publish(self, frame: np.ndarray) -> None:
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), settings.jpeg_quality])
        if ok:
            with self._frame_lock:
                self._latest_jpeg = buf.tobytes()

    def _annotate(self, frame: np.ndarray, tracks: List) -> np.ndarray:
        out = frame.copy()
        for t in tracks:
            box = t.bbox()
            if box is None:
                continue
            x1, y1, x2, y2 = (int(v) for v in box)
            colour = (0, 200, 255) if t.is_vehicle else (200, 200, 200)
            cv2.rectangle(out, (x1, y1), (x2, y2), colour, 2)
            label = VEHICLE_CLASSES.get(t.cls, "person")
            cv2.putText(out, f"{label} {t.track_id}", (x1, max(14, y1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, colour, 1, cv2.LINE_AA)

        score = self._pipeline.last_stage1.score
        bar = (0, 0, 255) if score >= settings.candidate_threshold else (80, 200, 80)
        cv2.rectangle(out, (0, 0), (out.shape[1], 30), (20, 20, 20), -1)
        cv2.putText(out, f"{self.spec.camera_id}  risk {score:.2f}  {self._pipeline.last_stage1.explanation}",
                    (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, bar, 1, cv2.LINE_AA)
        return out

    def _report(self, event, annotated: np.ndarray) -> None:
        ok, buf = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
        snapshot = base64.b64encode(buf.tobytes()).decode("ascii") if ok else ""

        log.warning(
            "[%s] DETECTION stage1=%.2f stage2=%s fused=%.2f (%s)",
            self.spec.camera_id, event.stage1_score,
            f"{event.stage2_score:.2f}" if event.stage2_score is not None else "n/a",
            event.fused_confidence, event.explanation,
        )

        bridge.post(
            "/api/ml/detection",
            {
                "cameraId": self.spec.camera_id,
                "stage1Score": event.stage1_score,
                "stage2Score": event.stage2_score,
                "fusedConfidence": event.fused_confidence,
                "snapshotBase64": snapshot,
                "detectedAt": _now_iso(),
            },
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class CameraManager:
    def __init__(self) -> None:
        self.workers: Dict[str, CameraWorker] = {}
        self.classifier = AccidentClassifier(settings.cnn_model_path, settings.enable_stage2)

    def start(self, specs: List[CameraSpec]) -> None:
        for spec in specs:
            worker = CameraWorker(spec, self.classifier)
            self.workers[spec.camera_id] = worker
            worker.start()

    def stop(self) -> None:
        for worker in self.workers.values():
            worker.stop_event.set()
        for worker in self.workers.values():
            worker.join(timeout=5.0)
        self.workers.clear()

    def get(self, camera_id: str) -> Optional[CameraWorker]:
        return self.workers.get(camera_id)


manager = CameraManager()
