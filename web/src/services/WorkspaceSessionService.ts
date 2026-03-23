/**
 * Workspace session save/restore via localStorage.
 * Persists open charts across page reloads.
 */
import type { ChartInstance, ChartSource } from '../context/WorkspaceContext';
import type { ChartConfig, CompactBar, SerializedSecurity, ViewState } from '../types/chart';
import type { ChartObject } from '../types/objects';
import type { PlanetLineObject } from '../types/planet';
import type { ChartEngine } from '../engine/ChartEngine';
import { migratePlanetLines } from '../utils/migratePlanetLines';
import { log } from './Logger';

const STORAGE_KEY = 'ultrachart-workspace';

/** Persisted chart data */
export interface PersistedChart {
  id: string;
  title: string;
  source: ChartSource;
  config: ChartConfig;
  viewState: Partial<ViewState>;
  objects: ChartObject[];
  planetLines: PlanetLineObject[];
  dirty: boolean;
  security: SerializedSecurity | null;
  /** Bars stored inline for file-sourced charts (no other reload source) */
  bars?: CompactBar[];
}

/** Full workspace session */
export interface WorkspaceSession {
  version: number;
  activeChartId: string | null;
  charts: PersistedChart[];
  savedAt: string;
}

const SESSION_VERSION = 1;

/**
 * Save the current workspace session to localStorage.
 * For cache/sample sources, bars are NOT stored (reloaded on restore).
 * For file sources, bars are stored inline.
 */
export function saveWorkspaceSession(
  charts: ChartInstance[],
  activeChartId: string | null,
  engines: Map<string, ChartEngine>,
): void {
  if (charts.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }

  const persisted: PersistedChart[] = charts.map((chart) => {
    const engine = engines.get(chart.id);
    const objects = engine ? (engine.objectManager.toJSON() as ChartObject[]) : [];

    // Read LIVE viewport state from the engine (source of truth for zoom/scroll)
    // — ChartContext/WorkspaceContext viewState may be stale since the engine
    //   manages scroll/zoom directly without syncing back to React state.
    const liveViewState = engine ? engine.viewport.state : chart.viewState;

    // Determine if we need to store bars inline
    const needInlineBars = chart.source.type === 'file' || chart.source.type === 'new';
    const bars: CompactBar[] | undefined = needInlineBars && chart.security?.bars
      ? chart.security.bars.map((b) => ({
          t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume,
        }))
      : undefined;

    return {
      id: chart.id,
      title: chart.title,
      source: chart.source,
      config: chart.config,
      viewState: {
        scrollOffset: liveViewState.scrollOffset,
        pixelsPerBar: liveViewState.pixelsPerBar,
        autoScale: liveViewState.autoScale,
      },
      objects,
      planetLines: chart.planetLines.map((pl) => ({
        ...pl,
        samples: [], // Don't store cached samples
        dirty: true,
      })),
      dirty: chart.dirty,
      security: chart.security
        ? {
            symbol: chart.security.info.symbol,
            name: chart.security.info.name,
            conId: chart.security.info.conId,
            exchange: chart.security.info.exchange,
            lastTradeDate: chart.security.info.lastTradeDate,
            secType: chart.security.info.secType,
            period: chart.security.period,
            interval: chart.security.interval,
          }
        : null,
      bars,
    };
  });

  const session: WorkspaceSession = {
    version: SESSION_VERSION,
    activeChartId,
    charts: persisted,
    savedAt: new Date().toISOString(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch (e) {
    log.warn('Session', 'Failed to save (quota exceeded?):', e);
  }
}

/** Load workspace session from localStorage. Returns null if none exists or invalid. */
export function loadWorkspaceSession(): WorkspaceSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as WorkspaceSession;
    if (typeof session.version !== 'number' || session.version > SESSION_VERSION || !Array.isArray(session.charts)) {
      return null;
    }
    // Validate individual chart entries
    session.charts = session.charts.filter((c: any) =>
      c && typeof c === 'object' && typeof c.id === 'string' && typeof c.title === 'string'
      && c.config && typeof c.config === 'object'
      && c.source && typeof c.source === 'object' && typeof c.source.type === 'string'
    );
    // Migrate planet line configs from old schema + deduplicate by ID
    for (const chart of session.charts) {
      if (chart.planetLines?.length) {
        chart.planetLines = migratePlanetLines(chart.planetLines);
        // Defensive: deduplicate planet lines by ID (prevents duplication bugs)
        const seen = new Set<string>();
        chart.planetLines = chart.planetLines.filter((pl) => {
          if (seen.has(pl.id)) return false;
          seen.add(pl.id);
          return true;
        });
      }
    }
    return session;
  } catch (e) {
    log.warn('Session', 'Failed to load:', e);
    return null;
  }
}

/** Clear the saved workspace session. */
export function clearWorkspaceSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
