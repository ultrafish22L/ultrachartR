# Astro Engine Usage Guide

## Quick Start

### 1. Install Dependencies

```bash
pip install pyswisseph numpy pandas scipy plotly pyarrow
```

### 2. Train on Your Market Data

```python
from market_data import load_csv
from trainer import train

# Load your soybean data
market = load_csv("data/soybeans_daily.csv", symbol="ZS", interval="daily")

# Train — scans all Mercury/Moon curves, finds best correlations
profile = train(market, validate=True)

# Save the trained profile
profile.save("models/soybeans_daily.json")
```

For topocentric calculations (observer-specific), pass your location:

```python
# Chicago Board of Trade: 41.8781° N, 87.6298° W, 181m
observer = (-87.6298, 41.8781, 181.0)
profile = train(market, observer=observer, validate=True)
```

### 3. Score the Current Moment

```python
from trainer import TrainedProfile
from scorer import score

profile = TrainedProfile.load("models/soybeans_daily.json")
result = score(profile)

print(f"Composite direction: {result.composite_direction:+.4f}")
print(f"Strongest signal: {result.strongest_signal}")
print(f"Timing: {result.timing_note}")

for sig in result.signals:
    print(f"  {sig.curve_label}: {sig.direction}, "
          f"correlation={sig.correlation_with_price:+.3f}")
    if sig.next_turning_point:
        print(f"    -> next turn: {sig.next_turning_point}")
```

### 4. Visualize

```python
from visualize import generate_overlay_chart, quick_chart
from market_data import load_csv
from trainer import TrainedProfile

market = load_csv("data/soybeans_daily.csv", symbol="ZS", interval="daily")

# Quick chart (no training needed — shows all curves)
quick_chart(market, output_path="soybeans_quick.html")

# Full chart with trained profile (shows ranked curves + correlation)
profile = TrainedProfile.load("models/soybeans_daily.json")
generate_overlay_chart(profile, market, output_path="soybeans_analysis.html")
```

Open the HTML file in any browser for interactive zoom/pan.

## Market Data Format

The loader accepts CSV or Parquet files with these columns (case-insensitive):

| Required | Column Names Accepted |
|----------|----------------------|
| Yes | `close`, `c`, `last`, `settle` |
| Optional | `open`, `o` |
| Optional | `high`, `h` |
| Optional | `low`, `l` |
| Optional | `volume`, `vol`, `v` |
| Optional | `datetime`, `date`, `time`, `timestamp` |

The datetime can be in the index or a column. Most common CSV formats work automatically.

### Example CSV

```csv
datetime,open,high,low,close,volume
2024-01-02 09:30:00,1485.50,1492.25,1483.00,1489.75,25430
2024-01-02 09:35:00,1489.75,1491.50,1488.00,1490.25,18210
...
```

## TypeScript Integration

The TypeScript bridge spawns Python as a subprocess:

```typescript
import { AstroEngine } from './ts-bridge/engine';

const engine = new AstroEngine();
await engine.start();

// Train
const profile = await engine.train(
  'data/soybeans_daily.csv',
  'ZS',
  'daily'
);

// Score
const result = await engine.score('models/ZS_daily_profile.json');
console.log(result.composite_direction);
console.log(result.timing_note);

// Chart
await engine.generateChart(
  'models/ZS_daily_profile.json',
  'data/soybeans_daily.csv',
  'ZS',
  'soybeans_chart.html'
);

await engine.stop();
```

## Command-Line Usage

Each module can be run standalone:

```bash
# Test phase curve generation
python phase_curves.py

# Test market data loading
python market_data.py

# Run correlation scan on synthetic data
python correlation.py

# Train on synthetic data (validation test)
python trainer.py

# Score using saved profile
python scorer.py

# Generate charts
python visualize.py
```

## Understanding the Output

### Trained Profile (JSON)

```json
{
  "market_symbol": "ZS",
  "best_curve": "mercury_latitude_helio",
  "best_score": 0.342,
  "curves": [
    {
      "curve_label": "mercury_latitude_helio",
      "pearson_r": 0.45,          // correlation with price
      "optimal_lag": 3,            // curve leads price by 3 bars
      "direction_agreement": 0.62, // 62% of bars match direction
      "composite_score": 0.342,    // overall quality
      "generalization_ratio": 0.85 // out-of-sample holds up
    }
  ]
}
```

### Score Result

```json
{
  "composite_direction": +0.35,      // positive = bullish aggregate
  "strongest_signal": "mercury_latitude_helio",
  "timing_note": "mercury_latitude_helio turns in ~4 bars",
  "signals": [
    {
      "curve": "mercury_latitude_helio",
      "direction": "rising",          // curve is currently going up
      "correlation": 0.45,            // positive = same direction as price
      "lag_bars": 3,                  // 3 bars ahead
      "next_turning": "2024-06-20T18:00:00+00:00",
      "bars_to_turning": 4
    }
  ]
}
```

### Interpreting Results

- **composite_direction > 0**: weighted aggregate of curves says bullish
- **composite_direction < 0**: weighted aggregate says bearish
- **direction = "turning_up"**: curve just reversed from falling to rising
- **direction = "turning_down"**: curve just reversed from rising to falling
- **bars_to_turning**: how many bars until the next direction change (timing window)
- **correlation > 0**: curve and price move in same direction
- **correlation < 0**: curve and price move in opposite directions

## Running Tests

```bash
cd astro-engine
python -m pytest tests/ -v
```

28 tests covering:
- Phase curve generation (all planet/coord/frame combos)
- Date conversion roundtrips
- Correlation on correlated vs. random synthetic data
- Scorer output format and fields
- Profile save/load roundtrip
