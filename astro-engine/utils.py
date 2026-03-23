"""Shared utility functions and constants for the astro-engine package."""

from __future__ import annotations

from typing import TYPE_CHECKING

from phase_curves import ZERO_VARIANCE_THRESHOLD  # re-export

if TYPE_CHECKING:
    from market_data import MarketData

__all__ = ["guess_interval", "ZERO_VARIANCE_THRESHOLD"]


def guess_interval(market: MarketData) -> float:
    """Guess bar interval in minutes from market data timestamps."""
    if market.count < 2:
        return 1440.0
    if hasattr(market.df.index, "to_series"):
        diffs = market.df.index.to_series().diff().dropna()
        if len(diffs) > 0:
            median_diff = diffs.median()
            return max(1.0, median_diff.total_seconds() / 60.0)
    return 1440.0
