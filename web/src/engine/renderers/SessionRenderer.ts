import { OHLCVBar, Rect } from '../../types/chart';
import { Viewport } from '../Viewport';
import { themeColors } from '../themeColors';

/**
 * Renders session bands (colored background strips) matching the legacy
 * cChart drawing with BackGround3 (pink/sleep) and BackGround2 (gray/lunch).
 *
 * Legacy defines two configurable time bands per day (local time):
 *   - "Sleep hours" (BackGround3, pink): 00:00 - 05:45
 *   - "Lunch hours" (BackGround2, gray): 06:00 - 11:15
 *   - Remaining hours: no band (normal background)
 *
 * Times use the browser's local timezone, same as the legacy uses the
 * machine's local time. Colors come from themeColors (overridable via preferences).
 */
export class SessionRenderer {

  // Default time ranges (minutes from midnight, local time)
  // Sleep hours: 00:00 - 05:45
  static readonly SLEEP_START = 0;       // 00:00
  static readonly SLEEP_END = 5 * 60 + 45; // 05:45
  // Lunch hours: 06:00 - 11:15
  static readonly LUNCH_START = 6 * 60;    // 06:00
  static readonly LUNCH_END = 11 * 60 + 15; // 11:15

  /** Reusable Date object to avoid allocations in hot loops */
  private static readonly _tempDate = new Date();

  /**
   * Classify a bar's timestamp into one of three band types.
   * Uses local time (browser timezone), matching legacy behavior.
   */
  private static getBand(timeMs: number): 'sleep' | 'lunch' | 'none' {
    this._tempDate.setTime(timeMs);
    const localMinutes = this._tempDate.getHours() * 60 + this._tempDate.getMinutes();

    if (localMinutes >= this.SLEEP_START && localMinutes < this.SLEEP_END) {
      return 'sleep';
    }
    if (localMinutes >= this.LUNCH_START && localMinutes < this.LUNCH_END) {
      return 'lunch';
    }
    return 'none';
  }

  private static bandColor(band: 'sleep' | 'lunch' | 'none'): string | null {
    switch (band) {
      case 'sleep': return themeColors.sessionSleep;
      case 'lunch': return themeColors.sessionLunch;
      default: return null;
    }
  }

  /**
   * Draw session bands across the chart and volume areas.
   * Works in both compressed and natural time modes.
   * Bands fill the full chart width — the margin only shifts bars, not bands.
   */
  static draw(
    ctx: CanvasRenderingContext2D,
    bars: OHLCVBar[],
    viewport: Viewport,
    chartRect: Rect,
    volumeRect: Rect,
  ): void {
    if (bars.length === 0) return;

    const { startIdx, endIdx } = viewport.visibleRange;
    const start = Math.max(0, startIdx);
    const end = Math.min(bars.length, endIdx);
    if (start >= end) return;

    // Total drawing height includes chart + volume area
    const totalY = chartRect.y;
    const totalH = chartRect.height + volumeRect.height;

    ctx.save();

    if (viewport.timeMode === 'natural') {
      this.drawNatural(ctx, bars, viewport, chartRect, totalY, totalH, start, end);
    } else {
      this.drawCompressed(ctx, bars, viewport, chartRect, totalY, totalH, start, end);
    }

    ctx.restore();
  }

  /**
   * Natural mode: draw bands based on actual clock-time boundaries.
   * Groups consecutive bars of the same band type.
   */
  private static drawNatural(
    ctx: CanvasRenderingContext2D,
    bars: OHLCVBar[],
    viewport: Viewport,
    chartRect: Rect,
    totalY: number,
    totalH: number,
    start: number,
    end: number,
  ): void {
    let bandStart = start;
    let prevBand = this.getBand(bars[start]!.time);

    for (let i = start + 1; i <= end; i++) {
      const isLast = i === end;
      const curBand = isLast
        ? prevBand
        : this.getBand(bars[Math.min(i, bars.length - 1)]!.time);

      if (curBand !== prevBand || isLast) {
        const color = this.bandColor(prevBand);
        if (color) {
          const x0 = viewport.barToX(bandStart);
          const x1 = isLast
            ? chartRect.x + chartRect.width
            : viewport.barToX(i);

          const cx0 = Math.max(chartRect.x, x0);
          const cx1 = Math.min(chartRect.x + chartRect.width, x1);
          if (cx1 > cx0) {
            ctx.fillStyle = color;
            ctx.fillRect(cx0, totalY, cx1 - cx0, totalH);
          }
        }

        bandStart = i;
        prevBand = curBand;
      }
    }
  }

  /**
   * Compressed mode: group consecutive bars of the same band type
   * and draw them packed by index position.
   * The last band extends to the full chart width (covers the margin).
   */
  private static drawCompressed(
    ctx: CanvasRenderingContext2D,
    bars: OHLCVBar[],
    viewport: Viewport,
    chartRect: Rect,
    totalY: number,
    totalH: number,
    start: number,
    end: number,
  ): void {
    const pixPerBar = viewport.state.pixelsPerBar;
    const halfBar = pixPerBar / 2;

    let bandStartIdx = start;
    let prevBand = this.getBand(bars[start]!.time);

    for (let i = start + 1; i <= end; i++) {
      const isLast = i === end;
      const curBand = isLast
        ? prevBand
        : this.getBand(bars[Math.min(i, bars.length - 1)]!.time);

      if (curBand !== prevBand || isLast) {
        const color = this.bandColor(prevBand);
        if (color) {
          const x0 = viewport.barToX(bandStartIdx) - halfBar;
          const x1 = isLast
            ? chartRect.x + chartRect.width
            : viewport.barToX(i - 1) + halfBar;

          const cx0 = Math.max(chartRect.x, x0);
          const cx1 = Math.min(chartRect.x + chartRect.width, x1);
          if (cx1 > cx0) {
            ctx.fillStyle = color;
            ctx.fillRect(cx0, totalY, cx1 - cx0, totalH);
          }
        }

        bandStartIdx = i;
        prevBand = curBand;
      }
    }
  }
}
