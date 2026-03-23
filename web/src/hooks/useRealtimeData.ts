import { useEffect, useRef, useState, useCallback } from 'react';
import { FeedSubscriptionManager } from '../services/FeedSubscriptionManager';
import { IBService } from '../services/IBService';
import { useChart } from '../context/ChartContext';
import { OHLCVBar } from '../types/chart';
import { log } from '../services/Logger';

interface UseRealtimeDataReturn {
  streaming: boolean;
  syncing: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Hook that manages a real-time SSE stream via FeedSubscriptionManager.
 * Tick updates go directly to ChartEngine (bypassing React state for performance).
 * Completed bars update both ChartEngine and ChartContext state.
 *
 * Uses cachePath as the feed key — multiple charts sharing a cachePath
 * share one SSE connection automatically.
 */
export function useRealtimeData(
  cachePath: string | undefined | null,
  chartId: string | undefined | null,
): UseRealtimeDataReturn {
  const { dispatch, engineRef } = useChart();
  const [streaming, setStreaming] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const versionRef = useRef(0);

  const stop = useCallback(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    setStreaming(false);
    dispatch({ type: 'SET_STREAMING', payload: false });
  }, [dispatch]);

  const start = useCallback(async () => {
    if (!cachePath || !chartId) return;

    const version = ++versionRef.current;

    // Stop any existing stream
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    setError(null);

    // Gap-fill first: sync cache from last bar to now
    setSyncing(true);
    try {
      const syncResult = await IBService.syncCache(cachePath);
      if (version !== versionRef.current) return;
      if (syncResult.newBars > 0) {
        log.info('RealtimeData', `Synced ${syncResult.newBars} new bars`);
        // Reload the cache to get the updated bars
        const cache = await IBService.loadCache(cachePath);
        if (version !== versionRef.current) return;
        const bars: OHLCVBar[] = cache.bars.map((b) => ({
          time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
        }));
        // Update security with new bars
        const security = {
          info: {
            symbol: cache.symbol,
            name: cache.symbol,
            conId: cache.conId,
            exchange: cache.exchange,
          },
          bars,
          period: cache.interval > 0 ? 'intraday' as const : 'daily' as const,
          interval: cache.interval,
          lastUpdate: Date.now(),
        };
        dispatch({ type: 'SET_SECURITY', payload: security });
        // Also update engine directly
        engineRef.current?.setData(bars);
      }
    } catch (err) {
      log.warn('RealtimeData', 'Sync failed (continuing):', err);
      // Continue anyway — sync failure shouldn't block streaming
    } finally {
      setSyncing(false);
    }

    if (version !== versionRef.current) return;

    // Subscribe to feed
    const unsub = FeedSubscriptionManager.subscribe(cachePath, chartId, {
      onConnected: () => {
        setStreaming(true);
        dispatch({ type: 'SET_STREAMING', payload: true });
        log.info('RealtimeData', 'Stream connected');
      },
      onDisconnected: () => {
        setStreaming(false);
        dispatch({ type: 'SET_STREAMING', payload: false });
        log.info('RealtimeData', 'Stream disconnected');
      },
      onTick: (bar: OHLCVBar) => {
        // Direct engine update — bypasses React state for performance.
        // Engine.requestRender() already coalesces via RAF, so rapid ticks
        // (5-10/sec from TWS 5-second bars) only produce one paint per frame.
        engineRef.current?.updateLastBar(bar);
      },
      onBar: (bar: OHLCVBar) => {
        // Completed bar — update both engine and React state
        engineRef.current?.appendBar(bar);
        dispatch({ type: 'APPEND_BAR', payload: bar });
        log.debug('RealtimeData', `New bar: ${new Date(bar.time).toLocaleTimeString()} C=${bar.close}`);
      },
      onError: (msg: string) => {
        setError(msg);
        log.error('RealtimeData', 'Error:', msg);
      },
    });

    unsubRef.current = unsub;
  }, [cachePath, chartId, dispatch, engineRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
      dispatch({ type: 'SET_STREAMING', payload: false });
    };
  }, [dispatch]);

  return { streaming, syncing, error, start, stop };
}
