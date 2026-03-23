"""Tests for the correlation scanner."""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from datetime import datetime, timezone
import numpy as np
import pytest

from phase_curves import Planet, Coordinate, Frame, compute_phase_curve, compute_all_curves
from market_data import generate_synthetic, MarketData, _process_market_data
from correlation import correlate, scan_all_curves
import pandas as pd


class TestCorrelationBasics:
    def setup_method(self):
        self.start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        self.end = datetime(2024, 12, 31, tzinfo=timezone.utc)
        self.market = generate_synthetic(days=365)
        self.curve = compute_phase_curve(
            Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
            self.start, self.end,
        )

    def test_basic_correlation(self):
        result = correlate(self.curve, self.market)
        assert -1 <= result.pearson_r <= 1
        assert 0 <= result.pearson_p <= 1
        assert -1 <= result.spearman_r <= 1
        assert 0 <= result.direction_agreement <= 1
        assert result.n_samples > 100

    def test_lag_bounds(self):
        result = correlate(self.curve, self.market, max_lag=10)
        assert -10 <= result.optimal_lag <= 10

    def test_composite_score_format(self):
        result = correlate(self.curve, self.market)
        assert result.composite_score >= 0
        assert isinstance(result.stability_score, float)

    def test_to_dict(self):
        result = correlate(self.curve, self.market)
        d = result.to_dict()
        assert "curve_label" in d
        assert "pearson_r" in d
        assert "optimal_lag" in d
        assert "composite_score" in d


class TestSyntheticCorrelation:
    """Test that correlated synthetic data produces high scores."""

    def test_correlated_signal(self):
        """Create a market whose price IS a planetary curve + noise."""
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        end = datetime(2024, 12, 31, tzinfo=timezone.utc)

        curve = compute_phase_curve(
            Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
            start, end, interval_minutes=1440.0,
        )

        # Create price that follows the curve with some noise
        rng = np.random.default_rng(42)
        n = len(curve.values)
        base_price = 1500.0
        noise = rng.normal(0, 0.5, n)
        price = base_price + curve.values * 20 + np.cumsum(noise)

        dates = pd.date_range(start, periods=n, freq="1D", tz=timezone.utc)
        df = pd.DataFrame({
            "open": price - 1,
            "high": price + 2,
            "low": price - 2,
            "close": price,
            "volume": np.ones(n) * 10000,
        }, index=dates)

        market = _process_market_data(df, "CORRELATED_TEST", "daily")
        result = correlate(curve, market)

        # Should show strong correlation
        assert abs(result.pearson_r) > 0.5, f"Expected strong correlation, got {result.pearson_r}"
        assert result.direction_agreement > 0.55, f"Expected >55% direction agreement, got {result.direction_agreement}"

    def test_random_data_low_score(self):
        """Random market data should show weak correlations."""
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        end = datetime(2024, 12, 31, tzinfo=timezone.utc)

        curve = compute_phase_curve(
            Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
            start, end,
        )
        market = generate_synthetic(days=365)
        result = correlate(curve, market)

        # Composite score should be low for random data
        assert result.composite_score < 0.5, f"Score too high for random data: {result.composite_score}"


class TestScanAllCurves:
    def test_scan(self):
        start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        end = datetime(2024, 12, 31, tzinfo=timezone.utc)
        curves = compute_all_curves(start, end)
        market = generate_synthetic(days=365)

        results = scan_all_curves(curves, market)
        assert len(results) > 0
        # Should be sorted by composite score descending
        scores = [r.composite_score for r in results]
        assert scores == sorted(scores, reverse=True)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
