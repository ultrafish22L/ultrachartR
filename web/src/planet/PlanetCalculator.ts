/**
 * Planet line calculator.
 * Computes raw planet angles for chart bars — viewport-independent.
 * Mirrors legacy cChartPlanet::CacheSamplesLines logic.
 *
 * Samples store accumulated longitude (with 360° wrap handling), NOT mapped prices.
 * The renderer handles the price mapping at draw time.
 *
 * Adaptive sub-sampling: between bars, recursively bisects and inserts extra
 * ephemeris samples where the curve deviates from linear beyond a threshold.
 * Fast planets (Moon) get many sub-samples; slow planets (Jupiter) get few.
 */
import { OHLCVBar, Point } from '../types/chart';
import { PlanetLineConfig } from '../types/planet';
import { getPlanetPosition, timestampToJD } from './EphemerisService';

/** Deviation threshold in degrees — sub-sample if midpoint deviates more than this from linear */
const DEVIATION_THRESHOLD = 0.08;

/** Max recursion depth for adaptive bisection */
const MAX_DEPTH = 5;

/**
 * Calculate raw planet angle samples for a range of bars.
 * Returns points where x=timestamp (ms), y=raw accumulated angle (degrees).
 * No price mapping — that happens in the renderer.
 */
export function calculatePlanetSamples(
  bars: OHLCVBar[],
  config: PlanetLineConfig,
  extraTimeMs = 0,
): Point[] {
  if (bars.length === 0) return [];

  const isHelio = config.perspective === 'heliocentric';
  const isTopo = config.perspective === 'topocentric';

  // Sample every bar (or every Nth for performance with many bars)
  const step = bars.length > 2000 ? Math.ceil(bars.length / 1000) : 1;

  // Build time samples: bar timestamps + extra future timestamps
  const timeSamples: number[] = [];
  for (let i = 0; i < bars.length; i += step) {
    timeSamples.push(bars[i]!.time);
  }
  // Ensure last bar is included
  if (timeSamples[timeSamples.length - 1] !== bars[bars.length - 1]!.time) {
    timeSamples.push(bars[bars.length - 1]!.time);
  }
  // Add future samples beyond the last bar
  if (extraTimeMs > 0 && bars.length >= 2) {
    const avgBarSpacing = (bars[bars.length - 1]!.time - bars[0]!.time) / (bars.length - 1);
    const futureStep = Math.max(avgBarSpacing, 60_000); // at least 1 minute
    const lastTime = bars[bars.length - 1]!.time;
    for (let t = lastTime + futureStep; t <= lastTime + extraTimeMs; t += futureStep) {
      timeSamples.push(t);
    }
  }

  // Phase 1: compute bar-level samples with wrap handling
  const barSamples: Point[] = [];
  let prevRawAngle: number | null = null;
  let wrapOffset = 0;

  for (let i = 0; i < timeSamples.length; i++) {
    const time = timeSamples[i]!;
    const jd = timestampToJD(time);

    const rawAngle = getPlanetPosition(
      jd,
      config.planet,
      config.coordinate,
      isHelio,
      isTopo,
      config.latitude,
      config.longitude,
      config.elevation,
    );

    if (prevRawAngle !== null) {
      const diff = rawAngle - prevRawAngle;
      if (diff > 180) wrapOffset -= 360;
      else if (diff < -180) wrapOffset += 360;
    }
    prevRawAngle = rawAngle;

    let angle = rawAngle + wrapOffset;
    if (config.invert) angle = -angle;

    barSamples.push({ x: time, y: angle });
  }

  if (barSamples.length < 2) return barSamples;

  // Phase 2: adaptive sub-sampling between consecutive bar samples
  const result: Point[] = [barSamples[0]!];

  for (let i = 1; i < barSamples.length; i++) {
    const p0 = barSamples[i - 1]!;
    const p1 = barSamples[i]!;

    // Recursively insert sub-samples where curve deviates from linear
    const subs = adaptiveBisect(p0, p1, config, isHelio, isTopo, MAX_DEPTH);
    for (const s of subs) {
      result.push(s);
    }

    result.push(p1);
  }

  return result;
}

/**
 * Recursively bisect between two samples, inserting midpoints where the
 * actual ephemeris deviates from linear interpolation by more than threshold.
 */
function adaptiveBisect(
  p0: Point,
  p1: Point,
  config: PlanetLineConfig,
  isHelio: boolean,
  isTopo: boolean,
  depth: number,
): Point[] {
  if (depth <= 0) return [];

  const tMid = (p0.x + p1.x) / 2;
  // Skip if time gap is tiny (< 30 seconds)
  if (p1.x - p0.x < 30_000) return [];

  const jdMid = timestampToJD(tMid);
  const rawMid = getPlanetPosition(
    jdMid,
    config.planet,
    config.coordinate,
    isHelio,
    isTopo,
    config.latitude,
    config.longitude,
    config.elevation,
  );

  // Expected accumulated angle (linear interpolation between p0 and p1)
  const expected = (p0.y + p1.y) / 2;

  // Unwrap rawMid to the accumulated angle closest to expected
  let accumMid = rawMid + Math.round((expected - rawMid) / 360) * 360;
  if (config.invert) accumMid = -accumMid + 2 * Math.round(accumMid / 360) * 360;

  // For inverted lines, the accumulated values are negated
  // Recalculate: invert flips the angle, so we need to handle it consistently
  if (config.invert) {
    // Re-derive: raw angle → unwrap relative to non-inverted expected → invert
    const expectedNonInv = -(p0.y + p1.y) / 2; // undo inversion to get expected raw accum
    const accumMidNonInv = rawMid + Math.round((expectedNonInv - rawMid) / 360) * 360;
    accumMid = -accumMidNonInv;
  }

  const deviation = Math.abs(accumMid - expected);

  if (deviation < DEVIATION_THRESHOLD) return [];

  // Deviation exceeds threshold — keep this midpoint and recurse
  const midPoint: Point = { x: tMid, y: accumMid };

  const left = adaptiveBisect(p0, midPoint, config, isHelio, isTopo, depth - 1);
  const right = adaptiveBisect(midPoint, p1, config, isHelio, isTopo, depth - 1);

  return [...left, midPoint, ...right];
}
