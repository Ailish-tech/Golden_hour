# ============================================================================
# SAMARITAN SHIELD — Stage 1: motion heuristics
#
# Scores a frame 0..1 on how much it looks like a collision, using only track
# kinematics. This exists because there are no public pretrained weights for
# accident classification (the repository we took the CNN topology from ships
# architecture but not weights), and a system that needs a training run before
# it detects anything is a system that never gets deployed.
#
# Stage 2 (accident/classifier.py) refines this when trained weights exist.
# ============================================================================

from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from config import settings

from .tracker import PERSON_CLASS, Track, iou


@dataclass
class Stage1Result:
    score: float
    signals: Dict[str, float] = field(default_factory=dict)
    involved_track_ids: List[int] = field(default_factory=list)

    @property
    def explanation(self) -> str:
        top = sorted(self.signals.items(), key=lambda kv: kv[1], reverse=True)
        fired = [f"{k}={v:.2f}" for k, v in top if v > 0.01]
        return ", ".join(fired) if fired else "no signal"


def _converging(a: Track, b: Track, window_s: float) -> bool:
    """True if the two tracks were closing distance over the window."""
    aw = a._window(window_s)
    bw = b._window(window_s)
    if len(aw) < 2 or len(bw) < 2:
        return False
    start = math.hypot(aw[0].cx - bw[0].cx, aw[0].cy - bw[0].cy)
    end = math.hypot(aw[-1].cx - bw[-1].cx, aw[-1].cy - bw[-1].cy)
    return end < start * 0.85


def score_frame(tracks: List[Track]) -> Stage1Result:
    s = settings
    vehicles = [t for t in tracks if t.is_vehicle and len(t.history) >= 4]

    signals: Dict[str, float] = {
        "deceleration": 0.0,
        "overlap": 0.0,
        "orientation": 0.0,
        "stillness": 0.0,
    }
    involved: set[int] = set()

    # --- 1. Sudden deceleration ---------------------------------------------
    # A vehicle that was moving and lost most of its speed inside half a second
    # either hit something or braked hard. On its own it is weak evidence,
    # which is why it carries 0.35 rather than deciding the outcome.
    for t in vehicles:
        if not t.was_moving(s.min_moving_speed):
            continue
        drop = t.speed_drop_ratio(s.decel_window_s)
        if drop >= s.decel_drop_ratio:
            magnitude = min(1.0, (drop - s.decel_drop_ratio) / max(1e-6, 1 - s.decel_drop_ratio))
            scaled = 0.6 + 0.4 * magnitude
            if scaled > signals["deceleration"]:
                signals["deceleration"] = scaled
            involved.add(t.track_id)

    # --- 2. Bounding-box overlap between converging vehicles ----------------
    # Overlap alone fires constantly on dense traffic and on the perspective
    # of one vehicle passing behind another. Requiring that the pair was
    # actively closing distance is what makes it mean something.
    for a, b in itertools.combinations(vehicles, 2):
        ba, bb = a.bbox(), b.bbox()
        if ba is None or bb is None:
            continue
        overlap = iou(ba, bb)
        if overlap < s.overlap_iou:
            continue
        if not _converging(a, b, s.converge_window_s):
            continue
        magnitude = min(1.0, overlap / max(1e-6, s.overlap_iou * 3))
        scaled = 0.5 + 0.5 * magnitude
        if scaled > signals["overlap"]:
            signals["overlap"] = scaled
        involved.update({a.track_id, b.track_id})

    # Vehicle/person overlap after a hard brake is the motorcycle-vs-rider
    # signature of the sample clip (and of most two-wheeler crashes). A person
    # merely standing next to a parked car does not qualify: the vehicle must
    # have been moving and then lost speed.
    people = [t for t in tracks if t.cls == PERSON_CLASS and t.latest]
    for v in vehicles:
        vb = v.bbox()
        if vb is None or not v.was_moving(s.min_moving_speed):
            continue
        if v.speed_drop_ratio(s.decel_window_s) < 0.40 and v.normalised_speed() < 0.6:
            continue
        for p in people:
            pb = p.bbox()
            if pb is None:
                continue
            overlap = iou(vb, pb)
            if overlap < 0.05:
                continue
            scaled = 0.55 + 0.45 * min(1.0, overlap / 0.25)
            if scaled > signals["overlap"]:
                signals["overlap"] = scaled
            involved.update({v.track_id, p.track_id})

    # --- 3. Abnormal orientation change -------------------------------------
    # A vehicle whose width/height ratio swings sharply has rotated relative to
    # the camera: spinning out, rolling, or slewing broadside.
    for t in vehicles:
        delta = t.aspect_ratio_delta(s.orientation_window_s)
        if delta >= s.orientation_delta:
            magnitude = min(1.0, (delta - s.orientation_delta) / max(1e-6, s.orientation_delta))
            scaled = 0.5 + 0.5 * magnitude
            if scaled > signals["orientation"]:
                signals["orientation"] = scaled
            involved.add(t.track_id)

    # --- 4. Post-event stillness --------------------------------------------
    # Wreckage does not drive away. This is the signal that keeps a detection
    # alive through the seconds after impact, when the other three have decayed.
    for t in vehicles:
        if not t.was_moving(s.min_moving_speed):
            continue
        still = t.stationary_seconds(s.min_moving_speed)
        if still >= s.stillness_seconds:
            magnitude = min(1.0, (still - s.stillness_seconds) / s.stillness_seconds)
            scaled = 0.5 + 0.5 * magnitude
            if scaled > signals["stillness"]:
                signals["stillness"] = scaled
            involved.add(t.track_id)

    score = (
        s.w_deceleration * signals["deceleration"]
        + s.w_overlap * signals["overlap"]
        + s.w_orientation * signals["orientation"]
        + s.w_stillness * signals["stillness"]
    )

    return Stage1Result(
        score=max(0.0, min(1.0, score)),
        signals=signals,
        involved_track_ids=sorted(involved),
    )
