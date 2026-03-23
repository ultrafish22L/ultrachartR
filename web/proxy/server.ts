/**
 * TWS Bridge Server
 *
 * Connects to IB Trader Workstation via the socket API (port 7496)
 * and exposes REST + SSE endpoints that the UltraChart web app can call.
 *
 * Usage:  npm start
 * Env:    TWS_PORT=7496  BRIDGE_PORT=5050  CLIENT_ID=99
 */
import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  IBApi,
  EventName,
  Contract,
  SecType,
  ContractDetails,
} from '@stoqey/ib';
import { AgentCore } from './agent/AgentCore.js';
import { createAgentRouter } from './agent/agentRoutes.js';
import { AstroService } from './services/AstroService.js';
import { createAstroRouter } from './astroRoutes.js';

// ─── Configuration ─────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '5050', 10) || 5050;
const TWS_HOST = process.env.TWS_HOST || '127.0.0.1';
const TWS_PORT = parseInt(process.env.TWS_PORT || '7496', 10) || 7496;
const CLIENT_ID = parseInt(process.env.CLIENT_ID || '99', 10) || 99;

// Directories — overridable for Electron embedding
let CACHE_DIR = path.resolve(__dirname, 'cache');
let CHARTS_DIR = path.resolve(__dirname, '..', 'public');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ─── Express Setup ─────────────────────────────────────────────────

const app = express();
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://127.0.0.1:3000,http://127.0.0.1:5050')
  .split(',').map(s => s.trim());
app.use(cors({ origin: CORS_ORIGINS }));
app.use(express.json({ limit: '10mb' }));

// ─── Request validation helpers ──────────────────────────────────

function requireString(val: unknown, name: string): string {
  if (typeof val !== 'string' || val.trim() === '') {
    throw new ValidationError(`${name} is required and must be a non-empty string`);
  }
  return val.trim();
}

