/**
 * Ephemeris service with two backends:
 * 1. Swiss Ephemeris WASM (swisseph-wasm) - high precision, primary
 * 2. Simplified Keplerian equations - fallback if WASM fails to load
 */
import { PlanetId, PlanetCoordinate } from '../types/planet';
import { loadPreferences, updatePreference } from '../services/PreferencesService';
import { log } from '../services/Logger';

// ─── Swiss Ephemeris WASM Backend ─────────────────────────────────────

let sweInstance: SwissEphInstance | null = null;
let sweReady = false;
let sweInitPromise: Promise<boolean> | null = null;

/** Subset of SwissEph API we use */
interface SwissEphInstance {
  initSwissEph(): Promise<void>;
  julday(year: number, month: number, day: number, hour: number): number;
  calc_ut(jd: number, planet: number, flags: number): Float64Array;
  set_topo(longitude: number, latitude: number, altitude: number): void;
  close(): void;
  SEFLG_SWIEPH: number;
  SEFLG_MOSEPH: number;
  SEFLG_HELCTR: number;
  SEFLG_TOPOCTR: number;
  SEFLG_EQUATORIAL: number;
  SEFLG_SPEED: number;
}

/**
 * Initialize the Swiss Ephemeris WASM module.
 * Returns true if successful, false if fallback should be used.
 */
export async function initSwissEph(): Promise<boolean> {
  if (sweReady) return true;
  if (sweInitPromise) return sweInitPromise;

  sweInitPromise = (async () => {
    try {
      // Race WASM init against a timeout — fall back to equations if it hangs
      const TIMEOUT_MS = 8000;
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('WASM init timed out')), TIMEOUT_MS),
      );
      const init = (async () => {
        const SwissEph = (await import('swisseph-wasm')).default;
        const swe = new SwissEph();
        await swe.initSwissEph();
        return swe;
      })();
      const swe = await Promise.race([init, timeout]);
      sweInstance = swe as unknown as SwissEphInstance;
      sweReady = true;
      log.info('Ephemeris', 'Swiss Ephemeris WASM initialized');
      return true;
    } catch (err) {
      log.warn('Ephemeris', 'WASM init failed, using equation fallback:', err);
      sweReady = false;
      sweInitPromise = null;  // Allow retry on next call
      return false;
    }
  })();

  return sweInitPromise;
}

/** Check if Swiss Ephemeris WASM is available */
export function isSwissEphReady(): boolean {
  return sweReady && sweInstance !== null;
}

/** Which backend is active */
export type EphemerisBackend = 'swisseph' | 'equations';

// Lazy-loaded: read from preferences on first access, not at module import time
let forcedBackend: EphemerisBackend | null | undefined = undefined;

export function getActiveBackend(): EphemerisBackend {
  if (forcedBackend === undefined) {
    forcedBackend = loadPreferences().ephemerisBackend;
  }
  if (forcedBackend) return forcedBackend;
  return sweReady ? 'swisseph' : 'equations';
}

/** Force a specific backend. 'swisseph' only works if WASM loaded. Persists to localStorage. */
export function setActiveBackend(backend: EphemerisBackend): void {
  if (backend === 'swisseph' && !sweReady) {
    forcedBackend = null; // can't force swisseph if not loaded
    updatePreference('ephemerisBackend', null);
  } else {
    forcedBackend = backend;
    updatePreference('ephemerisBackend', backend);
  }
}

/** Check if Swiss Ephemeris WASM was loaded (even if not currently active) */
export function isSwissEphLoaded(): boolean {
  return sweReady;
}

/** Convert timestamp (ms) to Julian Day number */
export function timestampToJD(timestamp: number): number {
  return timestamp / 86400000 + 2440587.5;
}

/**
 * Map PlanetId to Swiss Ephemeris planet constant.
 * The values match directly (SE_SUN=0, SE_MOON=1, etc.)
 */
function planetToSE(planet: PlanetId): number {
  return planet as number;
}

/**
 * Get planet position using Swiss Ephemeris WASM.
 */
