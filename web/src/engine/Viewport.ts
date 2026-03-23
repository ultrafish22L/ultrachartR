import { OHLCVBar, ViewState, Rect, Point, TimeMode, DEFAULT_VIEW_STATE } from '../types/chart';

/**
 * Viewport manages the zoom/scroll state and coordinate transforms.
 *
 * Supports two time modes:
 *   - **compressed**: Bars are evenly spaced by index (no time gaps).
 *   - **natural**: Bars are positioned proportional to their timestamps,
 *     so off-hours gaps appear as empty space.
 */
export class Viewport {
  state: ViewState;
  chartRect: Rect = { x: 0, y: 0, width: 800, height: 600 };
  timeMode: TimeMode = 'natural';
  /** User-set right margin in pixels (space after last bar when fully scrolled right) */
  rightMargin = 0;

  /**
   * Effective margin that scrolls with the data.
   * Full margin when scrolled to the right edge (scrollOffset=0),
   * fades to zero as you scroll left into older data so bars
   * fill the full chart width.
   */
  get effectiveMargin(): number {
    if (this.rightMargin <= 0) return 0;
    return Math.max(0, this.rightMargin - this.state.scrollOffset * this.state.pixelsPerBar);
  }

  private _visibleRange: { startIdx: number; endIdx: number } = { startIdx: 0, endIdx: 0 };
  private _barCount = 0;
  /** Bars reference for natural-mode time lookups */
  private _bars: OHLCVBar[] = [];

  // Cached natural-mode time window (recalculated each frame)
  private _natTimeMin = 0;
  private _natTimeMax = 0;
  private _natTimeRange = 0;

  constructor(state?: Partial<ViewState>) {
    this.state = { ...DEFAULT_VIEW_STATE, ...state };
  }

  /** Update the pixel rectangle available for chart content */
  setChartRect(rect: Rect): void {
    this.chartRect = rect;
  }

  /** Set bars data (needed for natural mode timestamp lookups) */
  setBars(bars: OHLCVBar[]): void {
    this._bars = bars;
    this._barCount = bars.length;
  }

  /** Set the total bar count for the loaded data */
  setBarCount(count: number): void {
    this._barCount = count;
  }

  /** Total number of bars in the dataset */
  get barCount(): number {
    return this._barCount;
  }

  /** Number of bars visible in the current viewport (used for scroll calculations) */
  get visibleBarCount(): number {
    if (this.state.pixelsPerBar <= 0) return 1;
    return Math.max(1, Math.ceil((this.chartRect.width - this.effectiveMargin) / this.state.pixelsPerBar));
  }

  /**
   * Effective pixels-per-bar based on actual visible bar count.
   * In natural mode, bars are spaced proportionally by time so
   * `state.pixelsPerBar` doesn't reflect real on-screen spacing.
   * Use this for label density / tick spacing calculations.
   */
  get effectivePixelsPerBar(): number {
    const { startIdx, endIdx } = this._visibleRange;
    const actualVisible = Math.max(1, endIdx - startIdx);
    return this.chartRect.width / actualVisible;
  }

  /** Clamp scrollOffset so at least 1 bar is always in view */
  clampScroll(): void {
    const totalBars = this._barCount;
    if (this.state.scrollOffset > totalBars - 1) {
      this.state.scrollOffset = Math.max(0, totalBars - 1);
    }
  }

  /** Index range of visible bars [startIdx, endIdx). Call once per frame before rendering. */
  updateVisibleRange(): { startIdx: number; endIdx: number } {
    const totalBars = this._barCount;
    const visible = this.visibleBarCount;

    // scrollOffset=0 means the last bar is at the right edge
    const endIdx = Math.max(1, totalBars - this.state.scrollOffset);
    const startIdx = Math.max(0, endIdx - visible);

    // Floor/ceil to ensure integer indices — scrollOffset can be fractional
    // from zoom() or scrollByPixels(), and fractional array indices return undefined.
    this._visibleRange = {
      startIdx: Math.max(0, Math.floor(startIdx - 2)),
      endIdx: Math.min(totalBars, Math.ceil(endIdx + 2)),
    };

    // Update natural-mode time window from visible range
    if (this.timeMode === 'natural' && this._bars.length > 0) {
      const s = this._visibleRange.startIdx;
      const e = Math.min(this._bars.length - 1, this._visibleRange.endIdx - 1);
      if (s <= e) {
        this._natTimeMin = this._bars[s]!.time;
        this._natTimeMax = this._bars[e]!.time;
        this._natTimeRange = this._natTimeMax - this._natTimeMin;
      }
    }

    return this._visibleRange;
  }

  /** Cached visible range — call updateVisibleRange() first each frame */
  get visibleRange(): { startIdx: number; endIdx: number } {
    return this._visibleRange;
  }

