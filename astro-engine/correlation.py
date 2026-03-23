"""
Correlation Scanner — measures directional agreement between
planetary phase curves and market price action.

This is the core "training" module: it quantifies how well each
phase curve tracks price, finds optimal lag/lead, and measures
statistical significance.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import numpy as np
from scipy import stats

from phase_curves import PhaseCurve, unwrap_longitude, Coordinate, ZERO_VARIANCE_THRESHOLD
from market_data import MarketData


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class CorrelationResult:
    """Result of correlating one phase curve with one market series."""
    # Identity
    curve_label: str
    market_symbol: str
    market_interval: str

    # Core metrics
    pearson_r: float               # Pearson correlation (raw)
    pearson_p: float               # p-value
    spearman_r: float              # Spearman rank correlation
    spearman_p: float

    # Lag analysis
    optimal_lag: int               # bars (positive = curve leads price)
    lagged_pearson_r: float        # correlation at optimal lag
    lagged_pearson_p: float

    # Directional agreement
    direction_agreement: float     # fraction of bars where curve and price move same way
    direction_p: float             # binomial test p-value (vs. 50% chance)

    # Stability
    rolling_corr_mean: float       # mean of rolling correlation
    rolling_corr_std: float        # std of rolling correlation (lower = more stable)
    pct_windows_positive: float    # % of rolling windows with positive correlation

    # Metadata
    n_samples: int
    window_size: int

    @property
    def stability_score(self) -> float:
        """0-1 score: high correlation that's consistent over time."""
        if self.rolling_corr_std < ZERO_VARIANCE_THRESHOLD:
            return 0.0
        return max(0, self.rolling_corr_mean) * (1.0 - min(1.0, self.rolling_corr_std))

    @property
    def composite_score(self) -> float:
        """Combined score for ranking: correlation × stability × significance."""
        sig = 1.0 if self.lagged_pearson_p < 0.01 else (0.5 if self.lagged_pearson_p < 0.05 else 0.1)
        return abs(self.lagged_pearson_r) * self.stability_score * sig

    def to_dict(self) -> dict:
        return {
            "curve_label": self.curve_label,
            "market": f"{self.market_symbol}_{self.market_interval}",
            "pearson_r": round(self.pearson_r, 4),
            "pearson_p": round(self.pearson_p, 6),
            "spearman_r": round(self.spearman_r, 4),
            "spearman_p": round(self.spearman_p, 6),
            "optimal_lag": self.optimal_lag,
            "lagged_pearson_r": round(self.lagged_pearson_r, 4),
            "lagged_pearson_p": round(self.lagged_pearson_p, 6),
            "direction_agreement": round(self.direction_agreement, 4),
            "direction_p": round(self.direction_p, 6),
            "rolling_corr_mean": round(self.rolling_corr_mean, 4),
            "rolling_corr_std": round(self.rolling_corr_std, 4),
            "pct_windows_positive": round(self.pct_windows_positive, 4),
            "stability_score": round(self.stability_score, 4),
            "composite_score": round(self.composite_score, 4),
            "n_samples": self.n_samples,
            "window_size": self.window_size,
        }

    def summary(self) -> str:
        """Human-readable one-line summary."""
        lag_desc = f"leads by {self.optimal_lag}" if self.optimal_lag > 0 else (
            f"lags by {-self.optimal_lag}" if self.optimal_lag < 0 else "no lag")
        return (
            f"{self.curve_label} -> {self.market_symbol}: "
            f"r={self.lagged_pearson_r:+.3f} ({lag_desc} bars), "
            f"dir={self.direction_agreement:.0%}, "
            f"p={self.lagged_pearson_p:.4f}, "
            f"score={self.composite_score:.3f}"
        )


# ---------------------------------------------------------------------------
# Core correlation functions
# ---------------------------------------------------------------------------

