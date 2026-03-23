import { createContext, useContext, useReducer, useCallback, useState, useRef, useMemo } from 'react';
import {
  OHLCVBar,
  SecurityData,
  ChartConfig,
  ViewState,
  ChartStyle,
  ChartPeriod,
  PenStyle,
  DEFAULT_CHART_CONFIG,
  DEFAULT_VIEW_STATE,
} from '../types/chart';
import { PlanetLineObject, PlanetLineConfig, PLANETS } from '../types/planet';
import { clearPlanetSampleCache } from '../planet/PlanetRenderer';
import { ChartMouseState } from '../engine/ChartEngine';
import type { ChartEngine } from '../engine/ChartEngine';

// ─── Per-Chart State ──────────────────────────────────────────────

interface ChartState {
  security: SecurityData | null;
  config: ChartConfig;
  viewState: ViewState;
  streaming: boolean;
}

type ChartAction =
  | { type: 'SET_SECURITY'; payload: SecurityData }
  | { type: 'SET_CONFIG'; payload: Partial<ChartConfig> }
  | { type: 'SET_VIEW_STATE'; payload: Partial<ViewState> }
  | { type: 'SET_CHART_STYLE'; payload: ChartStyle }
  | { type: 'SET_PERIOD'; payload: { period: ChartPeriod; interval: number } }
  | { type: 'TOGGLE_VOLUME' }
  | { type: 'TOGGLE_CROSSHAIR' }
  | { type: 'TOGGLE_GRID' }
  | { type: 'TOGGLE_TIME_MODE' }
  | { type: 'TOGGLE_SESSION_BANDS' }
  | { type: 'TOGGLE_TIMELINE_STYLE' }
  | { type: 'TOGGLE_MONOCHROME' }
  | { type: 'APPEND_BAR'; payload: OHLCVBar }
  | { type: 'UPDATE_LAST_BAR'; payload: OHLCVBar }
  | { type: 'SET_STREAMING'; payload: boolean };

function chartReducer(state: ChartState, action: ChartAction): ChartState {
  switch (action.type) {
    case 'SET_SECURITY':
      return { ...state, security: action.payload };
    case 'SET_CONFIG':
      return { ...state, config: { ...state.config, ...action.payload } };
    case 'SET_VIEW_STATE':
      return { ...state, viewState: { ...state.viewState, ...action.payload } };
    case 'SET_CHART_STYLE':
      return { ...state, config: { ...state.config, style: action.payload } };
    case 'SET_PERIOD':
      return {
        ...state,
        config: { ...state.config, period: action.payload.period, interval: action.payload.interval },
      };
    case 'TOGGLE_VOLUME':
      return { ...state, config: { ...state.config, showVolume: !state.config.showVolume } };
    case 'TOGGLE_CROSSHAIR':
      return { ...state, config: { ...state.config, showCrosshair: !state.config.showCrosshair } };
    case 'TOGGLE_GRID':
      return { ...state, config: { ...state.config, showGrid: !state.config.showGrid } };
    case 'TOGGLE_TIME_MODE':
      return {
        ...state,
        config: {
          ...state.config,
          timeMode: state.config.timeMode === 'compressed' ? 'natural' : 'compressed',
        },
      };
    case 'TOGGLE_SESSION_BANDS':
      return { ...state, config: { ...state.config, showSessionBands: !state.config.showSessionBands } };
    case 'TOGGLE_TIMELINE_STYLE':
      return {
        ...state,
        config: {
          ...state.config,
          timelineStyle: state.config.timelineStyle === 'legacy' ? 'express' : 'legacy',
        },
      };
    case 'TOGGLE_MONOCHROME':
      return { ...state, config: { ...state.config, monochromeBars: !state.config.monochromeBars } };
    case 'APPEND_BAR': {
      if (!state.security) return state;
      // In-place push: O(1) instead of O(n) spread copy.
      // Bars ref stays stable so useChartEngine's bars effect won't re-fire
      // (engine.appendBar() already called by useRealtimeData before this dispatch).
      state.security.bars.push(action.payload);
      return {
        ...state,
        security: { ...state.security, lastUpdate: Date.now() },
      };
    }
    case 'UPDATE_LAST_BAR': {
      if (!state.security || state.security.bars.length === 0) return state;
      // In-place assignment: O(1) instead of O(n) slice copy.
      state.security.bars[state.security.bars.length - 1] = action.payload;
      return {
        ...state,
        security: { ...state.security, lastUpdate: Date.now() },
      };
    }
    case 'SET_STREAMING':
      return { ...state, streaming: action.payload };
    default:
      return state;
  }
}

// ─── Context Interface ────────────────────────────────────────────

