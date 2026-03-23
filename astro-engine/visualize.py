"""
Visualization — generates interactive Plotly charts that overlay
planetary phase curves on market price data.

This is the validation tool: it lets you confirm visually that
the system "sees" what you see when you overlay curves on charts.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from phase_curves import (
    Planet, Coordinate, Frame, PhaseCurve,
    compute_phase_curve, unwrap_longitude,
)
from market_data import MarketData, load_auto, generate_synthetic
from trainer import TrainedProfile, CurveProfile
from correlation import correlate


# ---------------------------------------------------------------------------
# Color palette for phase curves
# ---------------------------------------------------------------------------

CURVE_COLORS = {
    "mercury_longitude_geo": "#FF6B35",
    "mercury_longitude_helio": "#FF9F1C",
    "mercury_latitude_geo": "#E71D36",
    "mercury_latitude_helio": "#FF006E",
    "mercury_longitude_topo": "#FB5607",
    "mercury_latitude_topo": "#FFBE0B",
    "moon_longitude_geo": "#3A86FF",
    "moon_longitude_helio": "#8338EC",
    "moon_latitude_geo": "#06D6A0",
    "moon_latitude_topo": "#118AB2",
    "moon_longitude_topo": "#073B4C",
    "moon_latitude_helio": "#7209B7",
}


def _get_color(label: str) -> str:
    return CURVE_COLORS.get(label, "#888888")


# ---------------------------------------------------------------------------
# Main chart generator
# ---------------------------------------------------------------------------

def generate_overlay_chart(
    profile: TrainedProfile,
    market: MarketData,
    output_path: str = "chart.html",
    curve_labels: Optional[list[str]] = None,
    top_n: int = 4,
    show_turning_points: bool = True,
    show_correlation_bands: bool = True,
    observer: Optional[tuple[float, float, float]] = None,
) -> str:
    """
    Generate an interactive Plotly chart with price candles + phase curve overlays.

    Parameters
    ----------
    profile : TrainedProfile with ranked curves
    market : MarketData to display
    output_path : where to save the HTML file
    curve_labels : specific curves to show (default: top N from profile)
    top_n : how many curves to show if curve_labels not specified
    show_turning_points : mark turning points on curves
    show_correlation_bands : shade regions of strong correlation
    observer : (lon, lat, alt) for topocentric curves

    Returns
    -------
    Path to saved HTML file.
    """
    # Select curves to display
    if curve_labels:
        selected = [cp for cp in profile.curves if cp.curve_label in curve_labels]
    else:
        selected = [cp for cp in profile.curves if cp.composite_score > 0][:top_n]
        if not selected:
            selected = profile.curves[:top_n]

    # Compute phase curves over the market's time range
    start_dt = market.df.index[0].to_pydatetime()
    end_dt = market.df.index[-1].to_pydatetime()
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=timezone.utc)

    interval = _guess_interval(market)

    _PLANET_MAP = {"MERCURY": Planet.MERCURY, "MOON": Planet.MOON}
    _COORD_MAP = {"LONGITUDE": Coordinate.LONGITUDE, "LATITUDE": Coordinate.LATITUDE}
    _FRAME_MAP = {"GEO": Frame.GEO, "HELIO": Frame.HELIO, "TOPO": Frame.TOPO}

    # Create figure with secondary y-axis
    n_curves = len(selected)
    fig = make_subplots(
        rows=2, cols=1,
        shared_xaxes=True,
        vertical_spacing=0.03,
        row_heights=[0.7, 0.3],
        subplot_titles=[
            f"{market.symbol} ({market.interval}) with Phase Curves",
            "Correlation Strength"
        ],
    )

    # Price candlestick
    dates = market.df.index

    if all(col in market.df.columns for col in ["open", "high", "low", "close"]):
        fig.add_trace(
            go.Candlestick(
                x=dates,
                open=market.df["open"],
                high=market.df["high"],
                low=market.df["low"],
                close=market.df["close"],
                name=market.symbol,
                increasing_line_color="#26A69A",
                decreasing_line_color="#EF5350",
            ),
            row=1, col=1,
        )
    else:
        fig.add_trace(
            go.Scatter(
                x=dates, y=market.close,
                mode="lines", name=market.symbol,
                line=dict(color="#CCCCCC", width=1),
            ),
            row=1, col=1,
        )

    # Overlay each selected phase curve
    price_min = market.close.min()
    price_max = market.close.max()
    price_range = price_max - price_min

    for cp in selected:
        planet = _PLANET_MAP.get(cp.planet)
        coord = _COORD_MAP.get(cp.coordinate)
        frame = _FRAME_MAP.get(cp.frame)

        if planet is None or coord is None or frame is None:
            continue
        if frame == Frame.TOPO and observer is None:
            continue

        try:
            curve = compute_phase_curve(
                planet, coord, frame, start_dt, end_dt,
                interval_minutes=interval, observer=observer,
            )
        except Exception as e:
            print(f"Warning: could not compute {cp.curve_label}: {e}")
            continue

        # Scale curve to overlay on price range
        vals = curve.values.copy()
        if coord == Coordinate.LONGITUDE:
            vals = unwrap_longitude(vals)

        # Normalize to price range
        v_min, v_max = vals.min(), vals.max()
        v_range = v_max - v_min
        if v_range < 1e-10:
            continue

        # Map curve values to price axis range (with some padding)
        scaled = price_min + (vals - v_min) / v_range * price_range

        # Apply lag offset if significant
        lag = cp.optimal_lag
        curve_dates = list(curve.datetimes)

        color = _get_color(cp.curve_label)
        lag_label = f" (lag {lag})" if lag != 0 else ""

        fig.add_trace(
            go.Scatter(
                x=curve_dates,
                y=scaled,
                mode="lines",
                name=f"{cp.curve_label}{lag_label} (r={cp.pearson_r:+.2f})",
                line=dict(color=color, width=2, dash="dot"),
                opacity=0.8,
                yaxis="y",
            ),
            row=1, col=1,
        )

        # Mark turning points
        if show_turning_points and len(curve.turning_points) > 0:
            tp_idx = curve.turning_points
            tp_dates = [curve_dates[i] for i in tp_idx if i < len(curve_dates)]
            tp_vals = [scaled[i] for i in tp_idx if i < len(scaled)]

            fig.add_trace(
                go.Scatter(
                    x=tp_dates, y=tp_vals,
                    mode="markers",
                    name=f"{cp.curve_label} turns",
                    marker=dict(color=color, size=8, symbol="diamond"),
                    showlegend=False,
                ),
                row=1, col=1,
            )

        # Rolling correlation in bottom panel
        if show_correlation_bands:
            try:
                result = correlate(curve, market, window_size=cp.best_window_size)

                # Compute rolling correlation series
                from correlation import _align_series, _rolling_correlation
                cv, pv = _align_series(curve, market)
                if coord == Coordinate.LONGITUDE:
                    cv = unwrap_longitude(cv)
                rolling = _rolling_correlation(cv, pv, cp.best_window_size)

                # Align rolling corr with dates (offset by window)
                corr_dates = dates[cp.best_window_size - 1:cp.best_window_size - 1 + len(rolling)]

                fig.add_trace(
                    go.Scatter(
                        x=corr_dates, y=rolling,
                        mode="lines",
                        name=f"{cp.curve_label} corr",
                        line=dict(color=color, width=1),
                    ),
                    row=2, col=1,
                )
            except Exception:
                pass

    # Zero line in correlation panel
    fig.add_hline(y=0, line_dash="dash", line_color="gray", row=2, col=1)

    # Layout
    fig.update_layout(
        height=900,
        template="plotly_dark",
        title=f"Phase Curve Analysis: {market.symbol}",
        xaxis_rangeslider_visible=False,
        legend=dict(
            orientation="h",
            yanchor="bottom",
            y=1.02,
            xanchor="right",
            x=1,
        ),
    )

    fig.update_yaxes(title_text="Price", row=1, col=1)
    fig.update_yaxes(title_text="Correlation", range=[-1, 1], row=2, col=1)

    # Save
    output_path = str(output_path)
    fig.write_html(output_path)
    print(f"Chart saved to {output_path}")
    return output_path


def _guess_interval(market: MarketData) -> float:
    if market.count < 2:
        return 1440.0
    diffs = market.df.index.to_series().diff().dropna()
    if len(diffs) > 0:
        median_diff = diffs.median()
        return max(1.0, median_diff.total_seconds() / 60.0)
    return 1440.0


# ---------------------------------------------------------------------------
# Quick standalone chart (no profile needed)
# ---------------------------------------------------------------------------

def quick_chart(
    market: MarketData,
    planets: list[Planet] = None,
    coordinates: list[Coordinate] = None,
    frames: list[Frame] = None,
    output_path: str = "quick_chart.html",
    observer: Optional[tuple] = None,
) -> str:
    """
    Generate a quick overlay chart without training.
    Shows all specified curves scaled onto the price chart.
    """
    if planets is None:
        planets = [Planet.MERCURY, Planet.MOON]
    if coordinates is None:
        coordinates = [Coordinate.LATITUDE, Coordinate.LONGITUDE]
    if frames is None:
        frames = [Frame.GEO, Frame.HELIO]

    start_dt = market.df.index[0].to_pydatetime()
    end_dt = market.df.index[-1].to_pydatetime()
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    if end_dt.tzinfo is None:
        end_dt = end_dt.replace(tzinfo=timezone.utc)

    interval = _guess_interval(market)

    fig = go.Figure()

    # Price
    dates = market.df.index
    fig.add_trace(go.Scatter(
        x=dates, y=market.close,
        mode="lines", name=market.symbol,
        line=dict(color="white", width=2),
    ))

    price_min, price_max = market.close.min(), market.close.max()
    price_range = price_max - price_min

    for planet in planets:
        for coord in coordinates:
            for frame in frames:
                if planet == Planet.MOON and frame == Frame.HELIO:
                    continue
                if frame == Frame.TOPO and observer is None:
                    continue

                try:
                    curve = compute_phase_curve(
                        planet, coord, frame, start_dt, end_dt,
                        interval_minutes=interval, observer=observer,
                    )
                except Exception:
                    continue

                vals = curve.values.copy()
                if coord == Coordinate.LONGITUDE:
                    vals = unwrap_longitude(vals)

                v_min, v_max = vals.min(), vals.max()
                v_range = v_max - v_min
                if v_range < 1e-10:
                    continue

                scaled = price_min + (vals - v_min) / v_range * price_range
                color = _get_color(curve.label)

                fig.add_trace(go.Scatter(
                    x=list(curve.datetimes), y=scaled,
                    mode="lines", name=curve.label,
                    line=dict(color=color, width=1.5, dash="dot"),
                    opacity=0.7,
                ))

    fig.update_layout(
        height=700,
        template="plotly_dark",
        title=f"Phase Curves: {market.symbol}",
        yaxis_title="Price (curves scaled to match)",
    )

    fig.write_html(output_path)
    print(f"Quick chart saved to {output_path}")
    return output_path


# ---------------------------------------------------------------------------
# Quick test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("Generating synthetic data + quick chart...")
    market = generate_synthetic(days=365)
    quick_chart(market, output_path="test_chart.html")

    # If we have a trained profile, make the full chart too
    profile_path = Path("models/test_profile.json")
    if profile_path.exists():
        profile = TrainedProfile.load(profile_path)
        generate_overlay_chart(profile, market, output_path="test_overlay.html")
