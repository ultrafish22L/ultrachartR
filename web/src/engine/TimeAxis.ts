import { OHLCVBar, Rect, ChartPeriod } from '../types/chart';
import { Viewport } from './Viewport';
import { themeColors } from './themeColors';

// Cached date formatters — 54x faster than toLocaleDateString per call
const fmtMonthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const fmtMonth = new Intl.DateTimeFormat('en-US', { month: 'short' });
const fmtMonthDayYear = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** A tick mark on the time axis */
export interface TimeTick {
  barIndex: number;
  x: number;
  label: string;
  /** Secondary label shown below the main label (e.g., date for intraday) */
  subLabel?: string;
  isMajor: boolean;
  /** Minor tick: grid line + tick mark only, no label. Used in legacy mode. */
  isMinor?: boolean;
}

/**
 * TimeAxis computes time grid lines and axis labels.
 * Mirrors legacy cTimeAxis drawing logic.
 *
 * For intraday compressed charts (bars by index), the axis shows:
 *   - Close zoom: HH:MM labels, with date on day boundaries
 *   - Medium zoom: session times + day dates
 *   - Far zoom: day numbers + month labels (like legacy 2-month view)
 */
export class TimeAxis {
  /** Reusable Date object to avoid allocations in tick computation loops */
  private static readonly _td = new Date();

  /** Get timestamp for a bar index, extrapolating beyond data using avg bar spacing */
  private static barTime(bars: OHLCVBar[], i: number): number {
    if (bars.length === 0) return 0;
    if (i < bars.length) return bars[i]!.time;
    // Use median of last 10 bar spacings for more reliable extrapolation
    // (avoids skew from session gaps in avg of all bars)
    const sampleCount = Math.min(10, bars.length - 1);
    let avgSpacing: number;
    if (sampleCount >= 1) {
      const startSample = bars.length - 1 - sampleCount;
      avgSpacing = (bars[bars.length - 1]!.time - bars[startSample]!.time) / sampleCount;
    } else {
      avgSpacing = 300_000; // fallback for single-bar datasets
    }
    return bars[bars.length - 1]!.time + (i - bars.length + 1) * avgSpacing;
  }

  /** Align timestamp down to a local-time interval boundary (avoids UTC misalignment) */
  private static localAlignedStart(t: number, intervalMs: number): number {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    const midnight = d.getTime();
    return midnight + Math.floor((t - midnight) / intervalMs) * intervalMs;
  }

  /**
   * Calculate visible time ticks for drawing grid lines and labels.
   */
  static computeTicks(
    bars: OHLCVBar[],
    viewport: Viewport,
    period: ChartPeriod,
    timelineStyle: 'express' | 'legacy' = 'express',
  ): TimeTick[] {
    if (bars.length === 0) return [];

    if (timelineStyle === 'legacy') {
      if (period === 'intraday') {
        return this.computeLegacyIntraday(bars, viewport);
      }
      return this.computeLegacyDaily(bars, viewport);
    }

    if (period === 'intraday') {
      return this.computeIntradayTicks(bars, viewport);
    }
    return this.computeDailyTicks(bars, viewport);
  }

  /**
   * Intraday tick computation - dispatches to compressed or natural mode.
   */
  private static computeIntradayTicks(
    bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    if (viewport.timeMode === 'natural') {
      return this.computeIntradayTicksNatural(bars, viewport);
    }
    return this.computeIntradayTicksCompressed(bars, viewport);
  }

