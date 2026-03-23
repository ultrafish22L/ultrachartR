import { createContext, useContext, useReducer, useCallback, useRef, useMemo, useEffect, useState } from 'react';
import {
  OHLCVBar,
  SecurityData,
  ChartConfig,
  ViewState,
  DEFAULT_VIEW_STATE,
} from '../types/chart';
import { ChartObjectType } from '../types/objects';
import { PlanetLineObject } from '../types/planet';
import type { ChartMouseState, ChartEngine } from '../engine/ChartEngine';
import { refreshThemeColors } from '../engine/themeColors';
import { loadPreferences, updatePreference } from '../services/PreferencesService';

export type AppTheme = 'dark' | 'light' | 'vibe';

// ─── Chart Source (how a chart was created) ──────────────────────

export type ChartSource =
  | { type: 'cache'; cachePath: string }
  | { type: 'sample'; which: 'zs_daily' | 'zs_5min' }
  | { type: 'file' }
  | { type: 'new' };

// ─── Drawing Object Style ────────────────────────────────────────

export interface DrawingObjectStyle {
  color: string;
  lineWidth: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
  fontFamily: string;
}

const DEFAULT_DRAWING_STYLE: DrawingObjectStyle = {
  color: '#60a5fa',
  lineWidth: 1,
  lineStyle: 'solid',
  fontFamily: 'Arial',
};

// ─── Stream Controls ─────────────────────────────────────────────

export interface StreamControls {
  streaming: boolean;
  syncing: boolean;
  canStream: boolean;
  start: () => void;
  stop: () => void;
  error: string | null;
}

// ─── Save Handlers ──────────────────────────────────────────────

export interface SaveHandlers {
  save: () => void;
  saveAs: () => void;
}

// ─── Chart Instance ───────────────────────────────────────────────

export interface ChartInstance {
  id: string;
  title: string;
  cachePath: string;
  security: SecurityData | null;
  config: ChartConfig;
  viewState: ViewState;
  streaming: boolean;
  downloading: boolean;
  downloadError: string | null;
  planetLines: PlanetLineObject[];
  mouse: ChartMouseState | null;
  dirty: boolean;
  source: ChartSource;
}

export type WorkspaceLayout = 'maximized' | 'cascade' | 'tile-h' | 'tile-v';

export type StatusMessageLevel = 'info' | 'warn' | 'error';

export interface StatusMessage {
  text: string;
  level: StatusMessageLevel;
  timestamp: number;
}

interface WorkspaceState {
  charts: ChartInstance[];
  activeChartId: string | null;
  layout: WorkspaceLayout;
  drawingTool: ChartObjectType | null;
  drawingObjectStyle: DrawingObjectStyle;
  statusMessage: StatusMessage;
  theme: AppTheme;
  restoreWorkspace: boolean;
}

// ─── Actions ──────────────────────────────────────────────────────

type WorkspaceAction =
  | { type: 'ADD_CHART'; payload: ChartInstance }
  | { type: 'REMOVE_CHART'; payload: string }
  | { type: 'SET_ACTIVE_CHART'; payload: string }
  | { type: 'SET_LAYOUT'; payload: WorkspaceLayout }
  | { type: 'UPDATE_CHART'; payload: { id: string; updates: Partial<ChartInstance> } }
  | { type: 'SET_CHART_SECURITY'; payload: { id: string; security: SecurityData } }
  | { type: 'SET_CHART_CONFIG'; payload: { id: string; config: Partial<ChartConfig> } }
  | { type: 'SET_CHART_VIEW_STATE'; payload: { id: string; viewState: Partial<ViewState> } }
  | { type: 'SET_CHART_STREAMING'; payload: { id: string; streaming: boolean } }
  | { type: 'APPEND_CHART_BAR'; payload: { id: string; bar: OHLCVBar } }
  | { type: 'UPDATE_CHART_LAST_BAR'; payload: { id: string; bar: OHLCVBar } }
  | { type: 'SET_CHART_PLANET_LINES'; payload: { id: string; planetLines: PlanetLineObject[] } }
  | { type: 'SET_CHART_MOUSE'; payload: { id: string; mouse: ChartMouseState } }
  | { type: 'SET_CHART_DIRTY'; payload: { id: string; dirty: boolean } }
  | { type: 'SET_DRAWING_TOOL'; payload: ChartObjectType | null }
  | { type: 'SET_DRAWING_STYLE'; payload: Partial<DrawingObjectStyle> }
  | { type: 'SET_STATUS_MESSAGE'; payload: { text: string; level?: StatusMessageLevel } }
  | { type: 'SET_THEME'; payload: AppTheme }
  | { type: 'SET_RESTORE_WORKSPACE'; payload: boolean };

