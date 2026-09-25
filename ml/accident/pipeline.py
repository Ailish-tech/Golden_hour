# ============================================================================
# SAMARITAN SHIELD — Detection pipeline
#
# Fuses stage 1 and stage 2, debounces, and decides when a camera has actually
# seen something. One pipeline instance per camera; it holds per-camera state.
# ============================================================================

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass
from typing import List, Optional

import numpy as np

from config import settings

from .classifier import AccidentClassifier
from .heuristics import Stage1Result, score_frame
from .tracker import Track


@dataclass
class DetectionEvent:
    camera_id: str
    stage1_score: float
    stage2_score: Optional[float]
    fused_confidence: float
    explanation: str
    frame: np.ndarray


def fuse(stage1: float, stage2: Optional[float]) -> float:
    """
    Combine the two stages.

    With no CNN the stage-1 score is capped at 0.85. That is deliberately just
    above the 0.80 auto-escalation bar, so an unambiguous collision still
    dispatches before the model is trained, while anything less than
    unambiguous lands in the operator-confirmation band instead.
    """
    if stage2 is None:
        return round(min(1.0, stage1 * settings.stage1_fuse_scale), 4)
    return round(min(1.0, 0.45 * stage1 + 0.55 * stage2), 4)


class DetectionPipeline:
    def __init__(self, camera_id: str, classifier: AccidentClassifier) -> None:
        self.camera_id = camera_id
        self.classifier = classifier
        self.window: deque[bool] = deque(maxlen=settings.debounce_window)
        self.last_stage1 = Stage1Result(score=0.0)
        self.last_fused = 0.0
        self.risk = 0.0
        self._emitted_at = 0.0

    def process(
        self, tracks: List[Track], frame: np.ndarray, now: Optional[float] = None
    ) -> Optional[DetectionEvent]:
        if now is None:
            now = time.monotonic()

        instant = score_frame(tracks)

        # Peak-hold with decay. The instantaneous score is what the frame shows;
        # `risk` is what the scene is currently worth worrying about.
        self.risk = max(instant.score, self.risk * settings.risk_decay)

        # Debounce on the same number the server will see. Using raw stage-1
        # here and fused later dropped the sample crash: 0.631 held across the
        # window, then 0.631 * 0.85 = 0.537 quietly failed the emit check.
        tentative = fuse(self.risk, None)
        above = tentative >= settings.candidate_threshold
        self.window.append(above)

        stage1 = Stage1Result(
            score=self.risk,
            signals=instant.signals,
            involved_track_ids=instant.involved_track_ids,
        )
        self.last_stage1 = stage1

        # Debounce: a lone spiking frame is a tracker glitch. Only once the
        # signal has held across most of a short window is it worth the cost of
        # a CNN inference, let alone an emergency.
        if sum(self.window) < settings.debounce_required:
            self.last_fused = fuse(stage1.score, None)
            return None

        stage2 = self.classifier.predict(frame)
        fused = fuse(stage1.score, stage2)
        self.last_fused = fused

        if fused < settings.candidate_threshold:
            return None

        # Do not re-report the same ongoing event every frame. The server has
        # its own cooldown, but sending it 40 duplicate snapshots a second is
        # rude and wastes the 2 MB body budget.
        if now - self._emitted_at < 5.0:
            return None
        self._emitted_at = now
        self.window.clear()
        self.risk = 0.0

        return DetectionEvent(
            camera_id=self.camera_id,
            stage1_score=round(stage1.score, 4),
            stage2_score=round(stage2, 4) if stage2 is not None else None,
            fused_confidence=fused,
            explanation=stage1.explanation,
            frame=frame,
        )
