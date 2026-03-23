"""
Training / Optimization Loop — discovers which phase curves
correlate best with each market, with what parameters, and
validates results using walk-forward testing.

Outputs a trained "profile" (JSON) that the scorer uses at runtime.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from phase_curves import (
    Planet, Coordinate, Frame, PhaseCurve,
    compute_phase_curve, compute_all_curves,
)
from market_data import MarketData, load_auto, _process_market_data
from correlation import correlate, scan_all_curves, CorrelationResult
from utils import guess_interval

logger = logging.getLogger(__name__)

# Default window sizes for parameter sweep (bars)
DEFAULT_WINDOW_SIZES = [10, 15, 20, 30, 50, 75, 100]


# ---------------------------------------------------------------------------
# Trained profile data structure
# ---------------------------------------------------------------------------

@dataclass
class CurveProfile:
    """Trained parameters for one phase curve -> market relationship."""
    curve_label: str
    planet: str
    coordinate: str
    frame: str
    optimal_lag: int
    best_window_size: int
    pearson_r: float
    direction_agreement: float
    composite_score: float
    stability_score: float
    p_value: float
    # Walk-forward validation results
    in_sample_score: float = 0.0
    out_of_sample_score: float = 0.0
    generalization_ratio: float = 0.0  # out/in — closer to 1.0 = generalizes well


@dataclass
class TrainedProfile:
    """Complete trained profile for a market."""
    market_symbol: str
    market_interval: str
    trained_at: str
    train_start: str
    train_end: str
    curves: list[CurveProfile]
    # Overall stats
    best_curve: str = ""
    best_score: float = 0.0

    def to_dict(self) -> dict:
        return {
            "market_symbol": self.market_symbol,
            "market_interval": self.market_interval,
            "trained_at": self.trained_at,
            "train_start": self.train_start,
            "train_end": self.train_end,
            "best_curve": self.best_curve,
            "best_score": self.best_score,
            "curves": [asdict(c) for c in self.curves],
        }

    def save(self, path: str | Path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)
        print(f"Profile saved to {path}")

    @classmethod
    def load(cls, path: str | Path) -> "TrainedProfile":
        with open(path) as f:
            data = json.load(f)
        curves = [CurveProfile(**c) for c in data.pop("curves")]
        return cls(curves=curves, **data)


# ---------------------------------------------------------------------------
# Parameter sweep
# ---------------------------------------------------------------------------

def _sweep_windows(
    curve: PhaseCurve,
    market: MarketData,
    max_lag: int = 20,
    window_sizes: list[int] = None,
) -> tuple[CorrelationResult, int]:
    """
    Sweep window sizes to find the one that maximizes composite score.
    Returns (best_result, best_window_size).
    """
    if window_sizes is None:
        window_sizes = DEFAULT_WINDOW_SIZES

    best_result = None
    best_window = 20

    for ws in window_sizes:
        if ws >= market.count // 2:
            continue
        try:
            result = correlate(curve, market, max_lag=max_lag, window_size=ws)
            if best_result is None or result.composite_score > best_result.composite_score:
                best_result = result
                best_window = ws
        except (ValueError, RuntimeError) as e:
            logger.debug("Window %d failed for %s: %s", ws, curve.label, e)
            continue

    if best_result is None:
        # Fallback
        best_result = correlate(curve, market, max_lag=max_lag, window_size=20)
        best_window = 20

    return best_result, best_window


# ---------------------------------------------------------------------------
# Walk-forward validation
# ---------------------------------------------------------------------------

def _walk_forward_validate(
    planet: Planet,
    coordinate: Coordinate,
    frame: Frame,
    market: MarketData,
    train_frac: float = 0.7,
    max_lag: int = 20,
    window_size: int = 20,
    observer: Optional[tuple] = None,
) -> tuple[float, float]:
    """
    Split data into train/test, compute correlation on each.
    Returns (in_sample_score, out_of_sample_score).
    """
    n = market.count
    split_idx = int(n * train_frac)
    if split_idx < 50 or (n - split_idx) < 20:
        return 0.0, 0.0

    # Split market data
    train_df = market.df.iloc[:split_idx].copy()
    test_df = market.df.iloc[split_idx:].copy()

    train_market = _process_market_data(train_df, market.symbol, market.interval)
    test_market = _process_market_data(test_df, market.symbol, market.interval)

    # Compute curves for each period
    train_start = train_df.index[0].to_pydatetime().replace(tzinfo=timezone.utc)
    train_end = train_df.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)
    test_start = test_df.index[0].to_pydatetime().replace(tzinfo=timezone.utc)
    test_end = test_df.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)

    train_curve = compute_phase_curve(
        planet, coordinate, frame, train_start, train_end,
        interval_minutes=guess_interval(market), observer=observer, use_cache=False,
    )
    test_curve = compute_phase_curve(
        planet, coordinate, frame, test_start, test_end,
        interval_minutes=guess_interval(market), observer=observer, use_cache=False,
    )

    try:
        train_result = correlate(train_curve, train_market, max_lag, window_size)
        test_result = correlate(test_curve, test_market, max_lag, window_size)
        return train_result.composite_score, test_result.composite_score
    except (ValueError, RuntimeError) as e:
        logger.debug("Walk-forward validation failed: %s", e)
        return 0.0, 0.0


# ---------------------------------------------------------------------------
# Main training function
# ---------------------------------------------------------------------------

def train(
    market: MarketData,
    max_lag: int = 20,
    observer: Optional[tuple[float, float, float]] = None,
    validate: bool = True,
    curves_filter: Optional[list[str]] = None,
) -> TrainedProfile:
    """
    Train a full profile: scan all phase curves, sweep parameters,
    validate out-of-sample, and return ranked results.

    Parameters
    ----------
    market : MarketData to train against
    max_lag : maximum lag to test
    observer : (lon, lat, alt) for topocentric calculations
    validate : run walk-forward validation (slower but more reliable)
    curves_filter : list of curve labels to include (e.g., ["mercury_latitude_helio"]).
                    If None, all curves are computed and ranked.
    """
    start_dt = market.df.index[0].to_pydatetime().replace(tzinfo=timezone.utc)
    end_dt = market.df.index[-1].to_pydatetime().replace(tzinfo=timezone.utc)
    interval = guess_interval(market)

    print(f"Training profile for {market.symbol} ({market.interval})")
    print(f"  Date range: {start_dt.date()} to {end_dt.date()}")
    print(f"  Bars: {market.count}, interval: {interval:.0f} min")
    if curves_filter:
        print(f"  Curves filter: {curves_filter}")

    # Compute all phase curves
    print("  Computing phase curves...")
    curves = compute_all_curves(start_dt, end_dt, interval, observer)

    # Apply filter if specified
    if curves_filter:
        curves = [c for c in curves if c.label in curves_filter]

    print(f"  Got {len(curves)} curves")

    # Scan with parameter sweep
    print("  Scanning correlations with window sweep...")
    profiles: list[CurveProfile] = []

    for curve in curves:
        try:
            result, best_window = _sweep_windows(curve, market, max_lag)

            cp = CurveProfile(
                curve_label=curve.label,
                planet=curve.planet.name,
                coordinate=curve.coordinate.name,
                frame=curve.frame.name,
                optimal_lag=result.optimal_lag,
                best_window_size=best_window,
                pearson_r=result.lagged_pearson_r,
                direction_agreement=result.direction_agreement,
                composite_score=result.composite_score,
                stability_score=result.stability_score,
                p_value=result.lagged_pearson_p,
            )

            # Walk-forward validation
            if validate:
                in_score, out_score = _walk_forward_validate(
                    curve.planet, curve.coordinate, curve.frame,
                    market, max_lag=max_lag, window_size=best_window,
                    observer=observer,
                )
                cp.in_sample_score = in_score
                cp.out_of_sample_score = out_score
                cp.generalization_ratio = (
                    out_score / in_score if in_score > 0.001 else 0.0
                )

            profiles.append(cp)
            print(f"    {curve.label}: score={cp.composite_score:.4f}"
                  + (f"  (gen={cp.generalization_ratio:.2f})" if validate else ""))

        except (ValueError, RuntimeError) as e:
            print(f"    {curve.label}: FAILED ({e})")

    # Sort by composite score
    profiles.sort(key=lambda p: p.composite_score, reverse=True)

    best = profiles[0] if profiles else None
    profile = TrainedProfile(
        market_symbol=market.symbol,
        market_interval=market.interval,
        trained_at=datetime.now(timezone.utc).isoformat(),
        train_start=start_dt.isoformat(),
        train_end=end_dt.isoformat(),
        curves=profiles,
        best_curve=best.curve_label if best else "",
        best_score=best.composite_score if best else 0.0,
    )

    print(f"\n  Best curve: {profile.best_curve} (score={profile.best_score:.4f})")
    return profile


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from market_data import generate_synthetic

    print("=== Training on synthetic data (should show low scores) ===\n")
    market = generate_synthetic(days=365 * 2)  # 2 years
    profile = train(market, validate=True)

    print("\n=== Ranked Results ===")
    for cp in profile.curves:
        gen = f"gen={cp.generalization_ratio:.2f}" if cp.generalization_ratio > 0 else "gen=n/a"
        print(f"  {cp.curve_label}: score={cp.composite_score:.4f}, "
              f"r={cp.pearson_r:+.3f}, dir={cp.direction_agreement:.0%}, "
              f"p={cp.p_value:.4f}, {gen}")

    # Save profile
    profile.save("models/test_profile.json")
