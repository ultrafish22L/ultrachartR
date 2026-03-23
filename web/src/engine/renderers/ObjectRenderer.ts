import { OHLCVBar, Point } from '../../types/chart';
import {
  ChartObject,
  LineObject,
  HorizontalLineObject,
  VerticalLineObject,
  RectangleObject,
  CircleObject,
  TextObject,
} from '../../types/objects';
import { Viewport } from '../Viewport';
import { themeColors } from '../themeColors';

const HANDLE_SIZE = 4;
export const HANDLE_HIT_RADIUS = HANDLE_SIZE + 3;

/**
 * Renders chart drawing objects (lines, shapes, text) onto the canvas.
 */
export class ObjectRenderer {
  /** Cached sorted arrays keyed by source reference — supports multiple chart instances */
  private static _sortCache = new WeakMap<ChartObject[], ChartObject[]>();

  static draw(
    ctx: CanvasRenderingContext2D,
    objects: ChartObject[],
    viewport: Viewport,
    bars: OHLCVBar[],
  ): void {
    // Re-sort only when the objects array reference changes (per-instance via WeakMap)
    let sorted = this._sortCache.get(objects);
    if (!sorted) {
      sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
      this._sortCache.set(objects, sorted);
    }

    for (const obj of sorted) {
      if (!obj.visible) continue;

      ctx.save();
      switch (obj.type) {
        case 'line':
          this.drawLine(ctx, obj, viewport, bars);
          break;
        case 'horizontalLine':
          this.drawHorizontalLine(ctx, obj, viewport);
          break;
        case 'verticalLine':
          this.drawVerticalLine(ctx, obj, viewport, bars);
          break;
        case 'rectangle':
          this.drawRectangle(ctx, obj, viewport, bars);
          break;
        case 'circle':
          this.drawCircle(ctx, obj, viewport, bars);
          break;
        case 'text':
          this.drawText(ctx, obj, viewport, bars);
          break;
      }
      ctx.restore();
    }
  }

  /** Get pixel positions of all handles for a selected object */
  static getHandlePositions(
    obj: ChartObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): Point[] {
    switch (obj.type) {
      case 'line': {
        const p0 = viewport.worldToPixel(obj.p0.x, obj.p0.y, bars);
        const p1 = viewport.worldToPixel(obj.p1.x, obj.p1.y, bars);
        return [p0, p1];
      }
      case 'horizontalLine': {
        const y = viewport.priceToY(obj.price);
        return [
          { x: viewport.chartRect.x + 20, y },
          { x: viewport.chartRect.x + viewport.chartRect.width - 20, y },
        ];
      }
      case 'verticalLine': {
        const barIdx = viewport.findBarIndex(obj.time, bars);
        const x = viewport.barToX(barIdx);
        return [
          { x, y: viewport.chartRect.y + 20 },
          { x, y: viewport.chartRect.y + viewport.chartRect.height - 20 },
        ];
      }
      case 'rectangle': {
        const rp0 = viewport.worldToPixel(obj.p0.x, obj.p0.y, bars);
        const rp1 = viewport.worldToPixel(obj.p1.x, obj.p1.y, bars);
        return [rp0, { x: rp1.x, y: rp0.y }, { x: rp0.x, y: rp1.y }, rp1];
      }
      case 'circle': {
        const center = viewport.worldToPixel(obj.center.x, obj.center.y, bars);
        const rx = obj.radiusX * viewport.state.pixelsPerBar;
        const priceRange = viewport.state.priceMax - viewport.state.priceMin;
        const ry = priceRange > 0
          ? obj.radiusY * (viewport.chartRect.height / priceRange)
          : 50;
        return [center, { x: center.x + rx, y: center.y }, { x: center.x, y: center.y - ry }];
      }
      case 'text': {
        const p = viewport.worldToPixel(obj.position.x, obj.position.y, bars);
        return [p];
      }
      default:
        return [];
    }
  }

  private static applyPen(ctx: CanvasRenderingContext2D, obj: ChartObject): void {
    ctx.strokeStyle = obj.pen.color;
    ctx.lineWidth = obj.pen.width;
    if (obj.pen.dash) {
      ctx.setLineDash(obj.pen.dash);
    }
  }

