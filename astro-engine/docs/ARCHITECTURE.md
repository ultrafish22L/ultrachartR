# Astro Engine Architecture

## Overview

The Astro Engine is a **planetary phase-curve correlation engine** that computes Mercury and Moon latitude/longitude cycles in heliocentric, geocentric, and topocentric reference frames, then measures their directional correlation with market price data. It discovers which phase curves track which markets, with what lag, and scores future moments based on trained relationships.

It is **not** a generative AI or LLM — it's a signal extraction and scoring tool that serves as input to those systems.

## System Diagram

```
┌─────────────────────────────────────┐
│  TypeScript API / LLM Tool Layer    │  query: "score soybeans now"
│  (ts-bridge/engine.ts)              │
└──────────────┬──────────────────────┘
               │ JSON over stdio (bridge.py)
┌──────────────▼──────────────────────┐
│  Python Correlation Engine          │
│                                     │
│  phase_curves.py                    │  Swiss Ephemeris (pyswisseph)
│    └─ compute Mercury/Moon lat/lon  │  0.001 arcsecond precision
│       in helio/geo/topo frames      │  13201 BC to 17191 AD
│                                     │
│  market_data.py                     │  CSV/Parquet loader
│    └─ OHLCV + returns + swings      │  auto-detect format
│                                     │
│  correlation.py                     │  the core engine
│    └─ Pearson, Spearman, rolling    │  cross-correlation with lag
│       directional agreement         │  composite scoring
│                                     │
│  trainer.py                         │  parameter optimization
│    └─ sweep windows + lags          │  walk-forward validation
│       rank curves, save profile     │  generalization ratio
│                                     │
│  scorer.py                          │  real-time scoring
│    └─ compute curves at "now"       │  predict turning points
│       weighted composite signal     │  timing windows
│                                     │
│  visualize.py                       │  interactive Plotly charts
│    └─ price candles + curve overlay │  correlation heatstrip
│       turning point markers         │  HTML export
└─────────────────────────────────────┘
```

## Phase Space

The engine computes **12 possible phase curves** (10 usable without observer location):

| # | Planet  | Coordinate | Frame   | Notes |
|---|---------|-----------|---------|-------|
| 1 | Mercury | Longitude  | Geo     | Includes retrograde loops |
| 2 | Mercury | Longitude  | Helio   | Smooth orbital motion |
| 3 | Mercury | Longitude  | Topo*   | Observer-dependent |
| 4 | Mercury | Latitude   | Geo     | Oscillates ~±5° |
| 5 | Mercury | Latitude   | Helio   | Oscillates ~±7° |
| 6 | Mercury | Latitude   | Topo*   | Observer-dependent |
| 7 | Moon    | Longitude  | Geo     | ~13°/day, wraps 360° monthly |
| 8 | Moon    | Longitude  | Topo*   | Observer-dependent |
| 9 | Moon    | Latitude   | Geo     | Oscillates ~±5.3° |
| 10| Moon    | Latitude   | Topo*   | Observer-dependent |
| 11| Moon    | Longitude  | Helio   | Earth-Moon barycenter (less useful) |
| 12| Moon    | Latitude   | Helio   | Earth-Moon barycenter (less useful) |

*Topo requires observer location (longitude, latitude, altitude).

## Key Concepts

### Phase Curves
A phase curve is a time series of one planetary coordinate value. For latitude, it naturally oscillates — rising and falling as the planet moves above and below the ecliptic. For longitude, it increases monotonically (heliocentric) or has retrograde loops (geocentric). Longitude is unwrapped for correlation analysis to avoid 360°→0° discontinuities.

### Directional Correlation
The core hypothesis: when a phase curve rises, price rises; when it falls, price falls. The correlation scanner measures this alignment using:
- **Pearson correlation**: linear relationship between curve values and price
- **Spearman correlation**: rank-based (handles non-linear relationships)
- **Directional agreement**: % of bars where curve direction matches price direction
- **Rolling correlation**: stability of the relationship over time

### Lag/Lead
A phase curve may lead or lag price. Cross-correlation sweeps lag values to find the optimal offset. Positive lag = curve leads price (predictive).

### Composite Score
Curves are ranked by: `|correlation| × stability × significance`. A curve that has moderate correlation but is very consistent over time scores higher than one with occasional high correlation but poor stability.

### Walk-Forward Validation
The data is split 70/30. The system trains on the first 70% and tests on the last 30%. The **generalization ratio** (out-of-sample score / in-sample score) measures whether the relationship is real or overfit. Values near 1.0 = generalizes well.

## Data Flow

### Training
1. Load market data (CSV/Parquet)
2. Compute all phase curves over the market's date range
3. For each curve: sweep lag values and window sizes
4. Measure correlation, direction agreement, and stability
5. Walk-forward validate the top curves
6. Save ranked profile to JSON

### Scoring
1. Load trained profile
2. For each ranked curve: compute planetary position at "now" via Swiss Ephemeris
3. Determine current direction (rising/falling/turning)
4. Look ahead to find next turning point
5. Compute weighted composite signal from all active curves
6. Return score with timing predictions

### Visualization
1. Load profile + market data
2. Compute phase curves over the date range
3. Scale curve values to price axis range
4. Render as interactive Plotly chart with candles + curve overlays
5. Show correlation strength in bottom panel
6. Export as HTML for browser viewing