  /**
   * Natural mode: ticks at regular clock-time intervals.
   * Uses viewport.timeToX() so ticks align with actual clock time.
   */
  private static computeIntradayTicksNatural(
    _bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    const ticks: TimeTick[] = [];
    const { min: tMin, max: tMax } = viewport.visibleTimeRange;
    if (tMax <= tMin) return ticks;

    const rangeMs = tMax - tMin;
    const rangeHours = rangeMs / (3600 * 1000);

    // Pick tick interval based on time range
    let intervalMs: number;
    let showMinutes: boolean;
    if (rangeHours > 30 * 24) {
      // > 1 month: tick every week
      intervalMs = 7 * 24 * 3600 * 1000;
      showMinutes = false;
    } else if (rangeHours > 14 * 24) {
      // > 2 weeks: tick every 2 days
      intervalMs = 2 * 24 * 3600 * 1000;
      showMinutes = false;
    } else if (rangeHours > 5 * 24) {
      // > 5 days: tick every day
      intervalMs = 24 * 3600 * 1000;
      showMinutes = false;
    } else if (rangeHours > 48) {
      // > 2 days: tick every 12 hours
      intervalMs = 12 * 3600 * 1000;
      showMinutes = true;
    } else if (rangeHours > 24) {
      // > 1 day: tick every 6 hours
      intervalMs = 6 * 3600 * 1000;
      showMinutes = true;
    } else if (rangeHours > 12) {
      // > 12h: tick every 3 hours
      intervalMs = 3 * 3600 * 1000;
      showMinutes = true;
    } else if (rangeHours > 6) {
      // > 6h: tick every hour
      intervalMs = 3600 * 1000;
      showMinutes = true;
    } else if (rangeHours > 2) {
      // > 2h: tick every 30 min
      intervalMs = 30 * 60 * 1000;
      showMinutes = true;
    } else {
      // < 2h: tick every 15 min
      intervalMs = 15 * 60 * 1000;
      showMinutes = true;
    }

    // Round start time down to nearest interval
    const startAligned = this.localAlignedStart(tMin, intervalMs);
    let prevDay = -1;

    const chartRight = viewport.chartRect.x + viewport.chartRect.width;
    for (let t = startAligned; ; t += intervalMs) {
      const x = viewport.timeToX(t);
      if (x > chartRight + 20) break;
      if (x < viewport.chartRect.x - 20) continue;

      this._td.setTime(t);
      const d = this._td;
      const day = d.getDate();
      const hours = d.getHours();
      const minutes = d.getMinutes();

      const isDayBoundary = day !== prevDay && prevDay !== -1;
      prevDay = day;

      if (showMinutes) {
        const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        if (isDayBoundary || (hours === 0 && minutes === 0)) {
          const dateStr = fmtMonthDay.format(d);
          ticks.push({ barIndex: 0, x, isMajor: true, label: timeStr, subLabel: dateStr });
        } else {
          ticks.push({ barIndex: 0, x, isMajor: false, label: timeStr });
        }
      } else {
        const dateStr = fmtMonthDay.format(d);
        const isMajor = d.getDate() === 1;
        ticks.push({ barIndex: 0, x, isMajor, label: dateStr });
      }
    }

    return ticks;
  }

  /**
   * Compressed mode: ticks based on bar index positions.
   * Detects day boundaries and produces appropriate labels at each zoom level.
   */
  private static computeIntradayTicksCompressed(
    bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    const ticks: TimeTick[] = [];
    const { startIdx, endIdx } = viewport.visibleRange;
    // Use effective spacing for tick density (accounts for natural-mode mismatch)
    const pixPerBar = viewport.effectivePixelsPerBar;
    const visibleBars = Math.max(1, endIdx - startIdx);

    // Extend past data into the right margin zone
    const marginBars = Math.ceil(viewport.rightMargin / viewport.state.pixelsPerBar);
    const start = Math.max(0, startIdx);
    const end = endIdx + marginBars + 1;

    // Decide what to show based on zoom level
    // With 5-min bars: 1 trading day ≈ 180–288 bars (15–24h)
    if (visibleBars > 4000) {
      // Very far zoom: show month labels on month boundaries, week ticks
      this.intradayFarZoom(bars, viewport, ticks, start, end);
    } else if (visibleBars > 1500) {
      // Far zoom: show day numbers with month labels
      this.intradayDayZoom(bars, viewport, ticks, start, end);
    } else if (visibleBars > 400) {
      // Medium zoom: show day dates
      this.intradayMediumZoom(bars, viewport, ticks, start, end);
    } else {
      // Close zoom: show HH:MM with day boundaries
      this.intradayCloseZoom(bars, viewport, ticks, start, end, pixPerBar);
    }

    return ticks;
  }

  /** Very zoomed out: month labels + day-of-month ticks */
  private static intradayFarZoom(
    bars: OHLCVBar[],
    viewport: Viewport,
    ticks: TimeTick[],
    start: number,
    end: number,
  ): void {
    let prevMonth = -1;
    let prevDay = -1;
    const effPixPerBar = viewport.effectivePixelsPerBar;
    // Skip bars to avoid too-dense labels
    const skipDays = effPixPerBar < 0.3 ? 7 : effPixPerBar < 0.5 ? 3 : 2;
    let dayCount = 0;
    let lastTickX = -Infinity;
    const minSpacing = 50;

    for (let i = start; i < end; i++) {
      this._td.setTime(this.barTime(bars, i));
      const d = this._td;
      const day = d.getDate();
      const month = d.getMonth();
      const year = d.getFullYear();

      if (day !== prevDay) {
        dayCount++;
        prevDay = day;

        if (month !== prevMonth) {
          // Month boundary - major tick
          prevMonth = month;
          const x = viewport.barToX(i);
          if (x - lastTickX < minSpacing) continue;
          const monthStr = fmtMonth.format(d);
          ticks.push({
            barIndex: i, x, isMajor: true,
            label: month === 0 ? `${monthStr} ${year}` : monthStr,
          });
          lastTickX = x;
          dayCount = 0;
        } else if (dayCount % skipDays === 0) {
          // Regular day tick
          const x = viewport.barToX(i);
          if (x - lastTickX < minSpacing) continue;
          ticks.push({
            barIndex: i, x, isMajor: false,
            label: `${day}`,
          });
          lastTickX = x;
        }
      }
    }
  }

