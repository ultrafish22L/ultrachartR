/**
 * IB TWS Bridge API client.
 * All requests go through the Vite proxy (/ib -> http://127.0.0.1:5050).
 */
import { OHLCVBar, CacheFile, CacheInfo } from '../types/chart';
import { log } from './Logger';

const BASE = '/ib';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`TWS Bridge error ${res.status}: ${text}`);
  }
  return res.json();
}

/** Search result from TWS bridge */
export interface TWSContract {
  conId: number;
  symbol: string;
  localSymbol: string;
  secType: string;
  exchange: string;
  primaryExch: string;
  currency: string;
  lastTradeDate: string;
  description: string;
  contractMonth: string;
  multiplier: string;
}

/** Connection status */
export interface TWSStatus {
  connected: boolean;
  authenticated: boolean;
}

/** Historical data response */
interface HistoryResponse {
  symbol: string;
  data: Array<{
    t: number; o: number; h: number; l: number; c: number; v: number;
  }>;
  points: number;
}

/** Import response */
interface ImportResponse {
  cachePath: string;
  barCount: number;
}

/** Sync response */
interface SyncResponse {
  newBars: number;
  totalBars: number;
}

/** Feed start response */
interface FeedStartResponse {
  cachePath: string;
  conId: number;
  exchange: string;
  interval: number;
}

export const IBService = {
  /** Check connection status */
  async status(): Promise<TWSStatus> {
    return apiFetch<TWSStatus>('/status');
  },

  /** Search for contracts */
  async search(
    symbol: string,
    secType: string = 'STK',
    exchange?: string,
  ): Promise<TWSContract[]> {
    let url = `/search?symbol=${encodeURIComponent(symbol)}&secType=${encodeURIComponent(secType)}`;
    if (exchange) url += `&exchange=${encodeURIComponent(exchange)}`;
    return apiFetch<TWSContract[]>(url);
  },

  /** Get historical bars for a contract */
  async getHistory(
    conId: number,
    duration: string = '2 M',
    barSize: string = '5 mins',
    useRTH: number = 0,
    exchange?: string,
  ): Promise<OHLCVBar[]> {
    let url = `/history?conId=${conId}&duration=${encodeURIComponent(duration)}&bar=${encodeURIComponent(barSize)}&rth=${useRTH}`;
    if (exchange) url += `&exchange=${encodeURIComponent(exchange)}`;
    const resp = await apiFetch<HistoryResponse>(url);
    if (!resp.data || resp.data.length === 0) return [];
    return resp.data.map((bar) => ({
      time: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v,
    }));
  },

  // ─── Cache + Feed Methods ──────────────────────────────────────

  /** Import historical data and create a cache file on the bridge */
  async importData(params: {
    conId: number;
    symbol: string;
    exchange: string;
    secType?: string;
    lastTradeDate?: string;
    interval: number;
    barSize: string;
    startDate: string;
    cachePath?: string;
  }): Promise<ImportResponse> {
    return apiFetch<ImportResponse>('/import', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  /** Gap-fill: sync cache file from last bar to current time */
  async syncCache(cachePath: string): Promise<SyncResponse> {
    return apiFetch<SyncResponse>('/sync', {
      method: 'POST',
      body: JSON.stringify({ cachePath }),
    });
  },

  /** Load a cache file from the bridge */
  async loadCache(cachePath: string): Promise<CacheFile> {
    return apiFetch<CacheFile>(`/cache/load?path=${encodeURIComponent(cachePath)}`);
  },

  /** List available cache files */
  async listCaches(): Promise<CacheInfo[]> {
    return apiFetch<CacheInfo[]>('/cache/list');
  },

  /** Start a realtime feed on the bridge */
  async startFeed(cachePath: string): Promise<FeedStartResponse> {
    return apiFetch<FeedStartResponse>('/feed/start', {
      method: 'POST',
      body: JSON.stringify({ cachePath }),
    });
  },

  /** Stop a realtime feed on the bridge */
  async stopFeed(cachePath: string): Promise<void> {
    await apiFetch<{ ok: boolean }>('/feed/stop', {
      method: 'POST',
      body: JSON.stringify({ cachePath }),
    });
  },

  /** Subscribe to a realtime feed SSE stream. Returns unsubscribe function. */
  subscribeFeed(
    cachePath: string,
    callbacks: {
      onTick: (bar: OHLCVBar) => void;
      onBar: (bar: OHLCVBar) => void;
      onConnected: () => void;
      onDisconnected: () => void;
      onError: (msg: string) => void;
    },
  ): () => void {
    const url = `${BASE}/feed/stream?cachePath=${encodeURIComponent(cachePath)}`;
    log.info('IBService', `Opening feed SSE: ${url}`);
    const es = new EventSource(url);

    function parseBar(data: string): OHLCVBar {
      const d = JSON.parse(data);
      const t = Number(d.t), o = Number(d.o), h = Number(d.h),
            l = Number(d.l), c = Number(d.c), v = Number(d.v);
      if (!isFinite(t) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c) || !isFinite(v)) {
        throw new Error('Malformed bar data: non-numeric fields');
      }
      return { time: t, open: o, high: h, low: l, close: c, volume: v };
    }

    let disconnected = false;
    const fireDisconnected = () => {
      if (!disconnected) { disconnected = true; callbacks.onDisconnected(); }
    };

    const onConnected = () => {
      log.info('IBService', 'Feed SSE connected');
      callbacks.onConnected();
    };
    const onTick = (e: Event) => {
      try { callbacks.onTick(parseBar((e as MessageEvent).data)); }
      catch { callbacks.onError('Failed to parse tick data'); }
    };
    const onBar = (e: Event) => {
      try { callbacks.onBar(parseBar((e as MessageEvent).data)); }
      catch { callbacks.onError('Failed to parse bar data'); }
    };
    const onEventError = (e: Event) => {
      if (es.readyState === EventSource.CLOSED) {
        fireDisconnected();
      } else if ((e as MessageEvent).data) {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          callbacks.onError(data.message || 'Stream error');
        } catch {
          callbacks.onError('Stream error');
        }
      }
    };
    const onGenericError = () => {
      if (es.readyState === EventSource.CLOSED) {
        fireDisconnected();
      } else {
        callbacks.onError('SSE connection error');
      }
    };

    es.addEventListener('connected', onConnected);
    es.addEventListener('tick', onTick);
    es.addEventListener('bar', onBar);
    es.addEventListener('error', onEventError);
    es.onerror = onGenericError;

    return () => {
      log.info('IBService', 'Closing feed SSE');
      es.removeEventListener('connected', onConnected);
      es.removeEventListener('tick', onTick);
      es.removeEventListener('bar', onBar);
      es.removeEventListener('error', onEventError);
      es.onerror = null;
      es.close();
      fireDisconnected();
    };
  },
};
