# Swiss Ephemeris Reference for Astro Engine

## pyswisseph Basics

Swiss Ephemeris provides sub-arcsecond planetary positions based on NASA JPL DE431 ephemeris. Coverage: 13201 BC to 17191 AD.

### Installation
```bash
pip install pyswisseph
```

### Core Function: `swe.calc_ut(jd, planet, flags)`

Returns a tuple: `((lon, lat, dist, lon_speed, lat_speed, dist_speed), ret_flags)`

| Index | Value | Unit |
|-------|-------|------|
| 0 | Ecliptic longitude | degrees (0-360) |
| 1 | Ecliptic latitude | degrees (~±7° for Mercury, ~±5° for Moon) |
| 2 | Distance | AU (or Earth radii for Moon) |
| 3 | Longitude speed | degrees/day |
| 4 | Latitude speed | degrees/day |
| 5 | Distance speed | AU/day |

### Planet Constants

```python
import swisseph as swe
swe.SUN      # 0
swe.MOON     # 1
swe.MERCURY  # 2
swe.VENUS    # 3
swe.MARS     # 4
swe.JUPITER  # 5
swe.SATURN   # 6
swe.URANUS   # 7
swe.NEPTUNE  # 8
swe.PLUTO    # 9
```

### Reference Frame Flags

```python
# Geocentric (default — no flag needed)
result = swe.calc_ut(jd, swe.MERCURY, swe.FLG_SPEED)

# Heliocentric
result = swe.calc_ut(jd, swe.MERCURY, swe.FLG_SPEED | swe.FLG_HELCTR)

# Topocentric (must set observer first)
swe.set_topo(lon_deg, lat_deg, alt_meters)
result = swe.calc_ut(jd, swe.MERCURY, swe.FLG_SPEED | swe.FLG_TOPOCTR)
```

### Julian Day Conversion

```python
# datetime -> Julian Day
jd = swe.julday(year, month, day, hour_fraction)
# hour_fraction = hour + minute/60 + second/3600

# Julian Day -> datetime components
year, month, day, hour_frac = swe.revjul(jd)
```

### Key Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `swe.FLG_SPEED` | 256 | Include speed in output |
| `swe.FLG_HELCTR` | 8 | Heliocentric frame |
| `swe.FLG_TOPOCTR` | 32 | Topocentric frame |
| `swe.FLG_EQUATORIAL` | 2048 | Equatorial coordinates |

### Performance
10,000 complete planetary sets (11 planets each) compute in ~3 seconds. For our use case (2 planets over years of data), computation is effectively instant.

## Planetary Characteristics

### Mercury
- **Orbital period (helio)**: ~88 days
- **Synodic period (geo)**: ~116 days
- **Latitude range (helio)**: ~±7.0°
- **Latitude range (geo)**: ~±5.0° (varies)
- **Retrograde frequency**: ~3 times/year, ~21 days each
- **Longitude speed**: ~0.5° to 2.2°/day (geo), 4.09°/day avg (helio)

### Moon
- **Orbital period**: ~27.32 days (sidereal)
- **Synodic period**: ~29.53 days (new moon to new moon)
- **Latitude range**: ~±5.3° (varies with nodal cycle)
- **Nodal cycle**: ~18.6 years (full latitude range variation)
- **Longitude speed**: ~12-15°/day (geo)
- **No heliocentric position**: Moon orbits Earth, not Sun. `FLG_HELCTR` returns Earth-Moon barycenter.

## Caveats

1. **Moon heliocentric**: Not meaningful — returns Earth-Moon barycenter. We skip this by default.
2. **Topocentric parallax**: Mostly relevant for Moon (large parallax due to proximity). Mercury's topocentric position differs negligibly from geocentric.
3. **Ephemeris files**: pyswisseph includes a built-in reduced ephemeris. For maximum precision, download the full SE ephemeris files from astro.com.
4. **Timezone**: All calculations use Julian Day UT (Universal Time). Convert local times to UTC before computing.
