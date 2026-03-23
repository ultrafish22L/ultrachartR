import { useState, useCallback } from 'react';
import { IBService } from '../services/IBService';
import { SecurityData, ChartPeriod } from '../types/chart';
import { log } from '../services/Logger';

interface UseMarketDataReturn {
  loading: boolean;
  error: string | null;
  connected: boolean;
  checkConnection: () => Promise<boolean>;
  loadSecurity: (
    conId: number,
    symbol: string,
    name: string,
    period: ChartPeriod,
    interval: number,
    duration?: string,
    barSize?: string,
    useRTH?: number,
    exchange?: string,
  ) => Promise<SecurityData | null>;
}

export function useMarketData(): UseMarketDataReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const checkConnection = useCallback(async () => {
    try {
      const status = await IBService.status();
      const ok = status.connected;
      setConnected(ok);
      if (!ok) {
        setError('TWS bridge reports disconnected. Check bridge server and TWS.');
      }
      return ok;
    } catch {
      setConnected(false);
      setError('Cannot reach TWS bridge. Run: cd proxy && npm start');
      return false;
    }
  }, []);

  const loadSecurity = useCallback(
    async (
      conId: number,
      symbol: string,
      name: string,
      period: ChartPeriod,
      interval: number,
      duration?: string,
      barSize?: string,
      useRTH?: number,
      exchange?: string,
    ): Promise<SecurityData | null> => {
      setLoading(true);
      setError(null);
      try {
        // If explicit duration/barSize provided, use them. Otherwise derive from period/interval.
        const dur = duration ?? deriveDuration(period);
        const bar = barSize ?? deriveBarSize(period, interval);
        const rth = useRTH ?? 0;

        log.info('MarketData', `Loading conId=${conId} duration="${dur}" bar="${bar}" rth=${rth} exchange=${exchange || 'auto'}`);
        const bars = await IBService.getHistory(conId, dur, bar, rth, exchange);

        if (bars.length === 0) {
          setError('No historical data returned');
          return null;
        }

        log.info('MarketData', `Loaded ${bars.length} bars`);

        const data: SecurityData = {
          info: { symbol, name, conId, exchange },
          bars,
          period,
          interval,
          lastUpdate: Date.now(),
        };
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { loading, error, connected, checkConnection, loadSecurity };
}

/** Derive IB duration string from chart period */
function deriveDuration(period: ChartPeriod): string {
  switch (period) {
    case 'intraday': return '2 M';
    case 'daily': return '1 Y';
    case 'weekly': return '5 Y';
    case 'monthly': return '10 Y';
    default: return '1 Y';
  }
}

/** Derive IB bar size from chart period and interval */
function deriveBarSize(period: ChartPeriod, interval: number): string {
  switch (period) {
    case 'intraday':
      if (interval <= 1) return '1 min';
      if (interval <= 5) return '5 mins';
      if (interval <= 15) return '15 mins';
      if (interval <= 30) return '30 mins';
      return '1 hour';
    case 'daily': return '1 day';
    case 'weekly': return '1 week';
    case 'monthly': return '1 month';
    default: return '1 day';
  }
}