  private static drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.fillStyle = themeColors.selectionColor;
    ctx.fillRect(x - HANDLE_SIZE, y - HANDLE_SIZE, HANDLE_SIZE * 2, HANDLE_SIZE * 2);
    ctx.strokeStyle = themeColors.objectStroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - HANDLE_SIZE, y - HANDLE_SIZE, HANDLE_SIZE * 2, HANDLE_SIZE * 2);
  }

  private static drawLine(
    ctx: CanvasRenderingContext2D,
    obj: LineObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): void {
    const p0 = viewport.worldToPixel(obj.p0.x, obj.p0.y, bars);
    const p1 = viewport.worldToPixel(obj.p1.x, obj.p1.y, bars);

    this.applyPen(ctx, obj);
    ctx.beginPath();

    if (obj.extend) {
      // Extend line beyond endpoints
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        const scale = 5000 / len;
        ctx.moveTo(p0.x - dx * scale, p0.y - dy * scale);
        ctx.lineTo(p1.x + dx * scale, p1.y + dy * scale);
      }
    } else {
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();

    if (obj.selected) {
      this.drawHandle(ctx, p0.x, p0.y);
      this.drawHandle(ctx, p1.x, p1.y);
    }
  }

  private static drawHorizontalLine(
    ctx: CanvasRenderingContext2D,
    obj: HorizontalLineObject,
    viewport: Viewport,
  ): void {
    const y = viewport.priceToY(obj.price);

    this.applyPen(ctx, obj);
    ctx.beginPath();
    ctx.moveTo(viewport.chartRect.x, Math.round(y) + 0.5);
    ctx.lineTo(viewport.chartRect.x + viewport.chartRect.width, Math.round(y) + 0.5);
    ctx.stroke();

    if (obj.showLabel) {
      ctx.fillStyle = obj.pen.color;
      ctx.font = '10px var(--font-mono, Consolas, monospace)';
      ctx.textBaseline = 'bottom';
      ctx.fillText(obj.price.toFixed(2), viewport.chartRect.x + 4, y - 2);
    }

    if (obj.selected) {
      this.drawHandle(ctx, viewport.chartRect.x + 20, y);
      this.drawHandle(ctx, viewport.chartRect.x + viewport.chartRect.width - 20, y);
    }
  }

  private static drawVerticalLine(
    ctx: CanvasRenderingContext2D,
    obj: VerticalLineObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): void {
    const barIdx = viewport.findBarIndex(obj.time, bars);
    const x = viewport.barToX(barIdx);

    this.applyPen(ctx, obj);
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, viewport.chartRect.y);
    ctx.lineTo(Math.round(x) + 0.5, viewport.chartRect.y + viewport.chartRect.height);
    ctx.stroke();

    if (obj.selected) {
      this.drawHandle(ctx, x, viewport.chartRect.y + 20);
      this.drawHandle(ctx, x, viewport.chartRect.y + viewport.chartRect.height - 20);
    }
  }

  private static drawRectangle(
    ctx: CanvasRenderingContext2D,
    obj: RectangleObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): void {
    const p0 = viewport.worldToPixel(obj.p0.x, obj.p0.y, bars);
    const p1 = viewport.worldToPixel(obj.p1.x, obj.p1.y, bars);
    const x = Math.min(p0.x, p1.x);
    const y = Math.min(p0.y, p1.y);
    const w = Math.abs(p1.x - p0.x);
    const h = Math.abs(p1.y - p0.y);

    if (obj.fillColor) {
      ctx.fillStyle = obj.fillColor;
      ctx.globalAlpha = obj.fillOpacity;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }

    this.applyPen(ctx, obj);
    ctx.strokeRect(x, y, w, h);

    if (obj.selected) {
      this.drawHandle(ctx, p0.x, p0.y);
      this.drawHandle(ctx, p1.x, p0.y);
      this.drawHandle(ctx, p0.x, p1.y);
      this.drawHandle(ctx, p1.x, p1.y);
    }
  }

  private static drawCircle(
    ctx: CanvasRenderingContext2D,
    obj: CircleObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): void {
    const center = viewport.worldToPixel(obj.center.x, obj.center.y, bars);
    const rx = obj.radiusX * viewport.state.pixelsPerBar;
    const priceRange = viewport.state.priceMax - viewport.state.priceMin;
    const ry = priceRange > 0
      ? obj.radiusY * (viewport.chartRect.height / priceRange)
      : 50;

    if (obj.fillColor) {
      ctx.fillStyle = obj.fillColor;
      ctx.globalAlpha = obj.fillOpacity;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    this.applyPen(ctx, obj);
    ctx.beginPath();
    ctx.ellipse(center.x, center.y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    ctx.stroke();

    if (obj.selected) {
      this.drawHandle(ctx, center.x, center.y);
      this.drawHandle(ctx, center.x + rx, center.y);
      this.drawHandle(ctx, center.x, center.y - ry);
    }
  }

  private static drawText(
    ctx: CanvasRenderingContext2D,
    obj: TextObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): void {
    const p = viewport.worldToPixel(obj.position.x, obj.position.y, bars);

    ctx.fillStyle = obj.pen.color;
    ctx.font = `${obj.fontSize}px ${obj.fontFamily}`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(obj.text, p.x, p.y);

    if (obj.selected) {
      this.drawHandle(ctx, p.x, p.y);
      const w = ctx.measureText(obj.text).width;
      this.drawHandle(ctx, p.x + w, p.y - obj.fontSize);
    }
  }
}