  /** Far zoom: day numbers with month markers */
  private static intradayDayZoom(
    bars: OHLCVBar[],
    viewport: Viewport,
    ticks: TimeTick[],
    start: number,
    end: number,
  ): void {
    let prevDay = -1;
    let prevMonth = -1;
    let lastTickX = -Infinity;
    const minSpacing = 30;

    for (let i = start; i < end; i++) {
      this._td.setTime(this.barTime(bars, i));
      const d = this._td;
      const day = d.getDate();
      const month = d.getMonth();
      const year = d.getFullYear();

      if (day !== prevDay) {
        prevDay = day;
        const x = viewport.barToX(i);
        if (x - lastTickX < minSpacing) continue;

        if (month !== prevMonth) {
          // Month boundary
          prevMonth = month;
          const monthStr = fmtMonth.format(d);
          ticks.push({
            barIndex: i, x, isMajor: true,
            label: `${day}`,
            subLabel: month === 0 ? `${monthStr} ${year}` : monthStr,
          });
        } else {
          ticks.push({
            barIndex: i, x, isMajor: false,
            label: `${day}`,
          });
        }
        lastTickX = x;
      }
    }
  }

  /** Medium zoom: show date labels at day boundaries */
  private static intradayMediumZoom(
    bars: OHLCVBar[],
    viewport: Viewport,
    ticks: TimeTick[],
    start: number,
    end: number,
  ): void {
    let prevDay = -1;
    let lastTickX = -Infinity;
    const minSpacing = 65;

    for (let i = start; i < end; i++) {
      this._td.setTime(this.barTime(bars, i));
      const d = this._td;
      const day = d.getDate();

      if (day !== prevDay) {
        prevDay = day;
        const x = viewport.barToX(i);
        if (x - lastTickX < minSpacing) continue;
        const label = fmtMonthDay.format(d);
        ticks.push({
          barIndex: i, x, isMajor: true,
          label,
        });
        lastTickX = x;
      }
    }
  }

  /** Close zoom: HH:MM labels with day boundary markers */
  private static intradayCloseZoom(
    bars: OHLCVBar[],
    viewport: Viewport,
    ticks: TimeTick[],
    start: number,
    end: number,
    pixPerBar: number,
  ): void {
    // Determine how many bars between time labels
    const minSpacingPx = 65;
    const barsPerTick = Math.max(1, Math.ceil(minSpacingPx / pixPerBar));

    let prevDay = -1;
    let tickCounter = 0;
    let lastTickX = -Infinity;

    for (let i = start; i < end; i++) {
      this._td.setTime(this.barTime(bars, i));
      const d = this._td;
      const day = d.getDate();
      const hours = d.getHours();
      const minutes = d.getMinutes();

      // Detect day boundary
      if (day !== prevDay) {
        const wasFirst = prevDay === -1;
        prevDay = day;
        tickCounter = 0;

        if (!wasFirst) {
          const x = viewport.barToX(i);
          // Enforce minimum pixel spacing
          if (x - lastTickX < minSpacingPx) continue;
          // Day boundary: show date as primary label, time as secondary
          const dateLabel = fmtMonthDay.format(d);
          ticks.push({
            barIndex: i, x, isMajor: true,
            label: dateLabel,
            subLabel: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
          });
          lastTickX = x;
          continue;
        }
      }

      // Regular time ticks
      tickCounter++;
      if (tickCounter % barsPerTick === 0) {
        const x = viewport.barToX(i);
        // Enforce minimum pixel spacing
        if (x - lastTickX < minSpacingPx) continue;
        ticks.push({
          barIndex: i, x, isMajor: false,
          label: `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`,
        });
        lastTickX = x;
      }
    }
  }