function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'ADD_CHART': {
      const charts = [...state.charts, action.payload];
      return { ...state, charts, activeChartId: action.payload.id };
    }
    case 'REMOVE_CHART': {
      const charts = state.charts.filter((c) => c.id !== action.payload);
      let activeChartId = state.activeChartId;
      if (activeChartId === action.payload) {
        activeChartId = charts.length > 0 ? charts[charts.length - 1]!.id : null;
      }
      return { ...state, charts, activeChartId };
    }
    case 'SET_ACTIVE_CHART':
      return { ...state, activeChartId: action.payload };
    case 'SET_LAYOUT':
      return { ...state, layout: action.payload };
    case 'UPDATE_CHART':
      return {
        ...state,
        charts: state.charts.map((c) =>
          c.id === action.payload.id ? { ...c, ...action.payload.updates } : c
        ),
      };
    case 'SET_CHART_SECURITY':
      return {
        ...state,
        charts: state.charts.map((c) =>
          c.id === action.payload.id ? { ...c, security: action.payload.security } : c
        ),
      };
    case 'SET_CHART_CONFIG':
      return {
        ...state,
        charts: state.charts.map((c) =>
          c.id === action.payload.id
            ? { ...c, config: { ...c.config, ...action.payload.config } }
            : c
        ),
      };
    case 'SET_CHART_VIEW_STATE':
      return {
        ...state,
        charts: state.charts.map((c) =>
          c.id === action.payload.id
            ? { ...c, viewState: { ...c.viewState, ...action.payload.viewState } }
            : c
        ),
      };
    case 'SET_CHART_STREAMING':
      return {
        ...state,
        charts: state.charts.map((c) =>
          c.id === action.payload.id ? { ...c, streaming: action.payload.streaming } : c
        ),
      };
    case 'APPEND_CHART_BAR': {
      return {
        ...state,
        charts: state.charts.map((c) => {
          if (c.id !== action.payload.id || !c.security) return c;
          // In-place push: O(1) instead of O(n) spread copy
          c.security.bars.push(action.payload.bar);
          return {
            ...c,
            security: { ...c.security, lastUpdate: Date.now() },
          };
        }),
      };
    }
    case 'UPDATE_CHART_LAST_BAR': {
      return {
        ...state,
        charts: state.charts.map((c) => {
          if (c.id !== action.payload.id || !c.security || c.security.bars.length === 0) return c;
          // In-place assignment: O(1) instead of O(n) slice copy
          c.security.bars[c.security.bars.length - 1] = action.payload.bar;
          return { ...c, security: { ...c.security, lastUpdate: Date.now() } };
        }),
      };
    }
    case 'SET_CHART_PLANET_LINES':
      return {
        ...state,
        charts: state.charts.map((c) =>
          c.id === action.payload.id ? { ...c, planetLines: action.payload.planetLines } : c
        ),
      };
    case 'SET_CHART_MOUSE':
      return {
        ...state,
        charts: state.charts.map((c) =>
          c.id === action.payload.id ? { ...c, mouse: action.payload.mouse } : c
        ),
      };
    case 'SET_CHART_DIRTY':
      return {
        ...state,
        charts: state.charts.map((c) =>
          c.id === action.payload.id ? { ...c, dirty: action.payload.dirty } : c
        ),
      };
    case 'SET_DRAWING_TOOL':
      return { ...state, drawingTool: action.payload };
    case 'SET_DRAWING_STYLE':
      return { ...state, drawingObjectStyle: { ...state.drawingObjectStyle, ...action.payload } };
    case 'SET_STATUS_MESSAGE':
      return {
        ...state,
        statusMessage: {
          text: action.payload.text,
          level: action.payload.level ?? 'info',
          timestamp: Date.now(),
        },
      };
    case 'SET_THEME':
      return { ...state, theme: action.payload };
    case 'SET_RESTORE_WORKSPACE':
      return { ...state, restoreWorkspace: action.payload };
    default:
      return state;
  }
}

