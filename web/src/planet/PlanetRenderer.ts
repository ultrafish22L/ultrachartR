/**
 * Renders planet lines on the chart canvas.
 * Mirrors legacy cChartPlanet::DrawLine3 + LoopLinesNew logic:
 *  - Samples store raw accumulated angles (viewport-independent)
 *  - Renderer maps angle → price directly (1° = 1 price unit) with offset (F0)
 *  - Multiple parallel lines spaced by Period fill the visible price range
 */
import { Rect, OHLCVBar } from '../types/chart';
import { PlanetLineObject, PLANETS } from '../types/planet';
import { Viewport } from '../engine/Viewport';
import { distToSegment } from '../utils/geometry';
import { themeColors } from '../engine/themeColors';
import { calculatePlanetSamples } from './PlanetCalculator';

const HANDLE_SIZE = 4;

/** Cache keys for planet line sample invalidation (keyed by planet line ID) */
const sampleCacheKeys = new Map<string, string>();

/** Remove cached sample key for a deleted planet line */
export function clearPlanetSampleCache(planetLineId: string): void {
  sampleCacheKeys.delete(planetLineId);
}

export class PlanetRenderer {
  static draw(
    ctx: CanvasRenderingContext2D,
    planetLines: PlanetLineObject[],
    viewport: Viewport,
    chartRect: Rect,
    bars: OHLCVBar[],
  ): void {
    if (bars.length === 0) return;

    ctx.save();
    ctx.beginPath();
    ctx.rect(chartRect.x, chartRect.y, chartRect.width, chartRect.height);
    ctx.clip();

    for (const pl of planetLines) {
      if (!pl.visible) continue;
      this.drawPlanetLine(ctx, pl, viewport, chartRect, bars);
    }

    ctx.restore();
  }

  private static drawPlanetLine(
    ctx: CanvasRenderingContext2D,
    pl: PlanetLineObject,
    viewport: Viewport,
    chartRect: Rect,
    bars: OHLCVBar[],
  ): void {
    // Compute extra future time for right margin projection
    let extraTimeMs = 0;
    if (viewport.rightMargin > 0 && bars.length >= 2) {
      const { min: tMin, max: tMax } = viewport.visibleTimeRange;
      const visibleDuration = tMax - tMin;
      if (visibleDuration > 0) {
        const dataWidth = chartRect.width - viewport.rightMargin;
        // Overshoot by 50% so lines reach the price axis (clip rect trims excess)
        extraTimeMs = (viewport.rightMargin / Math.max(1, dataWidth)) * visibleDuration * 1.5;
      }
    }

    // Recalculate samples when dirty (samples are viewport-independent now)
    const c = pl.config;
    const cacheKey = `${bars.length}_${c.planet}_${c.perspective}_${c.coordinate}_${c.latitude}_${c.longitude}_${c.elevation}_${c.gmtOffset}_${c.invert}_${c.period}_${c.offset}_${Math.round(extraTimeMs)}`;
    if (pl.dirty || pl.samples.length === 0 || sampleCacheKeys.get(pl.id) !== cacheKey) {
      pl.samples = calculatePlanetSamples(bars, pl.config, extraTimeMs);
      pl.dirty = false;
      sampleCacheKeys.set(pl.id, cacheKey);
    }

    if (pl.samples.length < 2) return;

    const color = pl.pen.color || this.getDefaultColor(pl.config.planet);
    const lineWidth = pl.pen.width || 1.5;
    const { priceMin, priceMax } = viewport.state;
    const period = pl.config.period;
    const offset = pl.config.offset;

    // Pre-compute pixel X and base value for each visible sample
    const pts: ({ x: number; base: number } | null)[] = [];
    let minBase = Infinity;
    let maxBase = -Infinity;
    for (let i = 0; i < pl.samples.length; i++) {
      const s = pl.samples[i]!;
      const x = viewport.timestampToX(s.x, bars);
      // Skip samples far off screen (leave null gaps)
      if (x < chartRect.x - 200 || x > chartRect.x + chartRect.width + 200) {
        pts.push(null);
        continue;
      }
      const base = s.y + offset;
      pts.push({ x, base });
      if (base < minBase) minBase = base;
      if (base > maxBase) maxBase = base;
    }

    if (minBase === Infinity) return;

    // Guard against degenerate period that would cause infinite loops
    if (period < 0.01) return;

    // Determine range of period offsets (N) needed to cover visible price range
    const nMin = Math.floor((priceMin - maxBase) / period) - 1;
    const nMax = Math.ceil((priceMax - minBase) / period) + 1;

    // Cap parallel lines to prevent freeze with very small periods
    if (nMax - nMin > 500) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(pl.pen.dash || []);

    // Draw each parallel line as one continuous polyline so dash pattern flows smoothly
    for (let n = nMin; n <= nMax; n++) {
      ctx.beginPath();
      let penDown = false;

      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (!p) { penDown = false; continue; }

        const y = viewport.priceToY(p.base + n * period);

        if (!penDown) {
          ctx.moveTo(p.x, y);
          penDown = true;
        } else {
          ctx.lineTo(p.x, y);
        }
      }

      ctx.stroke();
    }