  /** Convert bar index to pixel X coordinate */
  barToX(barIndex: number): number {
    if (this.timeMode === 'natural' && this._bars.length > 0 && this._natTimeRange > 0) {
      return this.barToXNatural(barIndex);
    }
    return this.barToXCompressed(barIndex);
  }

  private barToXCompressed(barIndex: number): number {
    const totalBars = this._barCount;
    const rightEdgeBar = totalBars - this.state.scrollOffset;
    const barsFromRight = rightEdgeBar - barIndex;
    return this.chartRect.x + this.chartRect.width - this.effectiveMargin - barsFromRight * this.state.pixelsPerBar;
  }

  private barToXNatural(barIndex: number): number {
    const n = this._bars.length;
    if (n === 0) return this.chartRect.x;
    const avgSpacing = n >= 2 ? (this._bars[n - 1]!.time - this._bars[0]!.time) / (n - 1) : 1;
    let barTime: number;
    if (barIndex <= 0) {
      // Extrapolate left
      barTime = this._bars[0]!.time + barIndex * avgSpacing;
    } else if (barIndex >= n - 1) {
      // Extrapolate right (into margin)
      barTime = this._bars[n - 1]!.time + (barIndex - (n - 1)) * avgSpacing;
    } else {
      // Interpolate between bars
      const floorIdx = Math.floor(barIndex);
      const frac = barIndex - floorIdx;
      const t0 = this._bars[floorIdx]!.time;
      const t1 = this._bars[floorIdx + 1]!.time;
      barTime = t0 + frac * (t1 - t0);
    }
    const ratio = (barTime - this._natTimeMin) / this._natTimeRange;
    const dataWidth = this.chartRect.width - this.effectiveMargin;
    const margin = dataWidth * 0.01;
    const usableWidth = dataWidth - 2 * margin;
    return this.chartRect.x + margin + ratio * usableWidth;
  }

  /** Convert pixel X to bar index (fractional) */
  xToBar(x: number): number {
    if (this.timeMode === 'natural' && this._bars.length > 0 && this._natTimeRange > 0) {
      return this.xToBarNatural(x);
    }
    return this.xToBarCompressed(x);
  }

  private xToBarCompressed(x: number): number {
    if (this.state.pixelsPerBar <= 0) return 0;
    const totalBars = this._barCount;
    const rightEdgeBar = totalBars - this.state.scrollOffset;
    const barsFromRight = (this.chartRect.x + this.chartRect.width - this.effectiveMargin - x) / this.state.pixelsPerBar;
    return rightEdgeBar - barsFromRight;
  }

  private xToBarNatural(x: number): number {
    const dataWidth = this.chartRect.width - this.effectiveMargin;
    const margin = dataWidth * 0.01;
    const usableWidth = dataWidth - 2 * margin;
    if (usableWidth <= 0) return 0;
    const ratio = (x - this.chartRect.x - margin) / usableWidth;
    const targetTime = this._natTimeMin + ratio * this._natTimeRange;
    // Return fractional bar index for smooth (no-snap) positioning
    const n = this._bars.length;
    if (n < 2) return 0;
    const avgSpacing = (this._bars[n - 1]!.time - this._bars[0]!.time) / (n - 1);
    // Extrapolate beyond data bounds
    if (targetTime <= this._bars[0]!.time) {
      return avgSpacing > 0 ? (targetTime - this._bars[0]!.time) / avgSpacing : 0;
    }
    if (targetTime >= this._bars[n - 1]!.time) {
      return avgSpacing > 0 ? (n - 1) + (targetTime - this._bars[n - 1]!.time) / avgSpacing : n - 1;
    }
    // Interpolate between bars
    const idx = this.findBarIndex(targetTime, this._bars);
    const t = this._bars[idx]!.time;
    if (targetTime >= t && idx < n - 1) {
      const tNext = this._bars[idx + 1]!.time;
      const span = tNext - t;
      return span > 0 ? idx + (targetTime - t) / span : idx;
    }
    if (targetTime < t && idx > 0) {
      const tPrev = this._bars[idx - 1]!.time;
      const span = t - tPrev;
      return span > 0 ? idx - 1 + (targetTime - tPrev) / span : idx;
    }
    return idx;
  }

  /** Convert a timestamp to pixel X (for session bands, grid lines, etc.) */
  timeToX(timestamp: number): number {
    if (this._natTimeRange <= 0) return this.chartRect.x;
    const dataWidth = this.chartRect.width - this.effectiveMargin;
    const margin = dataWidth * 0.01;
    const usableWidth = dataWidth - 2 * margin;
    const ratio = (timestamp - this._natTimeMin) / this._natTimeRange;
    return this.chartRect.x + margin + ratio * usableWidth;
  }