function requireNumber(val: unknown, name: string): number {
  const n = Number(val);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${name} must be a finite number`);
  }
  return n;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// IB routes are mounted on both `/` and `/ib/` so the same handlers work
// whether accessed directly (Vite proxy strips prefix) or via Electron (same origin).
const ibRouter = express.Router();
app.use('/', ibRouter);
app.use('/ib', ibRouter);

// ─── Agent Setup ──────────────────────────────────────────────────

const AGENT_MEMORY_DIR = path.resolve(__dirname, '..', 'agent-memory');
const AGENT_SOURCE_DIR = path.resolve(__dirname, '..', 'src');
const astroService = new AstroService();
const agent = new AgentCore(AGENT_MEMORY_DIR, AGENT_SOURCE_DIR, astroService);

// Auto-configure provider from saved settings on startup
try {
  const settings = agent.getSettings();
  if (settings.apiKey) {
    agent.configureProvider(settings);
    console.log(`  Agent: ${settings.provider} provider configured`);
  }
} catch { /* no saved settings yet */ }

app.use('/agent', createAgentRouter(agent));

// ─── Astro Engine Setup ──────────────────────────────────────────────

app.use('/astro', createAstroRouter(astroService));

/** Extract message from unknown error */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── IB API Connection ────────────────────────────────────────────

let ib: IBApi;
let connected = false;
let nextReqId = 1000;

function getReqId(): number {
  if (nextReqId >= 2147483647) nextReqId = 1000;
  return nextReqId++;
}

function connectToTWS(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Clean up previous instance if reconnecting
    if (ib) {
      try { ib.disconnect(); } catch { /* ignore */ }
      ib.removeAllListeners();
    }

    ib = new IBApi({ clientId: CLIENT_ID, host: TWS_HOST, port: TWS_PORT });

    const onDisconnected = () => {
      connected = false;
      console.log('✗ Disconnected from TWS');
    };

    const onError = (err: Error, code: number, reqId: number) => {
      // Code 2104/2106/2158 are info messages, not errors
      if (code === 2104 || code === 2106 || code === 2158) {
        console.log(`  [info] ${err.message}`);
      } else {
        console.error(`  [error] code=${code} reqId=${reqId}: ${err.message}`);
      }
    };

    const cleanupSetup = () => {
      clearTimeout(timeout);
      ib.removeListener(EventName.connected, onConnected);
    };

    const timeout = setTimeout(() => {
      if (!connected) {
        cleanupSetup();
        reject(new Error(`Connection timeout - is TWS running on ${TWS_HOST}:${TWS_PORT}?`));
      }
    }, 10000);

    const onConnected = () => {
      connected = true;
      cleanupSetup();
      console.log(`✓ Connected to TWS at ${TWS_HOST}:${TWS_PORT} (clientId=${CLIENT_ID})`);
      resolve();
    };

    ib.on(EventName.connected, onConnected);
    ib.on(EventName.disconnected, onDisconnected);
    ib.on(EventName.error, onError);

    ib.connect();
  });
}

// ─── Helper: Promisify IB API calls ───────────────────────────────

function reqContractDetailsAsync(contract: Contract): Promise<ContractDetails[]> {
  return new Promise((resolve, reject) => {
    const reqId = getReqId();
    const results: ContractDetails[] = [];

    const onDetails = (id: number, details: ContractDetails) => {
      if (id === reqId) results.push(details);
    };

    const onEnd = (id: number) => {
      if (id === reqId) {
        cleanup();
        resolve(results);
      }
    };

    const onError = (err: Error, code: number, id: number) => {
      if (id === reqId) {
        cleanup();
        reject(new Error(`IB Error ${code}: ${err.message}`));
      }
    };

    function cleanup() {
      ib.off(EventName.contractDetails, onDetails);
      ib.off(EventName.contractDetailsEnd, onEnd);
      ib.off(EventName.error, onError);
      clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve(results); // return whatever we have
    }, 15000);

    ib.on(EventName.contractDetails, onDetails);
    ib.on(EventName.contractDetailsEnd, onEnd);
    ib.on(EventName.error, onError);
    ib.reqContractDetails(reqId, contract);
  });
}

interface HistoryBar {
  t: number; // timestamp ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function reqHistoricalDataAsync(
  contract: Contract,
  endDateTime: string,
  durationStr: string,
  barSizeSetting: string,
  whatToShow: string,
  useRTH: number,
): Promise<HistoryBar[]> {
  return new Promise((resolve, reject) => {
    const reqId = getReqId();
    const bars: HistoryBar[] = [];

    // @stoqey/ib emits historicalData with individual parameters, NOT a Bar object:
    // (reqId, time, open, high, low, close, volume, count, WAP)
    const onBar = (
      id: number,
      time: string,
      open: number,
      high: number,
      low: number,
      close: number,
      volume: number,
      _count: number | undefined,
      _WAP: number,
    ) => {
      if (id !== reqId) return;
      // formatDate=2: time is epoch seconds as string
      const timeSec = parseInt(time, 10);
      if (isNaN(timeSec) || close < 0) return; // skip invalid / end marker
      bars.push({
        t: timeSec * 1000, // convert to ms
        o: open,
        h: high,
        l: low,
        c: close,
        v: volume ?? 0,
      });
    };

    const onEnd = (id: number) => {
      if (id === reqId) {
        cleanup();
        // Sort by time ascending
        bars.sort((a, b) => a.t - b.t);
        resolve(bars);
      }
    };

    const onError = (err: Error, code: number, id: number) => {
      if (id === reqId) {
        cleanup();
        reject(new Error(`IB Error ${code}: ${err.message}`));
      }
    };

    function cleanup() {
      ib.off(EventName.historicalData, onBar);
      ib.off(EventName.historicalDataEnd, onEnd);
      ib.off(EventName.error, onError);
      clearTimeout(timer);
    }

    // 120s timeout for large data requests
    const timer = setTimeout(() => {
      cleanup();
      if (bars.length > 0) {
        bars.sort((a, b) => a.t - b.t);
        resolve(bars);
      } else {
        reject(new Error('Historical data request timeout'));
      }
    }, 120000);

    ib.on(EventName.historicalData, onBar);
    ib.on(EventName.historicalDataEnd, onEnd);
    ib.on(EventName.error, onError);

    ib.reqHistoricalData(
      reqId,
      contract,
      endDateTime,
      durationStr,
      barSizeSetting,
      whatToShow,
      useRTH,
      2,     // formatDate: 2 = epoch seconds
      false, // keepUpToDate
    );
  });
}

// ─── Cache File Format ─────────────────────────────────────────────

interface CacheFile {
  version: number;
  symbol: string;
  conId: number;
  exchange: string;
  secType: string;
  lastTradeDate: string;
  interval: number;       // minutes (0 for daily/weekly/monthly)
  barSize: string;        // IB bar size string
  bars: HistoryBar[];
}

/** Resolve a path within a base directory, rejecting traversal and symlink attacks. */
function safePath(baseDir: string, userPath: string): string | null {
  if (userPath.includes('\0')) return null;  // null byte injection
  // Reject Windows legacy device names (CVE-2025-27210)
  const baseName = path.basename(userPath).replace(/[\s.]+$/, '').split('.')[0]!.toUpperCase();
  if (['CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'].includes(baseName)) {
    return null;
  }
  const abs = path.resolve(baseDir, userPath);
  const norm = path.normalize(abs);
  const base = path.normalize(baseDir) + path.sep;
  if (!norm.startsWith(base) && norm !== path.normalize(baseDir)) {
    return null;  // Path escapes the base directory
  }
  // Resolve symlinks and re-check containment
  try {
    if (fs.existsSync(norm)) {
      const real = fs.realpathSync(norm);
      if (!real.startsWith(base) && real !== path.normalize(baseDir)) {
        return null;  // Symlink target escapes the base directory
      }
      return real;
    }
  } catch { /* file doesn't exist yet (for writes) — norm is fine */ }
  return norm;
}

function readCacheFile(cachePath: string): CacheFile | null {
  const abs = safePath(CACHE_DIR, cachePath);
  if (!abs || !fs.existsSync(abs)) return null;
  try {
    const raw = fs.readFileSync(abs, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.bars)
        || typeof parsed.symbol !== 'string' || typeof parsed.conId !== 'number') {
      console.error(`  [cache] Invalid cache file structure: ${cachePath}`);
      return null;
    }
    return parsed as CacheFile;
  } catch {
    return null;
  }
}

function writeCacheFile(cachePath: string, cache: CacheFile): void {
  const abs = safePath(CACHE_DIR, cachePath);
  if (!abs) return;
  fs.writeFileSync(abs, JSON.stringify(cache, null, 2), 'utf-8');
}

function appendBarToCache(cachePath: string, bar: HistoryBar): void {
  try {
    const cache = readCacheFile(cachePath);
    if (!cache) return;
    // Deduplicate: skip if last bar has same timestamp
    if (cache.bars.length > 0 && cache.bars[cache.bars.length - 1]!.t === bar.t) {
      return;
    }
    cache.bars.push(bar);
    writeCacheFile(cachePath, cache);
    console.log(`  [persist] Appended bar t=${bar.t} → ${cachePath} (${cache.bars.length} total)`);
  } catch (err: unknown) {
    console.error(`  [persist] Failed to append bar to ${cachePath}:`, err instanceof Error ? err.message : err);
  }
}

// ─── FeedManager ───────────────────────────────────────────────────

interface Feed {
  cachePath: string;
  conId: number;
  exchange: string;
  interval: number;       // minutes
  barSize: string;
  twsReqId: number;
  currentBar: HistoryBar | null;
  clients: Set<Response>;
  intervalMs: number;
  _onRealtimeBar: (...args: any[]) => void;
  _onError: (...args: any[]) => void;
}

class FeedManager {
  private feeds = new Map<string, Feed>();

  startFeed(cachePath: string): Feed | null {
    // Already running?
    const existing = this.feeds.get(cachePath);
    if (existing) {
      console.log(`  [FeedManager] Feed already active for ${cachePath} (${existing.clients.size} clients)`);
      return existing;
    }

    // Read cache file to get contract info
    const cache = readCacheFile(cachePath);
    if (!cache) {
      console.error(`  [FeedManager] Cache file not found: ${cachePath}`);
      return null;
    }

    const reqId = getReqId();
    const intervalMs = cache.interval > 0 ? cache.interval * 60 * 1000 : 5 * 60 * 1000;

    const feed: Feed = {
      cachePath,
      conId: cache.conId,
      exchange: cache.exchange,
      interval: cache.interval,
      barSize: cache.barSize,
      twsReqId: reqId,
      currentBar: null,
      clients: new Set(),
      intervalMs,
      _onRealtimeBar: () => {},
      _onError: () => {},
    };

    this.feeds.set(cachePath, feed);

    // Set up TWS real-time bar subscription
    const contract: Contract = { conId: cache.conId };
    if (cache.exchange) contract.exchange = cache.exchange;

    const onRealtimeBar = (
      id: number,
      date: number,
      open: number,
      high: number,
      low: number,
      close: number,
      volume: number,
      _WAP: number,
      _count: number,
    ) => {
      if (id !== reqId) return;

      const timeMs = date * 1000;
      const barTime = Math.floor(timeMs / feed.intervalMs) * feed.intervalMs;

      if (feed.currentBar === null) {
        feed.currentBar = { t: barTime, o: open, h: high, l: low, c: close, v: volume };
      } else if (barTime !== feed.currentBar.t) {
        // New interval — emit completed bar
        this.broadcast(feed, 'bar', feed.currentBar);
        appendBarToCache(cachePath, feed.currentBar);
        feed.currentBar = { t: barTime, o: open, h: high, l: low, c: close, v: volume };
      } else {
        // Same interval — merge
        feed.currentBar.h = Math.max(feed.currentBar.h, high);
        feed.currentBar.l = Math.min(feed.currentBar.l, low);
        feed.currentBar.c = close;
        feed.currentBar.v += volume;
      }

      // Always emit current bar state as tick
      this.broadcast(feed, 'tick', feed.currentBar);
    };

    const onError = (err: Error, code: number, id: number) => {
      if (id === reqId) {
        this.broadcast(feed, 'error', { message: `IB Error ${code}: ${err.message}` });
      }
    };

    ib.on(EventName.realtimeBar, onRealtimeBar);
    ib.on(EventName.error, onError);

    // Store cleanup references on the feed
    feed._onRealtimeBar = onRealtimeBar;
    feed._onError = onError;

    ib.reqRealTimeBars(reqId, contract, 5, 'TRADES', false);
    console.log(`  [FeedManager] Started feed ${cachePath} reqId=${reqId} conId=${cache.conId} exchange=${cache.exchange}`);

    return feed;
  }

  stopFeed(cachePath: string): void {
    const feed = this.feeds.get(cachePath);
    if (!feed) return;

    // Cancel TWS subscription
    ib.cancelRealTimeBars(feed.twsReqId);
    ib.off(EventName.realtimeBar, feed._onRealtimeBar);
    ib.off(EventName.error, feed._onError);

    // Close all client connections
    for (const client of feed.clients) {
      try { client.end(); } catch {}
    }
    feed.clients.clear();

    this.feeds.delete(cachePath);
    console.log(`  [FeedManager] Stopped feed ${cachePath}`);
  }

  addClient(cachePath: string, res: Response): boolean {
    const feed = this.feeds.get(cachePath);
    if (!feed) return false;
    feed.clients.add(res);
    console.log(`  [FeedManager] Client added to ${cachePath} (${feed.clients.size} total)`);
    return true;
  }

  removeClient(cachePath: string, res: Response): void {
    const feed = this.feeds.get(cachePath);
    if (!feed) return;
    feed.clients.delete(res);
    console.log(`  [FeedManager] Client removed from ${cachePath} (${feed.clients.size} remaining)`);

    // If no clients left, stop the feed
    if (feed.clients.size === 0) {
      this.stopFeed(cachePath);
    }
  }

  getFeed(cachePath: string): Feed | undefined {
    return this.feeds.get(cachePath);
  }

  private broadcast(feed: Feed, event: string, data: object): void {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const failed: Response[] = [];
    for (const client of feed.clients) {
      try {
        client.write(msg);
      } catch (err) {
        console.log(`  [FeedManager] Client write failed for ${feed.cachePath}:`, errMsg(err));
        failed.push(client);
      }
    }
    for (const client of failed) {
      this.removeClient(feed.cachePath, client);
    }
  }
}

const feedManager = new FeedManager();

// ─── Helper: Calculate IB duration from start date to now ─────────

function calcDuration(startDate: string, barSize: string): string {
  const start = new Date(startDate);
  const now = new Date();
  const diffMs = now.getTime() - start.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  // IB duration string limits:
  // - "N S" (seconds, max 86400)
  // - "N D" (days, max 365)
  // - "N W" (weeks, max 52)
  // - "N M" (months, max 12)
  // - "N Y" (years, max 20)

  if (diffDays <= 365) {
    return `${diffDays} D`;
  }
  const months = Math.ceil(diffDays / 30);
  if (months <= 12) {
    return `${months} M`;
  }
  const years = Math.ceil(diffDays / 365);
  return `${Math.min(years, 20)} Y`;
}

// ─── REST Endpoints ───────────────────────────────────────────────

/** GET /status - Connection status */
ibRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ connected, authenticated: connected });
});

/**
 * GET /search?symbol=ZS&secType=FUT&exchange=CBOT
 * Search for contracts matching the given criteria.
 */
ibRouter.get('/search', async (req: Request, res: Response) => {
  try {
    if (!connected) return res.status(503).json({ error: 'Not connected to TWS' });

    const { symbol, secType = 'STK', exchange, currency = 'USD' } = req.query;
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });

    const contract: Contract = {
      symbol: symbol as string,
      secType: secType as SecType,
      currency: currency as string,
    };
    if (exchange) contract.exchange = exchange as string;

    const details = await reqContractDetailsAsync(contract);

    const results = details.map((d) => ({
      conId: d.contract.conId,
      symbol: d.contract.symbol,
      localSymbol: d.contract.localSymbol,
      secType: d.contract.secType,
      exchange: d.contract.exchange,
      primaryExch: d.contract.primaryExch,
      currency: d.contract.currency,
      lastTradeDate: d.contract.lastTradeDateOrContractMonth,
      description: d.longName || d.contract.localSymbol || d.contract.symbol,
      contractMonth: d.contractMonth,
      multiplier: d.contract.multiplier,
    }));

    console.log(`  /search symbol=${symbol} secType=${secType} → ${results.length} results`);
    res.json(results);
  } catch (err: unknown) {
    console.error('  /search error:', errMsg(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /history?conId=...&duration=2 M&bar=5 mins&rth=0&end=
 * Fetch historical bars for a contract.
 */
ibRouter.get('/history', async (req: Request, res: Response) => {
  try {
    if (!connected) return res.status(503).json({ error: 'Not connected to TWS' });

    const {
      conId,
      symbol,
      secType,
      exchange,
      currency = 'USD',
      lastTradeDate,
      duration = '2 M',
      bar = '5 mins',
      rth = '0',
      end = '',
      show = 'TRADES',
    } = req.query;

    // Build contract - either by conId or by description
    let contract: Contract;
    if (conId) {
      const numConId = Number(conId);
      if (isNaN(numConId) || numConId <= 0) {
        return res.status(400).json({ error: 'conId must be a positive number' });
      }
      contract = { conId: numConId };
      // IB requires exchange for futures even when conId is given
      if (exchange) contract.exchange = exchange as string;
    } else if (symbol) {
      contract = {
        symbol: symbol as string,
        secType: (secType as SecType) || 'STK',
        exchange: (exchange as string) || 'SMART',
        currency: currency as string,
      };
      if (lastTradeDate) {
        contract.lastTradeDateOrContractMonth = lastTradeDate as string;
      }
    } else {
      return res.status(400).json({ error: 'conId or symbol is required' });
    }

    // Validate bar size against known IB API values
    const VALID_BAR_SIZES = [
      '1 secs', '5 secs', '10 secs', '15 secs', '30 secs',
      '1 min', '2 mins', '3 mins', '5 mins', '10 mins', '15 mins', '20 mins', '30 mins',
      '1 hour', '2 hours', '3 hours', '4 hours', '8 hours',
      '1 day', '1 week', '1 month',
    ];
    if (!VALID_BAR_SIZES.includes(bar as string)) {
      return res.status(400).json({ error: `Invalid bar size: ${bar}` });
    }

    console.log(`  /history conId=${conId || 'N/A'} symbol=${symbol || 'N/A'} duration=${duration} bar=${bar} rth=${rth}`);

    const bars = await reqHistoricalDataAsync(
      contract,
      end as string,
      duration as string,
      bar as string,
      show as string,
      Number(rth),
    );

    console.log(`    → ${bars.length} bars received`);

    res.json({
      symbol: (symbol as string) || '',
      data: bars,
      points: bars.length,
    });
  } catch (err: unknown) {
    console.error('  /history error:', errMsg(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /contractDetails?conId=...
 * Get full contract details for a specific conId.
 */
ibRouter.get('/contractDetails', async (req: Request, res: Response) => {
  try {
    if (!connected) return res.status(503).json({ error: 'Not connected to TWS' });

    const { conId } = req.query;
    if (!conId) return res.status(400).json({ error: 'conId is required' });
    const numConId = Number(conId);
    if (isNaN(numConId) || numConId <= 0) {
      return res.status(400).json({ error: 'conId must be a positive number' });
    }

    const details = await reqContractDetailsAsync({ conId: numConId });
    if (details.length === 0) return res.status(404).json({ error: 'Contract not found' });

    const d = details[0]!;
    res.json({
      conId: d.contract.conId,
      symbol: d.contract.symbol,
      localSymbol: d.contract.localSymbol,
      secType: d.contract.secType,
      exchange: d.contract.exchange,
      currency: d.contract.currency,
      lastTradeDate: d.contract.lastTradeDateOrContractMonth,
      description: d.longName || d.contract.symbol,
      tradingHours: d.tradingHours,
      liquidHours: d.liquidHours,
      timeZoneId: d.timeZoneId,
    });
  } catch (err: unknown) {
    console.error('  Request error:', errMsg(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Cache Endpoints ──────────────────────────────────────────────

/**
 * POST /import - Import historical data and create a cache file
 * Body: { conId, symbol, exchange, secType?, lastTradeDate?, interval, barSize, startDate, cachePath? }
 */
ibRouter.post('/import', async (req: Request, res: Response) => {
  try {
    if (!connected) return res.status(503).json({ error: 'Not connected to TWS' });

    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    let conId: number, symbol: string, barSize: string, startDate: string;
    try {
      conId = requireNumber(body.conId, 'conId');
      symbol = requireString(body.symbol, 'symbol');
      barSize = requireString(body.barSize, 'barSize');
      startDate = requireString(body.startDate, 'startDate');
    } catch (e) {
      return res.status(400).json({ error: e instanceof ValidationError ? e.message : 'Invalid request' });
    }

    const exchange = typeof body.exchange === 'string' ? body.exchange : '';
    const secType = typeof body.secType === 'string' ? body.secType : 'FUT';
    const lastTradeDate = typeof body.lastTradeDate === 'string' ? body.lastTradeDate : '';
    const interval = Number(body.interval) || 0;
    const requestedPath = typeof body.cachePath === 'string' ? body.cachePath : undefined;

    // Generate cache filename
    const cachePath = requestedPath || `${symbol}_${interval > 0 ? interval + 'm' : barSize.replace(/\s+/g, '')}.json`;

    console.log(`  /import symbol=${symbol} conId=${conId} interval=${interval} barSize=${barSize} start=${startDate}`);

    // Build contract
    const contract: Contract = { conId: Number(conId) };
    if (exchange) contract.exchange = exchange;

    // Calculate duration from start date to now
    const duration = calcDuration(startDate, barSize);
    console.log(`    duration=${duration}`);

    // Fetch historical data
    const bars = await reqHistoricalDataAsync(
      contract,
      '',          // endDateTime: empty = now
      duration,
      barSize,
      'TRADES',
      0,           // include outside RTH
    );

    console.log(`    → ${bars.length} bars received`);

    // Create cache file
    const cache: CacheFile = {
      version: 1,
      symbol,
      conId: Number(conId),
      exchange: exchange || '',
      secType,
      lastTradeDate,
      interval: Number(interval) || 0,
      barSize,
      bars,
    };

    writeCacheFile(cachePath, cache);
    console.log(`    → Cache written: ${cachePath}`);

    res.json({ cachePath, barCount: bars.length });
  } catch (err: unknown) {
    console.error('  /import error:', errMsg(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /sync - Gap-fill from last cached bar to current time
 * Body: { cachePath }
 */
ibRouter.post('/sync', async (req: Request, res: Response) => {
  try {
    if (!connected) return res.status(503).json({ error: 'Not connected to TWS' });

    const { cachePath } = req.body;
    if (!cachePath) return res.status(400).json({ error: 'cachePath is required' });

    const cache = readCacheFile(cachePath);
    if (!cache) return res.status(404).json({ error: `Cache file not found: ${cachePath}` });

    if (cache.bars.length === 0) {
      return res.json({ newBars: 0, totalBars: 0 });
    }

    // Find last bar timestamp
    const lastBarTime = cache.bars[cache.bars.length - 1]!.t;
    const now = Date.now();
    const gapMs = now - lastBarTime;

    // If gap is less than one bar interval, nothing to sync
    const intervalMs = cache.interval > 0 ? cache.interval * 60 * 1000 : 24 * 60 * 60 * 1000;
    if (gapMs < intervalMs) {
      console.log(`  /sync ${cachePath}: no gap to fill (last bar ${Math.round(gapMs / 1000)}s ago)`);
      return res.json({ newBars: 0, totalBars: cache.bars.length });
    }

    // Calculate duration for gap-fill
    const gapDays = Math.ceil(gapMs / (1000 * 60 * 60 * 24));
    let duration: string;
    if (gapDays <= 365) {
      duration = `${gapDays} D`;
    } else {
      const months = Math.ceil(gapDays / 30);
      duration = months <= 12 ? `${months} M` : `${Math.min(Math.ceil(gapDays / 365), 20)} Y`;
    }

    console.log(`  /sync ${cachePath}: gap-fill duration=${duration} from ${new Date(lastBarTime).toISOString()}`);

    // Build contract
    const contract: Contract = { conId: cache.conId };
    if (cache.exchange) contract.exchange = cache.exchange;

    // Fetch historical data from last bar to now
    const newBars = await reqHistoricalDataAsync(
      contract,
      '',          // endDateTime: empty = now
      duration,
      cache.barSize,
      'TRADES',
      0,
    );

    // Merge: only add bars newer than last cached bar
    let addedCount = 0;
    for (const bar of newBars) {
      if (bar.t > lastBarTime) {
        // Also skip duplicates with existing bars
        if (cache.bars.length === 0 || cache.bars[cache.bars.length - 1]!.t !== bar.t) {
          cache.bars.push(bar);
          addedCount++;
        }
      }
    }

    if (addedCount > 0) {
      writeCacheFile(cachePath, cache);
      console.log(`    → Added ${addedCount} bars, total ${cache.bars.length}`);
    } else {
      console.log(`    → No new bars to add`);
    }

    res.json({ newBars: addedCount, totalBars: cache.bars.length });
  } catch (err: unknown) {
    console.error('  /sync error:', errMsg(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cache/list - List available cache files
 */
ibRouter.get('/cache/list', (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
    const results = files.map((filename) => {
      const cache = readCacheFile(filename);
      if (!cache) return null;
      return {
        path: filename,
        symbol: cache.symbol,
        conId: cache.conId,
        exchange: cache.exchange,
        interval: cache.interval,
        barSize: cache.barSize,
        barCount: cache.bars.length,
        lastBarTime: cache.bars.length > 0 ? cache.bars[cache.bars.length - 1]!.t : 0,
      };
    }).filter(Boolean);

    res.json(results);
  } catch (err: unknown) {
    console.error('  Request error:', errMsg(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /cache/load?path=ZSK6_5m.json - Load a cache file
 */
ibRouter.get('/cache/load', (req: Request, res: Response) => {
  const cachePath = req.query.path as string;
  if (!cachePath) return res.status(400).json({ error: 'path is required' });

  const cache = readCacheFile(cachePath);
  if (!cache) return res.status(404).json({ error: `Cache file not found: ${cachePath}` });

  res.json(cache);
});

// ─── Feed Endpoints ───────────────────────────────────────────────

/**
 * POST /feed/start - Start a realtime feed for a cache file
 * Body: { cachePath }
 */
ibRouter.post('/feed/start', (req: Request, res: Response) => {
  if (!connected) return res.status(503).json({ error: 'Not connected to TWS' });

  const { cachePath } = req.body;
  if (!cachePath) return res.status(400).json({ error: 'cachePath is required' });

  const feed = feedManager.startFeed(cachePath);
  if (!feed) return res.status(404).json({ error: `Failed to start feed for ${cachePath}` });

  res.json({ cachePath, conId: feed.conId, exchange: feed.exchange, interval: feed.interval });
});

/**
 * POST /feed/stop - Stop a realtime feed
 * Body: { cachePath }
 */
ibRouter.post('/feed/stop', (req: Request, res: Response) => {
  const { cachePath } = req.body;
  if (!cachePath) return res.status(400).json({ error: 'cachePath is required' });

  feedManager.stopFeed(cachePath);
  res.json({ ok: true });
});

/**
 * GET /feed/stream?cachePath=ZSK6_5m.json - SSE stream for a feed
 */
ibRouter.get('/feed/stream', (req: Request, res: Response) => {
  const cachePath = req.query.cachePath as string;
  if (!cachePath) return res.status(400).json({ error: 'cachePath is required' });

  // Ensure feed is started
  let feed = feedManager.getFeed(cachePath);
  if (!feed) {
    // Auto-start the feed if not running
    feed = feedManager.startFeed(cachePath) ?? undefined;
    if (!feed) {
      return res.status(404).json({ error: `Cannot start feed for ${cachePath}` });
    }
  }

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Add this client to the feed
  feedManager.addClient(cachePath, res);

  // Send connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ cachePath, conId: feed.conId, exchange: feed.exchange })}\n\n`);

  // Heartbeat
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch {}
  }, 15000);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    feedManager.removeClient(cachePath, res);
  });
});