  /**
   * Compute daily/weekly/monthly ticks (non-intraday).
   */
  private static computeDailyTicks(
    bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    if (viewport.timeMode === 'natural') {
      return this.computeDailyTicksNatural(bars, viewport);
    }
    const ticks: TimeTick[] = [];
    const { startIdx, endIdx } = viewport.visibleRange;
    // Use effective spacing (accounts for natural mode where pixelsPerBar != actual bar width)
    const pixPerBar = viewport.effectivePixelsPerBar;
    const minTickSpacingPx = 80;
    const barsPerTick = Math.max(1, Math.ceil(minTickSpacingPx / pixPerBar));

    let prevLabel = '';
    let lastTickX = -Infinity;
    const marginBars = Math.ceil(viewport.rightMargin / viewport.state.pixelsPerBar);
    const fullEnd = endIdx + marginBars + 1;
    for (let i = Math.max(0, startIdx); i < fullEnd; i++) {
      this._td.setTime(this.barTime(bars, i));
      const tick = this.dailyTickFn(this._td, i, barsPerTick, prevLabel);
      if (tick) {
        const x = viewport.barToX(i);
        // Enforce minimum pixel spacing between ticks to prevent overlap
        if (x - lastTickX < minTickSpacingPx) continue;
        ticks.push({ barIndex: i, x, ...tick });
        prevLabel = tick.label;
        lastTickX = x;
      }
    }

    return ticks;
  }

  private static dailyTickFn(
    date: Date,
    index: number,
    barsPerTick: number,
    _prevLabel: string,
  ): { label: string; isMajor: boolean } | null {
    const month = date.getMonth();
    const day = date.getDate();
    const year = date.getFullYear();

    // At very zoomed out levels, show years
    if (barsPerTick > 60) {
      if (month === 0 && day <= 7) {
        return { label: `${year}`, isMajor: true };
      }
      return null;
    }

    // At medium zoom, show months
    if (barsPerTick > 10) {
      if (day <= Math.ceil(barsPerTick / 2)) {
        const monthStr = fmtMonth.format(date);
        const isMajor = month === 0;
        return {
          label: isMajor ? `${monthStr} ${year}` : monthStr,
          isMajor,
        };
      }
      return null;
    }

    // At close zoom, show days
    if (index % barsPerTick === 0) {
      const isMajor = day === 1;
      if (isMajor) {
        const monthStr = fmtMonth.format(date);
        return { label: `${monthStr} ${year}`, isMajor: true };
      }
      return {
        label: fmtMonthDay.format(date),
        isMajor: false,
      };
    }

    return null;
  }

  /**
   * Natural mode daily: ticks at regular calendar-day intervals via timeToX().
   * Fills in weekend/holiday gaps that compressed mode doesn't have.
   */
  private static computeDailyTicksNatural(
    _bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    const ticks: TimeTick[] = [];
    const { min: tMin, max: tMax } = viewport.visibleTimeRange;
    if (tMax <= tMin) return ticks;

    const dayMs = 24 * 3600 * 1000;
    const rangeDays = (tMax - tMin) / dayMs;
    const chartWidthPx = viewport.chartRect.width;
    const pxPerDay = chartWidthPx / rangeDays;

    const minTickSpacingPx = 80;
    // Pick day interval so labels don't overlap
    const intervals = [1, 2, 7, 14, 28, 90, 180, 365];
    let intervalDays = 365;
    for (const iv of intervals) {
      if (iv * pxPerDay >= minTickSpacingPx) {
        intervalDays = iv;
        break;
      }
    }

    const chartRight = viewport.chartRect.x + viewport.chartRect.width;
    const chartLeft = viewport.chartRect.x;
    const startMs = this.localAlignedStart(tMin, dayMs * intervalDays);
    let lastTickX = -Infinity;
    let prevMonth = -1;

    for (let t = startMs; ; t += intervalDays * dayMs) {
      const x = viewport.timeToX(t);
      if (x > chartRight + 20) break;
      if (x < chartLeft - 20) continue;
      if (x - lastTickX < minTickSpacingPx) continue;

      this._td.setTime(t);
      const d = this._td;
      const month = d.getMonth();
      const day = d.getDate();
      const year = d.getFullYear();
      const isMajor = day === 1 || month !== prevMonth;
      if (month !== prevMonth) prevMonth = month;

      let label: string;
      if (intervalDays >= 28) {
        const monthStr = fmtMonth.format(d);
        label = month === 0 ? `${monthStr} ${year}` : monthStr;
      } else if (isMajor) {
        const monthStr = fmtMonth.format(d);
        label = `${monthStr} ${year}`;
      } else {
        label = fmtMonthDay.format(d);
      }

      ticks.push({ barIndex: 0, x, isMajor, label });
      lastTickX = x;
    }

    return ticks;
  }

  // ── Legacy 2-row timeline ─────────────────────────────────────────
  // Adaptive major/minor ticks like legacy UltraChart: dense grid,
  // dotted lines, tick marks, 2-row axis with date below.

  // Legacy-style adaptive intervals (minutes): [major, minor]
  // Picks the smallest major interval whose labels don't overlap.
  // Extended with day-scale intervals for far zoom on intraday data.
  private static readonly INTRADAY_INTERVALS: [number, number][] = [
    [1, 1], [5, 1], [10, 5], [15, 5], [20, 10],
    [30, 10], [60, 30], [120, 60], [240, 60], [720, 120],
    [1440, 720], [2880, 1440], [7200, 1440], [14400, 7200],
  ];