interface ChartContextValue {
  chartId: string | null;
  cachePath: string | null;
  state: ChartState;
  dispatch: React.Dispatch<ChartAction>;
  setSecurity: (data: SecurityData) => void;
  setChartStyle: (style: ChartStyle) => void;
  updateMouse: (mouse: ChartMouseState) => void;
  mouseRef: React.MutableRefObject<ChartMouseState | null>;
  subscribeToMouse: (fn: (mouse: ChartMouseState) => void) => (() => void);
  planetLines: PlanetLineObject[];
  setPlanetLines: (lines: PlanetLineObject[]) => void;
  addPlanetLine: (config: PlanetLineConfig) => void;
  updatePlanetLine: (id: string, config: Partial<PlanetLineConfig>) => void;
  updatePlanetLinePen: (id: string, pen: PenStyle) => void;
  removePlanetLine: (id: string) => void;
  engineRef: React.MutableRefObject<ChartEngine | null>;
  /** Bumped each time registerEngine is called; depend on this instead of engineRef.current */
  engineVersion: number;
  registerEngine: (engine: ChartEngine | null) => void;
}

const ChartContext = createContext<ChartContextValue | null>(null);

// Removed module-level nextPlanetId — using crypto.randomUUID() instead

// ─── ChartProvider ────────────────────────────────────────────────

interface ChartProviderProps {
  chartId?: string;
  cachePath?: string;
  initialConfig?: ChartConfig;
  initialSecurity?: SecurityData | null;
  initialViewState?: Partial<ViewState>;
  children: React.ReactNode;
}

export function ChartProvider({
  chartId,
  cachePath,
  initialConfig,
  initialSecurity,
  initialViewState,
  children,
}: ChartProviderProps) {
  const [state, dispatch] = useReducer(chartReducer, undefined, () => ({
    security: initialSecurity ?? null,
    config: initialConfig ?? DEFAULT_CHART_CONFIG,
    viewState: initialViewState ? { ...DEFAULT_VIEW_STATE, ...initialViewState } : DEFAULT_VIEW_STATE,
    streaming: false,
  }));
  const [planetLines, setPlanetLines] = useState<PlanetLineObject[]>([]);
  const engineRef = useRef<ChartEngine | null>(null);
  const [engineVersion, setEngineVersion] = useState(0);

  const registerEngine = useCallback((engine: ChartEngine | null) => {
    engineRef.current = engine;
    setEngineVersion((v) => v + 1);
  }, []);

  const setSecurity = useCallback(
    (data: SecurityData) => dispatch({ type: 'SET_SECURITY', payload: data }),
    [],
  );

  const setChartStyle = useCallback(
    (style: ChartStyle) => dispatch({ type: 'SET_CHART_STYLE', payload: style }),
    [],
  );

  const mouseRef = useRef<ChartMouseState | null>(null);
  const mouseListenersRef = useRef<Set<(mouse: ChartMouseState) => void>>(new Set());

  const updateMouse = useCallback((mouse: ChartMouseState) => {
    mouseRef.current = mouse;
    for (const fn of mouseListenersRef.current) fn(mouse);
  }, []);

  const subscribeToMouse = useCallback((fn: (mouse: ChartMouseState) => void) => {
    mouseListenersRef.current.add(fn);
    return () => { mouseListenersRef.current.delete(fn); };
  }, []);

  const addPlanetLine = useCallback((config: PlanetLineConfig) => {
    const planetInfo = PLANETS.find((p) => p.id === config.planet);
    const defaultColor = planetInfo?.defaultColor ?? '#ffffff';
    const planetName = planetInfo?.name ?? 'Planet';
    const pl: PlanetLineObject = {
      id: `planet-${crypto.randomUUID()}`,
      type: 'planetLine',
      name: `${planetName} Line`,
      visible: true,
      selected: false,
      locked: false,
      zIndex: 50,
      pen: { color: defaultColor, width: 1.5 },
      config,
      samples: [],
      dirty: true,
    };
    setPlanetLines((prev) => [...prev, pl]);
  }, []);

  const updatePlanetLine = useCallback((id: string, configUpdate: Partial<PlanetLineConfig>) => {
    setPlanetLines((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      return { ...p, config: { ...p.config, ...configUpdate }, dirty: true };
    }));
  }, []);

  const updatePlanetLinePen = useCallback((id: string, pen: PenStyle) => {
    setPlanetLines((prev) => prev.map((p) =>
      p.id !== id ? p : { ...p, pen }
    ));
  }, []);

  const removePlanetLine = useCallback((id: string) => {
    clearPlanetSampleCache(id);
    setPlanetLines((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const value = useMemo<ChartContextValue>(() => ({
    chartId: chartId ?? null,
    cachePath: cachePath ?? null,
    state, dispatch, setSecurity, setChartStyle, updateMouse,
    mouseRef, subscribeToMouse,
    planetLines, setPlanetLines, addPlanetLine, updatePlanetLine, updatePlanetLinePen, removePlanetLine,
    engineRef, engineVersion, registerEngine,
  }), [chartId, cachePath, state, planetLines, setSecurity, setChartStyle,
    updateMouse, subscribeToMouse, addPlanetLine, updatePlanetLine, updatePlanetLinePen, removePlanetLine,
    engineVersion, registerEngine]);

  return (
    <ChartContext.Provider value={value}>
      {children}
    </ChartContext.Provider>
  );
}

export function useChart(): ChartContextValue {
  const ctx = useContext(ChartContext);
  if (!ctx) throw new Error('useChart must be used within ChartProvider');
  return ctx;
}
