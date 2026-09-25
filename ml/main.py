# ============================================================================
# SAMARITAN SHIELD — ML service
#
#   uvicorn main:app --port 8000
#
# Pulls its camera roster from the Node backend at startup, runs one worker
# thread per camera, and serves each as an MJPEG stream the control-room
# dashboard can render with a plain <img>.
# ============================================================================

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import List

import httpx
from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from bridge import bridge
from cameras import CameraSpec, manager
from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s %(name)-20s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("samaritan.ml")


def load_camera_specs() -> List[CameraSpec]:
    rows = bridge.fetch_cameras()
    specs: List[CameraSpec] = []
    for row in rows:
        loc = row.get("location") or {}
        specs.append(
            CameraSpec(
                camera_id=row["cameraId"],
                name=row.get("name", row["cameraId"]),
                source=row.get("source", ""),
                lat=float(loc.get("lat", 0.0)),
                lng=float(loc.get("lng", 0.0)),
                zone=row.get("zone", "default"),
                approach=row.get("approach"),
                signal_id=row.get("signalId"),
            )
        )
    return specs


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if not settings.ml_service_token:
        raise RuntimeError(
            "ML_SERVICE_TOKEN is not set. It must match the value in server/.env — "
            "without it every call to the backend is rejected."
        )

    bridge.start()

    try:
        specs = load_camera_specs()
    except httpx.HTTPError as exc:
        bridge.stop()
        raise RuntimeError(
            f"Could not fetch the camera roster from {settings.node_api_base}. "
            f"Is the Express server running? ({exc})"
        ) from exc

    if not specs:
        log.warning("Backend returned no enabled cameras — run: npm --prefix server run seed:city")

    log.info("Starting %d camera worker(s)…", len(specs))
    manager.start(specs)

    yield

    log.info("Shutting down camera workers…")
    manager.stop()
    bridge.stop()


app = FastAPI(title="Samaritan Shield ML", version="1.0.0", lifespan=lifespan)

# The dashboard is served from the Expo dev server on another origin and needs
# to pull <img> frames from here. Streams carry no identity and no victim data.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    workers = list(manager.workers.values())
    return {
        "status": "ok",
        "cameras": len(workers),
        "online": sum(1 for w in workers if w.status == "ONLINE"),
        "stage2": manager.classifier.available,
        "stage2Path": str(settings.cnn_model_path),
    }


@app.get("/cameras")
def cameras() -> dict:
    return {"status": "success", "cameras": [w.snapshot() for w in manager.workers.values()]}


@app.get("/snapshot/{camera_id}.jpg")
def snapshot(camera_id: str) -> Response:
    worker = manager.get(camera_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Unknown camera")
    jpeg = worker.latest_jpeg()
    if jpeg is None:
        raise HTTPException(status_code=503, detail="No frame yet")
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/stream/{camera_id}")
def stream(camera_id: str) -> StreamingResponse:
    worker = manager.get(camera_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="Unknown camera")

    interval = 1.0 / max(settings.stream_fps, 1.0)

    def frames():
        while worker.status != "OFFLINE":
            jpeg = worker.latest_jpeg()
            if jpeg:
                yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " \
                      + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n"
            time.sleep(interval)

    return StreamingResponse(
        frames(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store"},
    )
