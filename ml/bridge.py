# ============================================================================
# SAMARITAN SHIELD — Node backend client
#
# Outbound posts go through a queue drained by a background thread. The capture
# loop must never block on the network: if the Express server is down, the
# camera grid has to keep running and the detector has to keep detecting. We
# drop rather than stall, and say so in the log.
# ============================================================================

from __future__ import annotations

import logging
import queue
import threading
from typing import Any, Dict, List, Optional

import httpx

from config import settings

log = logging.getLogger("samaritan.bridge")

_MAX_PENDING = 64


class NodeBridge:
    def __init__(self) -> None:
        self._queue: queue.Queue[tuple[str, Dict[str, Any]]] = queue.Queue(maxsize=_MAX_PENDING)
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._client = httpx.Client(
            base_url=settings.node_api_base,
            timeout=8.0,
            headers={"X-Service-Token": settings.ml_service_token},
        )
        self._dropped = 0

    # --- lifecycle -----------------------------------------------------------
    def start(self) -> None:
        self._thread = threading.Thread(target=self._drain, name="node-bridge", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5.0)
        self._client.close()

    # --- synchronous calls (startup only) ------------------------------------
    def fetch_cameras(self) -> List[Dict[str, Any]]:
        """Blocking on purpose: there is nothing to do until we have a roster."""
        res = self._client.get("/api/ml/cameras")
        res.raise_for_status()
        payload = res.json()
        return payload.get("cameras", [])

    # --- fire-and-forget -----------------------------------------------------
    def post(self, path: str, body: Dict[str, Any]) -> None:
        try:
            self._queue.put_nowait((path, body))
        except queue.Full:
            self._dropped += 1
            if self._dropped % 20 == 1:
                log.warning(
                    "Backend queue full (%d dropped) — is the Node server reachable at %s?",
                    self._dropped,
                    settings.node_api_base,
                )

    def _drain(self) -> None:
        while not self._stop.is_set():
            try:
                path, body = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                res = self._client.post(path, json=body)
                if res.status_code >= 400:
                    log.warning("%s -> %s %s", path, res.status_code, res.text[:200])
                elif path == "/api/ml/detection":
                    data = res.json()
                    log.info(
                        "detection accepted: escalated=%s incident=%s",
                        data.get("escalated"),
                        data.get("incidentId") or "-",
                    )
            except httpx.HTTPError as exc:
                log.warning("%s failed: %s", path, exc)


bridge = NodeBridge()
