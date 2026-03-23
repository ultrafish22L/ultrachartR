"""
Phase Curve Generator — computes Mercury/Moon latitude or longitude
over time in heliocentric, geocentric, or topocentric reference frames.

Uses pyswisseph (Swiss Ephemeris) for sub-arcsecond precision.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

import numpy as np
import swisseph as swe

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Planet(Enum):
    MERCURY = swe.MERCURY  # 2
    MOON = swe.MOON        # 1


class Coordinate(Enum):
    LONGITUDE = 0  # index into swe.calc_ut result
    LATITUDE = 1


class Frame(Enum):
    GEO = 0          # geocentric (default)
    HELIO = 1        # heliocentric
    TOPO = 2         # topocentric (observer-dependent)


# Swiss Ephemeris flag for each frame
_FRAME_FLAGS = {
    Frame.GEO: 0,
    Frame.HELIO: swe.FLG_HELCTR,
    Frame.TOPO: swe.FLG_TOPOCTR,
}

# Note: Moon has no heliocentric position (it orbits Earth, not Sun).
# swe.calc_ut with FLG_HELCTR for Moon returns Earth-Moon barycenter.
# We'll handle that gracefully.

# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class PhaseCurve:
    """A computed phase curve — time series of planetary coordinate values."""
    planet: Planet
    coordinate: Coordinate
    frame: Frame
    timestamps: np.ndarray       # Julian Day UT values
    values: np.ndarray           # raw coordinate values (degrees)
    speeds: np.ndarray           # rate of change (degrees/day)
    datetimes: list[datetime]    # human-readable timestamps
    interval_minutes: float
    observer: Optional[tuple[float, float, float]] = None  # (lon, lat, alt) for topo

    @property
    def label(self) -> str:
        parts = [self.planet.name.lower(), self.coordinate.name.lower(), self.frame.name.lower()]
        return "_".join(parts)

    @property
    def direction(self) -> np.ndarray:
        """1 = rising, -1 = falling, 0 = stationary (speed < threshold)."""
        threshold = 0.001  # degrees/day
        d = np.zeros_like(self.speeds)
        d[self.speeds > threshold] = 1
        d[self.speeds < -threshold] = -1
        return d

    @property
    def turning_points(self) -> np.ndarray:
        """Indices where direction changes sign (potential market signals)."""
        d = self.direction
        changes = np.where(np.diff(d) != 0)[0]
        return changes

    def normalized(self, method: str = "zscore") -> np.ndarray:
        """Normalize values for overlay on price charts."""
        if method == "zscore":
            mu = np.mean(self.values)
            sigma = np.std(self.values)
            if sigma < 1e-10:
                return np.zeros_like(self.values)
            return (self.values - mu) / sigma
        elif method == "minmax":
            vmin, vmax = np.min(self.values), np.max(self.values)
            rng = vmax - vmin
            if rng < 1e-10:
                return np.zeros_like(self.values)
            return (self.values - vmin) / rng
        else:
            raise ValueError(f"Unknown normalization method: {method}")

    def to_dict(self) -> dict:
        """Serialize for JSON export / TypeScript bridge."""
        return {
            "label": self.label,
            "planet": self.planet.name,
            "coordinate": self.coordinate.name,
            "frame": self.frame.name,
            "interval_minutes": self.interval_minutes,
            "count": len(self.values),
            "timestamps_jd": self.timestamps.tolist(),
            "datetimes_iso": [dt.isoformat() for dt in self.datetimes],
            "values": self.values.tolist(),
            "speeds": self.speeds.tolist(),
            "turning_point_indices": self.turning_points.tolist(),
        }


# ---------------------------------------------------------------------------
# Generator
# ---------------------------------------------------------------------------

# Cache: avoid recomputing identical curves within a session
_cache: dict[str, PhaseCurve] = {}


def _cache_key(planet: Planet, coord: Coordinate, frame: Frame,
               jd_start: float, jd_end: float, interval_min: float,
               observer: Optional[tuple]) -> str:
    raw = f"{planet.name}:{coord.name}:{frame.name}:{jd_start}:{jd_end}:{interval_min}:{observer}"
    return hashlib.md5(raw.encode()).hexdigest()


def datetime_to_jd(dt: datetime) -> float:
    """Convert Python datetime to Julian Day UT."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt_utc = dt.astimezone(timezone.utc)
    return swe.julday(dt_utc.year, dt_utc.month, dt_utc.day,
                      dt_utc.hour + dt_utc.minute / 60.0 + dt_utc.second / 3600.0)


def jd_to_datetime(jd: float) -> datetime:
    """Convert Julian Day to Python datetime (UTC)."""
    year, month, day, hour_frac = swe.revjul(jd)
    hours = int(hour_frac)
    minutes = int((hour_frac - hours) * 60)
    seconds = int(((hour_frac - hours) * 60 - minutes) * 60)
    return datetime(year, month, day, hours, minutes, seconds, tzinfo=timezone.utc)


