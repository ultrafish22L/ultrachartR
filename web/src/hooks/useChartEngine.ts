import { useRef, useEffect, useCallback } from 'react';
import { ChartEngine, DrawingTool } from '../engine/ChartEngine';
import { OHLCVBar, ChartConfig, ViewState, PenStyle, Point } from '../types/chart';
import { PlanetLineObject } from '../types/planet';
import { ChartObject } from '../types/objects';
import { ChartMouseState } from '../engine/ChartEngine';
import type { DrawingObjectStyle } from '../context/WorkspaceContext';
import { loadPreferences, savePreferences } from '../services/PreferencesService';

interface UseChartEngineOptions {
  config: ChartConfig;
  bars: OHLCVBar[];
  viewState: ViewState;
  drawingTool: DrawingTool;
  drawingObjectStyle: DrawingObjectStyle;
  planetLines: PlanetLineObject[];
  onMouseUpdate?: (mouse: ChartMouseState) => void;
  onDrawingComplete?: () => void;
  onObjectContextMenu?: (obj: ChartObject, screenX: number, screenY: number) => void;
  onPlanetLineContextMenu?: (pl: PlanetLineObject, screenX: number, screenY: number) => void;
  onPlanetLinePenChanged?: (id: string, pen: PenStyle) => void;
  onPlanetLineDeleted?: (id: string) => void;
  onTextInput?: (pixelPos: Point, callback: (text: string) => void, initialText?: string) => void;
}

/**
 * Initialize and manage a ChartEngine instance on a canvas element.
 * Handles resize observation, cleanup, and syncs config/data/callbacks with the engine.
 * @returns canvasRef to attach to a <canvas> element, and engineRef for imperative access
 */
export function useChartEngine({
  config,
  bars,
  viewState,
  drawingTool,
  drawingObjectStyle,
  planetLines,
  onMouseUpdate,
  onDrawingComplete,
  onObjectContextMenu,
  onPlanetLineContextMenu,
  onPlanetLinePenChanged,
  onPlanetLineDeleted,
  onTextInput,
}: UseChartEngineOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  // Capture initial viewState at mount time so it survives across renders
  const initialViewStateRef = useRef(viewState);

  const initEngine = useCallback((canvas: HTMLCanvasElement) => {
    if (engineRef.current) {
      engineRef.current.dispose();
    }
    const engine = new ChartEngine(canvas, config);
    const prefs = loadPreferences();
    engine.rightMargin = prefs.rightMargin || 0;
    engine.timelineStyle = config.timelineStyle ?? 'legacy';
    engineRef.current = engine;
    return engine;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one-time factory, config read on init only

  // Mount-only effect: create engine, wire resize observer, set initial data/callbacks.
  // Subsequent config/data/callback changes are synced via individual useEffects below.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = initEngine(canvas);

    // Apply initial viewState to engine viewport (restoring saved zoom/scroll)
    const vs = initialViewStateRef.current;
    if (vs.pixelsPerBar !== undefined) engine.viewport.state.pixelsPerBar = vs.pixelsPerBar;
    if (vs.scrollOffset !== undefined) engine.viewport.state.scrollOffset = vs.scrollOffset;
    if (vs.autoScale !== undefined) engine.viewport.state.autoScale = vs.autoScale;
    // Re-autoScale with the restored viewport so price range fits the restored zoom level
    if (engine.viewport.state.autoScale && bars.length > 0) {
      engine.viewport.autoScale(bars);
    }

    engine.onMouseUpdate = onMouseUpdate;
    engine.onDrawingComplete = onDrawingComplete;
    engine.onObjectContextMenu = onObjectContextMenu;
    engine.onPlanetLineContextMenu = onPlanetLineContextMenu;
    engine.onRightMarginChanged = (margin: number) => {
      const prefs = loadPreferences();
      prefs.rightMargin = margin;
      savePreferences(prefs);
    };

    const resizeObserver = new ResizeObserver(() => {
      engine.resize();
    });
    resizeObserver.observe(canvas);

    return () => {
      resizeObserver.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only; synced via effects below

  // Listen for live rightMargin changes from preferences dialog
  useEffect(() => {
    const handler = (e: Event) => {
      const margin = (e as CustomEvent<number>).detail;
      if (engineRef.current) {
        engineRef.current.rightMargin = margin;
        engineRef.current.resize();
      }
    };
    window.addEventListener('rightMarginChanged', handler);
    return () => window.removeEventListener('rightMarginChanged', handler);
  }, []);

  // Split sync effects by concern to avoid cross-contamination (e.g., style change triggering autoScale)

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setData(bars);
  }, [bars]);

  const prevLayoutRef = useRef({ showVolume: config.showVolume, volumeHeight: config.volumeHeight, timelineStyle: config.timelineStyle, period: config.period });
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.config = { ...config };
    engine.timelineStyle = config.timelineStyle ?? 'legacy';
    // Only call resize() for layout-affecting config changes
    const prev = prevLayoutRef.current;
    if (prev.showVolume !== config.showVolume || prev.volumeHeight !== config.volumeHeight
        || prev.timelineStyle !== config.timelineStyle || prev.period !== config.period) {
      engine.resize();
      prevLayoutRef.current = { showVolume: config.showVolume, volumeHeight: config.volumeHeight, timelineStyle: config.timelineStyle, period: config.period };
    } else {
      engine.requestRender();
    }
  }, [config]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDrawingTool(drawingTool);
  }, [drawingTool]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDrawingStyle(drawingObjectStyle);
    engine.applyStyleToSelected(drawingObjectStyle);
  }, [drawingObjectStyle]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.planetLines = planetLines;
    engine.requestRender();
  }, [planetLines]);

  // Sync callbacks to engine (cheap assignments, no side effects)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.onMouseUpdate = onMouseUpdate;
    engine.onDrawingComplete = onDrawingComplete;
    engine.onObjectContextMenu = onObjectContextMenu;
    engine.onPlanetLineContextMenu = onPlanetLineContextMenu;
    engine.onPlanetLinePenChanged = onPlanetLinePenChanged;
    engine.onPlanetLineDeleted = onPlanetLineDeleted;
    engine.onTextInput = onTextInput;
  }, [onMouseUpdate, onDrawingComplete, onObjectContextMenu, onPlanetLineContextMenu,
    onPlanetLinePenChanged, onPlanetLineDeleted, onTextInput]);

  return { canvasRef, engineRef };
}