    ctx.setLineDash([]);

    // Draw selection handles if selected
    if (pl.selected) {
      this.drawSelectionHandles(ctx, pl, viewport, chartRect, bars);
    }
  }

  /** Draw selection handles on the planet line */
  private static drawSelectionHandles(
    ctx: CanvasRenderingContext2D,
    pl: PlanetLineObject,
    viewport: Viewport,
    chartRect: Rect,
    bars: OHLCVBar[],
  ): void {
    const handles = this.getHandlePositions(pl, viewport, chartRect, bars);
    for (const h of handles) {
      ctx.fillStyle = themeColors.selectionColor;
      ctx.fillRect(h.x - HANDLE_SIZE, h.y - HANDLE_SIZE, HANDLE_SIZE * 2, HANDLE_SIZE * 2);
      ctx.strokeStyle = themeColors.objectStroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(h.x - HANDLE_SIZE, h.y - HANDLE_SIZE, HANDLE_SIZE * 2, HANDLE_SIZE * 2);
    }
  }

  /** Get handle pixel positions for a planet line (used by hit testing too) */
  static getHandlePositions(
    pl: PlanetLineObject,
    viewport: Viewport,
    chartRect: Rect,
    bars: OHLCVBar[],
  ): { x: number; y: number }[] {
    if (pl.samples.length < 2) return [];

    const { priceMin, priceMax } = viewport.state;
    const priceCenter = (priceMin + priceMax) / 2;
    const period = pl.config.period;
    const offset = pl.config.offset;

    // Find the visible sample nearest to the center of the chart
    const centerX = chartRect.x + chartRect.width / 2;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pl.samples.length; i++) {
      const x = viewport.timestampToX(pl.samples[i]!.x, bars);
      const d = Math.abs(x - centerX);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const handles: { x: number; y: number }[] = [];

    // Place handles at the center sample and at 1/4 and 3/4 points
    const indices = [
      Math.floor(pl.samples.length * 0.25),
      bestIdx,
      Math.floor(pl.samples.length * 0.75),
    ];

    for (const idx of indices) {
      if (idx < 0 || idx >= pl.samples.length) continue;
      const s = pl.samples[idx]!;
      const x = viewport.timestampToX(s.x, bars);
      if (x < chartRect.x - 20 || x > chartRect.x + chartRect.width + 20) continue;

      // Find the period line nearest to the price center
      if (period <= 0) return [];
      let val = s.y + offset;
      // Move to nearest period line to priceCenter
      const n = Math.round((priceCenter - val) / period);
      val += n * period;

      const y = viewport.priceToY(val);
      if (y >= chartRect.y && y <= chartRect.y + chartRect.height) {
        handles.push({ x, y });
      }
    }

    return handles;
  }

  /** Hit test a planet line at a pixel position. Returns true if within tolerance. */
  static hitTest(
    pos: { x: number; y: number },
    pl: PlanetLineObject,
    viewport: Viewport,
    _chartRect: Rect,
    bars: OHLCVBar[],
    tolerance = 6,
  ): boolean {
    if (pl.samples.length < 2) return false;

    const { priceMin, priceMax } = viewport.state;
    const period = pl.config.period;
    const offset = pl.config.offset;

    // Check each consecutive sample pair
    for (let i = 1; i < pl.samples.length; i++) {
      const s0 = pl.samples[i - 1]!;
      const s1 = pl.samples[i]!;

      const x0 = viewport.timestampToX(s0.x, bars);
      const x1 = viewport.timestampToX(s1.x, bars);

      // Quick X check: is the mouse between these two samples horizontally?
      const minX = Math.min(x0, x1) - tolerance;
      const maxX = Math.max(x0, x1) + tolerance;
      if (pos.x < minX || pos.x > maxX) continue;

      // Guard against degenerate period or excessive iterations
      if (period < 0.01) continue;
      const maxLines = Math.ceil((priceMax - priceMin) / period) + 2;
      if (maxLines > 500) continue;

      // Check each period-offset line segment using index-based iteration
      // to avoid floating-point accumulation error from repeated +=
      const base0 = s0.y + offset;
      const base1 = s1.y + offset;

      // Find starting index: first n where both base + n*period >= priceMin - period
      const nMin = Math.floor((priceMin - Math.max(base0, base1)) / period) - 1;
      const nMax = Math.ceil((priceMax - Math.min(base0, base1)) / period) + 1;

      for (let n = nMin; n <= nMax && (n - nMin) < 1000; n++) {
        const val0 = base0 + n * period;
        const val1 = base1 + n * period;
        const y0 = viewport.priceToY(val0);
        const y1 = viewport.priceToY(val1);

        // Distance from point to line segment
        const dist = distToSegment(pos, { x: x0, y: y0 }, { x: x1, y: y1 });
        if (dist <= tolerance) return true;
      }
    }

    return false;
  }

  private static getDefaultColor(planet: number): string {
    const info = PLANETS.find((p) => p.id === planet);
    return info?.defaultColor ?? '#ffffff';
  }
}

