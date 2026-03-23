import { Point, PenStyle } from '../types/chart';
import {
  ChartObject,
  LineObject,
  HorizontalLineObject,
  VerticalLineObject,
  RectangleObject,
  CircleObject,
  TextObject,
} from '../types/objects';

function genId(type: string): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const DEFAULT_PEN: PenStyle = { color: '#60a5fa', width: 1.5 };

/**
 * Creates, manages, and serializes chart objects.
 */
export class ObjectManager {
  objects: ChartObject[] = [];
  private listeners: Array<() => void> = [];

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notify(): void {
    // New reference so ObjectRenderer's sorted cache (reference-equality) invalidates
    this.objects = [...this.objects];
    for (const fn of this.listeners) fn();
  }

  /** Create a line from two world points */
  createLine(p0: Point, p1: Point, pen?: Partial<PenStyle>): LineObject {
    const obj: LineObject = {
      id: genId('line'),
      type: 'line',
      pen: { ...DEFAULT_PEN, ...pen },
      visible: true,
      selected: false,
      locked: false,
      name: 'Line',
      zIndex: this.objects.length,
      p0: { ...p0 },
      p1: { ...p1 },
      extend: false,
    };
    this.objects.push(obj);
    this.notify();
    return obj;
  }

  /** Create a horizontal line at a price */
  createHorizontalLine(price: number, pen?: Partial<PenStyle>): HorizontalLineObject {
    const obj: HorizontalLineObject = {
      id: genId('hline'),
      type: 'horizontalLine',
      pen: { ...DEFAULT_PEN, color: '#eab308', ...pen },
      visible: true,
      selected: false,
      locked: false,
      name: `H-Line ${price.toFixed(2)}`,
      zIndex: this.objects.length,
      price,
      showLabel: true,
    };
    this.objects.push(obj);
    this.notify();
    return obj;
  }

  /** Create a vertical line at a timestamp */
  createVerticalLine(time: number, pen?: Partial<PenStyle>): VerticalLineObject {
    const obj: VerticalLineObject = {
      id: genId('vline'),
      type: 'verticalLine',
      pen: { ...DEFAULT_PEN, color: '#a78bfa', ...pen },
      visible: true,
      selected: false,
      locked: false,
      name: 'V-Line',
      zIndex: this.objects.length,
      time,
      showLabel: true,
    };
    this.objects.push(obj);
    this.notify();
    return obj;
  }

  /** Create a rectangle from two corner points */
  createRectangle(p0: Point, p1: Point, pen?: Partial<PenStyle>): RectangleObject {
    const obj: RectangleObject = {
      id: genId('rect'),
      type: 'rectangle',
      pen: { ...DEFAULT_PEN, ...pen },
      visible: true,
      selected: false,
      locked: false,
      name: 'Rectangle',
      zIndex: this.objects.length,
      p0: { ...p0 },
      p1: { ...p1 },
      fillColor: '#3b82f6',
      fillOpacity: 0.1,
    };
    this.objects.push(obj);
    this.notify();
    return obj;
  }

  /** Create a circle from center and radius */
  createCircle(
    center: Point,
    radiusX: number,
    radiusY: number,
    pen?: Partial<PenStyle>,
  ): CircleObject {
    const obj: CircleObject = {
      id: genId('circle'),
      type: 'circle',
      pen: { ...DEFAULT_PEN, ...pen },
      visible: true,
      selected: false,
      locked: false,
      name: 'Circle',
      zIndex: this.objects.length,
      center: { ...center },
      radiusX,
      radiusY,
      fillColor: null,
      fillOpacity: 0.1,
    };
    this.objects.push(obj);
    this.notify();
    return obj;
  }

  /** Create a text annotation */
  createText(position: Point, text: string, pen?: Partial<PenStyle>): TextObject {
    const obj: TextObject = {
      id: genId('text'),
      type: 'text',
      pen: { ...DEFAULT_PEN, color: '#e2e8f0', ...pen },
      visible: true,
      selected: false,
      locked: false,
      name: `Text: ${text.substring(0, 20)}`,
      zIndex: this.objects.length,
      position: { ...position },
      text,
      fontSize: 13,
      fontFamily: 'var(--font-family, sans-serif)',
    };
    this.objects.push(obj);
    this.notify();
    return obj;
  }

  /** Add an externally-created object (e.g. from paste) */
  addObject(obj: ChartObject): void {
    this.objects.push(obj);
    this.notify();
  }

  /** Select an object (deselect all others) */
  select(id: string | null): void {
    for (const obj of this.objects) {
      obj.selected = obj.id === id;
    }
    this.notify();
  }

  /** Get the currently selected object */
  getSelected(): ChartObject | null {
    return this.objects.find((o) => o.selected) ?? null;
  }

  /** Delete an object by id */
  delete(id: string): void {
    this.objects = this.objects.filter((o) => o.id !== id);
    this.notify();
  }

  /** Delete the currently selected object */
  deleteSelected(): void {
    const sel = this.getSelected();
    if (sel) this.delete(sel.id);
  }

  /** Update properties of an object in-place (id and type are immutable) */
  updateObject(id: string, updates: Record<string, unknown>): void {
    const obj = this.objects.find((o) => o.id === id);
    if (obj) {
      const { id: _id, type: _type, __proto__: _p, constructor: _c, ...safeUpdates } = updates;
      Object.assign(obj, safeUpdates);
      this.notify();
    }
  }

  /** Toggle visibility of an object */
  toggleVisibility(id: string): void {
    const obj = this.objects.find((o) => o.id === id);
    if (obj) {
      obj.visible = !obj.visible;
      this.notify();
    }
  }

  /** Serialize all objects to JSON (deep copy to prevent external mutation) */
  toJSON(): ChartObject[] {
    return this.objects.map((obj) => structuredClone(obj));
  }

  /** Load objects from JSON, filtering out any malformed entries (deep copy for isolation) */
  fromJSON(data: unknown[]): void {
    this.objects = data.filter(isValidChartObject).map((obj) => structuredClone(obj));
    this.notify();
  }
}

const VALID_TYPES = new Set(['line', 'horizontalLine', 'verticalLine', 'rectangle', 'circle', 'text']);

/** Runtime check that an object has the required ChartObjectBase fields */
function isValidChartObject(obj: unknown): obj is ChartObject {
  if (obj == null || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.type === 'string' &&
    VALID_TYPES.has(o.type) &&
    o.pen != null && typeof o.pen === 'object' &&
    typeof o.visible === 'boolean' &&
    typeof o.zIndex === 'number'
  );
}