  /**
   * Convert an arbitrary timestamp to pixel X, supporting sub-bar precision.
   * Natural mode: uses direct time→pixel mapping.
   * Compressed mode: interpolates fractional bar index between surrounding bars.
   */
  timestampToX(timestamp: number, bars: OHLCVBar[]): number {
    if (this.timeMode === 'natural' && this._bars.length > 0 && this._natTimeRange > 0) {
      return this.timeToX(timestamp);
    }
    // Compressed mode: find surrounding bars and interpolate
    if (bars.length === 0) return this.chartRect.x;
    // Extrapolate beyond last bar into the margin zone
    if (timestamp > bars[bars.length - 1]!.time && bars.length >= 2) {
      const lastIdx = bars.length - 1;
      const avgSpacing = (bars[lastIdx]!.time - bars[0]!.time) / lastIdx;
      if (avgSpacing > 0) {
        const extraBars = (timestamp - bars[lastIdx]!.time) / avgSpacing;
        return this.barToXCompressed(lastIdx + extraBars);
      }
    }
    const idx = this.findBarIndex(timestamp, bars);
    // Exact match or at boundaries — just use the bar index
    if (idx <= 0 || idx >= bars.length || bars[idx]!.time === timestamp) {
      return this.barToXCompressed(idx);
    }
    // Interpolate between bars[idx-1] and bars[idx]
    const t0 = bars[idx - 1]!.time;
    const t1 = bars[idx]!.time;
    const frac = t1 > t0 ? (timestamp - t0) / (t1 - t0) : 0;
    return this.barToXCompressed(idx - 1 + frac);
  }

  /** Get the visible time range (for natural mode) */
  get visibleTimeRange(): { min: number; max: number } {
    return { min: this._natTimeMin, max: this._natTimeMax };
  }

  /** Convert price to pixel Y coordinate */
  priceToY(price: number): number {
    const { priceMin, priceMax } = this.state;
    const range = priceMax - priceMin;
    if (range <= 0 || this.chartRect.height <= 0) return this.chartRect.y + this.chartRect.height / 2;
    const ratio = (price - priceMin) / range;
    return this.chartRect.y + this.chartRect.height * (1 - ratio);
  }

  /** Convert pixel Y to price */
  yToPrice(y: number): number {
    const { priceMin, priceMax } = this.state;
    const range = priceMax - priceMin;
    if (this.chartRect.height <= 0 || range <= 0) return priceMin;
    const ratio = 1 - (y - this.chartRect.y) / this.chartRect.height;
    return priceMin + ratio * range;
  }

  /** Convert world coordinates (timestamp, price) to pixel using bar data */
  worldToPixel(worldX: number, worldY: number, bars: OHLCVBar[]): Point {
    return {
      x: this.timestampToX(worldX, bars),
      y: this.priceToY(worldY),
    };
  }

  /** Binary search for bar index by timestamp */
  findBarIndex(timestamp: number, bars: OHLCVBar[]): number {
    if (bars.length === 0) return 0;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid]!.time < timestamp) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** Auto-scale price axis to fit visible bars */
  autoScale(bars: OHLCVBar[]): void {
    if (!this.state.autoScale || bars.length === 0) return;

    const { startIdx, endIdx } = this.visibleRange;
    let min = Infinity;
    let max = -Infinity;

    for (let i = Math.max(0, startIdx); i < Math.min(bars.length, endIdx); i++) {
      const bar = bars[i]!;
      if (!isFinite(bar.low) || !isFinite(bar.high)) continue;
      if (bar.low < min) min = bar.low;
      if (bar.high > max) max = bar.high;
    }

    if (min === Infinity || max === -Infinity) return;

    const range = max - min;
    const padding = Math.max(range * 0.05, Math.abs(min) * 0.001, 0.01);
    this.state.priceMin = min - padding;
    this.state.priceMax = max + padding;
  }

  /** Zoom in/out — right edge stays fixed (matches legacy behavior) */
  zoom(factor: number, _centerX: number): void {
    // Dynamic minimum: don't zoom out beyond ~1.5× the total bar count
    const minPixPerBar = this._barCount > 0
      ? this.chartRect.width / (this._barCount * 1.5)
      : 0.05;
    this.state.pixelsPerBar = Math.max(minPixPerBar, Math.min(60, this.state.pixelsPerBar * factor));
    // scrollOffset is NOT changed — the right edge of the chart stays fixed
  }

  /** Scroll by pixel delta */
  scrollByPixels(deltaX: number): void {
    const barDelta = deltaX / this.state.pixelsPerBar;
    const maxScroll = Math.max(0, this._barCount - 1);
    this.state.scrollOffset = Math.min(maxScroll, Math.max(0, this.state.scrollOffset + barDelta));
  }

  /** Scroll by bar count */
  scrollByBars(deltaBars: number): void {
    const maxScroll = Math.max(0, this._barCount - 1);
    this.state.scrollOffset = Math.min(maxScroll, Math.max(0, this.state.scrollOffset + deltaBars));
  }

  /** Clone current state */
  cloneState(): ViewState {
    return { ...this.state };
  }
}
