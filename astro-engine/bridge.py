"""
JSON-over-stdio bridge for the TypeScript integration layer.

Reads one JSON command per line from stdin, executes it,
writes one JSON response per line to stdout.
"""

from __future__ import annotations

import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Ensure our modules are importable
sys.path.insert(0, str(Path(__file__).parent))

from phase_curves import compute_all_curves
from market_data import load_auto, load_from_json
from trainer import train, TrainedProfile
from scorer import score


def _run_backtest(profile: TrainedProfile, market) -> dict:
    """
    Walk through each bar, score with the trained profile, and
    compare predicted direction with actual price direction.
    Returns accuracy metrics.
    """
    from market_data import MarketData
    import numpy as np

    direction = market.direction  # 1=up, -1=down, 0=flat
    n = market.count

    # Score at each bar's timestamp
    correct = 0
    total = 0
    signals_count = {}

    for i in range(1, n):
        actual_dir = direction[i]
        if actual_dir == 0:
            continue  # skip flat bars

        dt = market.df.index[i].to_pydatetime()
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        try:
            result = score(profile, at=dt, top_n=3)
            predicted = 1.0 if result.composite_direction > 0 else -1.0

            if predicted * actual_dir > 0:
                correct += 1
            total += 1

            # Track per-signal contributions
            for sig in result.signals:
                label = sig.curve_label
                if label not in signals_count:
                    signals_count[label] = {"correct": 0, "total": 0}
                sig_dir = 1.0 if "rising" in sig.direction or "turning_up" in sig.direction else -1.0
                if sig.correlation_with_price < 0:
                    sig_dir *= -1
                signals_count[label]["total"] += 1
                if sig_dir * actual_dir > 0:
                    signals_count[label]["correct"] += 1

        except Exception:
            continue

    direction_accuracy = correct / total if total > 0 else 0.0

    return {
        "direction_accuracy": round(direction_accuracy, 4),
        "correct_predictions": correct,
        "total_predictions": total,
        "total_bars": n,
        "signals_by_curve": {
            k: {
                "accuracy": round(v["correct"] / v["total"], 4) if v["total"] > 0 else 0,
                "correct": v["correct"],
                "total": v["total"],
            }
            for k, v in signals_count.items()
        },
    }


def handle_command(cmd: dict) -> dict:
    """Dispatch a command and return a response dict."""
    action = cmd.get("action")
    _id = cmd.get("_id")

    try:
        if action == "quit":
            sys.exit(0)

        elif action == "score":
            profile = TrainedProfile.load(cmd["profile_path"])
            at = None
            if cmd.get("at"):
                at = datetime.fromisoformat(cmd["at"])
                if at.tzinfo is None:
                    at = at.replace(tzinfo=timezone.utc)
            observer = tuple(cmd["observer"]) if cmd.get("observer") else None
            result = score(profile, at=at, observer=observer)
            return {"ok": True, "action": action, "data": result.to_dict(), "_id": _id}

        elif action == "train":
            market = load_auto(cmd["data_path"], symbol=cmd["symbol"], interval=cmd.get("interval", "daily"))
            observer = tuple(cmd["observer"]) if cmd.get("observer") else None
            curves_filter = cmd.get("curves_filter")
            profile = train(market, observer=observer, curves_filter=curves_filter)
            # Save profile
            save_path = Path("models") / f"{cmd['symbol']}_{cmd.get('interval', 'daily')}_profile.json"
            profile.save(save_path)
            return {"ok": True, "action": action, "data": profile.to_dict(), "_id": _id}

        elif action == "phase_curves":
            start = datetime.fromisoformat(cmd["start"]).replace(tzinfo=timezone.utc)
            end = datetime.fromisoformat(cmd["end"]).replace(tzinfo=timezone.utc)
            interval = cmd.get("interval_minutes", 1440.0)
            observer = tuple(cmd["observer"]) if cmd.get("observer") else None
            curves = compute_all_curves(start, end, interval, observer)
            return {"ok": True, "action": action, "data": [c.to_dict() for c in curves], "_id": _id}

        elif action == "train_json":
            market = load_from_json(
                cmd["bars"],
                symbol=cmd.get("symbol", "unknown"),
                interval=cmd.get("interval", "daily"),
            )
            observer = tuple(cmd["observer"]) if cmd.get("observer") else None
            curves_filter = cmd.get("curves_filter")
            profile = train(market, observer=observer, curves_filter=curves_filter)
            # Save profile if output_path provided
            if cmd.get("output_path"):
                profile.save(cmd["output_path"])
            else:
                save_path = Path("models") / f"{cmd.get('symbol', 'unknown')}_{cmd.get('interval', 'daily')}_profile.json"
                profile.save(save_path)
            return {"ok": True, "action": action, "data": profile.to_dict(), "_id": _id}

        elif action == "backtest":
            profile = TrainedProfile.load(cmd["profile_path"])
            # Load market data from bars (JSON) or file path
            if cmd.get("bars"):
                market = load_from_json(
                    cmd["bars"],
                    symbol=cmd.get("symbol", profile.market_symbol),
                    interval=cmd.get("interval", profile.market_interval),
                )
            elif cmd.get("data_path"):
                market = load_auto(
                    cmd["data_path"],
                    symbol=cmd.get("symbol", profile.market_symbol),
                    interval=cmd.get("interval", profile.market_interval),
                )
            else:
                return {"ok": False, "action": action, "error": "Either 'bars' or 'data_path' is required", "_id": _id}

            result = _run_backtest(profile, market)
            return {"ok": True, "action": action, "data": result, "_id": _id}

        elif action == "chart":
            from visualize import generate_overlay_chart
            profile = TrainedProfile.load(cmd["profile_path"])
            market = load_auto(cmd["data_path"], symbol=cmd["symbol"])
            curve_labels = cmd.get("curves")
            output = cmd["output_path"]
            chart_path = generate_overlay_chart(profile, market, output_path=output, curve_labels=curve_labels)
            return {"ok": True, "action": action, "data": {"chart_path": chart_path}, "_id": _id}

        else:
            return {"ok": False, "action": action, "error": f"Unknown action: {action}", "_id": _id}

    except Exception as e:
        return {"ok": False, "action": action, "error": f"{type(e).__name__}: {e}", "_id": _id}


def main():
    # Signal ready
    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as e:
            response = {"ok": False, "error": f"Invalid JSON: {e}"}
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            continue

        response = handle_command(cmd)
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
