# ============================================================================
# SAMARITAN SHIELD — Stage 2: CNN confirmation
#
# Optional by design. The service must be fully operational with no trained
# weights on disk, because none are publicly available for this task — the
# repository this topology comes from publishes model.json but withholds
# model_weights.keras.
#
# When the file is absent this reports None and says so once, loudly. It never
# fabricates a score and never loads random weights: a detector that silently
# invents confidence is worse than no detector, because you would trust it.
# ============================================================================

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger("samaritan.stage2")

INPUT_SIZE = (250, 250)

# From the reference model.json. Index 0 is Accident. Getting this backwards
# produces a detector that fires on empty roads and stays silent on crashes,
# so it is asserted at load rather than assumed.
EXPECTED_CLASS_ORDER = ["Accident", "Non Accident"]


class AccidentClassifier:
    def __init__(self, model_path: Path, enabled: bool = True) -> None:
        self.model_path = Path(model_path)
        self.available = False
        self._model = None

        if not enabled:
            log.info("Stage 2 disabled by configuration; running stage 1 only.")
            return

        if not self.model_path.exists():
            log.warning(
                "Stage 2 CNN not found at %s — running stage-1 only. "
                "Detections will report stage2Score=null. "
                "Train one with: python train/train_cnn.py",
                self.model_path,
            )
            return

        try:
            from tensorflow import keras  # imported lazily; ~600 MB dependency

            self._model = keras.models.load_model(self.model_path)
            self._verify_class_order()
            self.available = True
            log.info("Stage 2 CNN loaded from %s", self.model_path)
        except Exception as exc:  # noqa: BLE001 — any failure means no stage 2
            log.error("Stage 2 CNN failed to load (%s); running stage-1 only.", exc)
            self._model = None

    def _verify_class_order(self) -> None:
        meta_path = self.model_path.with_suffix(".meta.json")
        if not meta_path.exists():
            log.warning(
                "No %s beside the weights — cannot verify class order. "
                "Index 0 must be 'Accident'.",
                meta_path.name,
            )
            return
        meta = json.loads(meta_path.read_text())
        order = meta.get("class_names")
        if order and order[0] != EXPECTED_CLASS_ORDER[0]:
            raise ValueError(
                f"Class order {order} puts '{order[0]}' at index 0; "
                f"expected '{EXPECTED_CLASS_ORDER[0]}'. Refusing to load."
            )

    def predict(self, frame_bgr: np.ndarray) -> Optional[float]:
        """
        Probability that this frame shows an accident, or None when no model
        is loaded. Preprocessing must mirror training exactly.
        """
        if not self.available or self._model is None:
            return None

        try:
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            resized = cv2.resize(rgb, INPUT_SIZE, interpolation=cv2.INTER_AREA)
            batch = np.expand_dims(resized.astype("float32"), axis=0)
            preds = self._model.predict(batch, verbose=0)
            return float(preds[0][0])  # index 0 == Accident
        except Exception as exc:  # noqa: BLE001
            log.error("Stage 2 inference failed: %s", exc)
            return None
