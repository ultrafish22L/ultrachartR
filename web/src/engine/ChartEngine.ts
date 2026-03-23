import {
  OHLCVBar,
  ChartConfig,
  Point,
  PenStyle,
  Rect,
  DEFAULT_CHART_CONFIG,
} from '../types/chart';
import { ChartObject, ChartObjectType, TextObject } from '../types/objects';
import { PlanetLineObject } from '../types/planet';
import { Viewport } from './Viewport';
import { TimeAxis, TimeTick } from './TimeAxis';
import { PriceAxis, PriceTick } from './PriceAxis';
import { GridRenderer } from './renderers/GridRenderer';
import { SessionRenderer } from './renderers/SessionRenderer';
import { CandlestickRenderer } from './renderers/CandlestickRenderer';
import { VolumeRenderer } from './renderers/VolumeRenderer';
import { ObjectRenderer, HANDLE_HIT_RADIUS } from './renderers/ObjectRenderer';
import { PlanetRenderer, clearPlanetSampleCache } from '../planet/PlanetRenderer';
import { themeColors } from './themeColors';
import { HitTester } from './HitTester';
import { ObjectManager } from '../objects/ObjectManager';

export interface ChartMouseState {
  pos: Point;
  inChart: boolean;
  price: number;
  barIndex: number;
  time: number;
  isDragging: boolean;
  buttonDown: boolean;
}

/** Drawing tool mode: null=pointer/pan, or a specific object type to draw */
export type DrawingTool = ChartObjectType | null;

/**
 * ChartEngine is the main rendering coordinator.
 * Manages the canvas, viewport, objects, and all renderers.
 */
