"""
Market Data Loader — loads OHLCV data from CSV/Parquet files,
aligns timestamps with Julian Day for ephemeris calculations,
and extracts directional/event features for correlation analysis.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd

from phase_curves import datetime_to_jd


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class MarketData:
    """Loaded and processed market data."""
    symbol: str
    interval: str                    # "5min", "daily", etc.
    df: pd.DataFrame                 # OHLCV + derived columns
    timestamps_jd: np.ndarray        # Julian Day for each bar
    returns: np.ndarray              # close-to-close returns
    direction: np.ndarray            # 1 = up, -1 = down, 0 = flat
    swing_highs: np.ndarray          # indices of swing high bars
    swing_lows: np.ndarray           # indices of swing low bars

    @property
    def close(self) -> np.ndarray:
        return self.df["close"].values

    @property
    def count(self) -> int:
        return len(self.df)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "interval": self.interval,
            "count": self.count,
            "date_range": f"{self.df.index[0]} to {self.df.index[-1]}",
            "swing_highs": len(self.swing_highs),
            "swing_lows": len(self.swing_lows),
        }


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize column names to lowercase standard: open, high, low, close, volume."""
    col_map = {}
    for col in df.columns:
        lower = col.strip().lower()
        if lower in ("open", "o"):
            col_map[col] = "open"
        elif lower in ("high", "h"):
            col_map[col] = "high"
        elif lower in ("low", "l"):
            col_map[col] = "low"
        elif lower in ("close", "c", "last", "settle"):
            col_map[col] = "close"
        elif lower in ("volume", "vol", "v"):
            col_map[col] = "volume"
        elif lower in ("date", "datetime", "time", "timestamp"):
            col_map[col] = "datetime"
    df = df.rename(columns=col_map)
    return df


