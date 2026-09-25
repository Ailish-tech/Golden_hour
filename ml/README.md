# Golden Hour — ML service

Python FastAPI process that treats looping video files as city CCTV cameras,
runs YOLOv8n + ByteTrack, scores collisions with motion heuristics, and posts
detections to the Node API.

## Why there is no pretrained accident CNN

The reference repo (`Soham2212004/Road-Accident-Detection-Alert-System`) ships
`model.json` (architecture) but **not** `model_weights.keras`. This service is
fully operational without stage 2: missing weights log a warning and every
detection reports `stage2Score: null`. Do not invent a weights file.

## Setup

```bash
# Python 3.11 — not 3.14. ultralytics does not publish wheels for 3.14.
/opt/homebrew/bin/python3.11 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt

# Token must match server/.env ML_SERVICE_TOKEN
cp .env.example .env
```

Footage lives in `data/videos/`. The reference clip is already downloaded as
`test_video_1.mp4` (21s junction crash at t≈7.8s). Seeded cameras all point
at it until you drop more files in.

## Calibrate / smoke-test a clip (no server required)

```bash
. .venv/bin/activate
export ML_SERVICE_TOKEN=x
python tools/calibrate.py data/videos/test_video_1.mp4
```

Exit code 0 means at least one event would have been posted. The numbers below
are from that clip after the thresholds in `config.py` were set against it:

- peak stage-1 ≈ 0.63 at the impact (overlap + deceleration)
- fused (no CNN) ≈ 0.57 → operator-confirmation band
- a 10-minute empty-road loop should emit nothing

## Run with the rest of the product

1. Node server on :3000 with `ML_SERVICE_TOKEN` set
2. `npm --prefix server run seed:city -- you@example.com`
3. From `ml/`: `. .venv/bin/activate && uvicorn main:app --port 8000`
4. Open a stream: http://localhost:8000/stream/JAI-CAM-014
5. Sign into the app as the seeded control-room email
