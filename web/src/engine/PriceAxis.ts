import { Rect } from '../types/chart';
import { Viewport } from './Viewport';
import { themeColors } from './themeColors';

/** A tick mark on the price axis */
export interface PriceTick {
  price: number;
  y: number;
  label: string;
  isMajor: boolean;
  showLabel: boolean;
}

/**
 * PriceAxis computes price grid lines and axis labels.
 * Mirrors legacy cFloatAxis.
 */
export class PriceAxis {
  /**
   * Calculate nice tick values for the price axis.
   * Dense ticks for grid lines; labels only at wider spacing.
   */
  static computeTicks(viewport: Viewport): PriceTick[] {
    const ticks: PriceTick[] = [];
    const { priceMin, priceMax } = viewport.state;
    const range = priceMax - priceMin;
    if (range <= 0) return ticks;

    // Dense tick interval for grid lines
    const minTickSpacingPx = 15;
    const maxTicks = Math.floor(viewport.chartRect.height / minTickSpacingPx);
    const rawTickInterval = range / Math.max(1, maxTicks);
    const tickInterval = this.niceInterval(rawTickInterval);

    // Sparser label interval (labels need ~40px to avoid overlap)
    const minLabelSpacingPx = 40;
    const maxLabels = Math.floor(viewport.chartRect.height / minLabelSpacingPx);
    const rawLabelInterval = range / Math.max(1, maxLabels);
    const labelInterval = this.niceInterval(rawLabelInterval);

    // Determine precision from tick interval
    const precision = this.getPrecision(tickInterval);

    // Generate ticks
    const start = Math.ceil(priceMin / tickInterval) * tickInterval;

    if (tickInterval <= 0) return ticks;
    for (let i = 0; start + i * tickInterval <= priceMax && ticks.length < 2000; i++) {
      const price = start + i * tickInterval;
      const y = viewport.priceToY(price);
      const isMajor = Math.abs(price % (labelInterval * 5)) < tickInterval * 0.01;
      const showLabel = Math.abs(price % labelInterval) < tickInterval * 0.01;
      ticks.push({
        price,
        y,
        label: price.toFixed(precision),
        isMajor,
        showLabel,
      });
    }

    return ticks;
  }

  /** Find a "nice" interval for the given raw interval */
  private static niceInterval(rawInterval: number): number {
    if (rawInterval <= 0 || !isFinite(rawInterval)) return 1;
    const exponent = Math.floor(Math.log10(rawInterval));
    const fraction = rawInterval / Math.pow(10, exponent);

    let niceFraction: number;
    if (fraction <= 1.0) niceFraction = 1;
    else if (fraction <= 2.0) niceFraction = 2;
    else if (fraction <= 2.5) niceFraction = 2.5;
    else if (fraction <= 5.0) niceFraction = 5;
    else niceFraction = 10;

    return Math.max(niceFraction * Math.pow(10, exponent), 1e-10);
  }

  /** Determine decimal precision for a price interval */
  private static getPrecision(interval: number): number {
    if (interval >= 1) return 0;
    if (interval >= 0.1) return 1;
    if (interval >= 0.01) return 2;
    if (interval >= 0.001) return 3;
    return 4;
  }

  /** Draw the price axis on canvas */
  static draw(
    ctx: CanvasRenderingContext2D,
    ticks: PriceTick[],
    axisRect: Rect,
    chartRect: Rect,
  ): void {
    ctx.save();
    ctx.font = '10px var(--font-mono, Consolas, monospace)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    // Visibility bounds for inline filtering (avoids allocating filtered array each frame)
    const visTop = chartRect.y;
    const visBot = chartRect.y + chartRect.height;

    // Batch grid lines: minor ticks
    ctx.strokeStyle = themeColors.chartGrid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const tick of ticks) {
      if (tick.isMajor || tick.y < visTop || tick.y > visBot) continue;
      const ySnap = Math.round(tick.y) + 0.5;
      ctx.moveTo(chartRect.x, ySnap);
      ctx.lineTo(chartRect.x + chartRect.width, ySnap);
    }
    ctx.stroke();

    // Batch grid lines: major ticks
    ctx.strokeStyle = themeColors.chartGridMajor;
    ctx.beginPath();
    for (const tick of ticks) {
      if (!tick.isMajor || tick.y < visTop || tick.y > visBot) continue;
      const ySnap = Math.round(tick.y) + 0.5;
      ctx.moveTo(chartRect.x, ySnap);
      ctx.lineTo(chartRect.x + chartRect.width, ySnap);
    }
    ctx.stroke();

    // Batch tick marks
    ctx.strokeStyle = themeColors.textMuted;
    ctx.beginPath();
    for (const tick of ticks) {
      if (tick.y < visTop || tick.y > visBot) continue;
      const ySnap = Math.round(tick.y) + 0.5;
      ctx.moveTo(axisRect.x, ySnap);
      ctx.lineTo(axisRect.x + (tick.showLabel ? 5 : 3), ySnap);
    }
    ctx.stroke();

    // Labels (snap y to match tick mark position)
    for (const tick of ticks) {
      if (!tick.showLabel || tick.y < visTop || tick.y > visBot) continue;
      ctx.fillStyle = tick.isMajor ? themeColors.textSecondary : themeColors.textMuted;
      ctx.fillText(tick.label, axisRect.x + 6, Math.round(tick.y));
    }

    ctx.restore();
  }

  /** Draw the current price marker (last close) */
  static drawPriceMarker(
    ctx: CanvasRenderingContext2D,
    price: number,
    isUp: boolean,
    viewport: Viewport,
    axisRect: Rect,
  ): void {
    const y = viewport.priceToY(price);
    if (y < viewport.chartRect.y || y > viewport.chartRect.y + viewport.chartRect.height) return;

    const precision = this.getPrecision(
      this.niceInterval((viewport.state.priceMax - viewport.state.priceMin) / 10),
    );
    const label = price.toFixed(precision);

    ctx.save();
    ctx.font = '11px var(--font-mono, Consolas, monospace)';

    const color = isUp ? themeColors.candleUp : themeColors.candleDown;
    ctx.fillStyle = color;
    const textWidth = ctx.measureText(label).width;
    ctx.fillRect(axisRect.x, y - 9, textWidth + 12, 18);

    // Text
    ctx.fillStyle = themeColors.textPrimary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, axisRect.x + 6, y);

    // Dashed line across chart (matches axis edge brightness)
    ctx.strokeStyle = themeColors.chartCrosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(viewport.chartRect.x, Math.round(y) + 0.5);
    ctx.lineTo(viewport.chartRect.x + viewport.chartRect.width, Math.round(y) + 0.5);
    ctx.stroke();

    ctx.restore();
  }
}