// ─── Split Context Interfaces ────────────────────────────────────

export interface WorkspaceChartsContextValue {
  charts: ChartInstance[];
  activeChartId: string | null;
  layout: WorkspaceLayout;
  dispatch: React.Dispatch<WorkspaceAction>;
  activeChart: ChartInstance | null;
  addChart: (title: string, cachePath: string, security: SecurityData | null, config: ChartConfig, downloading?: boolean, source?: ChartSource, viewState?: Partial<ViewState>) => string;
  removeChart: (id: string) => void;
  setActiveChart: (id: string) => void;
  setLayout: (layout: WorkspaceLayout) => void;
  registerStreamControls: (chartId: string, controls: StreamControls | null) => void;
  activeStreamControls: StreamControls | null;
  registerChartEngine: (chartId: string, engine: ChartEngine | null) => void;
  engineRegistryRef: React.MutableRefObject<Map<string, ChartEngine>>;
  registerSaveHandler: (chartId: string, handlers: SaveHandlers | null) => void;
  saveHandlerRegistryRef: React.MutableRefObject<Map<string, SaveHandlers>>;
}

export interface WorkspaceDrawingContextValue {
  drawingTool: ChartObjectType | null;
  setDrawingTool: (tool: ChartObjectType | null) => void;
  drawingObjectStyle: DrawingObjectStyle;
  setDrawingObjectStyle: (style: Partial<DrawingObjectStyle>) => void;
}

export interface WorkspaceUIContextValue {
  statusMessage: StatusMessage;
  setStatusMessage: (text: string, level?: StatusMessageLevel) => void;
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  restoreWorkspace: boolean;
  setRestoreWorkspace: (restore: boolean) => void;
}

// Backward-compatible combined interface
interface WorkspaceContextValue extends WorkspaceDrawingContextValue, WorkspaceUIContextValue {
  state: WorkspaceState;
  charts: ChartInstance[];
  activeChartId: string | null;
  layout: WorkspaceLayout;
  dispatch: React.Dispatch<WorkspaceAction>;
  activeChart: ChartInstance | null;
  addChart: (title: string, cachePath: string, security: SecurityData | null, config: ChartConfig, downloading?: boolean, source?: ChartSource, viewState?: Partial<ViewState>) => string;
  removeChart: (id: string) => void;
  setActiveChart: (id: string) => void;
  setLayout: (layout: WorkspaceLayout) => void;
  registerStreamControls: (chartId: string, controls: StreamControls | null) => void;
  activeStreamControls: StreamControls | null;
  registerChartEngine: (chartId: string, engine: ChartEngine | null) => void;
  engineRegistryRef: React.MutableRefObject<Map<string, ChartEngine>>;
  registerSaveHandler: (chartId: string, handlers: SaveHandlers | null) => void;
  saveHandlerRegistryRef: React.MutableRefObject<Map<string, SaveHandlers>>;
}

const WorkspaceChartsContext = createContext<WorkspaceChartsContextValue | null>(null);
const WorkspaceDrawingContext = createContext<WorkspaceDrawingContextValue | null>(null);
const WorkspaceUIContext = createContext<WorkspaceUIContextValue | null>(null);

let nextChartSeq = 0;

// Load preferences (including theme) synchronously before first paint
const _initPrefs = loadPreferences();
if (_initPrefs.theme !== 'dark') {
  document.documentElement.dataset.theme = _initPrefs.theme;
}
refreshThemeColors();

