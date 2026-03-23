# Astro Engine Design Rationale

## Why This Approach

### The Problem
You visually overlay Mercury and Moon phase curves (latitude and longitude, in various reference frames) on market price charts and observe directional correlation. The system needs to:
1. Quantify what you see visually
2. Discover which specific curves work best for which markets
3. Find optimal lead/lag timing
4. Validate that relationships are real (not overfit)
5. Score the current moment in real-time

### Why Not Classical ML
Traditional ML (neural networks, random forests on raw features) is the wrong tool here because:
- **You already know the features** — Mercury and Moon phases. No need for feature discovery.
- **The signal is directional correlation** — a well-understood statistical measure, not a complex nonlinear pattern.
- **Interpretability matters** — you need to see which curve correlates and how, not get a black-box probability.
- **The data is small** — decades of daily bars = ~7,000 points. ML models need orders of magnitude more.

What you need is **parameter optimization + statistical validation**, which is exactly what this engine provides.

### Why Phase Curves Specifically
Phase curves capture the physical motion of Mercury and Moon:
- **Latitude**: oscillates as the planet moves above/below the ecliptic plane. Natural periodicity with clear turning points.
- **Longitude**: smooth motion (heliocentric) or retrograde-loop motion (geocentric). Unwrapped for correlation.
- **Speed**: rate of change — stations (speed = 0) mark turning points.

Different reference frames see different cycles:
- **Geocentric**: what we see from Earth. Includes retrograde motion for Mercury.
- **Heliocentric**: the "true" orbital motion. Smooth, no retrogrades.
- **Topocentric**: observer-specific. Adds parallax effects (mainly relevant for Moon).

## Key Design Decisions

### 1. Swiss Ephemeris On-Demand (No Database)
Planetary positions are computed on-the-fly via `pyswisseph`. At 0.3ms per complete planetary set, there's no need to pre-compute and store positions. This eliminates a database dependency and ensures positions are always at the exact timestamps needed.

### 2. Correlation, Not Prediction
The system measures **how well a curve has tracked price historically**, not "what will the price be tomorrow." This is an important distinction:
- High correlation + curve rising = bullish signal
- High correlation + curve turning = potential reversal window
- Low correlation = that curve doesn't work for this market

### 3. Walk-Forward Validation
The biggest risk in this kind of analysis is overfitting — finding spurious correlations in historical data that don't generalize. Walk-forward validation (train on 70%, test on 30%) with a generalization ratio guards against this.

### 4. Composite Scoring
Rather than relying on a single metric, curves are ranked by a composite of:
- Absolute correlation strength
- Stability (consistency of rolling correlation)
- Statistical significance (p-value)

This prevents a curve that had one lucky window of high correlation from ranking above a curve with moderate but consistent correlation.

### 5. Longitude Unwrapping
Geocentric longitude wraps from 360° to 0°, creating artificial discontinuities. `unwrap_longitude()` makes the series continuous for correlation analysis. Without this, a steadily moving planet would show false turning points at the wrap boundary.

## Future Directions

### Aspect-Based Features
Currently the system works with raw phase curves. Adding inter-planetary aspects (Mercury-Moon angular separation) would capture their combined influence. This could be implemented as additional "virtual curves."

### Multi-Timeframe Fusion
Training independently on 5-min and daily data, then fusing the scores (e.g., daily trend + 5-min timing) would give both direction and entry precision.

### Adaptive Lag
The current system uses a fixed optimal lag per curve. In practice, the lag may vary — shorter during fast markets, longer during slow ones. A regime-switching lag model could improve timing accuracy.

### Cycle Phase Normalization
Instead of raw latitude/longitude, normalize to "phase within cycle" (0.0 to 1.0). This makes different cycles directly comparable and could reveal phase-specific effects (e.g., "market tends to reverse at 75% of Mercury's latitude cycle").