// ─── Legacy SSE Streaming Endpoint (kept for backward compat) ─────

/**
 * GET /stream?conId=...&exchange=...&interval=5&persist=...
 * @deprecated Use /feed/start + /feed/stream instead
 */
ibRouter.get('/stream', (req: Request, res: Response) => {
  if (!connected) {
    return res.status(503).json({ error: 'Not connected to TWS' });
  }

  const conId = Number(req.query.conId);
  const exchange = (req.query.exchange as string) || '';
  const interval = Number(req.query.interval) || 5; // minutes
  const persistPath = req.query.persist as string | undefined;

  if (!conId || isNaN(conId) || conId <= 0) {
    return res.status(400).json({ error: 'conId must be a positive number' });
  }
  if (interval <= 0 || interval > 1440) {
    return res.status(400).json({ error: 'interval must be between 1 and 1440 minutes' });
  }

  const intervalMs = interval * 60 * 1000;
  const reqId = getReqId();

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  function send(event: string, data: object): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  console.log(`  /stream started reqId=${reqId} conId=${conId} exchange=${exchange} interval=${interval}min`);
  send('connected', { conId, exchange, interval });

  // Bar aggregation state
  let currentBar: HistoryBar | null = null;

  const contract: Contract = { conId };
  if (exchange) contract.exchange = exchange;

  // Listen for 5-second real-time bars
  const onRealtimeBar = (
    id: number,
    date: number,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number,
    _WAP: number,
    _count: number,
  ) => {
    if (id !== reqId) return;

    // date is epoch seconds
    const timeMs = date * 1000;
    // Snap to interval boundary
    const barTime = Math.floor(timeMs / intervalMs) * intervalMs;

    if (currentBar === null) {
      // First bar
      currentBar = { t: barTime, o: open, h: high, l: low, c: close, v: volume };
    } else if (barTime !== currentBar.t) {
      // New interval — emit completed bar
      send('bar', currentBar);
      if (persistPath) {
        appendBarToCache(persistPath, currentBar);
      }
      currentBar = { t: barTime, o: open, h: high, l: low, c: close, v: volume };
    } else {
      // Same interval — merge
      currentBar.h = Math.max(currentBar.h, high);
      currentBar.l = Math.min(currentBar.l, low);
      currentBar.c = close;
      currentBar.v += volume;
    }

    // Always emit current bar state as tick
    send('tick', currentBar);
  };

  const onError = (err: Error, code: number, id: number) => {
    if (id === reqId) {
      send('error', { message: `IB Error ${code}: ${err.message}` });
    }
  };

  ib.on(EventName.realtimeBar, onRealtimeBar);
  ib.on(EventName.error, onError);

  // Request 5-second real-time bars
  ib.reqRealTimeBars(reqId, contract, 5, 'TRADES', false);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 15000);

  // Cleanup on client disconnect
  req.on('close', () => {
    console.log(`  /stream closed reqId=${reqId}`);
    clearInterval(heartbeat);
    ib.off(EventName.realtimeBar, onRealtimeBar);
    ib.off(EventName.error, onError);
    ib.cancelRealTimeBars(reqId);
  });
});

