"""
Real-Time Scorer — given a trained profile and current time,
computes active phase curve signals and returns timing predictions.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from phase_curves import (
    Planet, Coordinate, Frame, PhaseCurve,
    compute_phase_curve, jd_to_datetime, datetime_to_jd,
)
from trainer import TrainedProfile, CurveProfile


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class PhaseSignal:
    """Current signal from one phase curve."""
    curve_label: str
    planet: str
    coordinate: str
    frame: str

    # Current state
    current_value: float          # current coordinate value (degrees)
    current_speed: float          # rate of change (degrees/day)
    direction: str                # "rising", "falling", "turning_up", "turning_down"

    # From trained profile
    correlation_with_price: float
    optimal_lag_bars: int
    confidence: float             # composite score from training

    # Prediction
    next_turning_point: Optional[datetime] = None  # estimated time of next direction change
    bars_to_turning: Optional[int] = None


@dataclass
class ScoreResult:
    """Complete scoring result for a moment in time."""
    timestamp: datetime
    market_symbol: str
    signals: list[PhaseSignal]
    composite_direction: float     # weighted sum: +1 = all bullish, -1 = all bearish
    strongest_signal: str          # label of highest-confidence signal
    timing_note: str               # human-readable timing summary

    def to_dict(self) -> dict:
        return {
            "timestamp": self.timestamp.isoformat(),
            "market": self.market_symbol,
            "composite_direction": round(self.composite_direction, 4),
            "strongest_signal": self.strongest_signal,
            "timing_note": self.timing_note,
            "signals": [
                {
                    "curve": s.curve_label,
                    "direction": s.direction,
                    "value": round(s.current_value, 4),
                    "speed": round(s.current_speed, 6),
                    "correlation": round(s.correlation_with_price, 4),
                    "lag_bars": s.optimal_lag_bars,
                    "confidence": round(s.confidence, 4),
                    "next_turning": s.next_turning_point.isoformat() if s.next_turning_point else None,
                    "bars_to_turning": s.bars_to_turning,
                }
                for s in self.signals
            ],
        }


# ---------------------------------------------------------------------------
# Direction detection
# ---------------------------------------------------------------------------

def _classify_direction(speed: float, prev_speed: float, threshold: float = 0.001) -> str:
    """Classify current direction including turning points."""
    if abs(speed) < threshold:
        if prev_speed > threshold:
            return "turning_down"
        elif prev_speed < -threshold:
            return "turning_up"
        return "stationary"
    elif speed > 0:
        if prev_speed < -threshold:
            return "turning_up"
        return "rising"
    else:
        if prev_speed > threshold:
            return "turning_down"
        return "falling"


def _find_next_turning_point(
    planet: Planet,
    coordinate: Coordinate,
    frame: Frame,
    now: datetime,
    current_speed: float,
    observer: Optional[tuple] = None,
    max_lookahead_days: int = 90,
    step_hours: int = 6,
) -> Optional[datetime]:
    """
    Scan forward from now to find when the speed changes sign
    (i.e., the curve changes direction).
    """
    step = timedelta(hours=step_hours)
    t = now
    end = now + timedelta(days=max_lookahead_days)
    prev_sign = np.sign(current_speed)

    flags = {
        Frame.GEO: 0,
        Frame.HELIO: 0x08,  # FLG_HELCTR
        Frame.TOPO: 0x20,   # FLG_TOPOCTR
    }

    import swisseph as swe
    if frame == Frame.TOPO and observer:
        swe.set_topo(observer[0], observer[1], observer[2])

    speed_idx = 3 + coordinate.value  # 3=lon_speed, 4=lat_speed

    while t < end:
        t += step
        jd = datetime_to_jd(t)
        result, _ = swe.calc_ut(jd, planet.value, swe.FLG_SPEED | flags[frame])
        speed = result[speed_idx]
        new_sign = np.sign(speed)
        if new_sign != prev_sign and prev_sign != 0:
            return t
        prev_sign = new_sign

    return None


# ---------------------------------------------------------------------------
# Main scoring function
# ---------------------------------------------------------------------------

_PLANET_MAP = {"MERCURY": Planet.MERCURY, "MOON": Planet.MOON}
_COORD_MAP = {"LONGITUDE": Coordinate.LONGITUDE, "LATITUDE": Coordinate.LATITUDE}
_FRAME_MAP = {"GEO": Frame.GEO, "HELIO": Frame.HELIO, "TOPO": Frame.TOPO}


def score(
    profile: TrainedProfile,
    at: Optional[datetime] = None,
    observer: Optional[tuple[float, float, float]] = None,
    top_n: int = 6,
    interval_minutes: float = 1440.0,
) -> ScoreResult:
    """
    Score the current (or specified) moment using a trained profile.

    Parameters
    ----------
    profile : TrainedProfile from trainer.train()
    at : datetime to score (default: now UTC)
    observer : (lon, lat, alt) for topocentric
    top_n : only include top N curves by confidence
    interval_minutes : bar interval for timing calculations
    """
    if at is None:
        at = datetime.now(timezone.utc)

    # Use top N curves from profile
    active_curves = [c for c in profile.curves if c.composite_score > 0][:top_n]
    if not active_curves:
        active_curves = profile.curves[:top_n]

    signals = []
    total_weight = 0.0
    weighted_direction = 0.0

    for cp in active_curves:
        planet = _PLANET_MAP.get(cp.planet)
        coord = _COORD_MAP.get(cp.coordinate)
        frame = _FRAME_MAP.get(cp.frame)

        if planet is None or coord is None or frame is None:
            continue
        if frame == Frame.TOPO and observer is None:
            continue

        # Compute current value and speed
        import swisseph as swe
        flags_map = {Frame.GEO: 0, Frame.HELIO: swe.FLG_HELCTR, Frame.TOPO: swe.FLG_TOPOCTR}

        if frame == Frame.TOPO and observer:
            swe.set_topo(observer[0], observer[1], observer[2])

        jd = datetime_to_jd(at)
        result, _ = swe.calc_ut(jd, planet.value, swe.FLG_SPEED | flags_map[frame])

        value = result[coord.value]        # 0=lon, 1=lat
        speed = result[coord.value + 3]    # 3=lon_speed, 4=lat_speed

        # Previous step for turning detection
        jd_prev = jd - (interval_minutes / 1440.0)
        result_prev, _ = swe.calc_ut(jd_prev, planet.value, swe.FLG_SPEED | flags_map[frame])
        prev_speed = result_prev[coord.value + 3]

        direction = _classify_direction(speed, prev_speed)

        # Find next turning point
        next_turn = _find_next_turning_point(
            planet, coord, frame, at, speed, observer, max_lookahead_days=30
        )
        bars_to_turn = None
        if next_turn:
            hours_to_turn = (next_turn - at).total_seconds() / 3600.0
            bars_to_turn = int(hours_to_turn * 60 / interval_minutes)

        sig = PhaseSignal(
            curve_label=cp.curve_label,
            planet=cp.planet,
            coordinate=cp.coordinate,
            frame=cp.frame,
            current_value=value,
            current_speed=speed,
            direction=direction,
            correlation_with_price=cp.pearson_r,
            optimal_lag_bars=cp.optimal_lag,
            confidence=cp.composite_score,
            next_turning_point=next_turn,
            bars_to_turning=bars_to_turn,
        )
        signals.append(sig)

        # Weighted direction for composite
        weight = abs(cp.composite_score)
        dir_val = 1.0 if "rising" in direction or "turning_up" in direction else -1.0
        # If correlation is negative, invert
        if cp.pearson_r < 0:
            dir_val *= -1
        weighted_direction += dir_val * weight
        total_weight += weight

    composite = weighted_direction / total_weight if total_weight > 0 else 0.0

    # Find strongest signal
    strongest = max(signals, key=lambda s: s.confidence) if signals else None

    # Timing note
    turning_signals = [s for s in signals if s.bars_to_turning is not None and s.bars_to_turning < 10]
    if turning_signals:
        nearest = min(turning_signals, key=lambda s: s.bars_to_turning)
        timing = f"{nearest.curve_label} turns in ~{nearest.bars_to_turning} bars"
    else:
        timing = "No imminent turning points"

    return ScoreResult(
        timestamp=at,
        market_symbol=profile.market_symbol,
        signals=signals,
        composite_direction=composite,
        strongest_signal=strongest.curve_label if strongest else "none",
        timing_note=timing,
    )


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Load the test profile we saved earlier
    profile_path = Path("models/test_profile.json")
    if profile_path.exists():
        profile = TrainedProfile.load(profile_path)
        print(f"Loaded profile for {profile.market_symbol}")

        now = datetime(2024, 6, 15, 12, 0, tzinfo=timezone.utc)
        result = score(profile, at=now)

        print(f"\nScore at {now.isoformat()}:")
        print(f"  Composite direction: {result.composite_direction:+.4f}")
        print(f"  Strongest signal: {result.strongest_signal}")
        print(f"  Timing: {result.timing_note}")
        print(f"\n  Signals:")
        for sig in result.signals:
            print(f"    {sig.curve_label}: {sig.direction}, "
                  f"value={sig.current_value:.2f}, speed={sig.current_speed:.4f}")
            if sig.next_turning_point:
                print(f"      -> turns at {sig.next_turning_point.isoformat()} "
                      f"(~{sig.bars_to_turning} bars)")
    else:
        print("No test profile found. Run trainer.py first.")