def compute_phase_curve(
    planet: Planet,
    coordinate: Coordinate,
    frame: Frame,
    start: datetime,
    end: datetime,
    interval_minutes: float = 1440.0,  # default: daily
    observer: Optional[tuple[float, float, float]] = None,  # (lon_deg, lat_deg, alt_m)
    use_cache: bool = True,
) -> PhaseCurve:
    """
    Compute a planetary phase curve over a time range.

    Parameters
    ----------
    planet : Planet.MERCURY or Planet.MOON
    coordinate : Coordinate.LONGITUDE or Coordinate.LATITUDE
    frame : Frame.GEO, Frame.HELIO, or Frame.TOPO
    start, end : datetime range (UTC)
    interval_minutes : bar interval in minutes (1440 = daily, 5 = 5-min)
    observer : (longitude_deg, latitude_deg, altitude_m) for topocentric.
               Required if frame == Frame.TOPO.

    Returns
    -------
    PhaseCurve with timestamps, values, speeds, and metadata.
    """
    if frame == Frame.TOPO and observer is None:
        raise ValueError("Topocentric frame requires observer=(lon, lat, alt)")

    if frame == Frame.HELIO and planet == Planet.MOON:
        # Moon doesn't have a meaningful heliocentric position.
        # We compute Earth-Moon barycenter instead, and note this.
        pass  # pyswisseph handles it, returns barycenter

    jd_start = datetime_to_jd(start)
    jd_end = datetime_to_jd(end)
    interval_days = interval_minutes / 1440.0

    # Check cache
    key = _cache_key(planet, coordinate, frame, jd_start, jd_end, interval_minutes, observer)
    if use_cache and key in _cache:
        return _cache[key]

    # Set up topocentric observer if needed
    if frame == Frame.TOPO and observer is not None:
        swe.set_topo(observer[0], observer[1], observer[2])

    # Build timestamp array
    n_steps = int((jd_end - jd_start) / interval_days) + 1
    jd_array = np.linspace(jd_start, jd_end, n_steps)

    flags = swe.FLG_SPEED | _FRAME_FLAGS[frame]
    coord_idx = coordinate.value          # 0 = lon, 1 = lat
    speed_idx = coord_idx + 3             # 3 = lon_speed, 4 = lat_speed

    values = np.empty(n_steps, dtype=np.float64)
    speeds = np.empty(n_steps, dtype=np.float64)
    datetimes = []

    for i, jd in enumerate(jd_array):
        result, ret_flags = swe.calc_ut(jd, planet.value, flags)
        values[i] = result[coord_idx]
        speeds[i] = result[speed_idx]
        datetimes.append(jd_to_datetime(jd))

    curve = PhaseCurve(
        planet=planet,
        coordinate=coordinate,
        frame=frame,
        timestamps=jd_array,
        values=values,
        speeds=speeds,
        datetimes=datetimes,
        interval_minutes=interval_minutes,
        observer=observer,
    )

    if use_cache:
        _cache[key] = curve

    return curve


def compute_all_curves(
    start: datetime,
    end: datetime,
    interval_minutes: float = 1440.0,
    observer: Optional[tuple[float, float, float]] = None,
    skip_moon_helio: bool = True,
) -> list[PhaseCurve]:
    """
    Compute all 12 (or 10) phase curve combinations.

    2 planets × 2 coordinates × 3 frames = 12 combos.
    Moon helio is skipped by default (not meaningful).
    """
    curves = []
    for planet in Planet:
        for coord in Coordinate:
            for frame in Frame:
                if skip_moon_helio and planet == Planet.MOON and frame == Frame.HELIO:
                    continue
                try:
                    curve = compute_phase_curve(
                        planet, coord, frame, start, end,
                        interval_minutes=interval_minutes,
                        observer=observer,
                    )
                    curves.append(curve)
                except Exception as e:
                    print(f"Warning: failed to compute {planet.name} {coord.name} {frame.name}: {e}")
    return curves


def clear_cache():
    """Clear the in-memory curve cache."""
    _cache.clear()


# ---------------------------------------------------------------------------
# Convenience: longitude unwrapping for correlation
# ---------------------------------------------------------------------------

def unwrap_longitude(values: np.ndarray) -> np.ndarray:
    """
    Unwrap longitude values that wrap at 360° → 0° so that
    correlation analysis sees smooth continuous motion instead
    of discontinuous jumps.
    """
    return np.unwrap(np.radians(values)) * (180.0 / np.pi)


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    from datetime import timedelta

    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    end = datetime(2024, 12, 31, tzinfo=timezone.utc)

    print("Computing Mercury geocentric latitude (daily, 1 year)...")
    curve = compute_phase_curve(Planet.MERCURY, Coordinate.LATITUDE, Frame.GEO, start, end)
    print(f"  Points: {len(curve.values)}")
    print(f"  Range: {curve.values.min():.4f}° to {curve.values.max():.4f}°")
    print(f"  Turning points: {len(curve.turning_points)}")
    print(f"  Label: {curve.label}")

    print("\nComputing all curves...")
    all_curves = compute_all_curves(start, end)
    for c in all_curves:
        print(f"  {c.label}: {len(c.values)} pts, range [{c.values.min():.2f}, {c.values.max():.2f}]")
