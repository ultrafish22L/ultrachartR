import { Rect, Point } from '../../types/chart';
import { themeColors } from '../themeColors';

/**
 * Renders background grid and crosshair.
 */
export class GridRenderer {
  /** Draw chart background */
  static drawBackground(ctx: CanvasRenderingContext2D, rect: Rect): void {
    ctx.fillStyle = themeColors.chartBg;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  /** Draw the full axis area background */
  static drawAxisBackground(ctx: CanvasRenderingContext2D, fullRect: Rect, chartRect: Rect): void {
    // Right axis area
    ctx.fillStyle = themeColors.bgTertiary;
    ctx.fillRect(
      chartRect.x + chartRect.width,
      fullRect.y,
      fullRect.width - chartRect.width,
      fullRect.height,
    );
    // Bottom axis area
    ctx.fillRect(fullRect.x, chartRect.y + chartRect.height, fullRect.width, fullRect.height - chartRect.height);

    // Border lines
    ctx.strokeStyle = themeColors.chartCrosshair;
    ctx.lineWidth = 1;
    ctx.beginPath();
    // Right border of chart area
    ctx.moveTo(Math.round(chartRect.x + chartRect.width) + 0.5, chartRect.y);
    ctx.lineTo(Math.round(chartRect.x + chartRect.width) + 0.5, chartRect.y + chartRect.height);
    // Bottom border of chart area
    ctx.moveTo(chartRect.x, Math.round(chartRect.y + chartRect.height) + 0.5);
    ctx.lineTo(chartRect.x + chartRect.width, Math.round(chartRect.y + chartRect.height) + 0.5);
    ctx.stroke();
  }

  /** Draw crosshair at mouse position */
  static drawCrosshair(
    ctx: CanvasRenderingContext2D,
    mousePos: Point,
    chartRect: Rect,
    priceLabel: string,
    timeLabel: string,
  ): void {
    if (
      mousePos.x < chartRect.x ||
      mousePos.x > chartRect.x + chartRect.width ||
      mousePos.y < chartRect.y ||
      mousePos.y > chartRect.y + chartRect.height
    ) {
      return;
    }

    ctx.save();
    ctx.strokeStyle = themeColors.chartCrosshair;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(Math.round(mousePos.x) + 0.5, chartRect.y);
    ctx.lineTo(Math.round(mousePos.x) + 0.5, chartRect.y + chartRect.height);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(chartRect.x, Math.round(mousePos.y) + 0.5);
    ctx.lineTo(chartRect.x + chartRect.width, Math.round(mousePos.y) + 0.5);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Price label on right axis
    ctx.fillStyle = themeColors.borderPrimary;
    ctx.font = '10px var(--font-mono, Consolas, monospace)';
    const priceWidth = ctx.measureText(priceLabel).width + 8;
    ctx.fillRect(chartRect.x + chartRect.width + 1, mousePos.y - 8, priceWidth, 16);
    ctx.fillStyle = themeColors.textPrimary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(priceLabel, chartRect.x + chartRect.width + 5, mousePos.y);

    // Time label on bottom axis
    ctx.fillStyle = themeColors.borderPrimary;
    ctx.font = '10px var(--font-mono, Consolas, monospace)';
    const timeWidth = ctx.measureText(timeLabel).width + 8;
    ctx.fillRect(mousePos.x - timeWidth / 2, chartRect.y + chartRect.height + 1, timeWidth, 16);
    ctx.fillStyle = themeColors.textPrimary;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(timeLabel, mousePos.x, chartRect.y + chartRect.height + 3);

    ctx.restore();
  }
}