  /**
   * Legacy intraday: dense adaptive ticks with major/minor grid.
   */
  private static computeLegacyIntraday(
    bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    if (viewport.timeMode === 'natural') {
      return this.computeLegacyIntradayNatural(bars, viewport);
    }

    const ticks: TimeTick[] = [];
    const { startIdx, endIdx } = viewport.visibleRange;
    const pixPerBar = viewport.effectivePixelsPerBar;
    const marginBars = Math.ceil(viewport.rightMargin / viewport.state.pixelsPerBar);
    const start = Math.max(0, startIdx);
    const end = endIdx + marginBars + 1;

    // Determine bar interval (minutes per bar)
    let barIntervalMin = 5;
    if (bars.length >= 2) {
      barIntervalMin = Math.round((bars[1]!.time - bars[0]!.time) / 60000);
      if (barIntervalMin < 1) barIntervalMin = 1;
    }

    // Label width in pixels (approx 38px for "HH:MM" at 10px font)
    const labelWidthPx = 38;

    // Find best major interval: smallest where labels don't overlap
    let majorMin = 60;
    let minorMin = 30;
    for (const [maj, min] of this.INTRADAY_INTERVALS) {
      const barsForMaj = Math.max(1, Math.round(maj / barIntervalMin));
      const pxSpacing = barsForMaj * pixPerBar;
      if (pxSpacing >= labelWidthPx) {
        majorMin = maj;
        minorMin = min;
        break;
      }
    }

    // Enforce minimum pixel spacing to prevent overlapping labels/grid
    const minMajorSpacing = labelWidthPx;
    const minMinorSpacing = 6;
    let lastMajorX = -Infinity;
    let lastMinorX = -Infinity;
    let prevDay = -1;

    // For day-scale majors (>= 1440 min), show date instead of time
    const dayScale = majorMin >= 1440;

    for (let i = start; i < end; i++) {
      this._td.setTime(this.barTime(bars, i));
      const d = this._td;
      const day = d.getDate();
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const totalMin = hours * 60 + minutes;
      const x = viewport.barToX(i);

      // Day boundary detection
      const isDayBoundary = day !== prevDay && prevDay !== -1;
      if (day !== prevDay) prevDay = day;

      // Major tick: day boundary or time aligns to major interval
      if (isDayBoundary || totalMin % majorMin === 0) {
        if (x - lastMajorX >= minMajorSpacing) {
          const label = dayScale
            ? fmtMonthDay.format(d)
            : `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          ticks.push({
            barIndex: i, x, isMajor: true,
            label,
            subLabel: dayScale ? `${d.getFullYear()}` : fmtMonthDayYear.format(d),
          });
          lastMajorX = x;
          lastMinorX = x;
        }
      } else if (totalMin % minorMin === 0) {
        // Minor tick: just grid line + tick mark, no label
        if (x - lastMinorX >= minMinorSpacing) {
          ticks.push({
            barIndex: i, x, isMajor: false, isMinor: true,
            label: '',
          });
          lastMinorX = x;
        }
      }
    }

    return ticks;
  }

  /** Legacy natural intraday: clock-time ticks with dense adaptive grid */
  private static computeLegacyIntradayNatural(
    _bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    const ticks: TimeTick[] = [];
    const { min: tMin, max: tMax } = viewport.visibleTimeRange;
    if (tMax <= tMin) return ticks;

    const rangeMs = tMax - tMin;
    const chartWidthPx = viewport.chartRect.width;
    const labelWidthPx = 38;

    // Find best major interval — extended with day-scale for far zoom
    const intervals = [1, 5, 10, 15, 20, 30, 60, 120, 240, 720, 1440, 2880, 7200, 14400];
    const minorMap: Record<number, number> = {
      1: 1, 5: 1, 10: 5, 15: 5, 20: 10, 30: 10, 60: 30, 120: 60, 240: 60, 720: 120,
      1440: 720, 2880: 1440, 7200: 1440, 14400: 7200,
    };

    let majorMin = 1440;
    let minorMin = 720;
    for (const m of intervals) {
      const intervalMs = m * 60000;
      const tickCount = rangeMs / intervalMs;
      const pxPerTick = chartWidthPx / tickCount;
      if (pxPerTick >= labelWidthPx) {
        majorMin = m;
        minorMin = minorMap[m] ?? m;
        break;
      }
    }

    const dayScale = majorMin >= 1440;
    const minorMs = minorMin * 60000;

    // Generate ticks at minor interval, promoting to major when aligned
    const minorStart = this.localAlignedStart(tMin, minorMs);
    const chartRight = viewport.chartRect.x + viewport.chartRect.width;
    const minMajorSpacing = labelWidthPx;
    const minMinorSpacing = 6;
    let lastMajorX = -Infinity;
    let lastMinorX = -Infinity;

    for (let t = minorStart; ; t += minorMs) {
      const x = viewport.timeToX(t);
      if (x > chartRight + 20) break;
      if (x < viewport.chartRect.x - 20) continue;

      this._td.setTime(t);
      const d = this._td;
      const hours = d.getHours();
      const minutes = d.getMinutes();
      const totalMin = hours * 60 + minutes;

      if (totalMin % majorMin === 0) {
        if (x - lastMajorX >= minMajorSpacing) {
          const label = dayScale
            ? fmtMonthDay.format(d)
            : `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          ticks.push({
            barIndex: 0, x, isMajor: true,
            label,
            subLabel: dayScale ? `${d.getFullYear()}` : fmtMonthDayYear.format(d),
          });
          lastMajorX = x;
          lastMinorX = x;
        }
      } else {
        if (x - lastMinorX >= minMinorSpacing) {
          ticks.push({
            barIndex: 0, x, isMajor: false, isMinor: true,
            label: '',
          });
          lastMinorX = x;
        }
      }
    }

    return ticks;
  }