def _align_series(curve: PhaseCurve, market: MarketData) -> tuple[np.ndarray, np.ndarray]:
    """
    Align phase curve values with market close prices by matching
    Julian Day timestamps.

    Finds the overlapping time range, masks both series to that range,
    then linearly interpolates the shorter one to match lengths.

    Returns (curve_values, price_series) of equal length.
    """
    # Find overlapping time range
    curve_jd = curve.timestamps
    market_jd = market.timestamps_jd

    jd_start = max(curve_jd[0], market_jd[0])
    jd_end = min(curve_jd[-1], market_jd[-1])

    if jd_start >= jd_end:
        raise ValueError("No overlapping time range between curve and market data")

    # For each market bar, find nearest curve value
    # (they may have different intervals)
    curve_mask = (curve_jd >= jd_start) & (curve_jd <= jd_end)
    market_mask = (market_jd >= jd_start) & (market_jd <= jd_end)

    curve_vals = curve.values[curve_mask]
    market_close = market.close[market_mask]

    # If different lengths, resample the shorter to match the longer
    n = min(len(curve_vals), len(market_close))
    if len(curve_vals) != len(market_close):
        # Simple linear interpolation to align
        curve_vals = np.interp(
            np.linspace(0, 1, n),
            np.linspace(0, 1, len(curve_vals)),
            curve_vals
        )
        market_close = np.interp(
            np.linspace(0, 1, n),
            np.linspace(0, 1, len(market_close)),
            market_close
        )

    return curve_vals, market_close


def _compute_lag(curve_vals: np.ndarray, price_vals: np.ndarray,
                 max_lag: int = 20) -> tuple[int, float, float]:
    """
    Find optimal lag using brute-force cross-correlation over [-max_lag, +max_lag].

    Both series are z-score normalized, then Pearson r is computed at each lag.
    The lag with the highest absolute correlation wins.

    Returns (optimal_lag, correlation_at_lag, p_value).
    Positive lag means the curve leads price by that many bars.
    """
    # Normalize both series
    cv = (curve_vals - np.mean(curve_vals))
    pv = (price_vals - np.mean(price_vals))
    cv_std = np.std(cv)
    pv_std = np.std(pv)
    if cv_std < ZERO_VARIANCE_THRESHOLD or pv_std < ZERO_VARIANCE_THRESHOLD:
        return 0, 0.0, 1.0
    cv = cv / cv_std
    pv = pv / pv_std

    n = len(cv)
    best_lag = 0
    best_corr = 0.0

    for lag in range(-max_lag, max_lag + 1):
        if lag > 0:
            # Curve leads: compare curve[:-lag] with price[lag:]
            c = cv[:n - lag]
            p = pv[lag:]
        elif lag < 0:
            # Price leads: compare curve[-lag:] with price[:n+lag]
            c = cv[-lag:]
            p = pv[:n + lag]
        else:
            c = cv
            p = pv

        if len(c) < 10:
            continue

        r = np.corrcoef(c, p)[0, 1]
        if abs(r) > abs(best_corr):
            best_corr = r
            best_lag = lag

    # Compute p-value at best lag
    if best_lag > 0:
        c = cv[:n - best_lag]
        p = pv[best_lag:]
    elif best_lag < 0:
        c = cv[-best_lag:]
        p = pv[:n + best_lag]
    else:
        c, p = cv, pv

    _, p_value = stats.pearsonr(c, p)

    return best_lag, best_corr, p_value


def _rolling_correlation(curve_vals: np.ndarray, price_vals: np.ndarray,
                         window: int = 20) -> np.ndarray:
    """Compute rolling Pearson correlation between two series."""
    n = len(curve_vals)
    if n < window:
        return np.array([])

    corrs = np.full(n, np.nan)
    for i in range(window - 1, n):
        c = curve_vals[i - window + 1:i + 1]
        p = price_vals[i - window + 1:i + 1]
        if np.std(c) < ZERO_VARIANCE_THRESHOLD or np.std(p) < ZERO_VARIANCE_THRESHOLD:
            corrs[i] = 0.0
        else:
            corrs[i] = np.corrcoef(c, p)[0, 1]

    return corrs[~np.isnan(corrs)]


def _direction_agreement(curve: PhaseCurve, market: MarketData,
                         curve_mask: np.ndarray, market_mask: np.ndarray) -> tuple[float, float]:
    """
    What fraction of bars have the same direction (curve rising + price rising,
    or curve falling + price falling)?

    Returns (agreement_fraction, binomial_p_value).
    """
    curve_dir = curve.direction[curve_mask]
    market_dir = market.direction[market_mask]

    n = min(len(curve_dir), len(market_dir))
    curve_dir = curve_dir[:n]
    market_dir = market_dir[:n]

    # Only count bars where both have a clear direction
    valid = (curve_dir != 0) & (market_dir != 0)
    if np.sum(valid) < 10:
        return 0.5, 1.0

    agree = np.sum(curve_dir[valid] == market_dir[valid])
    total = np.sum(valid)
    agreement = agree / total

    # Binomial test: is this significantly better than 50%?
    p_value = stats.binomtest(agree, total, 0.5).pvalue

    return agreement, p_value