// Reusable date formatters (54x faster than toLocaleDateString per call)
const intradayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dailyFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export class ChartEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  viewport: Viewport;
  config: ChartConfig;
  objectManager: ObjectManager;

  private bars: OHLCVBar[] = [];
  private dpr = 1;
  rightMargin = 0;
  timelineStyle: 'express' | 'legacy' = 'express';

  // Layout rects
  private fullRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private chartRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private volumeRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private priceAxisRect: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private timeAxisRect: Rect = { x: 0, y: 0, width: 0, height: 0 };

  // Cached ticks
  private timeTicks: TimeTick[] = [];
  private priceTicks: PriceTick[] = [];

  // Mouse state
  mouse: ChartMouseState = {
    pos: { x: 0, y: 0 },
    inChart: false,
    price: 0,
    barIndex: 0,
    time: 0,
    isDragging: false,
    buttonDown: false,
  };

  // Planet lines
  planetLines: PlanetLineObject[] = [];

  // Drawing tool state
  drawingTool: DrawingTool = null;
  private drawingState: {
    /** First click point in world coords */
    p0: Point | null;
    /** Current second point (while dragging to create) */
    p1: Point | null;
  } = { p0: null, p1: null };

  // Drawing style (from toolbar)
  drawingPen: PenStyle | null = null;
  drawingFontFamily = 'Arial';

  // Callbacks
  onMouseUpdate?: (mouse: ChartMouseState) => void;
  onObjectSelected?: (obj: ChartObject | null) => void;
  onPlanetLineSelected?: (pl: PlanetLineObject | null) => void;
  onPlanetLineChanged?: (pl: PlanetLineObject) => void;
  onPlanetLineDeleted?: (id: string) => void;
  onDrawingComplete?: () => void;
  onObjectContextMenu?: (obj: ChartObject, screenX: number, screenY: number) => void;
  onPlanetLineContextMenu?: (pl: PlanetLineObject, screenX: number, screenY: number) => void;
  onPlanetLinePenChanged?: (id: string, pen: PenStyle) => void;
  onTextInput?: (pixelPos: Point, callback: (text: string) => void, initialText?: string) => void;
  onRightMarginChanged?: (margin: number) => void;
  onAfterRender?: (() => void) | null;
  private _unsubObjectManager: (() => void) | null = null;

  // Render scheduling
  private renderRequested = false;
  private rafId = 0;
  private disposed = false;
  private cachedCanvasRect: DOMRect | null = null;
  /** Set after a right-click drag so handleContextMenu can suppress the menu */
  private wasRightDragging = false;

  constructor(canvas: HTMLCanvasElement, config?: Partial<ChartConfig>) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D canvas context');
    this.ctx = ctx;
    this.viewport = new Viewport();
    this.config = { ...DEFAULT_CHART_CONFIG, ...config };
    this.objectManager = new ObjectManager();
    this.dpr = window.devicePixelRatio || 1;

    this._unsubObjectManager = this.objectManager.subscribe(() => this.requestRender());
    this.setupEvents();
    this.resize();
  }

  setData(bars: OHLCVBar[]): void {
    this.bars = bars;
    this.viewport.setBars(bars);
    if (this.viewport.state.autoScale) {
      this.viewport.autoScale(bars);
    }
    this.requestRender();
  }

  /** Update the last bar in-place (for live tick updates). */
  updateLastBar(bar: OHLCVBar): void {
    if (this.bars.length === 0) return;
    this.bars[this.bars.length - 1] = bar;
    if (this.viewport.state.autoScale) {
      // Only run full autoScale if the new bar exceeds current price range
      // (avoids scanning all visible bars on every 5-second tick)
      const { priceMin, priceMax } = this.viewport.state;
      if (bar.low < priceMin || bar.high > priceMax) {
        this.viewport.autoScale(this.bars);
      }
    }
    this.requestRender();
  }

  /** Append a new completed bar to the end. */
  appendBar(bar: OHLCVBar): void {
    this.bars.push(bar);
    this.viewport.setBars(this.bars);
    if (this.viewport.state.autoScale) {
      this.viewport.autoScale(this.bars);
    }
    this.requestRender();
  }

  resize(): void {
    this.updateCanvasRect();
    const rect = this.cachedCanvasRect!;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.computeLayout(rect.width, rect.height);
    this.requestRender();
  }

  private computeLayout(width: number, height: number): void {
    const axisW = 70;
    const axisH = this.timelineStyle === 'legacy' ? 32 : (this.config.period === 'intraday' ? 32 : 24);
    const volH = this.config.showVolume ? Math.round(height * this.config.volumeHeight) : 0;
    const chartW = width - axisW;

    this.fullRect = { x: 0, y: 0, width, height };
    this.chartRect = { x: 0, y: 0, width: chartW, height: height - axisH - volH };
    this.volumeRect = { x: 0, y: this.chartRect.height, width: chartW, height: volH };
    this.priceAxisRect = { x: width - axisW, y: 0, width: axisW, height: height - axisH };
    this.timeAxisRect = { x: 0, y: height - axisH, width: chartW, height: axisH };
    this.viewport.rightMargin = this.rightMargin;
    this.viewport.setChartRect(this.chartRect);
  }

  requestRender(): void {
    if (this.disposed || this.renderRequested) return;
    this.renderRequested = true;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.renderRequested = false;
      this.render();
      this.onAfterRender?.();
    });
  }

  // ─── Main Render Pipeline ───

  private render(): void {
    const { ctx, bars, viewport } = this;
    const { width, height } = this.fullRect;

    ctx.clearRect(0, 0, width, height);

    // Guard: nothing to draw if no bars loaded
    if (bars.length === 0) return;

    // Sync viewport with current config
    viewport.timeMode = this.config.timeMode;

    // Clamp scroll, compute visible range, then auto-scale if enabled
    viewport.clampScroll();
    viewport.updateVisibleRange();
    if (viewport.state.autoScale) {
      viewport.autoScale(bars);
    }

    this.timeTicks = TimeAxis.computeTicks(bars, viewport, this.config.period, this.timelineStyle);
    this.priceTicks = PriceAxis.computeTicks(viewport);

    GridRenderer.drawBackground(ctx, this.chartRect);

    // Session bands (behind everything else)
    if (this.config.showSessionBands && this.config.period === 'intraday') {
      SessionRenderer.draw(ctx, bars, viewport, this.chartRect, this.volumeRect);
    }

    GridRenderer.drawAxisBackground(ctx, this.fullRect, this.chartRect);
    TimeAxis.draw(ctx, this.timeTicks, this.timeAxisRect, this.chartRect, this.timelineStyle);
    PriceAxis.draw(ctx, this.priceTicks, this.priceAxisRect, this.chartRect);

    if (this.config.showVolume && this.volumeRect.height > 0) {
      VolumeRenderer.draw(ctx, bars, viewport, this.volumeRect);
    }

    CandlestickRenderer.draw(ctx, bars, viewport, this.config.style, this.config.monochromeBars);

    // Planet lines
    if (this.planetLines.length > 0) {
      PlanetRenderer.draw(ctx, this.planetLines, viewport, this.chartRect, bars);
    }

    // Chart objects (clipped to chart area)
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.chartRect.x, this.chartRect.y, this.chartRect.width, this.chartRect.height);
    ctx.clip();
    ObjectRenderer.draw(ctx, this.objectManager.objects, viewport, bars);
    ctx.restore();

    // Drawing preview (in-progress object creation), clipped to chart area
    if (this.drawingState.p0 && this.drawingState.p1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.chartRect.x, this.chartRect.y, this.chartRect.width, this.chartRect.height);
      ctx.clip();
      this.drawCreationPreview(ctx);
      ctx.restore();
    }

    // Last price marker
    if (bars.length > 0) {
      const lastBar = bars[bars.length - 1]!;
      const prevBar = bars.length > 1 ? bars[bars.length - 2]! : lastBar;
      PriceAxis.drawPriceMarker(
        ctx, lastBar.close, lastBar.close >= prevBar.close, viewport, this.priceAxisRect,
      );
    }

    // Last bar margin drag indicator (only when hovering/dragging)
    if (this.bars.length > 0) {
      const lastBarX = this.getLastBarX();
      const hovering = !this.draggingRightMargin && this.isNearLastBar(this.mouse.pos);
      if ((hovering || this.draggingRightMargin) && lastBarX >= this.chartRect.x) {
        ctx.save();
        ctx.strokeStyle = themeColors.selectionColor;
        ctx.lineWidth = 1;
        ctx.globalAlpha = this.draggingRightMargin ? 0.9 : 0.5;
        ctx.beginPath();
        ctx.moveTo(Math.round(lastBarX) + 0.5, this.chartRect.y);
        ctx.lineTo(Math.round(lastBarX) + 0.5, this.chartRect.y + this.chartRect.height);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Crosshair
    if (this.config.showCrosshair && this.mouse.inChart) {
      const priceLabel = this.mouse.price.toFixed(
        viewport.state.priceMax - viewport.state.priceMin > 10 ? 2 : 4,
      );
      const barIdx = Math.round(this.mouse.barIndex);
      let timeLabel = '';
      if (barIdx >= 0 && barIdx < bars.length) {
        timeLabel = this.config.period === 'intraday'
          ? intradayFmt.format(bars[barIdx]!.time)
          : dailyFmt.format(bars[barIdx]!.time);
      }
      GridRenderer.drawCrosshair(ctx, this.mouse.pos, this.chartRect, priceLabel, timeLabel);
    }
  }

  /** Draw a preview of the object being created */
  private drawCreationPreview(ctx: CanvasRenderingContext2D): void {
    const { p0, p1 } = this.drawingState;
    if (!p0 || !p1) return;

    const px0 = this.viewport.worldToPixel(p0.x, p0.y, this.bars);
    const px1 = this.viewport.worldToPixel(p1.x, p1.y, this.bars);

    ctx.save();
    if (this.drawingPen) {
      ctx.strokeStyle = this.drawingPen.color;
      ctx.lineWidth = this.drawingPen.width;
      if (this.drawingPen.dash) {
        ctx.setLineDash(this.drawingPen.dash);
      }
      ctx.globalAlpha = 0.7;
    } else {
      ctx.strokeStyle = themeColors.selectionStroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
    }

    switch (this.drawingTool) {
      case 'line':
        ctx.beginPath();
        ctx.moveTo(px0.x, px0.y);
        ctx.lineTo(px1.x, px1.y);
        ctx.stroke();
        break;
      case 'rectangle': {
        const x = Math.min(px0.x, px1.x);
        const y = Math.min(px0.y, px1.y);
        ctx.strokeRect(x, y, Math.abs(px1.x - px0.x), Math.abs(px1.y - px0.y));
        break;
      }
      case 'circle': {
        const rx = Math.abs(px1.x - px0.x);
        const ry = Math.abs(px1.y - px0.y);
        ctx.beginPath();
        ctx.ellipse(px0.x, px0.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
    }

    ctx.restore();
  }

  /** Get the world-space point at the current mouse position */
  private getWorldPoint(): Point {
    const n = this.bars.length;
    if (n === 0) return { x: 0, y: this.mouse.price };
    const fractIdx = this.mouse.barIndex;
    // Compute average bar spacing for extrapolation beyond data
    const avgSpacing = n >= 2 ? (this.bars[n - 1]!.time - this.bars[0]!.time) / (n - 1) : 1;
    let time: number;
    if (fractIdx <= 0) {
      // Extrapolate left of first bar
      time = this.bars[0]!.time + fractIdx * avgSpacing;
    } else if (fractIdx >= n - 1) {
      // Extrapolate right of last bar (into margin)
      time = this.bars[n - 1]!.time + (fractIdx - (n - 1)) * avgSpacing;
    } else {
      // Interpolate between bars
      const floorIdx = Math.floor(fractIdx);
      const t0 = this.bars[floorIdx]!.time;
      const t1 = this.bars[floorIdx + 1]!.time;
      time = t0 + (fractIdx - floorIdx) * (t1 - t0);
    }
    return { x: time, y: this.mouse.price };
  }

  // ─── Event Handling ───

  private dragStart: Point | null = null;
  private dragButton = -1;
  private dragScrollStart = 0;

  // Object drag state
  private draggingObject: ChartObject | null = null;
  private draggingPlanetLine: PlanetLineObject | null = null;
  private draggingHandleIndex = -1; // -1 = body drag
  private dragStartWorld: Point | null = null;

  // Right margin drag state
  private draggingRightMargin = false;
  private pendingTextEdit: { obj: TextObject; downPos: Point } | null = null;
  private rightMarginDragStartX = 0;
  private rightMarginDragStartVal = 0;
  private static readonly MARGIN_HIT_PX = 8; // pixels from boundary to trigger drag

  private setupEvents(): void {
    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.handleContextMenu);
    this.canvas.addEventListener('keydown', this.handleKeyDown);
  }

  private updateCanvasRect(): void {
    this.cachedCanvasRect = this.canvas.getBoundingClientRect();
  }

  private updateMouseState(e: MouseEvent): void {
    const rect = this.cachedCanvasRect ?? this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.mouse.pos.x = x;
    this.mouse.pos.y = y;
    this.mouse.inChart =
      x >= this.chartRect.x && x <= this.chartRect.x + this.chartRect.width &&
      y >= this.chartRect.y && y <= this.chartRect.y + this.chartRect.height;
    this.mouse.price = this.viewport.yToPrice(y);
    this.mouse.barIndex = this.viewport.xToBar(x);

    const barIdx = Math.round(this.mouse.barIndex);
    if (barIdx >= 0 && barIdx < this.bars.length) {
      this.mouse.time = this.bars[barIdx]!.time;
    }
  }

  private handleMouseMove = (e: MouseEvent): void => {
    this.updateMouseState(e);

    // Update drawing preview
    if (this.drawingState.p0 && this.drawingTool) {
      this.drawingState.p1 = this.getWorldPoint();
    }

    // Handle right margin drag
    if (this.mouse.isDragging && this.draggingRightMargin) {
      const dx = this.mouse.pos.x - this.rightMarginDragStartX;
      this.rightMargin = Math.max(0, Math.min(this.chartRect.width * 0.5, this.rightMarginDragStartVal - dx));
      this.viewport.rightMargin = this.rightMargin;
      this.onMouseUpdate?.(this.mouse);
      this.requestRender();
      return;
    }

    // Handle object/handle drag
    if (this.mouse.isDragging && this.draggingObject && this.dragStartWorld) {
      this.pendingTextEdit = null; // actual drag occurred, cancel text edit
      const wp = this.getWorldPoint();
      this.applyDrag(this.draggingObject, this.draggingHandleIndex, wp);
      this.dragStartWorld = wp;
    }
    // Handle planet line drag (adjusts offset)
    else if (this.mouse.isDragging && this.draggingPlanetLine && this.dragStartWorld) {
      const wp = this.getWorldPoint();
      const dy = wp.y - this.dragStartWorld.y;
      this.draggingPlanetLine.config.offset += dy;
      this.dragStartWorld = wp;
      this.requestRender();
      // Notify that planet line config changed
      this.onPlanetLineChanged?.(this.draggingPlanetLine);
    }
    // Handle pan drag
    else if (this.mouse.isDragging && this.dragStart && !this.drawingTool) {
      const dx = this.mouse.pos.x - this.dragStart.x;
      this.viewport.state.scrollOffset = Math.max(
        0, this.dragScrollStart - dx / this.viewport.state.pixelsPerBar,
      );
    }
    // Cursor feedback when hovering handles/objects/boundary
    else if (!this.drawingTool && !this.mouse.isDragging) {
      let cursor = 'default';
      // Last bar margin drag hover
      if (this.isNearLastBar(this.mouse.pos)) {
        cursor = 'ew-resize';
      }
      const sel = this.objectManager.getSelected();
      if (sel) {
        const handleIdx = HitTester.hitTestHandle(this.mouse.pos, sel, this.viewport, this.bars);
        if (handleIdx >= 0) {
          cursor = 'grab';
        } else if (HitTester.hitTestObject(this.mouse.pos, sel, this.viewport, this.bars)) {
          cursor = 'move';
        }
      }
      // Check selected planet line handles / body
      if (cursor === 'default') {
        const selPL = this.getSelectedPlanetLine();
        if (selPL) {
          const handles = PlanetRenderer.getHandlePositions(selPL, this.viewport, this.chartRect, this.bars);
          let onHandle = false;
          for (const h of handles) {
            if (Math.abs(this.mouse.pos.x - h.x) <= HANDLE_HIT_RADIUS && Math.abs(this.mouse.pos.y - h.y) <= HANDLE_HIT_RADIUS) {
              onHandle = true;
              break;
            }
          }
          if (onHandle) {
            cursor = 'grab';
          } else if (PlanetRenderer.hitTest(this.mouse.pos, selPL, this.viewport, this.chartRect, this.bars)) {
            cursor = 'move';
          }
        }
      }
      this.canvas.style.cursor = cursor;
    }

    this.onMouseUpdate?.(this.mouse);
    this.requestRender();
  };

  private handleMouseDown = (e: MouseEvent): void => {
    this.updateMouseState(e);
    this.mouse.buttonDown = true;
    this.onMouseUpdate?.(this.mouse);

    // Right-click: pan drag on empty chart area
    if (e.button === 2) {
      if (!this.mouse.inChart || this.mouse.isDragging) return;
      this.dragButton = 2;
      this.dragStart = { ...this.mouse.pos };
      this.dragScrollStart = this.viewport.state.scrollOffset;
      this.mouse.isDragging = true;
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button !== 0) return;
    this.dragButton = 0;

    // Right margin drag — initiated from the last bar
    if (this.isNearLastBar(this.mouse.pos) && !this.drawingTool) {
      this.draggingRightMargin = true;
      this.rightMarginDragStartX = this.mouse.pos.x;
      this.rightMarginDragStartVal = this.rightMargin;
      this.mouse.isDragging = true;
      this.canvas.style.cursor = 'ew-resize';
      return;
    }

    if (!this.mouse.inChart) return;

    const wp = this.getWorldPoint();

    // If we have a drawing tool active
    if (this.drawingTool) {
      const pen = this.drawingPen ?? undefined;
      if (this.drawingTool === 'horizontalLine') {
        this.objectManager.createHorizontalLine(this.mouse.price, pen);
        this.finishDrawing();
        return;
      }
      if (this.drawingTool === 'verticalLine') {
        this.objectManager.createVerticalLine(wp.x, pen);
        this.finishDrawing();
        return;
      }
      if (this.drawingTool === 'text') {
        if (this.onTextInput) {
          const fontFamily = this.drawingFontFamily;
          const snapped = this.viewport.worldToPixel(wp.x, wp.y, this.bars);
          this.onTextInput(snapped, (text: string) => {
            const obj = this.objectManager.createText(wp, text, pen);
            obj.fontFamily = fontFamily;
          });
        }
        this.finishDrawing();
        return;
      }

      // Two-click tools: first click sets p0, second click finalizes
      if (!this.drawingState.p0) {
        this.drawingState.p0 = wp;
        this.drawingState.p1 = wp;
      } else {
        this.finalizeDrawing(wp);
      }
      return;
    }

    // Pointer mode: check handles on selected object first, then hit test objects
    const selected = this.objectManager.getSelected();
    if (selected) {
      const handleIdx = HitTester.hitTestHandle(this.mouse.pos, selected, this.viewport, this.bars);
      if (handleIdx >= 0) {
        // Start handle drag
        this.draggingObject = selected;
        this.draggingHandleIndex = handleIdx;
        this.dragStartWorld = wp;
        this.mouse.isDragging = true;
        this.canvas.style.cursor = 'grabbing';
        this.requestRender();
        return;
      }
    }

    // Check handles on selected planet line
    const selPL = this.getSelectedPlanetLine();
    if (selPL) {
      const handles = PlanetRenderer.getHandlePositions(selPL, this.viewport, this.chartRect, this.bars);
      for (let i = 0; i < handles.length; i++) {
        const h = handles[i]!;
        if (Math.abs(this.mouse.pos.x - h.x) <= HANDLE_HIT_RADIUS && Math.abs(this.mouse.pos.y - h.y) <= HANDLE_HIT_RADIUS) {
          this.draggingPlanetLine = selPL;
          this.draggingHandleIndex = i;
          this.dragStartWorld = wp;
          this.mouse.isDragging = true;
          this.canvas.style.cursor = 'grabbing';
          this.requestRender();
          return;
        }
      }
    }

    // Hit test regular objects
    const hit = HitTester.hitTest(this.mouse.pos, this.objectManager.objects, this.viewport, this.bars);
    if (hit) {
      // Track potential text edit (click-without-drag on already-selected text)
      this.pendingTextEdit = (hit === selected && hit.type === 'text')
        ? { obj: hit as TextObject, downPos: { ...this.mouse.pos } }
        : null;
      this.objectManager.select(hit.id);
      this.deselectAllPlanetLines();
      this.onObjectSelected?.(hit);
      this.onPlanetLineSelected?.(null);
      // Start body drag
      this.draggingObject = hit;
      this.draggingHandleIndex = -1; // body
      this.dragStartWorld = wp;
      this.mouse.isDragging = true;
      this.canvas.style.cursor = 'grabbing';
      this.requestRender();
      return;
    }

    // Hit test planet lines
    const hitPL = this.hitTestPlanetLines(this.mouse.pos);
    if (hitPL) {
      this.objectManager.select(null);
      this.onObjectSelected?.(null);
      this.deselectAllPlanetLines();
      hitPL.selected = true;
      this.onPlanetLineSelected?.(hitPL);
      // Start body drag (adjusts offset)
      this.draggingPlanetLine = hitPL;
      this.draggingHandleIndex = -1;
      this.dragStartWorld = wp;
      this.mouse.isDragging = true;
      this.canvas.style.cursor = 'grabbing';
      this.requestRender();
      return;
    }

    // Nothing hit — deselect all
    this.objectManager.select(null);
    this.onObjectSelected?.(null);
    this.deselectAllPlanetLines();
    this.onPlanetLineSelected?.(null);
    this.requestRender();
  };

  private handleMouseUp = (e: MouseEvent): void => {
    if (this.mouse.isDragging && e.button !== this.dragButton) return;
    this.mouse.buttonDown = false;
    if (this.draggingRightMargin) {
      this.draggingRightMargin = false;
      this.mouse.isDragging = false;
      this.canvas.style.cursor = 'default';
      this.onRightMarginChanged?.(this.rightMargin);
      return;
    }
    // Check for click-without-drag on selected text object → open inline edit
    if (this.pendingTextEdit && this.onTextInput) {
      const { obj, downPos } = this.pendingTextEdit;
      const dx = this.mouse.pos.x - downPos.x;
      const dy = this.mouse.pos.y - downPos.y;
      if (dx * dx + dy * dy < 9) { // less than 3px movement = click
        const pixelPos = this.viewport.worldToPixel(obj.position.x, obj.position.y, this.bars);
        this.onTextInput(pixelPos, (newText: string) => {
          this.objectManager.updateObject(obj.id, { text: newText, name: `Text: ${newText.substring(0, 20)}` });
          this.requestRender();
        }, obj.text);
      }
      this.pendingTextEdit = null;
    }
    if (!this.drawingTool) {
      // Track right-click drag so contextmenu handler can suppress the menu
      this.wasRightDragging = this.dragStart != null && this.mouse.isDragging;
      this.mouse.isDragging = false;
      this.dragStart = null;
      this.draggingObject = null;
      this.draggingPlanetLine = null;
      this.draggingHandleIndex = -1;
      this.dragStartWorld = null;
      this.canvas.style.cursor = 'default';
    }
  };

  private handleMouseLeave = (): void => {
    // If actively dragging an object, keep the drag alive via document listeners
    if (this.mouse.isDragging && (this.draggingObject || this.draggingPlanetLine || this.dragStart)) {
      document.addEventListener('mousemove', this.handleDocumentMouseMove);
      document.addEventListener('mouseup', this.handleDocumentMouseUp);
      return;
    }
    if (this.draggingRightMargin) {
      this.draggingRightMargin = false;
      this.onRightMarginChanged?.(this.rightMargin);
    }
    this.mouse.inChart = false;
    this.mouse.isDragging = false;
    this.dragStart = null;
    this.draggingObject = null;
    this.draggingPlanetLine = null;
    this.draggingHandleIndex = -1;
    this.dragStartWorld = null;
    this.canvas.style.cursor = 'default';
    this.requestRender();
  };

  private handleDocumentMouseMove = (e: MouseEvent): void => {
    this.updateMouseState(e);
    this.handleMouseMove(e);
  };

  private handleDocumentMouseUp = (): void => {
    document.removeEventListener('mousemove', this.handleDocumentMouseMove);
    document.removeEventListener('mouseup', this.handleDocumentMouseUp);
    this.mouse.isDragging = false;
    this.dragStart = null;
    this.draggingObject = null;
    this.draggingPlanetLine = null;
    this.draggingHandleIndex = -1;
    this.dragStartWorld = null;
    this.pendingTextEdit = null;
    this.canvas.style.cursor = 'default';
    this.requestRender();
  };

  private handleContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    // Suppress context menu if we were panning (right-click drag)
    if (this.wasRightDragging) {
      this.wasRightDragging = false;
      return;
    }
    this.wasRightDragging = false;
    const rect = this.cachedCanvasRect ?? this.canvas.getBoundingClientRect();
    const pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    // Check regular objects first
    if (this.onObjectContextMenu) {
      const hit = HitTester.hitTest(pos, this.objectManager.objects, this.viewport, this.bars);
      if (hit) {
        this.onObjectContextMenu(hit, e.clientX, e.clientY);
        return;
      }
    }
    // Then check planet lines
    if (this.onPlanetLineContextMenu) {
      const hitPL = this.hitTestPlanetLines(pos);
      if (hitPL) {
        this.onPlanetLineContextMenu(hitPL, e.clientX, e.clientY);
      }
    }
  };

  private handleWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.cachedCanvasRect ?? this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const factor = e.deltaY > 0 ? 0.85 : 1.18;
    this.viewport.zoom(factor, x);
    if (this.viewport.state.autoScale) {
      this.viewport.autoScale(this.bars);
    }
    this.requestRender();
  };

  // ─── Clipboard ───
  private clipboard: ChartObject | null = null;

  /** Delete the currently selected object or planet line */
  deleteSelected(): void {
    const selPL = this.getSelectedPlanetLine();
    if (selPL) {
      this.planetLines = this.planetLines.filter((p) => p.id !== selPL.id);
      clearPlanetSampleCache(selPL.id);
      this.onPlanetLineSelected?.(null);
      this.onPlanetLineDeleted?.(selPL.id);
    } else {
      this.objectManager.deleteSelected();
      this.onObjectSelected?.(null);
    }
    this.requestRender();
  }

  /** Copy the currently selected drawing object to clipboard */
  copySelected(): void {
    const sel = this.objectManager.getSelected();
    if (sel) {
      this.clipboard = structuredClone(sel);
    }
  }

  /** Paste the clipboard object (offset slightly from original) */
  pasteClipboard(): void {
    if (!this.clipboard) return;
    const src = this.clipboard;
    const id = crypto.randomUUID();
    // Offset pasted object slightly from original (in world coordinates)
    const priceRange = this.viewport.state.priceMax - this.viewport.state.priceMin;
    const dy = priceRange * 0.02;
    const dx = 5; // bar-index units

    let clone: ChartObject;
    switch (src.type) {
      case 'line':
        clone = { ...src, id, selected: false, name: '',
          p0: { x: src.p0.x + dx, y: src.p0.y - dy },
          p1: { x: src.p1.x + dx, y: src.p1.y - dy } };
        break;
      case 'horizontalLine':
        clone = { ...src, id, selected: false, name: '', price: src.price - dy };
        break;
      case 'verticalLine':
        clone = { ...src, id, selected: false, name: '', time: src.time + dx };
        break;
      case 'rectangle':
        clone = { ...src, id, selected: false, name: '',
          p0: { x: src.p0.x + dx, y: src.p0.y - dy },
          p1: { x: src.p1.x + dx, y: src.p1.y - dy } };
        break;
      case 'circle':
        clone = { ...src, id, selected: false, name: '',
          center: { x: src.center.x + dx, y: src.center.y - dy } };
        break;
      case 'text':
        clone = { ...src, id, selected: false, name: '',
          position: { x: src.position.x + dx, y: src.position.y - dy } };
        break;
      default:
        return;
    }
    this.objectManager.addObject(clone);
    this.objectManager.select(id);
    this.onObjectSelected?.(clone);
    this.requestRender();
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    }
    if (e.ctrlKey && e.key === 'c') {
      this.copySelected();
    }
    if (e.ctrlKey && e.key === 'v') {
      this.pasteClipboard();
    }
    if (e.key === 'Escape') {
      if (this.drawingTool) {
        this.cancelDrawing();
      } else {
        this.objectManager.select(null);
        this.onObjectSelected?.(null);
        this.deselectAllPlanetLines();
        this.onPlanetLineSelected?.(null);
      }
      this.requestRender();
    }
  };

  /** Finalize a two-click drawing operation */
  private finalizeDrawing(p1: Point): void {
    const p0 = this.drawingState.p0!;
    const pen = this.drawingPen ?? undefined;
    switch (this.drawingTool) {
      case 'line':
        this.objectManager.createLine(p0, p1, pen);
        break;
      case 'rectangle':
        this.objectManager.createRectangle(p0, p1, pen);
        break;
      case 'circle': {
        const dxBars = Math.abs(
          this.viewport.findBarIndex(p1.x, this.bars) - this.viewport.findBarIndex(p0.x, this.bars),
        );
        const dyPrice = Math.abs(p1.y - p0.y);
        this.objectManager.createCircle(p0, dxBars, dyPrice, pen);
        break;
      }
    }
    this.finishDrawing();
  }

  /** Clean up after drawing */
  private finishDrawing(): void {
    this.drawingState.p0 = null;
    this.drawingState.p1 = null;
    this.drawingTool = null;
    this.canvas.style.cursor = 'default';
    this.onDrawingComplete?.();
    this.requestRender();
  }

  /** Cancel an in-progress drawing */
  private cancelDrawing(): void {
    this.drawingState.p0 = null;
    this.drawingState.p1 = null;
    this.drawingTool = null;
    this.canvas.style.cursor = 'default';
    this.onDrawingComplete?.();
  }

  /** Set the active drawing tool */
  setDrawingTool(tool: DrawingTool): void {
    this.drawingTool = tool;
    this.drawingState.p0 = null;
    this.drawingState.p1 = null;
    this.objectManager.select(null);
    this.canvas.style.cursor = tool ? 'crosshair' : 'default';
  }

  /** Apply a drag operation to an object */
  private applyDrag(obj: ChartObject, handleIndex: number, wp: Point): void {
    if (!this.dragStartWorld) return;
    const dx = wp.x - this.dragStartWorld.x;
    const dy = wp.y - this.dragStartWorld.y;

    switch (obj.type) {
      case 'line':
        if (handleIndex === 0) {
          obj.p0 = { ...wp };
        } else if (handleIndex === 1) {
          obj.p1 = { ...wp };
        } else {
          // Body drag
          obj.p0 = { x: obj.p0.x + dx, y: obj.p0.y + dy };
          obj.p1 = { x: obj.p1.x + dx, y: obj.p1.y + dy };
        }
        break;
      case 'horizontalLine':
        obj.price = wp.y;
        obj.name = `H-Line ${obj.price.toFixed(2)}`;
        break;
      case 'verticalLine':
        obj.time = wp.x;
        break;
      case 'rectangle':
        if (handleIndex === 0) {
          obj.p0 = { ...wp };
        } else if (handleIndex === 1) {
          obj.p1 = { ...obj.p1, x: wp.x };
          obj.p0 = { ...obj.p0, y: wp.y };
        } else if (handleIndex === 2) {
          obj.p0 = { ...obj.p0, x: wp.x };
          obj.p1 = { ...obj.p1, y: wp.y };
        } else if (handleIndex === 3) {
          obj.p1 = { ...wp };
        } else {
          obj.p0 = { x: obj.p0.x + dx, y: obj.p0.y + dy };
          obj.p1 = { x: obj.p1.x + dx, y: obj.p1.y + dy };
        }
        break;
      case 'circle':
        if (handleIndex === 0) {
          // Move center
          obj.center = { ...wp };
        } else if (handleIndex === 1) {
          // Resize radiusX (in bar units)
          const barIdxCenter = this.viewport.findBarIndex(obj.center.x, this.bars);
          const barIdxMouse = this.viewport.findBarIndex(wp.x, this.bars);
          obj.radiusX = Math.max(1, Math.abs(barIdxMouse - barIdxCenter));
        } else if (handleIndex === 2) {
          // Resize radiusY (in price units)
          obj.radiusY = Math.max(0.1, Math.abs(wp.y - obj.center.y));
        } else {
          obj.center = { x: obj.center.x + dx, y: obj.center.y + dy };
        }
        break;
      case 'text':
        if (handleIndex === 0 || handleIndex === -1) {
          obj.position = { x: obj.position.x + dx, y: obj.position.y + dy };
        }
        break;
    }
    this.requestRender();
  }

  /** Set the drawing style from toolbar */
  setDrawingStyle(style: { color: string; lineWidth: number; lineStyle: string; fontFamily: string }): void {
    const dash = style.lineStyle === 'dashed' ? [6, 3]
      : style.lineStyle === 'dotted' ? [2, 2]
      : undefined;
    this.drawingPen = { color: style.color, width: style.lineWidth, dash };
    this.drawingFontFamily = style.fontFamily;
  }

  /** Apply current drawing style to the selected object */
  applyStyleToSelected(style: { color: string; lineWidth: number; lineStyle: string; fontFamily: string }): void {
    const dash = style.lineStyle === 'dashed' ? [6, 3]
      : style.lineStyle === 'dotted' ? [2, 2]
      : undefined;
    const pen: PenStyle = { color: style.color, width: style.lineWidth, dash };

    // Apply to selected drawing object
    const sel = this.objectManager.getSelected();
    if (sel) {
      if (sel.type === 'text') {
        this.objectManager.updateObject(sel.id, { pen, fontFamily: style.fontFamily });
      } else {
        this.objectManager.updateObject(sel.id, { pen });
      }
    }

    // Apply to selected planet line
    const selectedPL = this.getSelectedPlanetLine();
    if (selectedPL) {
      selectedPL.pen = pen;
      this.onPlanetLinePenChanged?.(selectedPL.id, pen);
      this.requestRender();
    }
  }

  // ─── Planet Line Helpers ───

  /** Get the currently selected planet line, if any */
  getSelectedPlanetLine(): PlanetLineObject | null {
    return this.planetLines.find((p) => p.selected) ?? null;
  }

  /** Deselect all planet lines */
  private deselectAllPlanetLines(): void {
    for (const pl of this.planetLines) {
      pl.selected = false;
    }
  }

  /** Get the X pixel position of the last data bar */
  private getLastBarX(): number {
    if (this.bars.length === 0) return -1;
    return this.viewport.barToX(this.bars.length - 1);
  }

  /** Check if mouse is near the last bar (for margin drag) */
  private isNearLastBar(pos: Point): boolean {
    const lastBarX = this.getLastBarX();
    if (lastBarX < this.chartRect.x || lastBarX > this.chartRect.x + this.chartRect.width) return false;
    return pos.y >= this.chartRect.y
      && pos.y <= this.chartRect.y + this.chartRect.height
      && Math.abs(pos.x - lastBarX) <= ChartEngine.MARGIN_HIT_PX;
  }

  /** Hit test all planet lines at a pixel position. Returns the first hit, or null. */
  private hitTestPlanetLines(pos: Point): PlanetLineObject | null {
    // Test in reverse order (top-most first)
    for (let i = this.planetLines.length - 1; i >= 0; i--) {
      const pl = this.planetLines[i]!;
      if (!pl.visible) continue;
      if (PlanetRenderer.hitTest(pos, pl, this.viewport, this.chartRect, this.bars)) {
        return pl;
      }
    }
    return null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this._unsubObjectManager?.();
    this._unsubObjectManager = null;
    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('contextmenu', this.handleContextMenu);
    this.canvas.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('mousemove', this.handleDocumentMouseMove);
    document.removeEventListener('mouseup', this.handleDocumentMouseUp);
    // Release large data for GC
    this.bars = [];
    this.planetLines = [];
    this.clipboard = null;
    this.draggingObject = null;
    this.draggingPlanetLine = null;
    this.dragStartWorld = null;
    this.pendingTextEdit = null;
    this.onMouseUpdate = undefined;
    this.onObjectSelected = undefined;
    this.onPlanetLineSelected = undefined;
    this.onPlanetLineChanged = undefined;
    this.onPlanetLineDeleted = undefined;
    this.onDrawingComplete = undefined;
    this.onObjectContextMenu = undefined;
    this.onPlanetLineContextMenu = undefined;
    this.onPlanetLinePenChanged = undefined;
    this.onTextInput = undefined;
    this.onRightMarginChanged = undefined;
    this.onAfterRender = null;
  }
}
