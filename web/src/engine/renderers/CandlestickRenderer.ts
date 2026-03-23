import { OHLCVBar, ChartStyle } from '../../types/chart';
import { Viewport } from '../Viewport';
import { themeColors } from '../themeColors';

/**
 * Renders OHLC bars/candlesticks on the chart canvas.
 * Mirrors legacy cChartSecurity::DrawSample.
 */
export class CandlestickRenderer {
  /** Draw all visible bars */
  static draw(
    ctx: CanvasRenderingContext2D,
    bars: OHLCVBar[],
    viewport: Viewport,
    style: ChartStyle,
    monochrome = false,
  ): void {
    if (bars.length === 0) return;

    const { startIdx, endIdx } = viewport.visibleRange;
    const pixPerBar = viewport.state.pixelsPerBar;

    ctx.save();

    if (style === 'line') {
      this.drawLine(ctx, bars, viewport, startIdx, endIdx);
    } else {
      this.drawCandles(ctx, bars, viewport, startIdx, endIdx, pixPerBar, style, monochrome);
    }

    ctx.restore();
  }

  private static drawCandles(
    ctx: CanvasRenderingContext2D,
    bars: OHLCVBar[],
    viewport: Viewport,
    startIdx: number,
    endIdx: number,
    pixPerBar: number,
    style: ChartStyle,
    monochrome: boolean,
  ): void {
    // Candlestick body width
    const bodyWidth = Math.max(1, Math.min(pixPerBar * 0.7, 20));
    const halfBody = bodyWidth / 2;
    const monoColor = themeColors.textSecondary;
    const upColor = monochrome ? monoColor : themeColors.candleUp;
    const downColor = monochrome ? monoColor : themeColors.candleDown;

    const lo = Math.max(0, startIdx);
    const hi = Math.min(bars.length, endIdx);

    if (style === 'candlestick') {
      // Batch wicks and bodies by color for minimal beginPath/stroke calls
      for (let pass = 0; pass < 2; pass++) {
        const isUpPass = pass === 0;
        const color = isUpPass ? upColor : downColor;

        // Wicks
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = lo; i < hi; i++) {
          const bar = bars[i]!;
          if ((bar.close >= bar.open) !== isUpPass) continue;
          const x = Math.round(viewport.barToX(i));
          const highY = Math.round(viewport.priceToY(bar.high));
          const lowY = Math.round(viewport.priceToY(bar.low));
          ctx.moveTo(x + 0.5, highY);
          ctx.lineTo(x + 0.5, lowY);
        }
        ctx.stroke();

        // Bodies
        ctx.fillStyle = color;
        for (let i = lo; i < hi; i++) {
          const bar = bars[i]!;
          if ((bar.close >= bar.open) !== isUpPass) continue;
          const x = Math.round(viewport.barToX(i));
          const openY = Math.round(viewport.priceToY(bar.open));
          const closeY = Math.round(viewport.priceToY(bar.close));
          const topBody = Math.min(openY, closeY);
          const bottomBody = Math.max(openY, closeY);
          ctx.fillRect(x - halfBody, topBody, bodyWidth, Math.max(1, bottomBody - topBody));
        }
      }
    } else {
      // OHLC bar style — batch by color
      for (let pass = 0; pass < 2; pass++) {
        const isUpPass = pass === 0;
        const color = isUpPass ? upColor : downColor;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = lo; i < hi; i++) {
          const bar = bars[i]!;
          if ((bar.close >= bar.open) !== isUpPass) continue;
          const x = Math.round(viewport.barToX(i));
          const openY = Math.round(viewport.priceToY(bar.open));
          const closeY = Math.round(viewport.priceToY(bar.close));
          const highY = Math.round(viewport.priceToY(bar.high));
          const lowY = Math.round(viewport.priceToY(bar.low));

          // Vertical high-low
          ctx.moveTo(x + 0.5, highY);
          ctx.lineTo(x + 0.5, lowY);
          // Left tick (open)
          ctx.moveTo(x + 0.5 - halfBody, openY + 0.5);
          ctx.lineTo(x + 0.5, openY + 0.5);
          // Right tick (close)
          ctx.moveTo(x + 0.5, closeY + 0.5);
          ctx.lineTo(x + 0.5 + halfBody, closeY + 0.5);
        }
        ctx.stroke();
      }
    }
  }

  private static drawLine(
    ctx: CanvasRenderingContext2D,
    bars: OHLCVBar[],
    viewport: Viewport,
    startIdx: number,
    endIdx: number,
  ): void {
    ctx.strokeStyle = themeColors.selectionStroke;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();

    let first = true;
    for (let i = Math.max(0, startIdx); i < Math.min(bars.length, endIdx); i++) {
      const bar = bars[i]!;
      // Snap to pixel grid for crisp rendering (matches candlestick wick snapping)
      const x = Math.round(viewport.barToX(i)) + 0.5;
      const y = Math.round(viewport.priceToY(bar.close)) + 0.5;

      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();
  }
}