const initialState: WorkspaceState = {
  charts: [],
  activeChartId: null,
  layout: 'maximized',
  drawingTool: null,
  drawingObjectStyle: DEFAULT_DRAWING_STYLE,
  statusMessage: { text: 'Ready', level: 'info', timestamp: Date.now() },
  theme: _initPrefs.theme,
  restoreWorkspace: _initPrefs.restoreWorkspace,
};

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  const streamControlsRef = useRef<Map<string, StreamControls>>(new Map());
  const [streamControlsVersion, setStreamControlsVersion] = useState(0);
  const engineRegistryRef = useRef<Map<string, ChartEngine>>(new Map());
  const saveHandlerRegistryRef = useRef<Map<string, SaveHandlers>>(new Map());

  const activeChart = useMemo(
    () => state.charts.find((c) => c.id === state.activeChartId) ?? null,
    [state.charts, state.activeChartId],
  );

  const addChart = useCallback(
    (title: string, cachePath: string, security: SecurityData | null, config: ChartConfig, downloading = false, source: ChartSource = { type: 'new' }, viewState?: Partial<ViewState>): string => {
      const id = `chart-${Date.now()}-${++nextChartSeq}`;
      const chart: ChartInstance = {
        id,
        title,
        cachePath,
        security,
        config,
        viewState: viewState ? { ...DEFAULT_VIEW_STATE, ...viewState } : DEFAULT_VIEW_STATE,
        streaming: false,
        downloading,
        downloadError: null,
        planetLines: [],
        mouse: null,
        dirty: false,
        source,
      };
      dispatch({ type: 'ADD_CHART', payload: chart });
      return id;
    },
    [],
  );

  const removeChart = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_CHART', payload: id });
    streamControlsRef.current.delete(id);
    engineRegistryRef.current.delete(id);
    saveHandlerRegistryRef.current.delete(id);
  }, []);

  const setActiveChart = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_CHART', payload: id });
  }, []);

  const setLayout = useCallback((layout: WorkspaceLayout) => {
    dispatch({ type: 'SET_LAYOUT', payload: layout });
  }, []);

  const setDrawingTool = useCallback((tool: ChartObjectType | null) => {
    dispatch({ type: 'SET_DRAWING_TOOL', payload: tool });
  }, []);

  const setDrawingObjectStyle = useCallback((style: Partial<DrawingObjectStyle>) => {
    dispatch({ type: 'SET_DRAWING_STYLE', payload: style });
  }, []);

  const setStatusMessage = useCallback((text: string, level?: StatusMessageLevel) => {
    dispatch({ type: 'SET_STATUS_MESSAGE', payload: { text, level } });
  }, []);

  const setTheme = useCallback((theme: AppTheme) => {
    dispatch({ type: 'SET_THEME', payload: theme });
  }, []);

  const setRestoreWorkspace = useCallback((restore: boolean) => {
    dispatch({ type: 'SET_RESTORE_WORKSPACE', payload: restore });
  }, []);

  const registerChartEngine = useCallback((chartId: string, engine: ChartEngine | null) => {
    if (engine) {
      engineRegistryRef.current.set(chartId, engine);
    } else {
      engineRegistryRef.current.delete(chartId);
    }
  }, []);

  const registerSaveHandler = useCallback((chartId: string, handlers: SaveHandlers | null) => {
    if (handlers) {
      saveHandlerRegistryRef.current.set(chartId, handlers);
    } else {
      saveHandlerRegistryRef.current.delete(chartId);
    }
  }, []);

  // Apply theme to DOM and refresh canvas colors
  useEffect(() => {
    if (state.theme === 'dark') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = state.theme;
    }
    updatePreference('theme', state.theme);
    // Allow CSS to update before reading computed values
    requestAnimationFrame(() => {
      refreshThemeColors();
    });
  }, [state.theme]);

  // Persist restoreWorkspace preference
  useEffect(() => {
    updatePreference('restoreWorkspace', state.restoreWorkspace);
  }, [state.restoreWorkspace]);

  const registerStreamControls = useCallback((chartId: string, controls: StreamControls | null) => {
    if (controls) {
      streamControlsRef.current.set(chartId, controls);
    } else {
      streamControlsRef.current.delete(chartId);
    }
    setStreamControlsVersion(v => v + 1);
  }, []);

  const activeStreamControls = useMemo(() => {
    if (!state.activeChartId) return null;
    return streamControlsRef.current.get(state.activeChartId) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.activeChartId, streamControlsVersion]);

  const chartsValue = useMemo<WorkspaceChartsContextValue>(() => ({
    charts: state.charts, activeChartId: state.activeChartId, layout: state.layout,
    dispatch, activeChart, addChart, removeChart, setActiveChart, setLayout,
    registerStreamControls, activeStreamControls,
    registerChartEngine, engineRegistryRef,
    registerSaveHandler, saveHandlerRegistryRef,
  }), [state.charts, state.activeChartId, state.layout, activeChart,
    addChart, removeChart, setActiveChart, setLayout,
    registerStreamControls, activeStreamControls,
    registerChartEngine, registerSaveHandler]);

  const drawingValue = useMemo<WorkspaceDrawingContextValue>(() => ({
    drawingTool: state.drawingTool, setDrawingTool,
    drawingObjectStyle: state.drawingObjectStyle, setDrawingObjectStyle,
  }), [state.drawingTool, state.drawingObjectStyle, setDrawingTool, setDrawingObjectStyle]);

  const uiValue = useMemo<WorkspaceUIContextValue>(() => ({
    statusMessage: state.statusMessage, setStatusMessage,
    theme: state.theme, setTheme,
    restoreWorkspace: state.restoreWorkspace, setRestoreWorkspace,
  }), [state.statusMessage, state.theme, state.restoreWorkspace,
    setStatusMessage, setTheme, setRestoreWorkspace]);

  return (
    <WorkspaceChartsContext.Provider value={chartsValue}>
      <WorkspaceDrawingContext.Provider value={drawingValue}>
        <WorkspaceUIContext.Provider value={uiValue}>
          {children}
        </WorkspaceUIContext.Provider>
      </WorkspaceDrawingContext.Provider>
    </WorkspaceChartsContext.Provider>
  );
}

