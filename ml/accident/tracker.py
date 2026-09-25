# ============================================================================
# SAMARITAN SHIELD — YOLOv8 detection + multi-object tracking
#
# Produces per-track kinematics (speed, acceleration, heading change, shape
# change) that stage-1 heuristics reason over. Detection alone cannot tell a
# crash from traffic; the motion history is where the signal lives.
# ============================================================================

from __future__ import annotations

import math
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import numpy as np

# COCO ids. The reference implementation filters on class 2 alone — cars — and
# so is blind to the motorcycles, autos, buses and trucks that make up most of
# the traffic this is meant to watch.
VEHICLE_CLASSES: Dict[int, str] = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}
PERSON_CLASS = 0
TRACKED_CLASSES: List[int] = [PERSON_CLASS, *VEHICLE_CLASSES.keys()]

HISTORY_LEN = 45


@dataclass
class Sample:
    t: float
    cx: float
    cy: float
    w: float
    h: float


@dataclass
class Track:
    track_id: int
    cls: int
    history: deque = field(default_factory=lambda: deque(maxlen=HISTORY_LEN))
    last_seen: float = 0.0

    @property
    def is_vehicle(self) -> bool:
        return self.cls in VEHICLE_CLASSES

    @property
    def latest(self) -> Optional[Sample]:
        return self.history[-1] if self.history else None

    def bbox(self) -> Optional[Tuple[float, float, float, float]]:
        """(x1, y1, x2, y2) of the most recent observation."""
        s = self.latest
        if s is None:
            return None
        return (s.cx - s.w / 2, s.cy - s.h / 2, s.cx + s.w / 2, s.cy + s.h / 2)

    def _window(self, seconds: float) -> List[Sample]:
        if not self.history:
            return []
        cutoff = self.history[-1].t - seconds
        return [s for s in self.history if s.t >= cutoff]

    def normalised_speed(self, seconds: float = 0.25) -> float:
        """
        Centroid speed in bounding-box-heights per second.

        Normalising by box height is what lets one set of thresholds work
        across cameras at different zoom levels and mounting heights. Raw pixel
        speed would have to be retuned per camera, which in practice means it
        never gets tuned at all.
        """
        win = self._window(seconds)
        if len(win) < 2:
            return 0.0
        a, b = win[0], win[-1]
        dt = b.t - a.t
        if dt <= 1e-6:
            return 0.0
        dist = math.hypot(b.cx - a.cx, b.cy - a.cy)
        scale = max(b.h, 1.0)
        return (dist / scale) / dt

    def speed_drop_ratio(self, window_s: float) -> float:
        """Fraction of speed lost across the window, 0..1."""
        win = self._window(window_s)
        if len(win) < 4:
            return 0.0
        mid = len(win) // 2
        before = _segment_speed(win[:mid + 1])
        after = _segment_speed(win[mid:])
        if before <= 1e-6:
            return 0.0
        return max(0.0, (before - after) / before)

    def aspect_ratio_delta(self, window_s: float) -> float:
        """Fractional change in w/h, a proxy for a vehicle rolling or spinning."""
        win = self._window(window_s)
        if len(win) < 3:
            return 0.0
        first = win[0].w / max(win[0].h, 1.0)
        last = win[-1].w / max(win[-1].h, 1.0)
        if first <= 1e-6:
            return 0.0
        return abs(last - first) / first

    def stationary_seconds(self, moving_threshold: float) -> float:
        """How long this track has been below the moving threshold."""
        if len(self.history) < 3:
            return 0.0
        elapsed = 0.0
        for i in range(len(self.history) - 1, 0, -1):
            seg = [self.history[i - 1], self.history[i]]
            if _segment_speed(seg) > moving_threshold:
                break
            elapsed = self.history[-1].t - self.history[i - 1].t
        return elapsed

    def was_moving(self, moving_threshold: float, lookback_s: float = 4.0) -> bool:
        win = self._window(lookback_s)
        if len(win) < 4:
            return False
        half = len(win) // 2
        return _segment_speed(win[:half + 1]) > moving_threshold


def _segment_speed(samples: List[Sample]) -> float:
    if len(samples) < 2:
        return 0.0
    a, b = samples[0], samples[-1]
    dt = b.t - a.t
    if dt <= 1e-6:
        return 0.0
    return (math.hypot(b.cx - a.cx, b.cy - a.cy) / max(b.h, 1.0)) / dt


def iou(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


class VehicleTracker:
    """
    One tracker per camera.

    Ultralytics stores tracker state on the model object when persist=True, so
    a shared YOLO instance would braid the track ids of every camera together.
    Each worker gets its own; yolov8n weights are ~6 MB, which is a cheap price
    for correctness.
    """

    def __init__(self, model_name: str, conf: float, imgsz: int) -> None:
        from ultralytics import YOLO  # imported lazily: ~3s of torch startup

        self.model = YOLO(model_name)
        self.conf = conf
        self.imgsz = imgsz
        self.tracks: Dict[int, Track] = {}

    def update(self, frame: np.ndarray, now: Optional[float] = None) -> List[Track]:
        """
        Run detection+tracking on one frame and return the live tracks.

        `now` is the timestamp to record against this frame, and the caller owns
        it deliberately. Live workers pass the wall clock; offline analysis
        passes video time (frame_no / fps). Reading the wall clock here instead
        would make every temporal signal collapse to zero whenever processing
        runs slower than playback, which on CPU is always.
        """
        if now is None:
            now = time.monotonic()

        results = self.model.track(
            frame,
            persist=True,
            tracker="bytetrack.yaml",
            classes=TRACKED_CLASSES,
            conf=self.conf,
            imgsz=self.imgsz,
            verbose=False,
        )

        if not results:
            return self._reap(now)

        boxes = results[0].boxes
        if boxes is None or boxes.id is None:
            return self._reap(now)

        ids = boxes.id.int().cpu().tolist()
        clss = boxes.cls.int().cpu().tolist()
        xywh = boxes.xywh.cpu().numpy()

        for track_id, cls, (cx, cy, w, h) in zip(ids, clss, xywh):
            track = self.tracks.get(track_id)
            if track is None:
                track = Track(track_id=track_id, cls=int(cls))
                self.tracks[track_id] = track
            track.cls = int(cls)
            track.last_seen = now
            track.history.append(Sample(t=now, cx=float(cx), cy=float(cy), w=float(w), h=float(h)))

        return self._reap(now)

    def _reap(self, now: float, ttl: float = 5.0) -> List[Track]:
        stale = [tid for tid, t in self.tracks.items() if now - t.last_seen > ttl]
        for tid in stale:
            del self.tracks[tid]
        return list(self.tracks.values())

    def vehicle_counts(self) -> Dict[str, int]:
        counts = {name: 0 for name in VEHICLE_CLASSES.values()}
        for track in self.tracks.values():
            name = VEHICLE_CLASSES.get(track.cls)
            if name:
                counts[name] += 1
        return counts
