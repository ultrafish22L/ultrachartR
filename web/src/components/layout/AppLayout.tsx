import { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import { MenuBar } from './MenuBar';
import { AppToolbar } from './AppToolbar';
import { AppStatusBar } from './AppStatusBar';
import { TabBar } from './TabBar';
import { ChartHeader } from '../chart/ChartHeader';
import { ChartFooter } from '../chart/ChartFooter';
import { ChartPanel } from '../chart/ChartPanel';
import { ImportDialog } from '../dialogs/ImportDialog';
import { PlanetLineDialog } from '../dialogs/PlanetLineDialog';
import { PreferencesDialog } from '../dialogs/PreferencesDialog';
import { EphemerisWheel } from '../panels/EphemerisWheel';
import { ChartProvider, useChart } from '../../context/ChartContext';
import { useWorkspace, useWorkspaceCharts, useWorkspaceUI, ChartInstance } from '../../context/WorkspaceContext';
import { useRealtimeData } from '../../hooks/useRealtimeData';
import { IBService } from '../../services/IBService';
import { ImportRequest } from '../dialogs/ImportDialog';
import { OHLCVBar, SecurityData, ChartPeriod, formatContractDate } from '../../types/chart';
import { PlanetLineConfig, PlanetLineObject, PlanetId, DEFAULT_EPHEM_CONFIG } from '../../types/planet';
import { ChartObject } from '../../types/objects';
import { initSwissEph, getActiveBackend } from '../../planet/EphemerisService';
import { serializeChart, openFile, deserializeChart, serializeTemplate, deserializeTemplate, saveTemplateWithPicker, openTemplateFile, saveFileWithPickerGetHandle } from '../../services/FileService';
import { saveWorkspaceSession, loadWorkspaceSession } from '../../services/WorkspaceSessionService';
import { loadPreferences, savePreferences, getDefaultChartConfig } from '../../services/PreferencesService';
import { parseChartFile } from '../../utils/chartFileLoader';
import { AboutDialog } from '../dialogs/AboutDialog';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { getSampleSecurity, getIntradaySampleSecurity } from '../../data/sampleData';
import { log } from '../../services/Logger';
import styles from './AppLayout.module.css';

// ─── Restore data for newly opened/restored charts ────────────────

interface RestoreData {
  objects?: ChartObject[];
  planetLines?: PlanetLineObject[];
}

/** Shared ref for passing restore data to ChartPaneInner on mount */
const pendingRestoreRef = { current: new Map<string, RestoreData>() };

/** Module-level object cache: survives HMR so objects aren't lost when engines are recreated */
const objectCacheRef = { current: new Map<string, ChartObject[]>() };

/** Module-level callback for adding planet lines to the active chart (bridges AppLayout ↔ ChartContext) */
const planetLineCallbackRef = { current: null as ((config: PlanetLineConfig) => void) | null };

/** Module-level flag to prevent duplicate workspace restore (survives HMR) */
let workspaceRestored = false;

export function AppLayout() {
  const workspace = useWorkspace();
  const { state: wsState, dispatch: wsDispatch, activeChart, addChart, removeChart, setActiveChart, setLayout, setStatusMessage } = workspace;

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [planetDialogOpen, setPlanetDialogOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [showEphemeris, setShowEphemeris] = useState(false);
  const [ephemTime, setEphemTime] = useState<number | null>(null);
  const [, setEphemBackend] = useState<string>('loading');

  // Update ephemeris time only on click / click-drag (not hover)
  useEffect(() => {
    const mouse = activeChart?.mouse;
    if (mouse?.buttonDown && mouse.time) {
      setEphemTime(mouse.time);
    }
  }, [activeChart?.mouse]);

  // Initialize Swiss Ephemeris on mount
  useEffect(() => {
    initSwissEph().then((ok) => {
      setEphemBackend(ok ? 'swisseph' : 'equations');
      log.info('App', 'Ephemeris backend:', getActiveBackend());
      if (!ok) {
        setStatusMessage('Swiss Ephemeris unavailable, using equation-based fallback', 'warn');
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Workspace Session Restore (once on mount) ──────────────────

  useEffect(() => {
    if (workspaceRestored) return;
    workspaceRestored = true;

    if (!wsState.restoreWorkspace) return;
    // Skip if charts already loaded (e.g., HMR remount after auto-save)
    if (wsState.charts.length > 0) return;

    const session = loadWorkspaceSession();
    if (!session || session.charts.length === 0) return;

    const idMap = new Map<string, string>();
    let aborted = false;

    (async () => {
      for (const pc of session.charts) {
        if (aborted) return;
        try {
          let security: SecurityData | null = null;

          if (pc.source.type === 'sample') {
            const sampleSec = pc.source.which === 'zs_5min'
              ? getIntradaySampleSecurity()
              : getSampleSecurity();
            security = sampleSec;
          } else if (pc.source.type === 'cache') {
            try {
              const cache = await IBService.loadCache(pc.source.cachePath);
              const bars: OHLCVBar[] = cache.bars.map((b) => ({
                time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
              }));
              security = {
                info: {
                  symbol: cache.symbol, name: cache.symbol, conId: cache.conId,
                  exchange: cache.exchange, lastTradeDate: cache.lastTradeDate, secType: cache.secType,
                },
                bars,
                period: cache.interval > 0 ? 'intraday' : 'daily',
                interval: cache.interval,
                lastUpdate: Date.now(),
              };
            } catch {
              // Proxy unavailable — create chart with empty bars
              if (pc.security) {
                security = {
                  info: { symbol: pc.security.symbol, name: pc.security.name, conId: pc.security.conId, exchange: pc.security.exchange },
                  bars: [],
                  period: pc.security.period as ChartPeriod,
                  interval: pc.security.interval,
                  lastUpdate: Date.now(),
                };
              }
              setStatusMessage(`Could not reload ${pc.title} — TWS proxy unavailable`, 'warn');
            }
          } else if ((pc.source.type === 'file' || pc.source.type === 'new') && pc.bars) {
            const bars: OHLCVBar[] = pc.bars.map((b) => ({
              time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
            }));
            if (pc.security) {
              security = {
                info: { symbol: pc.security.symbol, name: pc.security.name, conId: pc.security.conId, exchange: pc.security.exchange },
                bars,
                period: pc.security.period as ChartPeriod,
                interval: pc.security.interval,
                lastUpdate: Date.now(),
              };
            }
          }

          const cachePath = pc.source.type === 'cache' ? pc.source.cachePath : '';
          const newId = addChart(pc.title, cachePath, security, pc.config, false, pc.source, pc.viewState);
          idMap.set(pc.id, newId);

          // Queue objects/planetLines for restoration in ChartPaneInner
          // (viewState flows through addChart → ChartProvider → engine directly)
          if ((pc.objects && pc.objects.length > 0) || (pc.planetLines && pc.planetLines.length > 0)) {
            pendingRestoreRef.current.set(newId, {
              objects: pc.objects,
              planetLines: pc.planetLines,
            });
            // Also populate the HMR cache so objects survive engine recreation
            if (pc.objects && pc.objects.length > 0) {
              objectCacheRef.current.set(newId, pc.objects);
            }
          }

          // Charts start clean — user actions (objects, planet lines, etc.) will set dirty
        } catch (err: any) {
          log.error('Workspace', `Failed to restore chart "${pc.title}":`, err);
        }
      }

      // Restore active chart
      if (!aborted && session.activeChartId) {
        const newActiveId = idMap.get(session.activeChartId);
        if (newActiveId) setActiveChart(newActiveId);
      }
    })();
    return () => { aborted = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Workspace Session Auto-Save (debounced) ───────────────────

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!wsState.restoreWorkspace) return;
    if (wsState.charts.length === 0) return;

    clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      saveWorkspaceSession(wsState.charts, wsState.activeChartId, workspace.engineRegistryRef.current);
    }, 2000);

    return () => clearTimeout(saveTimeoutRef.current);
  }, [wsState.charts, wsState.activeChartId, wsState.restoreWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── beforeunload: warn on dirty + save session ─────────────────

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      // Auto-save workspace session (also check localStorage pref to allow external clearing)
      const prefs = loadPreferences();
      if (prefs.restoreWorkspace && wsState.restoreWorkspace && wsState.charts.length > 0) {
        saveWorkspaceSession(wsState.charts, wsState.activeChartId, workspace.engineRegistryRef.current);
      }
      // Warn if any chart has unsaved changes
      const hasDirty = wsState.charts.some((c) => c.dirty);
      if (hasDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [wsState.charts, wsState.activeChartId, wsState.restoreWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Close chart with dirty confirmation ────────────────────────

  // Ref to avoid stale closure in handleCloseChart (prevents re-creating callback on every charts change)
  const chartsRef = useRef(wsState.charts);
  useEffect(() => { chartsRef.current = wsState.charts; }, [wsState.charts]);

  const handleCloseChart = useCallback((chartId: string) => {
    const chart = chartsRef.current.find((c) => c.id === chartId);
    if (chart?.dirty) {
      setConfirmState({
        message: `"${chart.title}" has unsaved changes. Close anyway?`,
        onConfirm: () => {
          removeChart(chartId);
          objectCacheRef.current.delete(chartId);
          setConfirmState(null);
        },
      });
      return;
    }
    removeChart(chartId);
    objectCacheRef.current.delete(chartId);
  }, [removeChart]);

  const handleCloseAllCharts = useCallback(() => {
    const charts = chartsRef.current;
    const dirtyCharts = charts.filter((c) => c.dirty);
    if (dirtyCharts.length > 0) {
      setConfirmState({
        message: `${dirtyCharts.length} chart(s) have unsaved changes. Close all anyway?`,
        onConfirm: () => {
          for (const c of chartsRef.current) {
            removeChart(c.id);
            objectCacheRef.current.delete(c.id);
          }
          setConfirmState(null);
        },
      });
      return;
    }
    for (const c of charts) {
      removeChart(c.id);
      objectCacheRef.current.delete(c.id);
    }
  }, [removeChart]);

  // ─── Helper: load a cache file into a chart ─────────────────────

  const loadCacheIntoChart = useCallback(async (cachePath: string, chartId?: string) => {
    const cache = await IBService.loadCache(cachePath);
    const bars: OHLCVBar[] = cache.bars.map((b) => ({
      time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
    }));

    const security: SecurityData = {
      info: {
        symbol: cache.symbol,
        name: cache.symbol,
        conId: cache.conId,
        exchange: cache.exchange,
        lastTradeDate: cache.lastTradeDate,
        secType: cache.secType,
      },
      bars,
      period: cache.interval > 0 ? 'intraday' : 'daily',
      interval: cache.interval,
      lastUpdate: Date.now(),
    };

    if (chartId) {
      wsDispatch({ type: 'UPDATE_CHART', payload: { id: chartId, updates: { security, downloading: false, downloadError: null } } });
    } else {
      const filename = cachePath.replace(/^.*[\\/]/, '').replace(/\.json$/i, '');
      const title = filename;
      const config = getDefaultChartConfig({ period: security.period, interval: security.interval });
      addChart(title, cachePath, security, config, false, { type: 'cache', cachePath });
    }
    setStatusMessage(`Loaded ${cache.symbol} — ${bars.length} bars`);
  }, [addChart, wsDispatch, setStatusMessage]);

  // ─── Import / Load handlers ────────────────────────────────────

  const handleImport = useCallback((request: ImportRequest) => {
    const { contract, interval, barSize, startDate, cachePath } = request;
    const contractDate = formatContractDate(contract.lastTradeDate);
    const sym = contract.localSymbol || contract.symbol;
    const datePart = contractDate ? ` ${contractDate}` : '';
    const intervalPart = interval > 0 ? interval + 'm' : barSize;
    const title = `${sym}${datePart} ${intervalPart}`;
    const config = getDefaultChartConfig({
      period: (interval > 0 ? 'intraday' : 'daily') as 'intraday' | 'daily',
      interval,
    });

    const chartId = addChart(title, cachePath, null, config, true, { type: 'cache', cachePath });
    setStatusMessage(`Importing ${contract.symbol}...`);

    IBService.importData({
      conId: contract.conId,
      symbol: contract.symbol,
      exchange: contract.exchange,
      secType: contract.secType,
      lastTradeDate: contract.lastTradeDate,
      interval,
      barSize,
      startDate,
      cachePath,
    }).then(async (result) => {
      log.info('AppLayout', `Import complete: ${result.cachePath} (${result.barCount} bars)`);
      await loadCacheIntoChart(result.cachePath, chartId);
    }).catch((err) => {
      log.error('AppLayout', 'Import failed:', err);
      wsDispatch({ type: 'UPDATE_CHART', payload: { id: chartId, updates: { downloading: false, downloadError: err.message || 'Import failed' } } });
      setStatusMessage(`Import failed: ${err.message || 'Unknown error'}`, 'error');
    });
  }, [addChart, loadCacheIntoChart, wsDispatch, setStatusMessage]);

  const handleLoad = useCallback(async (cachePath: string, sync: boolean) => {
    try {
      if (sync) {
        setStatusMessage('Syncing cache...');
        await IBService.syncCache(cachePath);
      }
      await loadCacheIntoChart(cachePath);
    } catch (err: any) {
      log.error('AppLayout', 'Load failed:', err);
      setStatusMessage(`Load failed: ${err.message || 'Unknown error'}`, 'error');
    }
  }, [loadCacheIntoChart, setStatusMessage]);

  // ─── File > Open handler ─────────────────────────────────────────

  const handleOpenChart = useCallback(async () => {
    try {
      const { content, filename } = await openFile();
      const title = filename.replace(/\.(uchart|json)$/i, '');
      const parsed = JSON.parse(content);

      // Detect format: ChartFile (.uchart) vs CacheFile (.json)
      if (parsed.version && parsed.config) {
        const chartFile = deserializeChart(content);
        const { security, config, viewState, objects, planetLines, barCount } = parseChartFile(chartFile);

        const chartId = addChart(title, '', security, config, false, { type: 'file' }, viewState);
        pendingRestoreRef.current.set(chartId, { objects, planetLines });

        setStatusMessage(`Opened ${filename} — ${barCount} bars`);
      } else if (parsed.bars && Array.isArray(parsed.bars)) {
        // Cache file format (.json from TWS bridge)
        const bars: OHLCVBar[] = parsed.bars.map((b: any) => ({
          time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
        }));
        const security: SecurityData = {
          info: {
            symbol: parsed.symbol || title,
            name: parsed.symbol || title,
            conId: parsed.conId,
            exchange: parsed.exchange,
            lastTradeDate: parsed.lastTradeDate,
            secType: parsed.secType,
          },
          bars,
          period: parsed.interval > 0 ? 'intraday' : 'daily',
          interval: parsed.interval || 0,
          lastUpdate: Date.now(),
        };
        const config = getDefaultChartConfig({ period: security.period, interval: security.interval });
        addChart(title, '', security, config, false, { type: 'file' });
        setStatusMessage(`Opened ${filename} — ${bars.length} bars`);
      } else {
        setStatusMessage(`Unrecognized file format: ${filename}`, 'error');
      }
    } catch (err: any) {
      if (err.message !== 'No file selected') {
        setStatusMessage(`Open failed: ${err.message}`, 'error');
      }
    }
  }, [addChart, setStatusMessage]);

  // ─── Planet Line (app-level, applied to active chart) ──────────

  const handleAddPlanetLine = useCallback((config: PlanetLineConfig) => {
    if (planetLineCallbackRef.current) {
      planetLineCallbackRef.current(config);
    }
  }, []);

  const handleQuickMercury = useCallback(() => {
    handleAddPlanetLine({
      ...DEFAULT_EPHEM_CONFIG,
      planet: PlanetId.Mercury,
      perspective: 'heliocentric',
      coordinate: 'longitude',
      period: 57.7,
      offset: 0,
      invert: false,
      showVertLines: false,
      showBands: false,
    });
  }, [handleAddPlanetLine]);

  const handleQuickMoon = useCallback(() => {
    handleAddPlanetLine({
      ...DEFAULT_EPHEM_CONFIG,
      planet: PlanetId.Moon,
      perspective: 'topocentric',
      coordinate: 'longitude',
      period: 45,
      offset: 0,
      invert: false,
      showVertLines: false,
      showBands: false,
    });
  }, [handleAddPlanetLine]);

  const handleQuickSunGeo = useCallback(() => {
    handleAddPlanetLine({
      ...DEFAULT_EPHEM_CONFIG,
      planet: PlanetId.Sun,
      perspective: 'geocentric',
      coordinate: 'longitude',
      period: 60,
      offset: 0,
      invert: false,
      showVertLines: false,
      showBands: false,
    });
  }, [handleAddPlanetLine]);

  // ─── Load .uchart from URL (for testing / quick-load) ───────────

  const handleLoadUchartUrl = useCallback(async (url: string) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const content = await resp.text();
      // Extract filename from URL — handle both /file.uchart and /chart/load?name=file.uchart
      const urlObj = new URL(url, window.location.origin);
      const nameParam = urlObj.searchParams.get('name');
      const filename = nameParam || url.split('/').pop() || 'chart.uchart';
      const title = filename.replace(/\.(uchart|json)$/i, '');

      const chartFile = deserializeChart(content);
      const { security, config, viewState, objects, planetLines, barCount } = parseChartFile(chartFile);

      const chartId = addChart(title, '', security, config, false, { type: 'file' }, viewState);
      pendingRestoreRef.current.set(chartId, { objects, planetLines });

      setStatusMessage(`Opened ${filename} — ${barCount} bars`);
    } catch (err: any) {
      log.error('Open', `Failed to load ${url}:`, err.message);
      setStatusMessage(`Load failed: ${err.message}`, 'error');
    }
  }, [addChart, setStatusMessage]);

  const handleLoadSample = useCallback((which: 'zs_daily' | 'zs_5min') => {
    const security = which === 'zs_5min' ? getIntradaySampleSecurity() : getSampleSecurity();
    const title = which === 'zs_5min' ? 'ZS 5min (sample)' : 'ZS Daily (sample)';
    const config = getDefaultChartConfig({ period: security.period, interval: security.interval });
    addChart(title, '', security, config, false, { type: 'sample', which });
    setStatusMessage(`Loaded sample: ${title} — ${security.bars.length} bars`);
  }, [addChart, setStatusMessage]);

  // ─── Menu-level Save / Save As (delegates to active chart) ─────

  const handleMenuSave = useCallback(() => {
    if (!wsState.activeChartId) return;
    const handler = workspace.saveHandlerRegistryRef.current.get(wsState.activeChartId);
    handler?.save();
  }, [wsState.activeChartId, workspace.saveHandlerRegistryRef]);

  const handleMenuSaveAs = useCallback(() => {
    if (!wsState.activeChartId) return;
    const handler = workspace.saveHandlerRegistryRef.current.get(wsState.activeChartId);
    handler?.saveAs();
  }, [wsState.activeChartId, workspace.saveHandlerRegistryRef]);

  // ─── Edit Menu Handlers ────────────────────────────────────────────

  const getActiveEngine = useCallback(() => {
    if (!wsState.activeChartId) return null;
    return workspace.engineRegistryRef.current.get(wsState.activeChartId) ?? null;
  }, [wsState.activeChartId, workspace.engineRegistryRef]);

  const handleDelete = useCallback(() => { getActiveEngine()?.deleteSelected(); }, [getActiveEngine]);
  const handleCopy = useCallback(() => { getActiveEngine()?.copySelected(); }, [getActiveEngine]);
  const handlePaste = useCallback(() => { getActiveEngine()?.pasteClipboard(); }, [getActiveEngine]);

  // ─── Template Save / Load ──────────────────────────────────────────

  const handleSaveTemplate = useCallback(async () => {
    if (!wsState.activeChartId) return;
    const engine = workspace.engineRegistryRef.current.get(wsState.activeChartId);
    if (!engine) return;
    const objects = engine.objectManager.objects;
    if (objects.length === 0) {
      setStatusMessage('No objects to save', 'warn');
      return;
    }
    const chart = wsState.charts.find((c) => c.id === wsState.activeChartId);
    const baseName = chart?.title ?? 'template';
    const json = serializeTemplate(objects);
    try {
      const chosenName = await saveTemplateWithPicker(json, `${baseName}.tem`);
      setStatusMessage(`Saved template: ${chosenName}`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStatusMessage(`Template save failed: ${err.message}`, 'error');
      }
    }
  }, [wsState.activeChartId, wsState.charts, workspace.engineRegistryRef, setStatusMessage]);

  const handleLoadTemplate = useCallback(async () => {
    if (!wsState.activeChartId) return;
    const engine = workspace.engineRegistryRef.current.get(wsState.activeChartId);
    if (!engine) return;
    try {
      const result = await openTemplateFile();
      if (!result) return;
      const template = deserializeTemplate(result.content);
      engine.objectManager.fromJSON(template.objects);
      engine.resize(); // trigger re-render
      setStatusMessage(`Loaded template: ${result.filename} (${template.objects.length} objects)`);
      wsDispatch({ type: 'SET_CHART_DIRTY', payload: { id: wsState.activeChartId, dirty: true } });
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStatusMessage(`Template load failed: ${err.message}`, 'error');
      }
    }
  }, [wsState.activeChartId, wsDispatch, setStatusMessage]);

  // ─── Keyboard Shortcuts (App-Level) ─────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

      // Ctrl+Shift combos
      if (e.ctrlKey && e.shiftKey) {
        if (e.key === 'W' || e.key === 'w') { e.preventDefault(); handleCloseAllCharts(); return; }
        return; // Ctrl+Shift+S handled per-chart
      }

      // Ctrl combos
      if (e.ctrlKey) {
        switch (e.key) {
          case 'l': e.preventDefault(); setImportDialogOpen(true); return;
          case 'o': e.preventDefault(); handleOpenChart(); return;
          case 'p': case 'P': e.preventDefault(); setPreferencesOpen(true); return;
        }
        return; // Ctrl+S handled per-chart
      }

      if (inInput) return;

      // Function keys
      switch (e.key) {
        case 'F1': e.preventDefault(); window.open('/help.html', '_blank'); return;
        case 'F2': e.preventDefault(); handleLoadSample('zs_daily'); return;
        case 'F3': e.preventDefault(); handleLoadSample('zs_5min'); return;
        case 'F5': e.preventDefault(); handleLoadUchartUrl('/chart/load?name=ZSK6_5m.uchart'); return;
      }

      // Plain keys (no modifier)
      if (!e.altKey && !e.metaKey) {
        // Drawing tools (number keys)
        if (!e.shiftKey) {
          switch (e.key) {
            case '1': e.preventDefault(); workspace.setDrawingTool('line'); return;
            case '2': e.preventDefault(); workspace.setDrawingTool('horizontalLine'); return;
            case '3': e.preventDefault(); workspace.setDrawingTool('verticalLine'); return;
            case '4': e.preventDefault(); workspace.setDrawingTool('rectangle'); return;
            case '5': e.preventDefault(); workspace.setDrawingTool('circle'); return;
            case '6': e.preventDefault(); workspace.setDrawingTool('text'); return;
            case '7': e.preventDefault(); setPlanetDialogOpen(true); return;
            case 'e': e.preventDefault(); setShowEphemeris(v => !v); return;
            case 'Escape': e.preventDefault(); workspace.setDrawingTool(null); return;
          }
        }

        // Shift combos (window layouts)
        if (e.shiftKey) {
          switch (e.key) {
            case 'C': e.preventDefault(); setLayout('cascade'); return;
            case 'H': e.preventDefault(); setLayout('tile-h'); return;
            case 'V': e.preventDefault(); setLayout('tile-v'); return;
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleOpenChart, handleLoadUchartUrl, handleCloseAllCharts, handleLoadSample, wsDispatch, setLayout]); // eslint-disable-line react-hooks/exhaustive-deps

  const layoutClass = wsState.layout === 'tile-h' ? 'tileH' : wsState.layout === 'tile-v' ? 'tileV' : 'cascade';

  // Stable callbacks for memoized children (Fix #1: prevent re-render cascade)
  const handleOpenImport = useCallback(() => setImportDialogOpen(true), []);
  const handleOpenPlanetDialog = useCallback(() => setPlanetDialogOpen(true), []);
  const handleOpenPrefs = useCallback(() => setPreferencesOpen(true), []);
  const handleOpenAbout = useCallback(() => setAboutOpen(true), []);

  // Agent floating window
  const agentWindowRef = useRef<Window | null>(null);
  const handleToggleAgent = useCallback(() => {
    // If window exists and is still open, focus it
    if (agentWindowRef.current && !agentWindowRef.current.closed) {
      agentWindowRef.current.focus();
      return;
    }
    // Get current theme
    const theme = document.documentElement.getAttribute('data-theme') || 'dark';
    agentWindowRef.current = window.open(
      `/agent-window.html?theme=${theme}`,
      'ultrachart-agent',
      'width=420,height=650,resizable=yes,scrollbars=no',
    );
  }, []);

  // Expose chart state globally for agent popup window
  useEffect(() => {
    (window as any).__ultrachart_getChartState = () => {
      if (!wsState.activeChartId) return null;
      const chart = wsState.charts.find((c) => c.id === wsState.activeChartId);
      const engine = workspace.engineRegistryRef.current.get(wsState.activeChartId);
      if (!chart || !engine) return null;
      const sec = chart.security;
      const bars = sec?.bars || [];
      const recentBars = bars.slice(-200).map((b) => ({
        time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      return {
        symbol: sec?.info.symbol || '',
        name: sec?.info.name || '',
        conId: sec?.info.conId || 0,
        exchange: sec?.info.exchange || '',
        period: sec?.period || '',
        interval: sec?.interval || 0,
        barCount: bars.length,
        recentBars,
        objects: engine.objectManager.objects,
        planetLines: engine.planetLines || [],
        viewState: {
          scrollOffset: engine.viewport.state.scrollOffset,
          pixelsPerBar: engine.viewport.state.pixelsPerBar,
          priceMin: engine.viewport.state.priceMin,
          priceMax: engine.viewport.state.priceMax,
        },
      };
    };
    return () => { delete (window as any).__ultrachart_getChartState; };
  }, [wsState.activeChartId, wsState.charts, workspace.engineRegistryRef]);

  const handleToggleEphemeris = useCallback(() => setShowEphemeris(v => !v), []);
  const handleCascade = useCallback(() => setLayout('cascade'), [setLayout]);
  const handleTileH = useCallback(() => setLayout('tile-h'), [setLayout]);
  const handleTileV = useCallback(() => setLayout('tile-v'), [setLayout]);
  const handleCloseImport = useCallback(() => setImportDialogOpen(false), []);
  const handleClosePlanetDialog = useCallback(() => setPlanetDialogOpen(false), []);
  const handleClosePrefs = useCallback(() => setPreferencesOpen(false), []);
  const handleCloseAbout = useCallback(() => setAboutOpen(false), []);
  const handleCloseConfirm = useCallback(() => setConfirmState(null), []);
  const handleCloseEphemeris = useCallback(() => setShowEphemeris(false), []);
  const handleEphemChange = useCallback((backend: string) => {
    setEphemBackend(backend);
    setStatusMessage(`Ephemeris provider: ${backend === 'swisseph' ? 'Swiss Ephemeris' : 'Equations'}`);
  }, [setStatusMessage]);

  return (
    <div className={styles.layout}>
      <MenuBar
        onOpenSymbol={handleOpenImport}
        onOpenChart={handleOpenChart}
        onSaveChart={handleMenuSave}
        onSaveAsChart={handleMenuSaveAs}
        onCloseAll={handleCloseAllCharts}
        onSaveTemplate={handleSaveTemplate}
        onLoadTemplate={handleLoadTemplate}
        onDelete={handleDelete}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onInsertPlanetLine={handleOpenPlanetDialog}
        onCascade={handleCascade}
        onTileH={handleTileH}
        onTileV={handleTileV}
        onPreferences={handleOpenPrefs}
        onLoadSample={handleLoadSample}
        onAbout={handleOpenAbout}
        onToggleAgent={handleToggleAgent}
      />

      <AppToolbar
        onPlanetLine={handleOpenPlanetDialog}
        onQuickMercury={handleQuickMercury}
        onQuickMoon={handleQuickMoon}
        onQuickSunGeo={handleQuickSunGeo}
        showEphemeris={showEphemeris}
        onToggleEphemeris={handleToggleEphemeris}
      />

      {/* Chart Workspace Area */}
      {wsState.charts.length === 0 ? (
        <div className={styles.workspace}>
          <div className={styles.emptyWorkspace}>
            <div>No charts open</div>
            <div className={styles.emptyHints}>
              <span><strong>Ctrl+L</strong> Import from TWS</span>
              <span><strong>Ctrl+O</strong> Open chart file</span>
              <span><strong>F2</strong> Sample daily data</span>
              <span><strong>F3</strong> Sample 5-min data</span>
            </div>
          </div>
        </div>
      ) : wsState.layout === 'maximized' && activeChart ? (
        <div className={styles.workspace}>
          <ChartPaneWrapper
            key={activeChart.id}
            chart={activeChart}
            isActive={true}
            onClose={handleCloseChart}
          />
        </div>
      ) : (
        <div className={`${styles.workspace} ${styles.multiChart} ${styles[layoutClass]}`}>
          {wsState.charts.map((chart, idx) => (
            <div
              key={chart.id}
              className={`${styles.chartPane} ${chart.id === wsState.activeChartId ? styles.chartPaneActive : ''}`}
              style={wsState.layout === 'cascade' ? { top: idx * 30, left: idx * 30, zIndex: chart.id === wsState.activeChartId ? 10 : idx } : undefined}
              onClick={() => setActiveChart(chart.id)}
            >
              <ChartPaneWrapper
                chart={chart}
                isActive={chart.id === wsState.activeChartId}
                onClose={handleCloseChart}
              />
            </div>
          ))}
        </div>
      )}

      <TabBar
        charts={wsState.charts}
        activeChartId={wsState.activeChartId}
        onSelectTab={setActiveChart}
        onCloseTab={handleCloseChart}
      />

      <AppStatusBar />

      <ImportDialog
        open={importDialogOpen}
        onClose={handleCloseImport}
        onImport={handleImport}
        onLoad={handleLoad}
      />

      <PlanetLineDialog
        open={planetDialogOpen}
        onClose={handleClosePlanetDialog}
        onAdd={handleAddPlanetLine}
      />

      <PreferencesDialog
        open={preferencesOpen}
        onClose={handleClosePrefs}
        onEphemChange={handleEphemChange}
      />

      <AboutDialog
        open={aboutOpen}
        onClose={handleCloseAbout}
      />

      <ConfirmDialog
        open={confirmState !== null}
        title="Unsaved Changes"
        message={confirmState?.message ?? ''}
        confirmLabel="Close"
        onConfirm={confirmState?.onConfirm ?? handleCloseConfirm}
        onCancel={handleCloseConfirm}
      />

      {showEphemeris && (
        <EphemerisWheel
          timestamp={ephemTime}
          onClose={handleCloseEphemeris}
        />
      )}
    </div>
  );
}

// ─── Chart Pane Wrapper (wraps a chart in its own ChartProvider) ──

interface ChartPaneWrapperProps {
  chart: ChartInstance;
  isActive: boolean;
  onClose: (chartId: string) => void;
}

const ChartPaneWrapper = memo(function ChartPaneWrapper({ chart, isActive, onClose }: ChartPaneWrapperProps) {
  const handleClose = useCallback(() => onClose(chart.id), [onClose, chart.id]);
  return (
    <ChartProvider
      chartId={chart.id}
      cachePath={chart.cachePath}
      initialConfig={chart.config}
      initialSecurity={chart.security}
      initialViewState={chart.viewState}
    >
      <ChartPaneInner
        chartId={chart.id}
        chart={chart}
        isActive={isActive}
        onClose={handleClose}
      />
    </ChartProvider>
  );
});

// ─── Chart Pane Inner (inside ChartProvider) ──────────────────────

interface ChartPaneInnerProps {
  chartId: string;
  chart: ChartInstance;
  isActive: boolean;
  onClose: () => void;
}

const ChartPaneInner = memo(function ChartPaneInner({
  chartId,
  chart,
  isActive,
  onClose,
}: ChartPaneInnerProps) {
  const {
    state, setChartStyle, dispatch,
    planetLines, setPlanetLines, addPlanetLine,
    engineRef, engineVersion, subscribeToMouse,
  } = useChart();

  const wsCharts = useWorkspaceCharts();
  const wsUI = useWorkspaceUI();
  const wsDispatch = wsCharts.dispatch;
  const setStatus = wsUI.setStatusMessage;
  const prevPlanetLinesRef = useRef(planetLines);
  const restoringRef = useRef(false);

  // Register addPlanetLine callback for the active chart (bridges AppLayout ↔ ChartContext)
  useEffect(() => {
    if (isActive) {
      planetLineCallbackRef.current = addPlanetLine;
      return () => {
        if (planetLineCallbackRef.current === addPlanetLine) {
          planetLineCallbackRef.current = null;
        }
      };
    }
  }, [isActive, addPlanetLine]);

  // Register engine with workspace for session save
  useEffect(() => {
    const engine = engineRef.current;
    if (engine) {
      wsCharts.registerChartEngine(chartId, engine);
      // Restore objects from HMR cache if engine was recreated with empty ObjectManager
      const cached = objectCacheRef.current.get(chartId);
      if (cached && cached.length > 0 && engine.objectManager.objects.length === 0) {
        engine.objectManager.fromJSON(cached);
        engine.requestRender();
      }
    }
    return () => wsCharts.registerChartEngine(chartId, null);
  }, [engineVersion, chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply pending restore data (objects, planetLines) on mount.
  // ViewState is now handled through the component tree (addChart → ChartProvider → useChartEngine).
  // Important: only delete restoreData once the engine is available, because
  // this effect may fire before the engine is created (ref doesn't trigger re-renders).
  // Planet lines are safe to apply early (they don't need the engine).
  useEffect(() => {
    const restoreData = pendingRestoreRef.current.get(chartId);
    if (!restoreData) return;

    const engine = engineRef.current;

    // Suppress dirty-flag side effects while applying restore data
    restoringRef.current = true;

    // Planet lines can be applied without the engine (they live in React state)
    if (restoreData.planetLines && restoreData.planetLines.length > 0) {
      setPlanetLines(restoreData.planetLines);
      restoreData.planetLines = []; // consumed — don't re-apply
    }

    // Objects require the engine — wait until it's available
    if (!engine) {
      // Reset after React re-renders and fires effects from the state update
      requestAnimationFrame(() => { restoringRef.current = false; });
      return;
    }

    if (restoreData.objects && restoreData.objects.length > 0) {
      engine.objectManager.fromJSON(restoreData.objects);
      engine.requestRender();
    }

    // All data consumed — clean up
    pendingRestoreRef.current.delete(chartId);
    // Reset after React re-renders and fires effects from restore state changes
    requestAnimationFrame(() => { restoringRef.current = false; });
  }, [engineVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render canvas when theme changes
  useEffect(() => {
    const engine = engineRef.current;
    if (engine) {
      requestAnimationFrame(() => engine.requestRender());
    }
  }, [wsUI.theme, engineRef]);

  // Auto-save chart display preferences whenever user toggles an option
  useEffect(() => {
    if (restoringRef.current) return;
    const { style, showVolume, showSessionBands, monochromeBars, timeMode, timelineStyle } = state.config;
    const prefs = loadPreferences();
    prefs.chartDefaults = { style, showVolume, showSessionBands, monochromeBars, timeMode, timelineStyle };
    savePreferences(prefs);
  }, [state.config.style, state.config.showVolume, state.config.showSessionBands,
      state.config.monochromeBars, state.config.timeMode, state.config.timelineStyle]);

  // Subscribe to ObjectManager changes → mark dirty + cache objects for HMR resilience
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    return engine.objectManager.subscribe(() => {
      // Cache objects so they survive engine recreation during HMR
      objectCacheRef.current.set(chartId, engine.objectManager.toJSON() as ChartObject[]);
      if (!restoringRef.current) {
        wsDispatch({ type: 'SET_CHART_DIRTY', payload: { id: chartId, dirty: true } });
      }
    });
  }, [engineVersion, chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch planet lines for changes → mark dirty
  useEffect(() => {
    if (!restoringRef.current && prevPlanetLinesRef.current !== planetLines && prevPlanetLinesRef.current.length + planetLines.length > 0) {
      wsDispatch({ type: 'SET_CHART_DIRTY', payload: { id: chartId, dirty: true } });
    }
    prevPlanetLinesRef.current = planetLines;
  }, [planetLines, chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync chart config to workspace (for session save)
  useEffect(() => {
    wsDispatch({ type: 'SET_CHART_CONFIG', payload: { id: chartId, config: state.config } });
  }, [state.config, chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync planet lines to workspace (for session save)
  useEffect(() => {
    wsDispatch({ type: 'SET_CHART_PLANET_LINES', payload: { id: chartId, planetLines } });
  }, [planetLines, chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real-time streaming
  const { streaming, syncing, error: streamError, start: startStream, stop: stopStream } = useRealtimeData(
    chart.cachePath,
    chartId,
  );

  // Memoize stream controls object to avoid creating a new object on every render
  const streamControls = useMemo(() => ({
    streaming,
    syncing,
    canStream: !!state.security?.info.conId,
    start: startStream,
    stop: stopStream,
    error: streamError,
  }), [streaming, syncing, state.security?.info.conId, startStream, stopStream, streamError]);

  // Register stream controls with workspace
  useEffect(() => {
    wsCharts.registerStreamControls(chartId, streamControls);
  }, [streamControls, chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup stream controls on unmount
  useEffect(() => {
    return () => wsCharts.registerStreamControls(chartId, null);
  }, [chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync streaming state back to workspace + status message
  useEffect(() => {
    wsDispatch({
      type: 'SET_CHART_STREAMING',
      payload: { id: chartId, streaming },
    });
    if (streaming) {
      wsUI.setStatusMessage(`Streaming ${chart.title}`);
    }
  }, [streaming, chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream error → status message
  useEffect(() => {
    if (streamError) {
      wsUI.setStatusMessage(`Stream error: ${streamError}`, 'error');
    }
  }, [streamError]); // eslint-disable-line react-hooks/exhaustive-deps

  // Throttled mouse state bridge to workspace (for AppStatusBar) — subscription-based, no re-renders
  const mouseThrottleRef = useRef<number>(0);
  const mouseTrailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestMouseRef = useRef<import('../../engine/ChartEngine').ChartMouseState | null>(null);
  useEffect(() => {
    const unsub = subscribeToMouse((mouse) => {
      latestMouseRef.current = mouse;
      const now = Date.now();
      const elapsed = now - mouseThrottleRef.current;
      if (elapsed >= 100) {
        mouseThrottleRef.current = now;
        if (mouseTrailingRef.current) { clearTimeout(mouseTrailingRef.current); mouseTrailingRef.current = null; }
        wsDispatch({ type: 'SET_CHART_MOUSE', payload: { id: chartId, mouse } });
      } else if (!mouseTrailingRef.current) {
        mouseTrailingRef.current = setTimeout(() => {
          mouseThrottleRef.current = Date.now();
          mouseTrailingRef.current = null;
          wsDispatch({ type: 'SET_CHART_MOUSE', payload: { id: chartId, mouse: latestMouseRef.current! } });
        }, 100 - elapsed);
      }
    });
    return () => { unsub(); if (mouseTrailingRef.current) clearTimeout(mouseTrailingRef.current); };
  }, [chartId, subscribeToMouse, wsDispatch]);

  const handleToggleVolume = useCallback(() => dispatch({ type: 'TOGGLE_VOLUME' }), [dispatch]);
  const handleToggleMonochrome = useCallback(() => dispatch({ type: 'TOGGLE_MONOCHROME' }), [dispatch]);
  const handleToggleTimeMode = useCallback(() => dispatch({ type: 'TOGGLE_TIME_MODE' }), [dispatch]);
  const handleToggleSessionBands = useCallback(() => dispatch({ type: 'TOGGLE_SESSION_BANDS' }), [dispatch]);
  const handleToggleTimelineStyle = useCallback(() => dispatch({ type: 'TOGGLE_TIMELINE_STYLE' }), [dispatch]);

  // Build serialized JSON for save
  const buildSaveJson = useCallback(() => {
    const engine = engineRef.current;
    const objects = engine ? engine.objectManager.objects : [];
    // Read LIVE viewport state from engine (source of truth for zoom/scroll)
    const liveViewState = engine ? engine.viewport.cloneState() : state.viewState;
    return serializeChart(state.security, state.config, liveViewState, objects, planetLines);
  }, [state.security, state.config, state.viewState, planetLines, engineRef]);

  const saveFilename = `${chart.title}.uchart`;

  // Save chart (Ctrl+S) — POST to proxy server which writes .uchart to public/
  const handleSaveChart = useCallback(async () => {
    try {
      const json = buildSaveJson();
      const resp = await fetch('/chart/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: saveFilename, content: json }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      wsDispatch({ type: 'SET_CHART_DIRTY', payload: { id: chartId, dirty: false } });
      setStatus(`Saved ${saveFilename}`);
    } catch (err: any) {
      log.error('Save', 'Proxy save failed:', err.message);
      setStatus(`Save failed: ${err.message}`, 'error');
    }
  }, [saveFilename, buildSaveJson, wsDispatch, chartId, setStatus]);

  // Save As (Ctrl+Shift+S) — show native file picker, save to disk, update title
  const handleSaveAsChart = useCallback(async () => {
    const json = buildSaveJson();
    try {
      const result = await saveFileWithPickerGetHandle(json, saveFilename);
      if (result) {
        // Update chart title to match the chosen filename (strip extension)
        const newTitle = result.filename.replace(/\.(uchart|json)$/i, '');
        wsDispatch({ type: 'UPDATE_CHART', payload: { id: chartId, updates: { title: newTitle, source: { type: 'file' } } } });
        wsDispatch({ type: 'SET_CHART_DIRTY', payload: { id: chartId, dirty: false } });
        setStatus(`Saved ${result.filename}`);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      log.error('Save', 'SaveAs failed:', err.message);
      setStatus(`Save As failed: ${err.message}`, 'error');
    }
  }, [buildSaveJson, saveFilename, wsDispatch, chartId, setStatus]);

  // Register save handlers with workspace (for menu File > Save / Save As)
  useEffect(() => {
    wsCharts.registerSaveHandler(chartId, { save: handleSaveChart, saveAs: handleSaveAsChart });
    return () => wsCharts.registerSaveHandler(chartId, null);
  }, [handleSaveChart, handleSaveAsChart, chartId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Global keyboard shortcuts for this chart (only active chart responds)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isActive) return;
      if (e.ctrlKey && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        handleSaveAsChart();
      } else if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        handleSaveChart();
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        switch (e.key) {
          case 't': dispatch({ type: 'TOGGLE_TIME_MODE' }); break;
          case 'v': dispatch({ type: 'TOGGLE_VOLUME' }); break;
          case 'g': dispatch({ type: 'TOGGLE_GRID' }); break;
          case 'x': dispatch({ type: 'TOGGLE_CROSSHAIR' }); break;
          case 'm': dispatch({ type: 'TOGGLE_MONOCHROME' }); break;
          case 'b': dispatch({ type: 'TOGGLE_SESSION_BANDS' }); break;
          case 'l': dispatch({ type: 'TOGGLE_TIMELINE_STYLE' }); break;
          default: return;
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveChart, handleSaveAsChart, dispatch, isActive, chartId]);

  return (
    <div className={styles.chartPaneInner}>
      <ChartHeader
        title={chart.title}
        exchange={state.security?.info.exchange}
        description={state.security?.info.description}
        isActive={isActive}
        chartStyle={state.config.style}
        onStyleChange={setChartStyle}
        showVolume={state.config.showVolume}
        onToggleVolume={handleToggleVolume}
        monochromeBars={state.config.monochromeBars}
        onToggleMonochrome={handleToggleMonochrome}
        timeMode={state.config.timeMode}
        onToggleTimeMode={handleToggleTimeMode}
        showSessionBands={state.config.showSessionBands}
        onToggleSessionBands={handleToggleSessionBands}
        timelineStyle={state.config.timelineStyle}
        onToggleTimelineStyle={handleToggleTimelineStyle}
        onClose={onClose}
      />
      <div className={styles.content}>
        {!chart.downloading && <ChartPanel />}
        {chart.downloading && <div className={styles.downloadingOverlay}>Downloading...</div>}
        {chart.downloadError && <div className={styles.errorBanner}>{chart.downloadError}</div>}
        {syncing && <div className={styles.loadingOverlay}>Syncing...</div>}
        {streamError && <div className={styles.errorBanner}>{streamError}</div>}
      </div>
      <ChartFooter engineRef={engineRef} />
    </div>
  );
}, (prev, next) =>
  prev.chartId === next.chartId
  && prev.isActive === next.isActive
  && prev.onClose === next.onClose
  && prev.chart.title === next.chart.title
  && prev.chart.downloading === next.chart.downloading
  && prev.chart.downloadError === next.chart.downloadError
  && prev.chart.cachePath === next.chart.cachePath
);