function swePlanetPosition(
  jd: number,
  planet: PlanetId,
  coordinate: PlanetCoordinate,
  heliocentric: boolean,
  topocentric = false,
  obsLat = 0,
  obsLon = 0,
  obsElev = 0,
): number {
  if (!sweInstance) return 0;

  // Sun, Moon, and Nodes have no meaningful heliocentric position —
  // fall back to geocentric (matches equation backend behavior)
  const useHelio = heliocentric && !topocentric &&
    planet !== PlanetId.Sun && planet !== PlanetId.Moon &&
    planet !== PlanetId.MeanNode && planet !== PlanetId.TrueNode;

  let flags = sweInstance.SEFLG_SWIEPH | sweInstance.SEFLG_SPEED;
  if (useHelio) {
    flags |= sweInstance.SEFLG_HELCTR;
  } else if (topocentric) {
    // Topocentric: set observer location + flag
    sweInstance.set_topo(obsLon, obsLat, obsElev);
    flags |= sweInstance.SEFLG_TOPOCTR;
  }
  if (coordinate === 'rightAscension' || coordinate === 'declination') {
    flags |= sweInstance.SEFLG_EQUATORIAL;
  }

  try {
    const result = sweInstance.calc_ut(jd, planetToSE(planet), flags);
    // result: [longitude, latitude, distance, lonSpeed, latSpeed, distSpeed]
    // With SEFLG_EQUATORIAL: [RA, declination, distance, ...]
    const lon = result[0] ?? 0;
    const lat = result[1] ?? 0;
    switch (coordinate) {
      case 'longitude': return lon;
      case 'latitude': return lat;
      case 'rightAscension': return lon; // with EQUATORIAL flag
      case 'declination': return lat;     // with EQUATORIAL flag
      default: return lon;
    }
  } catch (err) {
    log.warn('Ephemeris', 'calc_ut error:', err);
    return equationPlanetPosition(jd, planet, coordinate, heliocentric);
  }
}

/**
 * Main entry point: get planet position at a given Julian Day.
 * Uses Swiss Ephemeris if available, otherwise falls back to equations.
 */
export function getPlanetPosition(
  jd: number,
  planet: PlanetId,
  coordinate: PlanetCoordinate,
  heliocentric: boolean,
  topocentric = false,
  obsLat = 0,
  obsLon = 0,
  obsElev = 0,
): number {
  const backend = getActiveBackend();
  if (backend === 'swisseph' && sweReady && sweInstance) {
    return swePlanetPosition(jd, planet, coordinate, heliocentric, topocentric, obsLat, obsLon, obsElev);
  }
  return equationPlanetPosition(jd, planet, coordinate, heliocentric, topocentric, obsLat, obsLon);
}

// ─── Equation-based Fallback Backend ──────────────────────────────────
// Simplified ephemeris using mean orbital elements.
// ~1° accuracy for planets, sufficient for chart visualization.

