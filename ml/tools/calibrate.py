# ============================================================================
# SAMARITAN SHIELD — offline detector calibration
#
# Runs the real pipeline over a video file with no backend and no server, and
# prints the risk timeline. This is how thresholds get set: you watch what the
# detector actually scores on footage you have labelled by eye, rather than
# guessing constants and hoping.
#
#   python tools/calibrate.py data/videos/test_video_1.mp4
#   python tools/calibrate.py data/videos/*.mp4 --quiet
#
# Exit code is 0 if at least one frame crossed the candidate threshold, 1 if
# nothing fired — so it doubles as a smoke test in CI.
# ============================================================================

from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Run from the ml/ directory or anywhere: make sibling packages importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import cv2  # noqa: E402

from accident.classifier import AccidentClassifier  # noqa: E402
from accident.pipeline import DetectionPipeline, fuse  # noqa: E402
from accident.tracker import VehicleTracker  # noqa: E402
from config import settings  # noqa: E402


def sparkline(values: list[float], width: int = 72) -> str:
    if not values:
        return ""
    blocks = " .:-=+*#%@"
    step = max(1, len(values) // width)
    sampled = [max(values[i:i + step]) for i in range(0, len(values), step)]
    return "".join(blocks[min(len(blocks) - 1, int(v * (len(blocks) - 1)))] for v in sampled)


def _annotate(frame, tracks, result):
    """Draw boxes and the signal breakdown, for eyeballing what the detector saw."""
    from accident.tracker import VEHICLE_CLASSES

    out = frame.copy()
    for t in tracks:
        box = t.bbox()
        if box is None:
            continue
        x1, y1, x2, y2 = (int(v) for v in box)
        hot = t.track_id in result.involved_track_ids
        colour = (0, 0, 255) if hot else (0, 200, 255) if t.is_vehicle else (160, 160, 160)
        cv2.rectangle(out, (x1, y1), (x2, y2), colour, 2 if hot else 1)
        cv2.putText(out, f"{VEHICLE_CLASSES.get(t.cls, 'person')}{t.track_id}",
                    (x1, max(12, y1 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, colour, 1, cv2.LINE_AA)

    y = 16
    cv2.rectangle(out, (0, 0), (250, 86), (18, 18, 18), -1)
    cv2.putText(out, f"stage1 {result.score:.3f}", (6, y),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    for name, value in result.signals.items():
        y += 16
        colour = (0, 200, 0) if value > 0 else (110, 110, 110)
        cv2.putText(out, f"{name[:12]:<12} {value:.2f}", (6, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.42, colour, 1, cv2.LINE_AA)
    return out


def run(path: Path, quiet: bool, dump_dir: Path | None = None, dump_at: float = -1.0) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise SystemExit(f"Could not open {path}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    tracker = VehicleTracker(settings.yolo_model, settings.yolo_conf, settings.yolo_imgsz)

    # The real pipeline, with stage 2 whatever it is on this machine. Scoring
    # through anything else would calibrate a detector that is not the one that
    # ships — the decay, the debounce and the re-report guard all change the
    # answer, and all three live in DetectionPipeline.
    pipeline = DetectionPipeline(path.stem, AccidentClassifier(settings.cnn_model_path, settings.enable_stage2))

    scores: list[float] = []
    peak = {"score": 0.0, "t": 0.0, "why": "", "counts": {}}
    signal_max: dict[str, float] = {}
    events: list[dict] = []
    frame_no = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_no += 1
        if frame_no % settings.infer_every_n:
            continue

        # Video time, not wall time: this loop runs far slower than playback.
        t = frame_no / src_fps
        tracks = tracker.update(frame, t)
        event = pipeline.process(tracks, frame, now=t)
        result = pipeline.last_stage1
        scores.append(result.score)

        if event is not None:
            events.append({"t": t, "fused": event.fused_confidence,
                           "stage1": event.stage1_score, "why": event.explanation})
            if not quiet:
                verdict = "AUTO-ESCALATE" if event.fused_confidence >= 0.80 else "operator review"
                print(f"  \033[93mEVENT\033[0m t={t:6.2f}s  stage1={event.stage1_score:.3f}  "
                      f"fused={event.fused_confidence:.3f}  -> {verdict}  ({event.explanation})")

        for name, value in result.signals.items():
            if value > signal_max.get(name, 0.0):
                signal_max[name] = value

        if dump_dir is not None and abs(t - dump_at) <= 0.25:
            dump_dir.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(dump_dir / f"{path.stem}_t{t:05.2f}.jpg"),
                        _annotate(frame, tracks, result))

        if result.score > peak["score"]:
            peak = {
                "score": result.score,
                "t": t,
                "why": result.explanation,
                "counts": tracker.vehicle_counts(),
            }

    cap.release()

    above = sum(1 for s in scores if s >= settings.candidate_threshold)
    return {
        "path": path,
        "frames": len(scores),
        "duration": frame_no / src_fps,
        "peak": peak,
        "above": above,
        "scores": scores,
        "signal_max": signal_max,
        "events": events,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description="Calibrate the stage-1 accident detector against video.")
    ap.add_argument("videos", nargs="+", type=Path)
    ap.add_argument("--quiet", action="store_true", help="suppress the per-frame trigger log")
    ap.add_argument("--dump-at", type=float, default=-1.0,
                    help="write annotated frames near this timestamp (seconds)")
    ap.add_argument("--dump-dir", type=Path, default=Path("data/debug"))
    args = ap.parse_args()

    any_fired = False
    stage2_on = AccidentClassifier(settings.cnn_model_path, settings.enable_stage2).available

    for path in args.videos:
        print(f"\n\033[1m{path}\033[0m")
        dump = args.dump_dir if args.dump_at >= 0 else None
        r = run(path, args.quiet, dump, args.dump_at)

        if not r["scores"]:
            print("  no frames decoded")
            continue

        peak = r["peak"]
        fired = len(r["events"]) > 0
        any_fired = any_fired or fired

        print(f"  risk  |{sparkline(r['scores'])}|")
        print(f"  {r['frames']} inferences over {r['duration']:.1f}s")
        print(f"  peak stage1 {peak['score']:.3f} at t={peak['t']:.2f}s  ({peak['why']})")
        print("  best-ever per signal: " + "  ".join(
            f"\033[{'92' if v > 0 else '90'}m{k}={v:.2f}\033[0m"
            for k, v in sorted(r["signal_max"].items())
        ))
        print(f"  peak fused  {fuse(peak['score'], None):.3f}"
              f"{'' if stage2_on else '  (stage-1 only, CNN absent)'}")
        print(f"  vehicles at peak: {peak['counts']}")
        print(f"  frames >= candidate ({settings.candidate_threshold}): {r['above']}")

        if not r["events"]:
            print("  \033[90m=> no event emitted (logged only, no alert)\033[0m")
            continue

        best = max(e["fused"] for e in r["events"])
        auto = sum(1 for e in r["events"] if e["fused"] >= 0.80)
        print(f"  \033[93m=> {len(r['events'])} event(s) emitted, best fused {best:.3f}, "
              f"{auto} would auto-escalate\033[0m")

    return 0 if any_fired else 1


if __name__ == "__main__":
    raise SystemExit(main())