// ─── Chart State Snapshot ─────────────────────────────────────────
// Cached latest chart state from agent chat — available to MCP via GET /chart/state
import { getLatestChartState } from './chartState.js';

app.get('/chart/state', (_req: Request, res: Response) => {
  const state = getLatestChartState();
  if (!state) {
    return res.json({
      available: false,
      note: 'No chart state cached yet. Open a chart in UltraChart and interact with the agent chat to populate.',
    });
  }
  res.json({ available: true, state });
});

// ─── Chart File Endpoints (read/write .uchart in public/) ──────────

/** GET /chart/list — list .uchart files in public/ */
app.get('/chart/list', (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(CHARTS_DIR)
      .filter(f => f.endsWith('.uchart'))
      .map(f => {
        const stat = fs.statSync(path.join(CHARTS_DIR, f));
        return { name: f, size: stat.size, modified: stat.mtimeMs };
      })
      .sort((a, b) => b.modified - a.modified);
    res.json(files);
  } catch (err: unknown) {
    console.error('  Request error:', errMsg(err));
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /chart/load?name=X — read a .uchart file from public/ */
app.get('/chart/load', (req: Request, res: Response) => {
  const name = req.query.name as string;
  if (!name) return res.status(400).json({ error: 'name required' });
  const filePath = safePath(CHARTS_DIR, name);
  if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: `Not found: ${name}` });
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Validate content is parseable JSON before sending with JSON content-type
    try { JSON.parse(content); } catch {
      return res.status(500).json({ error: 'Chart file contains invalid JSON' });
    }
    res.type('application/json').send(content);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

/** POST /chart/save — write a .uchart file to public/ */
app.post('/chart/save', (req: Request, res: Response) => {
  const { name, content } = req.body;
  if (!name || !content) {
    return res.status(400).json({ error: 'name and content required' });
  }
  if (!/^[a-zA-Z0-9_.\-]+\.uchart$/.test(name)) {
    return res.status(400).json({ error: 'Invalid filename — must be alphanumeric and end with .uchart' });
  }
  const contentStr = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  if (contentStr.length > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'Chart file exceeds 5MB limit' });
  }
  const filePath = safePath(CHARTS_DIR, name);
  if (!filePath) return res.status(400).json({ error: 'Invalid filename' });
  try {
    fs.writeFileSync(filePath, contentStr, 'utf-8');
    console.log(`  /chart/save → ${name} (${fs.statSync(filePath).size} bytes)`);
    res.json({ ok: true, name });
  } catch (err: unknown) {
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// ─── Exports for Electron embedding ──────────────────────────────

export { app };

export interface StartServerOptions {
  port?: number;
  staticDir?: string;
  chartsDir?: string;
  cacheDir?: string;
}

export function startServer(options?: StartServerOptions): Promise<number> {
  const port = options?.port ?? BRIDGE_PORT;

  // Override directories if provided (Electron mode)
  if (options?.cacheDir) {
    CACHE_DIR = options.cacheDir;
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
  }
  if (options?.chartsDir) {
    CHARTS_DIR = options.chartsDir;
    if (!fs.existsSync(CHARTS_DIR)) {
      fs.mkdirSync(CHARTS_DIR, { recursive: true });
    }
  }

  // Serve static files if directory provided (Electron mode)
  if (options?.staticDir) {
    app.use(express.static(options.staticDir));
    // SPA fallback — serves index.html for any unmatched GET
    app.get('*', (_req, res) => {
      res.sendFile(path.join(options.staticDir!, 'index.html'));
    });
  }

  return new Promise((resolve) => {
    app.listen(port, '127.0.0.1', () => {
      console.log(`✓ Server ready at http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

export { connectToTWS };

// ─── Process Error Handlers ──────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
});

// ─── Standalone Start ────────────────────────────────────────────

async function main() {
  console.log('UltraChart TWS Bridge');
  console.log(`  TWS: ${TWS_HOST}:${TWS_PORT} (clientId ${CLIENT_ID})`);
  console.log(`  Bridge: http://127.0.0.1:${BRIDGE_PORT}`);
  console.log(`  Cache: ${CACHE_DIR}`);
  console.log('');

  await startServer();
  console.log('  Endpoints:');
  console.log('    GET  /status');
  console.log('    GET  /search?symbol=ZS&secType=FUT&exchange=CBOT');
  console.log('    GET  /history?conId=...&duration=2 M&bar=5 mins&rth=0');
  console.log('    GET  /contractDetails?conId=...');
  console.log('    POST /import  { conId, symbol, exchange, interval, barSize, startDate }');
  console.log('    POST /sync    { cachePath }');
  console.log('    GET  /cache/list');
  console.log('    GET  /cache/load?path=...');
  console.log('    POST /feed/start  { cachePath }');
  console.log('    POST /feed/stop   { cachePath }');
  console.log('    GET  /feed/stream?cachePath=...');
  console.log('    GET  /chart/list');
  console.log('    GET  /chart/load?name=...');
  console.log('    POST /chart/save  { name, content }');
  console.log('  Agent:');
  console.log('    POST /agent/chat      { sessionId, message, chartState? }');
  console.log('    GET  /agent/settings');
  console.log('    POST /agent/settings  { provider, apiKey, model, ... }');
  console.log('    GET  /agent/contexts');
  console.log('    POST /agent/contexts  { action, name?, contextId? }');
  console.log('    POST /agent/mode      { observe?, instruct?, anticipate? }');
  console.log('    POST /agent/clear     { sessionId }');
  console.log('');

  // Connect to TWS in background (non-fatal if TWS is down)
  try {
    await connectToTWS();
  } catch (err: unknown) {
    console.warn(`\n⚠ TWS not available: ${errMsg(err)}`);
    console.warn('  Chart file endpoints still active. TWS features will not work.');
    console.warn('  Start TWS and restart the bridge to enable live data.');
  }
}

// Run standalone when executed directly (not imported by Electron)
const isMainModule = process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)).replace(/\\/g, '/') ===
  path.resolve(process.argv[1]).replace(/\\/g, '/');

if (isMainModule) {
  main();
}