  /**
   * Legacy daily: dense ticks, top row = day, bottom row = month/year.
   */
  private static computeLegacyDaily(
    bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    if (viewport.timeMode === 'natural') {
      return this.computeLegacyDailyNatural(bars, viewport);
    }
    const ticks: TimeTick[] = [];
    const { startIdx, endIdx } = viewport.visibleRange;
    const pixPerBar = viewport.effectivePixelsPerBar;

    // Adaptive: label every Nth day, minor ticks every day
    const labelWidthPx = 24;
    const dayIntervals = [1, 7, 14, 28];
    const minorDays = [1, 1, 7, 14];
    let majorDayN = 7;
    let minorDayN = 1;
    for (let idx = 0; idx < dayIntervals.length; idx++) {
      if (dayIntervals[idx]! * pixPerBar >= labelWidthPx) {
        majorDayN = dayIntervals[idx]!;
        minorDayN = minorDays[idx]!;
        break;
      }
    }

    const marginBars = Math.ceil(viewport.rightMargin / viewport.state.pixelsPerBar);
    const fullEnd = endIdx + marginBars + 1;
    let prevDay = -1;
    let prevMonth = -1;
    let dayCount = 0;
    for (let i = Math.max(0, startIdx); i < fullEnd; i++) {
      this._td.setTime(this.barTime(bars, i));
      const d = this._td;
      const day = d.getDate();
      const month = d.getMonth();
      const year = d.getFullYear();

      if (day === prevDay) continue;
      prevDay = day;
      dayCount++;

      const x = viewport.barToX(i);
      const monthStr = fmtMonth.format(d);
      const isMonthBoundary = month !== prevMonth;
      if (isMonthBoundary) prevMonth = month;

      if (isMonthBoundary || dayCount % majorDayN === 0) {
        ticks.push({
          barIndex: i, x, isMajor: true,
          label: `${day}`,
          subLabel: isMonthBoundary
            ? (month === 0 ? `${monthStr} ${year}` : monthStr)
            : undefined,
        });
      } else if (dayCount % minorDayN === 0) {
        ticks.push({
          barIndex: i, x, isMajor: false, isMinor: true,
          label: '',
        });
      }
    }

    return ticks;
  }

