# ============================================================================
# SAMARITAN SHIELD — ML service configuration
#
# Every detector threshold lives here rather than in the algorithm, because
# tuning a detector against real footage is an iterative exercise and it must
# not require editing code. See tools/calibrate.py, which sweeps these.
# ============================================================================

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ML_ROOT = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ML_ROOT / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # --- Node backend --------------------------------------------------------
    node_api_base: str = "http://localhost:3000"
    ml_service_token: str = ""

    # --- Capture -------------------------------------------------------------
    # 12 fps decode with inference every 3rd frame gives ~4 inferences/sec per
    # camera, which is enough to catch a collision (they last >1s) and light
    # enough that six cameras stay real-time on a laptop CPU.
    target_fps: float = 12.0
    infer_every_n: int = 3
    heartbeat_seconds: float = 10.0
    video_dir: Path = ML_ROOT / "data" / "videos"

    # --- YOLO ----------------------------------------------------------------
    yolo_model: str = "yolov8n.pt"
    yolo_conf: float = 0.35
    yolo_imgsz: int = 640

    # --- Stage 1 heuristic weights (must sum to 1.0) -------------------------
    # Weighted toward the two impact signals on purpose. Deceleration and
    # overlap observe the collision itself; orientation and stillness describe
    # the aftermath, and a real crash is precisely the event that destroys the
    # track continuity they depend on — the wreck stops looking like a vehicle
    # and the tracker issues fresh ids. Verified against real junction footage:
    # see tools/calibrate.py output in ml/README.md.
    w_deceleration: float = 0.40
    w_overlap: float = 0.35
    w_orientation: float = 0.10
    w_stillness: float = 0.15

    # Risk decays rather than resetting between frames. Impact evidence lasts
    # two or three frames; the emergency lasts minutes. Without this the score
    # is a spike no debounce window can catch.
    #
    # Calibrated on the Soham2212004 test_video (junction motorcycle/car crash
    # at t≈7.8s): 0.96 keeps four inferences above the candidate bar after the
    # peak of 0.63. 0.92 decayed below 0.55 in two steps and the event vanished.
    risk_decay: float = 0.96

    # --- Stage 1 trigger thresholds ------------------------------------------
    # Speeds are normalised by bounding-box height before comparison, so these
    # are unitless and transfer between cameras of different zoom levels.
    decel_drop_ratio: float = 0.65      # fraction of speed lost
    decel_window_s: float = 0.5
    min_moving_speed: float = 0.25      # below this a track is "stopped"
    overlap_iou: float = 0.15
    converge_window_s: float = 1.0
    orientation_delta: float = 0.40     # fractional change in w/h
    orientation_window_s: float = 1.0
    stillness_seconds: float = 3.0

    # --- Debounce ------------------------------------------------------------
    # A single-frame spike is a tracker glitch, not a crash. Requiring a
    # majority of a short window is the main defence against false positives.
    debounce_window: int = 6
    debounce_required: int = 3
    candidate_threshold: float = 0.55

    # When the CNN is absent, stage-1 is scaled by this before it is treated as
    # fused confidence. 0.90 still caps a perfect stage-1 below 1.0 (so a
    # trained CNN can outrank it) and lets the sample crash (peak 0.63) clear
    # the 0.55 candidate bar. 0.85 left that crash at 0.537 — logged, never
    # alerted.
    stage1_fuse_scale: float = 0.90

    # --- Stage 2 -------------------------------------------------------------
    cnn_model_path: Path = ML_ROOT / "models" / "accident_cnn.keras"
    stage2_threshold: float = 0.70
    enable_stage2: bool = True

    # --- Service -------------------------------------------------------------
    host: str = "0.0.0.0"
    port: int = 8000
    jpeg_quality: int = 70
    stream_fps: float = 10.0


settings = Settings()
