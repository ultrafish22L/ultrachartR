import { Point, OHLCVBar } from '../types/chart';
import { ChartObject, LineObject, HorizontalLineObject, VerticalLineObject, RectangleObject, CircleObject, TextObject } from '../types/objects';
import { Viewport } from './Viewport';
import { ObjectRenderer, HANDLE_HIT_RADIUS } from './renderers/ObjectRenderer';
import { distToSegment } from '../utils/geometry';

const HIT_TOLERANCE = 6; // pixels

/**
 * Hit testing for chart objects.
 * Tests whether a pixel coordinate is "close enough" to an object to select it.
 */
export class HitTester {
  /** Cached reverse-z-sorted arrays — invalidates when ObjectManager.notify() creates new array */
  private static _sortCache = new WeakMap<ChartObject[], ChartObject[]>();

  /** Find the topmost object at a pixel position */
  static hitTest(
    pos: Point,
    objects: ChartObject[],
    viewport: Viewport,
    bars: OHLCVBar[],
  ): ChartObject | null {
    // Test in reverse z-order (topmost first)
    let sorted = this._sortCache.get(objects);
    if (!sorted) {
      sorted = [...objects].sort((a, b) => b.zIndex - a.zIndex);
      this._sortCache.set(objects, sorted);
    }
    for (const obj of sorted) {
      if (!obj.visible) continue;
      if (this.hitTestObject(pos, obj, viewport, bars)) {
        return obj;
      }
    }
    return null;
  }

  /** Test if a pixel position hits a handle on a selected object. Returns handle index or -1. */
  static hitTestHandle(
    pos: Point,
    obj: ChartObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): number {
    if (!obj.selected) return -1;
    const handles = ObjectRenderer.getHandlePositions(obj, viewport, bars);
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i]!;
      if (Math.abs(pos.x - h.x) <= HANDLE_HIT_RADIUS && Math.abs(pos.y - h.y) <= HANDLE_HIT_RADIUS) {
        return i;
      }
    }
    return -1;
  }

  /** Test a single object */
  static hitTestObject(
    pos: Point,
    obj: ChartObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): boolean {
    switch (obj.type) {
      case 'line':
        return this.hitTestLine(pos, obj, viewport, bars);
      case 'horizontalLine':
        return this.hitTestHorizontalLine(pos, obj, viewport);
      case 'verticalLine':
        return this.hitTestVerticalLine(pos, obj, viewport, bars);
      case 'rectangle':
        return this.hitTestRectangle(pos, obj, viewport, bars);
      case 'circle':
        return this.hitTestCircle(pos, obj, viewport, bars);
      case 'text':
        return this.hitTestText(pos, obj, viewport, bars);
      default:
        return false;
    }
  }

  private static hitTestLine(
    pos: Point,
    obj: LineObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): boolean {
    const p0 = viewport.worldToPixel(obj.p0.x, obj.p0.y, bars);
    const p1 = viewport.worldToPixel(obj.p1.x, obj.p1.y, bars);
    return distToSegment(pos, p0, p1) <= HIT_TOLERANCE;
  }

  private static hitTestHorizontalLine(
    pos: Point,
    obj: HorizontalLineObject,
    viewport: Viewport,
  ): boolean {
    const y = viewport.priceToY(obj.price);
    return Math.abs(pos.y - y) <= HIT_TOLERANCE;
  }

  private static hitTestVerticalLine(
    pos: Point,
    obj: VerticalLineObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): boolean {
    const barIdx = viewport.findBarIndex(obj.time, bars);
    const x = viewport.barToX(barIdx);
    return Math.abs(pos.x - x) <= HIT_TOLERANCE;
  }

  private static hitTestRectangle(
    pos: Point,
    obj: RectangleObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): boolean {
    const p0 = viewport.worldToPixel(obj.p0.x, obj.p0.y, bars);
    const p1 = viewport.worldToPixel(obj.p1.x, obj.p1.y, bars);
    const minX = Math.min(p0.x, p1.x);
    const maxX = Math.max(p0.x, p1.x);
    const minY = Math.min(p0.y, p1.y);
    const maxY = Math.max(p0.y, p1.y);

    // Check if near any edge
    const nearLeft = Math.abs(pos.x - minX) <= HIT_TOLERANCE && pos.y >= minY - HIT_TOLERANCE && pos.y <= maxY + HIT_TOLERANCE;
    const nearRight = Math.abs(pos.x - maxX) <= HIT_TOLERANCE && pos.y >= minY - HIT_TOLERANCE && pos.y <= maxY + HIT_TOLERANCE;
    const nearTop = Math.abs(pos.y - minY) <= HIT_TOLERANCE && pos.x >= minX - HIT_TOLERANCE && pos.x <= maxX + HIT_TOLERANCE;
    const nearBottom = Math.abs(pos.y - maxY) <= HIT_TOLERANCE && pos.x >= minX - HIT_TOLERANCE && pos.x <= maxX + HIT_TOLERANCE;

    // Also hit if filled and inside
    if (obj.fillColor) {
      return pos.x >= minX && pos.x <= maxX && pos.y >= minY && pos.y <= maxY;
    }

    return nearLeft || nearRight || nearTop || nearBottom;
  }

  private static hitTestCircle(
    pos: Point,
    obj: CircleObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): boolean {
    const center = viewport.worldToPixel(obj.center.x, obj.center.y, bars);
    const priceRange = viewport.state.priceMax - viewport.state.priceMin;
    const rx = obj.radiusX * viewport.state.pixelsPerBar;
    const ry = priceRange > 0 ? obj.radiusY * (viewport.chartRect.height / priceRange) : 0;

    // Guard: degenerate circle with zero radius
    if (Math.abs(rx) < 1 || Math.abs(ry) < 1) {
      const dist = Math.hypot(pos.x - center.x, pos.y - center.y);
      return dist <= HIT_TOLERANCE;
    }

    // Normalized distance from center
    const dx = (pos.x - center.x) / rx;
    const dy = (pos.y - center.y) / ry;
    const d = Math.sqrt(dx * dx + dy * dy);

    if (obj.fillColor) {
      return d <= 1.0;
    }
    return Math.abs(d - 1.0) <= HIT_TOLERANCE / Math.min(Math.abs(rx), Math.abs(ry));
  }

  private static hitTestText(
    pos: Point,
    obj: TextObject,
    viewport: Viewport,
    bars: OHLCVBar[],
  ): boolean {
    const p = viewport.worldToPixel(obj.position.x, obj.position.y, bars);
    // Approximate text bounding box
    const width = obj.text.length * obj.fontSize * 0.6;
    const height = obj.fontSize * 1.2;
    return pos.x >= p.x && pos.x <= p.x + width && pos.y >= p.y - height && pos.y <= p.y;
  }
}