// ─── Specific Hooks (prefer these for performance) ───────────────

export function useWorkspaceCharts(): WorkspaceChartsContextValue {
  const ctx = useContext(WorkspaceChartsContext);
  if (!ctx) throw new Error('useWorkspaceCharts must be used within WorkspaceProvider');
  return ctx;
}

export function useWorkspaceDrawing(): WorkspaceDrawingContextValue {
  const ctx = useContext(WorkspaceDrawingContext);
  if (!ctx) throw new Error('useWorkspaceDrawing must be used within WorkspaceProvider');
  return ctx;
}

export function useWorkspaceUI(): WorkspaceUIContextValue {
  const ctx = useContext(WorkspaceUIContext);
  if (!ctx) throw new Error('useWorkspaceUI must be used within WorkspaceProvider');
  return ctx;
}

// ─── Facade (backward-compatible, subscribes to all 3) ───────────

export function useWorkspace(): WorkspaceContextValue {
  const charts = useWorkspaceCharts();
  const drawing = useWorkspaceDrawing();
  const ui = useWorkspaceUI();
  // Reconstruct full state for legacy consumers
  const state = useMemo<WorkspaceState>(() => ({
    charts: charts.charts,
    activeChartId: charts.activeChartId,
    layout: charts.layout,
    drawingTool: drawing.drawingTool,
    drawingObjectStyle: drawing.drawingObjectStyle,
    statusMessage: ui.statusMessage,
    theme: ui.theme,
    restoreWorkspace: ui.restoreWorkspace,
  }), [charts.charts, charts.activeChartId, charts.layout,
    drawing.drawingTool, drawing.drawingObjectStyle,
    ui.statusMessage, ui.theme, ui.restoreWorkspace]);
  return {
    state,
    ...charts,
    ...drawing,
    ...ui,
  };
}