  /** Legacy daily natural: ticks at calendar-day intervals with major/minor grid */
  private static computeLegacyDailyNatural(
    _bars: OHLCVBar[],
    viewport: Viewport,
  ): TimeTick[] {
    const ticks: TimeTick[] = [];
    const { min: tMin, max: tMax } = viewport.visibleTimeRange;
    if (tMax <= tMin) return ticks;

    const dayMs = 24 * 3600 * 1000;
    const rangeDays = (tMax - tMin) / dayMs;
    const chartWidthPx = viewport.chartRect.width;
    const pxPerDay = chartWidthPx / rangeDays;

    // Adaptive major/minor intervals based on pixel density
    const labelWidthPx = 24;
    const dayIntervals = [1, 7, 14, 28];
    const minorDaysArr = [1, 1, 7, 14];
    let majorDayN = 7;
    let minorDayN = 1;
    for (let idx = 0; idx < dayIntervals.length; idx++) {
      if (dayIntervals[idx]! * pxPerDay >= labelWidthPx) {
        majorDayN = dayIntervals[idx]!;
        minorDayN = minorDaysArr[idx]!;
        break;
      }
    }

    const chartRight = viewport.chartRect.x + viewport.chartRect.width;
    const chartLeft = viewport.chartRect.x;
    const startMs = this.localAlignedStart(tMin, dayMs);
    let prevMonth = -1;
    let dayCount = 0;

    for (let t = startMs; ; t += dayMs) {
      const x = viewport.timeToX(t);
      if (x > chartRight + 20) break;
      if (x < chartLeft - 20) continue;

      dayCount++;
      this._td.setTime(t);
      const d = this._td;
      const day = d.getDate();
      const month = d.getMonth();
      const year = d.getFullYear();
      const monthStr = fmtMonth.format(d);
      const isMonthBoundary = month !== prevMonth;
      if (isMonthBoundary) prevMonth = month;

      if (isMonthBoundary || dayCount % majorDayN === 0) {
        ticks.push({
          barIndex: 0, x, isMajor: true,
          label: `${day}`,
          subLabel: isMonthBoundary
            ? (month === 0 ? `${monthStr} ${year}` : monthStr)
            : undefined,
        });
      } else if (dayCount % minorDayN === 0) {
        ticks.push({
          barIndex: 0, x, isMajor: false, isMinor: true,
          label: '',
        });
      }
    }

    return ticks;
  }

  /** Draw the time axis on the canvas */
  static draw(
    ctx: CanvasRenderingContext2D,
    ticks: TimeTick[],
    axisRect: Rect,
    chartRect: Rect,
    timelineStyle: 'express' | 'legacy' = 'express',
  ): void {
    if (timelineStyle === 'legacy') {
      this.drawLegacy(ctx, ticks, axisRect, chartRect);
    } else {
      this.drawExpress(ctx, ticks, axisRect, chartRect);
    }
  }

  private static drawExpress(
    ctx: CanvasRenderingContext2D,
    ticks: TimeTick[],
    axisRect: Rect,
    chartRect: Rect,
  ): void {
    ctx.save();
    ctx.lineWidth = 1;
    const chartLeft = chartRect.x;
    const chartRight = chartRect.x + chartRect.width;
    const chartTop = chartRect.y;
    const chartBottom = chartRect.y + chartRect.height;
    const axisTop = axisRect.y;

    // ── Batch 1: minor grid lines (one path) ──
    ctx.strokeStyle = themeColors.chartGrid;
    ctx.beginPath();
    for (const tick of ticks) {
      if (tick.isMajor || tick.x < chartLeft || tick.x > chartRight) continue;
      const xSnap = Math.round(tick.x) + 0.5;
      ctx.moveTo(xSnap, chartTop);
      ctx.lineTo(xSnap, chartBottom);
    }
    ctx.stroke();

    // ── Batch 2: major grid lines (one path) ──
    ctx.strokeStyle = themeColors.chartGridMajor;
    ctx.beginPath();
    for (const tick of ticks) {
      if (!tick.isMajor || tick.x < chartLeft || tick.x > chartRight) continue;
      const xSnap = Math.round(tick.x) + 0.5;
      ctx.moveTo(xSnap, chartTop);
      ctx.lineTo(xSnap, chartBottom);
    }
    ctx.stroke();

    // ── Batch 3: all tick marks (one path, same style) ──
    ctx.strokeStyle = themeColors.textMuted;
    ctx.beginPath();
    for (const tick of ticks) {
      if (tick.x < chartLeft || tick.x > chartRight) continue;
      const xSnap = Math.round(tick.x) + 0.5;
      ctx.moveTo(xSnap, axisTop);
      ctx.lineTo(xSnap, axisTop + (tick.isMajor ? 4 : 3));
    }
    ctx.stroke();

    // ── Pass 4: text labels (cannot be batched) ──
    ctx.font = '10px var(--font-mono, Consolas, monospace)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tick of ticks) {
      if (tick.x < chartLeft || tick.x > chartRight) continue;
      // Snap label x to match grid line position (avoids sub-pixel misalignment)
      const xLabel = Math.round(tick.x);
      ctx.fillStyle = tick.isMajor ? themeColors.textSecondary : themeColors.textMuted;
      ctx.fillText(tick.label, xLabel, axisTop + 5);
      if (tick.subLabel) {
        ctx.fillStyle = themeColors.textSecondary;
        ctx.fillText(tick.subLabel, xLabel, axisTop + 16);
      }
    }