# ---------------------------------------------------------------------------
# Main scanner
# ---------------------------------------------------------------------------

def correlate(
    curve: PhaseCurve,
    market: MarketData,
    max_lag: int = 20,
    window_size: int = 20,
) -> CorrelationResult:
    """
    Compute full correlation analysis between a phase curve and market data.

    Parameters
    ----------
    curve : PhaseCurve from phase_curves module
    market : MarketData from market_data module
    max_lag : maximum lag to test (in bars)
    window_size : rolling correlation window size

    Returns
    -------
    CorrelationResult with all metrics.
    """
    # Get aligned, equal-length series
    curve_vals, price_vals = _align_series(curve, market)

    # For longitude, unwrap to avoid 360→0 discontinuities
    if curve.coordinate == Coordinate.LONGITUDE:
        curve_vals = unwrap_longitude(curve_vals)

    n = len(curve_vals)

    # Basic correlations
    pearson_r, pearson_p = stats.pearsonr(curve_vals, price_vals) if n > 2 else (0, 1)
    spearman_r, spearman_p = stats.spearmanr(curve_vals, price_vals) if n > 2 else (0, 1)

    # Lag analysis
    optimal_lag, lagged_r, lagged_p = _compute_lag(curve_vals, price_vals, max_lag)

    # Direction agreement
    curve_jd = curve.timestamps
    market_jd = market.timestamps_jd
    jd_start = max(curve_jd[0], market_jd[0])
    jd_end = min(curve_jd[-1], market_jd[-1])
    curve_mask = (curve_jd >= jd_start) & (curve_jd <= jd_end)
    market_mask = (market_jd >= jd_start) & (market_jd <= jd_end)
    dir_agree, dir_p = _direction_agreement(curve, market, curve_mask, market_mask)

    # Rolling correlation
    rolling = _rolling_correlation(curve_vals, price_vals, window_size)
    if len(rolling) > 0:
        rolling_mean = np.mean(rolling)
        rolling_std = np.std(rolling)
        pct_positive = np.mean(rolling > 0)
    else:
        rolling_mean = 0.0
        rolling_std = 1.0
        pct_positive = 0.5

    return CorrelationResult(
        curve_label=curve.label,
        market_symbol=market.symbol,
        market_interval=market.interval,
        pearson_r=float(pearson_r),
        pearson_p=float(pearson_p),
        spearman_r=float(spearman_r),
        spearman_p=float(spearman_p),
        optimal_lag=optimal_lag,
        lagged_pearson_r=float(lagged_r),
        lagged_pearson_p=float(lagged_p),
        direction_agreement=dir_agree,
        direction_p=dir_p,
        rolling_corr_mean=rolling_mean,
        rolling_corr_std=rolling_std,
        pct_windows_positive=pct_positive,
        n_samples=n,
        window_size=window_size,
    )


def scan_all_curves(
    curves: list[PhaseCurve],
    market: MarketData,
    max_lag: int = 20,
    window_size: int = 20,
) -> list[CorrelationResult]:
    """
    Scan all phase curves against a market, returning results
    sorted by composite score (best first).
    """
    results = []
    for curve in curves:
        try:
            result = correlate(curve, market, max_lag, window_size)
            results.append(result)
        except (ValueError, RuntimeError) as e:
            print(f"  Warning: {curve.label} failed: {e}")

    results.sort(key=lambda r: r.composite_score, reverse=True)
    return results


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from datetime import datetime, timezone
    from phase_curves import compute_all_curves
    from market_data import generate_synthetic

    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    end = datetime(2024, 12, 31, tzinfo=timezone.utc)

    print("Computing phase curves (daily, 2024)...")
    curves = compute_all_curves(start, end, interval_minutes=1440.0)

    print("Generating synthetic market data...")
    market = generate_synthetic(days=365)

    print(f"\nScanning {len(curves)} curves against {market.symbol}...\n")
    results = scan_all_curves(curves, market)

    print("Results (ranked by composite score):")
    print("-" * 80)
    for r in results:
        print(f"  {r.summary()}")
    print()
    print(f"Best: {results[0].curve_label} with score {results[0].composite_score:.4f}")