/** Julian centuries from J2000.0 */
function jCenturies(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

/** Normalize angle to 0-360 */
function norm360(deg: number): number {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

function deg2rad(d: number): number { return (d * Math.PI) / 180; }
function rad2deg(r: number): number { return (r * 180) / Math.PI; }

/** Solve Kepler's equation by Newton iteration */
function solveKepler(M: number, e: number): number {
  const Mrad = deg2rad(M);
  let E = Mrad;
  for (let i = 0; i < 15; i++) {
    const dE = (E - e * Math.sin(E) - Mrad) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

interface OrbitalElements {
  L0: number; Ld: number; a: number;
  e0: number; ed: number;
  I0: number; Id: number;
  Om0: number; Omd: number;
  w0: number; wd: number;
}

const ELEMENTS: Partial<Record<PlanetId, OrbitalElements>> = {
  [PlanetId.Mercury]: {
    L0: 252.2509, Ld: 149472.6747, a: 0.387098,
    e0: 0.205632, ed: 0.000020, I0: 7.0048, Id: -0.0059,
    Om0: 48.3313, Omd: -0.1254, w0: 77.4561, wd: 0.1588,
  },
  [PlanetId.Venus]: {
    L0: 181.9798, Ld: 58517.8157, a: 0.723330,
    e0: 0.006773, ed: -0.000048, I0: 3.3946, Id: -0.0009,
    Om0: 76.6799, Omd: -0.2780, w0: 131.5637, wd: 0.0048,
  },
  [PlanetId.Mars]: {
    L0: 355.4330, Ld: 19140.2993, a: 1.523688,
    e0: 0.093405, ed: 0.000090, I0: 1.8497, Id: -0.0013,
    Om0: 49.5574, Omd: -0.2949, w0: 336.0602, wd: 0.4439,
  },
  [PlanetId.Jupiter]: {
    L0: 34.3515, Ld: 3034.9057, a: 5.202561,
    e0: 0.048498, ed: 0.000163, I0: 1.3033, Id: -0.0019,
    Om0: 100.4542, Omd: 0.1768, w0: 14.3312, wd: 0.2155,
  },
  [PlanetId.Saturn]: {
    L0: 50.0774, Ld: 1222.1138, a: 9.554747,
    e0: 0.055548, ed: -0.000346, I0: 2.4889, Id: 0.0025,
    Om0: 113.6634, Omd: -0.2507, w0: 93.0572, wd: 0.5652,
  },
  [PlanetId.Uranus]: {
    L0: 314.0550, Ld: 428.4677, a: 19.18171,
    e0: 0.047318, ed: -0.000019, I0: 0.7732, Id: 0.0001,
    Om0: 74.0005, Omd: 0.0413, w0: 173.0053, wd: 0.0129,
  },
  [PlanetId.Neptune]: {
    L0: 304.3487, Ld: 218.4862, a: 30.05826,
    e0: 0.008606, ed: 0.000022, I0: 1.7700, Id: -0.0003,
    Om0: 131.7806, Omd: -0.0062, w0: 48.1237, wd: 0.0237,
  },
  [PlanetId.Pluto]: {
    L0: 238.9290, Ld: 145.2078, a: 39.48169,
    e0: 0.248808, ed: 0.000060, I0: 17.1417, Id: 0.0000,
    Om0: 110.3034, Omd: -0.0108, w0: 224.0680, wd: -0.0342,
  },
};

function obliquity(T: number): number { return 23.4393 - 0.013 * T; }

function helioLongitude(planet: PlanetId, T: number): number {
  const el = ELEMENTS[planet];
  if (!el) return 0;
  const L = norm360(el.L0 + el.Ld * T);
  const w = norm360(el.w0 + el.wd * T);
  const e = el.e0 + el.ed * T;
  const M = norm360(L - w);
  const E = solveKepler(M, e);
  const sinV = (Math.sqrt(1 - e * e) * Math.sin(E)) / (1 - e * Math.cos(E));
  const cosV = (Math.cos(E) - e) / (1 - e * Math.cos(E));
  const v = rad2deg(Math.atan2(sinV, cosV));
  return norm360(v + w);
}

function sunLongitude(T: number): number {
  const L0 = norm360(280.4665 + 36000.7698 * T);
  const M = norm360(357.5291 + 35999.0503 * T);
  const C = 1.9146 * Math.sin(deg2rad(M)) + 0.0200 * Math.sin(2 * deg2rad(M));
  return norm360(L0 + C);
}

function moonLongitude(T: number): number {
  const L = norm360(218.3165 + 481267.8813 * T);
  const D = deg2rad(norm360(297.8502 + 445267.1115 * T));
  const M = deg2rad(norm360(357.5291 + 35999.0503 * T));
  const Mp = deg2rad(norm360(134.9634 + 477198.8676 * T));
  const F = deg2rad(norm360(93.2720 + 483202.0175 * T));
  let lon = L;
  lon += 6.289 * Math.sin(Mp) + 1.274 * Math.sin(2 * D - Mp);
  lon += 0.658 * Math.sin(2 * D) + 0.214 * Math.sin(2 * Mp);
  lon -= 0.186 * Math.sin(M) - 0.114 * Math.sin(2 * F);
  return norm360(lon);
}

function meanNodeLongitude(T: number): number {
  return norm360(125.0446 - 1934.1363 * T);
}

function geoLongitude(planet: PlanetId, T: number): number {
  if (planet === PlanetId.Sun) return sunLongitude(T);
  if (planet === PlanetId.Moon) return moonLongitude(T);
  if (planet === PlanetId.MeanNode || planet === PlanetId.TrueNode) return meanNodeLongitude(T);
  if (planet === PlanetId.Chiron) return norm360(209.3 + 7.114 * T * 100);

  const el = ELEMENTS[planet];
  if (!el) return 0;

  const lP = deg2rad(helioLongitude(planet, T));
  const rP = el.a;

  // Earth position
  const earthL = deg2rad(norm360(100.4665 + 35999.3728 * T));
  const earthE = 0.016709 - 0.000042 * T;
  const earthW = deg2rad(norm360(102.9373 + 0.3225 * T));
  const Ee = solveKepler(rad2deg(earthL - earthW), earthE);
  const sinVe = (Math.sqrt(1 - earthE * earthE) * Math.sin(Ee)) / (1 - earthE * Math.cos(Ee));
  const cosVe = (Math.cos(Ee) - earthE) / (1 - earthE * Math.cos(Ee));
  const earthTrueLon = Math.atan2(sinVe, cosVe) + Number(earthW);
  const rE = 1.00014;

  const xP = rP * Math.cos(lP) - rE * Math.cos(earthTrueLon);
  const yP = rP * Math.sin(lP) - rE * Math.sin(earthTrueLon);
  return norm360(rad2deg(Math.atan2(yP, xP)));
}

function longitudeToDeclination(lon: number, T: number): number {
  return rad2deg(Math.asin(Math.sin(deg2rad(obliquity(T))) * Math.sin(deg2rad(lon))));
}

function longitudeToRA(lon: number, T: number): number {
  const eps = deg2rad(obliquity(T));
  const lonRad = deg2rad(lon);
  return norm360(rad2deg(Math.atan2(Math.cos(eps) * Math.sin(lonRad), Math.cos(lonRad))));
}

/**
 * Approximate topocentric parallax correction for the Moon.
 *
 * The Moon is close enough that an observer's position on Earth's surface
 * shifts its apparent longitude by up to ~1 degree. This oscillates with
 * local sidereal time (Earth's rotation) creating the characteristic
 * "wavy" Moon line in topocentric mode.
 *
 * For all other planets, parallax is negligible (<0.01°) so we skip it.
 */
function topocentricMoonCorrection(jd: number, geoLon: number, obsLat: number, obsLon: number): number {
  // Earth equatorial radius in km
  const R_EARTH = 6378.137;
  // Mean Moon distance in km
  const MOON_DIST = 384400;

  // Local Sidereal Time (approximate)
  const T = jCenturies(jd);
  // Greenwich Mean Sidereal Time in degrees
  const gmst = norm360(280.46061837 + 360.98564736629 * (jd - 2451545.0) + 0.000387933 * T * T);
  // Local sidereal time
  const lst = deg2rad(norm360(gmst + obsLon));

  const latRad = deg2rad(obsLat);

  // Observer's geocentric position projected onto equatorial plane
  const rhoCosPhi = R_EARTH * Math.cos(latRad);
  const rhoSinPhi = R_EARTH * Math.sin(latRad);

  // Moon's ecliptic position (approximate for parallax calc)
  const eps = deg2rad(obliquity(T));
  const lonRad = deg2rad(geoLon);

  // Convert Moon ecliptic → equatorial for parallax
  const moonRA = Math.atan2(
    Math.sin(lonRad) * Math.cos(eps),
    Math.cos(lonRad),
  );
  const moonDec = Math.asin(Math.sin(eps) * Math.sin(lonRad));

  // Parallax in RA (the dominant term)
  const sinHP = R_EARTH / MOON_DIST; // horizontal parallax ~0.95°

  // Topocentric correction to RA
  const deltaRA = Math.atan2(
    -rhoCosPhi * sinHP * Math.sin(lst - moonRA),
    Math.cos(moonDec) - rhoCosPhi * sinHP * Math.cos(lst - moonRA),
  );

  // Topocentric correction to Dec
  const topoDecNum = (Math.sin(moonDec) - rhoSinPhi * sinHP) * Math.cos(deltaRA);
  const topoDecDen = Math.cos(moonDec) - rhoCosPhi * sinHP * Math.cos(lst - moonRA);
  const topoDec = Math.atan2(topoDecNum, topoDecDen);

  // Convert back to ecliptic longitude
  const topoRA = moonRA + deltaRA;
  const topoLon = Math.atan2(
    Math.sin(topoRA) * Math.cos(eps) + Math.tan(topoDec) * Math.sin(eps),
    Math.cos(topoRA),
  );

  return norm360(rad2deg(topoLon));
}

/** Equation-based planet position (fallback) */
export function equationPlanetPosition(
  jd: number,
  planet: PlanetId,
  coordinate: PlanetCoordinate,
  heliocentric: boolean,
  topocentric = false,
  obsLat = 0,
  obsLon = 0,
): number {
  const T = jCenturies(jd);
  let lon: number;

  if (heliocentric) {
    if (planet === PlanetId.Sun || planet === PlanetId.Moon ||
        planet === PlanetId.MeanNode || planet === PlanetId.TrueNode) {
      lon = geoLongitude(planet, T);
    } else {
      lon = helioLongitude(planet, T);
    }
  } else {
    lon = geoLongitude(planet, T);
  }

  // Apply topocentric parallax for Moon (only body where it matters)
  if (topocentric && planet === PlanetId.Moon) {
    lon = topocentricMoonCorrection(jd, lon, obsLat, obsLon);
  }

  switch (coordinate) {
    case 'longitude': return lon;
    case 'declination': return longitudeToDeclination(lon, T);
    case 'rightAscension': return longitudeToRA(lon, T);
    case 'latitude': return 0;
    default: return lon;
  }
}
