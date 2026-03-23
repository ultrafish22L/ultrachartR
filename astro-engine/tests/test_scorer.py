"""Tests for the real-time scorer."""

from datetime import datetime, timezone
import pytest

from market_data import generate_synthetic
from trainer import train, TrainedProfile
from scorer import score, ScoreResult


class TestScorer:
    @pytest.fixture(autouse=True)
    def setup(self, tmp_path):
        # Train a quick profile on synthetic data
        market = generate_synthetic(days=365)
        self.profile = train(market, validate=False)
        self.profile_path = tmp_path / "test_profile.json"
        self.profile.save(self.profile_path)

    def test_score_returns_result(self):
        at = datetime(2024, 6, 15, 12, 0, tzinfo=timezone.utc)
        result = score(self.profile, at=at)
        assert isinstance(result, ScoreResult)
        assert result.market_symbol == "SYNTHETIC"
        assert -1 <= result.composite_direction <= 1

    def test_score_has_signals(self):
        at = datetime(2024, 6, 15, 12, 0, tzinfo=timezone.utc)
        result = score(self.profile, at=at)
        assert len(result.signals) > 0

    def test_signal_fields(self):
        at = datetime(2024, 6, 15, 12, 0, tzinfo=timezone.utc)
        result = score(self.profile, at=at)
        sig = result.signals[0]
        assert sig.planet in ("MERCURY", "MOON")
        assert sig.coordinate in ("LONGITUDE", "LATITUDE")
        assert sig.frame in ("GEO", "HELIO", "TOPO")
        assert sig.direction in ("rising", "falling", "turning_up", "turning_down", "stationary")

    def test_score_now(self):
        # Score at current time (should not crash)
        result = score(self.profile)
        assert isinstance(result, ScoreResult)

    def test_to_dict(self):
        at = datetime(2024, 6, 15, 12, 0, tzinfo=timezone.utc)
        result = score(self.profile, at=at)
        d = result.to_dict()
        assert "timestamp" in d
        assert "composite_direction" in d
        assert "signals" in d
        assert len(d["signals"]) > 0

    def test_profile_load_roundtrip(self):
        loaded = TrainedProfile.load(self.profile_path)
        assert loaded.market_symbol == self.profile.market_symbol
        assert len(loaded.curves) == len(self.profile.curves)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
