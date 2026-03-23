import { PenStyle, Point } from './chart';

/** All chart object types */
export type ChartObjectType =
  | 'line'
  | 'horizontalLine'
  | 'verticalLine'
  | 'rectangle'
  | 'circle'
  | 'text'
  | 'planetLine';

/** Handle modes for interactive editing - mirrors legacy cHandleModes */
export type HandleMode = 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'endpoint';

/** Interactive handle on a chart object */
export interface ObjectHandle {
  id: string;
  mode: HandleMode;
  /** Position in world coordinates (time as x, price as y) */
  worldPos: Point;
  /** Pixel radius for hit testing */
  hitRadius: number;
}

/** Base chart object - all drawable objects extend this */
export interface ChartObjectBase {
  id: string;
  type: ChartObjectType;
  pen: PenStyle;
  visible: boolean;
  selected: boolean;
  locked: boolean;
  name: string;
  /** Z-order for rendering */
  zIndex: number;
}

/** Two-point trend line */
export interface LineObject extends ChartObjectBase {
  type: 'line';
  /** Start point: x=timestamp ms, y=price */
  p0: Point;
  /** End point: x=timestamp ms, y=price */
  p1: Point;
  /** Extend line beyond endpoints */
  extend: boolean;
}

/** Horizontal line at a price level */
export interface HorizontalLineObject extends ChartObjectBase {
  type: 'horizontalLine';
  price: number;
  showLabel: boolean;
}

/** Vertical line at a timestamp */
export interface VerticalLineObject extends ChartObjectBase {
  type: 'verticalLine';
  time: number;      // timestamp ms
  showLabel: boolean;
}

/** Rectangle defined by two corners */
export interface RectangleObject extends ChartObjectBase {
  type: 'rectangle';
  p0: Point;    // top-left: x=timestamp, y=price
  p1: Point;    // bottom-right: x=timestamp, y=price
  fillColor: string | null;
  fillOpacity: number;
}

/** Circle/ellipse */
export interface CircleObject extends ChartObjectBase {
  type: 'circle';
  center: Point;   // x=timestamp, y=price
  radiusX: number; // in bar units
  radiusY: number; // in price units
  fillColor: string | null;
  fillOpacity: number;
}

/** Text annotation */
export interface TextObject extends ChartObjectBase {
  type: 'text';
  position: Point;  // x=timestamp, y=price
  text: string;
  fontSize: number;
  fontFamily: string;
}

/** Union of all chart objects */
export type ChartObject =
  | LineObject
  | HorizontalLineObject
  | VerticalLineObject
  | RectangleObject
  | CircleObject
  | TextObject;
