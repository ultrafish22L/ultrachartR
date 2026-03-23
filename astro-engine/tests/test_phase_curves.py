"""Tests for the phase curve generator."""

from datetime import datetime, timezone
import numpy as np
import pytest

from phase_curves import (
    Planet, Coordinate, Frame, PhaseCurve,
    compute_phase_curve, compute_all_curves, clear_cache,
    datetime_to_jd, jd_to_datetime, unwrap_longitude,
)


class TestDateConversion:
    def test_jd_roundtrip(self):
        dt = datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        jd = datetime_to_jd(dt)
        dt2 = jd_to_datetime(jd)
        assert dt2.year == 2024
        assert dt2.month == 6
        assert dt2.day == 15
        assert dt2.hour == 12

    def test_known_jd(self):
        # J2000.0 epoch = 2000-01-01 12:00:00 TT ~= JD 2451545.0
        dt = datetime(2000, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        jd = datetime_to_jd(dt)
        assert abs(jd - 2451545.0) < 0.001


class TestPhaseCurves:
    def setup_method(self):
        clear_cache()
        self.start = datetime(2024, 1, 1, tzinfo=timezone.utc)
        self.end = datetime(2024, 12, 31, tzinfo=timezone.utc)

    def test_mercury_geo_latitude(self):
        curve = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
                                    self.start, self.end)
        assert len(curve.values) > 300
        # Mercury geocentric latitude oscillates roughly -7 to +7 degrees
        assert curve.values.min() > -10
        assert curve.values.max() < 10
        assert curve.label == "mercury_latitude_geo"

    def test_mercury_helio_latitude(self):
        curve = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.HELIO,
                                    self.start, self.end)
        # Heliocentric latitude of Mercury: about -7 to +7 degrees
        assert curve.values.min() > -10
        assert curve.values.max() < 10

    def test_moon_geo_longitude(self):
        curve = compute_phase_curve(Planet.MOON, Coordinate.LONGITUDE, Frame.GEO,
                                    self.start, self.end)
        # Moon longitude wraps 0-360
        assert curve.values.min() >= 0
        assert curve.values.max() <= 360

    def test_5min_interval(self):
        # Just one day at 5-min intervals
        end_1day = datetime(2024, 1, 2, tzinfo=timezone.utc)
        curve = compute_phase_curve(Planet.MOON, Coordinate.LONGITUDE, Frame.GEO,
                                    self.start, end_1day, interval_minutes=5.0)
        # 1 day / 5min = 288 bars + 1
        assert len(curve.values) >= 280

    def test_topo_requires_observer(self):
        with pytest.raises(ValueError, match="observer"):
            compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.TOPO,
                                self.start, self.end)

    def test_topo_with_observer(self):
        # Chicago: 41.88 N, -87.63 W, 181m
        curve = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.TOPO,
                                    self.start, self.end,
                                    observer=(-87.63, 41.88, 181.0))
        assert len(curve.values) > 300

    def test_turning_points(self):
        curve = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
                                    self.start, self.end)
        # Mercury latitude should have several turning points per year
        assert len(curve.turning_points) > 2

    def test_direction(self):
        curve = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
                                    self.start, self.end)
        d = curve.direction
        assert set(np.unique(d)).issubset({-1, 0, 1})

    def test_normalization(self):
        curve = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
                                    self.start, self.end)
        z = curve.normalized("zscore")
        assert abs(np.mean(z)) < 0.01
        assert abs(np.std(z) - 1.0) < 0.01

        mm = curve.normalized("minmax")
        assert abs(np.min(mm)) < 0.01
        assert abs(np.max(mm) - 1.0) < 0.01

    def test_cache(self):
        c1 = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
                                 self.start, self.end, use_cache=True)
        c2 = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
                                 self.start, self.end, use_cache=True)
        assert c1 is c2  # same object from cache

    def test_compute_all(self):
        curves = compute_all_curves(self.start, self.end)
        # 2 planets * 2 coords * 3 frames = 12, minus 2 moon helio = 10,
        # minus 4 topo (no observer) = 6
        assert len(curves) == 6

    def test_to_dict(self):
        curve = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO,
                                    self.start, self.end)
        d = curve.to_dict()
        assert d["planet"] == "MERCURY"
        assert d["coordinate"] == "LATITUDE"
        assert d["frame"] == "GEO"
        assert len(d["values"]) == len(d["timestamps_jd"])


class TestUnwrapLongitude:
    def test_unwrap(self):
        # Simulate 350, 355, 0, 5, 10 (crossing 360->0 boundary)
        vals = np.array([350.0, 355.0, 0.0, 5.0, 10.0])
        unwrapped = unwrap_longitude(vals)
        # After unwrapping, values should be monotonically increasing
        assert np.all(np.diff(unwrapped) > 0)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
