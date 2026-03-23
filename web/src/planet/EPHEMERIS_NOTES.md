# Legacy UltraChart Ephemeris — How Each Mode Works

## Data Structure: `cEphemData`

Each planet line object has its own `cEphemData` with these key fields:

| Field | Default | Purpose |
|-------|---------|---------|
| `DoHelio` | **true** | Heliocentric mode (from Sun) |
| `DoGeo` | false | Geocentric mode (from Earth center) |
| `DoTopo` | false | Topocentric mode (from observer on Earth surface) |
| `Lat` | 34.033 | Observer latitude (Santa Monica, CA) |
| `Lon` | -118.75 | Observer longitude |
| `Elevation` | 22 | Observer elevation (meters) |
| `DiffGMT` | -8 | GMT offset for time conversion |

The three mode flags are **mutually exclusive radio buttons** — exactly one is true.

## Swiss Ephemeris Flag Computation

The flag formula used everywhere in legacy:

```cpp
u32 flags = SEFLG_SWIEPH | (DoHelio ? SEFLG_HELCTR : DoTopo ? SEFLG_TOPOCTR : 0);
```

| Mode | Flags |
|------|-------|
| Heliocentric | `SEFLG_SWIEPH \| SEFLG_HELCTR` (2 + 8 = 10) |
| Geocentric | `SEFLG_SWIEPH` (2) — no extra flag |
| Topocentric | `SEFLG_SWIEPH \| SEFLG_TOPOCTR` (2 + 32768 = 32770) |

## Mode Details

### Heliocentric
- Flag: `SEFLG_HELCTR`
- Positions relative to the Sun's center
- **Planet exclusions**: Sun, Moon, Mean Node, True Node are skipped (meaningless from Sun)
- Legacy auto-forces Moon/Sun/Nodes to geocentric if helio is selected

### Geocentric
- No extra flag (default for `swe_calc_ut`)
- Positions relative to Earth's center
- **Planet exclusion**: Earth is skipped
- Moon is meaningful and commonly used

### Topocentric
- Flag: `SEFLG_TOPOCTR`
- Positions relative to observer on Earth's surface
- **Requires `swe_set_topo(lon, lat, elevation)` before `swe_calc_ut()`**
- The parallax correction is largest for **the Moon** (~1 degree!) due to its proximity
- For distant planets, topocentric ≈ geocentric (negligible parallax)
- This is why Moon lines are **wavy in topo but straight in geo**

## The `GetPlanet()` Call Flow

Legacy makes **two** `swe_calc_ut()` calls per planet per timestamp:

1. Ecliptic coordinates: `swe_calc_ut(jd, planet, flags, result)` → lon, lat, dist
2. Equatorial coordinates: `swe_calc_ut(jd, planet, flags | SEFLG_EQUATORIAL, result)` → RA, dec, dist

Then also calls `swe_azalt()` for horizon coordinates (azimuth, altitude).

Return array layout:
- [0] = longitude (or RA if DoRAscension)
- [1] = latitude (or declination if DoDeclination)
- [2] = raw ecliptic longitude (always)
- [3] = azimuth (from swe_azalt)
- [4] = altitude (from swe_azalt)

## Why Moon Waviness Requires Topocentric

The Moon is ~384,000 km from Earth. Earth's radius is ~6,371 km. The parallax angle
is roughly arctan(6371/384000) ≈ **0.95 degrees**. As Earth rotates, the observer's
position shifts relative to the Moon, causing the apparent longitude to oscillate
with a ~24-hour period of approximately ±1 degree.

- **Geocentric**: No parallax, Moon longitude is smooth curve
- **Topocentric**: Includes parallax, Moon longitude has a ~1° ripple superimposed on the smooth curve
- **Other planets**: Parallax is negligible (Mars: ~0.005°, Jupiter: ~0.001°)

## Key Differences from Web Implementation

1. Legacy uses `SEFLG_SPEED` flag in some calls — web doesn't need speed data
2. Legacy computes azimuth/altitude via `swe_azalt()` — web doesn't implement this coordinate
3. Legacy has DST auto-detection for US time zones in GMT conversion
4. Legacy passes elevation=0 in some code paths (DrawInit, Write) but actual elevation in GetPlanet
5. The equation fallback backend has NO topocentric support — must use Swiss Ephemeris WASM