    ctx.restore();
  }

  private static drawLegacy(
    ctx: CanvasRenderingContext2D,
    ticks: TimeTick[],
    axisRect: Rect,
    chartRect: Rect,
  ): void {
    ctx.save();
    ctx.lineWidth = 1;
    const rowSplit = axisRect.y + 16; // split between time row and date row
    const chartLeft = chartRect.x;
    const chartRight = chartRect.x + chartRect.width;
    const chartTop = chartRect.y;
    const chartBottom = chartRect.y + chartRect.height;
    const axisTop = axisRect.y;
    const axisBottom = axisRect.y + axisRect.height;

    // ── Horizontal separators (axis top + row split) ──
    ctx.strokeStyle = themeColors.chartCrosshair;
    ctx.beginPath();
    ctx.moveTo(chartLeft, Math.round(axisTop) + 0.5);
    ctx.lineTo(chartRight, Math.round(axisTop) + 0.5);
    ctx.stroke();
    ctx.strokeStyle = themeColors.chartGrid;
    ctx.beginPath();
    ctx.moveTo(chartLeft, Math.round(rowSplit) + 0.5);
    ctx.lineTo(chartRight, Math.round(rowSplit) + 0.5);
    ctx.stroke();

    // ── Collect date spans for centered bottom-row labels ──
    const dateSpans: { label: string; xMin: number; xMax: number }[] = [];
    for (const tick of ticks) {
      if (tick.x < chartLeft || tick.x > chartRight) continue;
      if (!tick.subLabel) continue;
      const last = dateSpans[dateSpans.length - 1];
      if (last && last.label === tick.subLabel) {
        last.xMax = tick.x;
      } else {
        dateSpans.push({ label: tick.subLabel, xMin: tick.x, xMax: tick.x });
      }
    }
    for (let i = 0; i < dateSpans.length; i++) {
      if (i === 0) dateSpans[i]!.xMin = chartLeft;
      if (i === dateSpans.length - 1) dateSpans[i]!.xMax = chartRight;
      else {
        const mid = (dateSpans[i]!.xMax + dateSpans[i + 1]!.xMin) / 2;
        dateSpans[i]!.xMax = mid;
        dateSpans[i + 1]!.xMin = mid;
      }
    }

    // ── Batch 1: minor grid lines (dotted, one path) ──
    ctx.setLineDash([1, 4]);
    ctx.strokeStyle = themeColors.chartGrid;
    ctx.beginPath();
    for (const tick of ticks) {
      if (tick.isMajor || tick.x < chartLeft || tick.x > chartRight) continue;
      const xSnap = Math.round(tick.x) + 0.5;
      ctx.moveTo(xSnap, chartTop);
      ctx.lineTo(xSnap, chartBottom);
    }
    ctx.stroke();

    // ── Batch 2: major grid lines (dotted, one path) ──
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = themeColors.chartGridMajor;
    ctx.beginPath();
    for (const tick of ticks) {
      if (!tick.isMajor || tick.x < chartLeft || tick.x > chartRight) continue;
      const xSnap = Math.round(tick.x) + 0.5;
      ctx.moveTo(xSnap, chartTop);
      ctx.lineTo(xSnap, chartBottom);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Batch 3: all tick marks (solid, one path) ──
    ctx.strokeStyle = themeColors.textMuted;
    ctx.beginPath();
    for (const tick of ticks) {
      if (tick.x < chartLeft || tick.x > chartRight) continue;
      const xSnap = Math.round(tick.x) + 0.5;
      ctx.moveTo(xSnap, axisTop);
      ctx.lineTo(xSnap, axisTop + (tick.isMajor ? 4 : 3));
    }
    ctx.stroke();

    // ── Batch 4: major vertical lines through axis area (solid, one path) ──
    ctx.strokeStyle = themeColors.chartGrid;
    ctx.beginPath();
    for (const tick of ticks) {
      if (!tick.isMajor || tick.x < chartLeft || tick.x > chartRight) continue;
      const xSnap = Math.round(tick.x) + 0.5;
      ctx.moveTo(xSnap, axisTop);
      ctx.lineTo(xSnap, axisBottom);
    }
    ctx.stroke();

    // ── Pass 5: time labels (top row, cannot be batched) ──
    ctx.font = '10px var(--font-mono, Consolas, monospace)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tick of ticks) {
      if (!tick.label || tick.x < chartLeft || tick.x > chartRight) continue;
      // Snap label x to match grid line position
      const xLabel = Math.round(tick.x);
      ctx.fillStyle = tick.isMajor ? themeColors.textSecondary : themeColors.textMuted;
      ctx.fillText(tick.label, xLabel, axisTop + 4);
    }

    // ── Pass 6: centered date labels (bottom row) ──
    ctx.fillStyle = themeColors.textSecondary;
    for (const span of dateSpans) {
      const cx = Math.round((span.xMin + span.xMax) / 2);
      ctx.fillText(span.label, cx, rowSplit + 2);
    }

    ctx.restore();
  }
}