def _parse_datetime_index(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure the DataFrame has a DatetimeIndex."""
    if isinstance(df.index, pd.DatetimeIndex):
        return df

    # Try 'datetime' column first
    for col in ("datetime", "date", "time", "timestamp"):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col])
            df = df.set_index(col)
            return df

    # Try parsing the existing index
    try:
        df.index = pd.to_datetime(df.index)
    except (ValueError, TypeError) as e:
        raise ValueError(f"Could not find or parse datetime column/index: {e}") from e

    return df


def load_csv(
    path: str | Path,
    symbol: str = "unknown",
    interval: str = "daily",
) -> MarketData:
    """
    Load market data from a CSV file.

    Handles various column naming conventions and date formats.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Market data file not found: {path}")

    df = pd.read_csv(path)
    df = _normalize_columns(df)
    df = _parse_datetime_index(df)
    df = df.sort_index()

    # Drop rows with missing close
    if "close" not in df.columns:
        raise ValueError(f"No 'close' column found. Columns: {list(df.columns)}")
    df = df.dropna(subset=["close"])

    return _process_market_data(df, symbol, interval)


def load_parquet(
    path: str | Path,
    symbol: str = "unknown",
    interval: str = "daily",
) -> MarketData:
    """Load market data from a Parquet file."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Market data file not found: {path}")

    df = pd.read_parquet(path)
    df = _normalize_columns(df)
    df = _parse_datetime_index(df)
    df = df.sort_index()
    df = df.dropna(subset=["close"])

    return _process_market_data(df, symbol, interval)


def load_auto(
    path: str | Path,
    symbol: str = "unknown",
    interval: str = "daily",
) -> MarketData:
    """Auto-detect file format and load."""
    path = Path(path)
    suffix = path.suffix.lower()
    if suffix == ".parquet" or suffix == ".pq":
        return load_parquet(path, symbol, interval)
    elif suffix in (".csv", ".tsv", ".txt"):
        return load_csv(path, symbol, interval)
    else:
        # Try CSV as fallback
        return load_csv(path, symbol, interval)


# ---------------------------------------------------------------------------
# Processing
# ---------------------------------------------------------------------------

def _process_market_data(df: pd.DataFrame, symbol: str, interval: str) -> MarketData:
    """Compute derived fields from raw OHLCV data."""
    close = df["close"].values.astype(np.float64)

    # Returns (close-to-close percentage change)
    returns = np.zeros(len(close))
    prev_close = close[:-1]
    safe_prev = np.where(prev_close != 0, prev_close, np.nan)
    returns[1:] = np.nan_to_num(np.diff(close) / safe_prev, nan=0.0)

    # Direction
    direction = np.zeros(len(close))
    direction[returns > 0] = 1
    direction[returns < 0] = -1

    # Julian Day timestamps
    timestamps_jd = np.array([
        datetime_to_jd(dt.to_pydatetime().replace(tzinfo=timezone.utc)
                       if dt.tzinfo is None else dt.to_pydatetime())
        for dt in df.index
    ])

    # Swing detection (simple N-bar method)
    swing_highs, swing_lows = _detect_swings(df, lookback=5)

    return MarketData(
        symbol=symbol,
        interval=interval,
        df=df,
        timestamps_jd=timestamps_jd,
        returns=returns,
        direction=direction,
        swing_highs=swing_highs,
        swing_lows=swing_lows,
    )


def _detect_swings(df: pd.DataFrame, lookback: int = 5) -> tuple[np.ndarray, np.ndarray]:
    """
    Detect swing highs and lows using N-bar method.

    A swing high at bar i means high[i] is the highest high
    in the window [i-lookback, i+lookback]. Similarly for lows.
    Bars within `lookback` of the edges are excluded.

    Parameters
    ----------
    df : DataFrame with 'high' and 'low' columns
    lookback : number of bars to look each side of a candidate

    Returns
    -------
    (swing_high_indices, swing_low_indices) as integer numpy arrays.
    """
    if "high" not in df.columns or "low" not in df.columns:
        return np.array([], dtype=int), np.array([], dtype=int)

    high = df["high"].values
    low = df["low"].values
    n = len(high)

    swing_highs = []
    swing_lows = []

    for i in range(lookback, n - lookback):
        window_high = high[i - lookback:i + lookback + 1]
        window_low = low[i - lookback:i + lookback + 1]

        if high[i] == np.max(window_high):
            swing_highs.append(i)
        if low[i] == np.min(window_low):
            swing_lows.append(i)

    return np.array(swing_highs, dtype=int), np.array(swing_lows, dtype=int)


# ---------------------------------------------------------------------------
# JSON bar ingestion (UltraChart format)
# ---------------------------------------------------------------------------

def load_from_json(
    bars: list[dict],
    symbol: str = "unknown",
    interval: str = "daily",
) -> MarketData:
    """
    Load market data from a list of UltraChart-format bar dicts.

    Each bar: {"t": unix_ms, "o": float, "h": float, "l": float, "c": float, "v": float}
    """
    if not bars:
        raise ValueError("No bars provided")

    # Convert to DataFrame
    records = []
    for b in bars:
        dt = datetime.fromtimestamp(b["t"] / 1000.0, tz=timezone.utc)
        records.append({
            "datetime": dt,
            "open": float(b["o"]),
            "high": float(b["h"]),
            "low": float(b["l"]),
            "close": float(b["c"]),
            "volume": float(b.get("v", 0)),
        })

    df = pd.DataFrame(records)
    df = df.set_index("datetime")
    df = df.sort_index()
    df = df.dropna(subset=["close"])

    return _process_market_data(df, symbol, interval)


# ---------------------------------------------------------------------------
# Synthetic data generator (for testing)
# ---------------------------------------------------------------------------

def generate_synthetic(
    days: int = 365,
    interval_minutes: float = 1440.0,
    seed: int = 42,
) -> MarketData:
    """
    Generate synthetic market data for testing.

    Creates a random walk with some trend and volatility variation.
    """
    rng = np.random.default_rng(seed)
    n_bars = int(days * 1440 / interval_minutes)

    start = datetime(2024, 1, 1, tzinfo=timezone.utc)
    dates = pd.date_range(start, periods=n_bars, freq=f"{int(interval_minutes)}min")

    # Random walk with drift
    returns = rng.normal(0.0001, 0.015, n_bars)
    price = 1500.0 * np.exp(np.cumsum(returns))  # soybean-ish starting price

    df = pd.DataFrame({
        "open": price * (1 + rng.normal(0, 0.002, n_bars)),
        "high": price * (1 + np.abs(rng.normal(0, 0.005, n_bars))),
        "low": price * (1 - np.abs(rng.normal(0, 0.005, n_bars))),
        "close": price,
        "volume": rng.integers(1000, 50000, n_bars),
    }, index=dates)

    return _process_market_data(df, "SYNTHETIC", "daily" if interval_minutes >= 1440 else "intraday")


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Generating synthetic market data...")
    mkt = generate_synthetic(days=365)
    print(f"  Symbol: {mkt.symbol}")
    print(f"  Bars: {mkt.count}")
    print(f"  Date range: {mkt.df.index[0]} to {mkt.df.index[-1]}")
    print(f"  Swing highs: {len(mkt.swing_highs)}")
    print(f"  Swing lows: {len(mkt.swing_lows)}")
    print(f"  Close range: {mkt.close.min():.2f} to {mkt.close.max():.2f}")
