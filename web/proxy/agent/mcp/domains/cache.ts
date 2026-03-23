/**
 * Cache domain — cache file browsing (resources) + indicator computation (tool).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeSMA, computeEMA, computeRSI } from './indicators.js';
import { resourceJson } from '../helpers.js';
import type { DomainModule, ToolDef, ResourceDef, ResourceTemplateDef, ResourceContent } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.resolve(__dirname, '..', '..', '..', 'cache');

interface CacheFile {
  version: number;
  symbol: string;
  conId: number;
  exchange: string;
  secType: string;
  lastTradeDate: string;
  interval: number;
  barSize: string;
  bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
}

function readCacheFile(filename: string): CacheFile | null {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) return null;
  const filepath = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    if (!parsed || !Array.isArray(parsed.bars) || typeof parsed.symbol !== 'string') return null;
    return parsed as CacheFile;
  } catch {
    return null;
  }
}

// ── Resources ──────────────────────────────────────────────────

export const resources: ResourceDef[] = [
  {
    uri: 'ultrachart://cache',
    name: 'Cache Files',
    description: 'List all cached market data files with symbol, bar count, and timeframe info.',
    mimeType: 'application/json',
  },
];

export const resourceTemplates: ResourceTemplateDef[] = [
  {
    uriTemplate: 'ultrachart://cache/{filename}',
    name: 'Cache File Bars',
    description: 'Load OHLCV bars from a specific cache file. Returns most recent 200 bars.',
    mimeType: 'application/json',
  },
];

export async function handleResource(uri: string): Promise<ResourceContent[]> {
  if (uri === 'ultrachart://cache') {
    if (!fs.existsSync(CACHE_DIR)) return resourceJson(uri, []);
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    const results = [];
    for (const filename of files) {
      const cache = readCacheFile(filename);
      if (!cache) continue;
      results.push({
        filename,
        symbol: cache.symbol,
        conId: cache.conId,
        exchange: cache.exchange,
        interval: cache.interval,
        barSize: cache.barSize,
        barCount: cache.bars.length,
        firstBar: cache.bars.length > 0 ? new Date(cache.bars[0]!.t).toISOString() : null,
        lastBar: cache.bars.length > 0 ? new Date(cache.bars[cache.bars.length - 1]!.t).toISOString() : null,
      });
    }
    return resourceJson(uri, results);
  }

  // ultrachart://cache/{filename}
  const match = uri.match(/^ultrachart:\/\/cache\/(.+)$/);
  if (match) {
    const filename = decodeURIComponent(match[1]);
    const cache = readCacheFile(filename);
    if (!cache) return resourceJson(uri, { error: `Cache file not found: ${filename}` });
    const bars = cache.bars.slice(-200);
    return resourceJson(uri, {
      symbol: cache.symbol, conId: cache.conId, exchange: cache.exchange,
      interval: cache.interval, barSize: cache.barSize,
      totalBars: cache.bars.length, returnedBars: bars.length, bars,
    });
  }

  throw new Error(`Unknown cache resource: ${uri}`);
}

// ── Tools ──────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  {
    name: 'compute_indicator',
    description: 'Compute a technical indicator (SMA, EMA, RSI) from a cache file\'s bars.',
    inputSchema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Cache filename (e.g., "ZSK6_5m.json")' },
        indicator: { type: 'string', description: 'Indicator type: sma, ema, rsi' },
        period: { type: 'number', description: 'Lookback period (default: 14)' },
        source: { type: 'string', description: 'Price source: close, open, high, low (default: close)' },
        count: { type: 'number', description: 'Number of recent values to return (default: 50)' },
      },
      required: ['filename', 'indicator'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name !== 'compute_indicator') throw new Error(`Unknown cache tool: ${name}`);

  const cache = readCacheFile(input.filename as string);
  if (!cache) return `Cache file not found: ${input.filename}`;
  if (cache.bars.length === 0) return 'No bars available.';

  const period = Number(input.period) || 14;
  const source = (input.source as string) || 'close';
  const count = Math.min(Number(input.count) || 50, 500);

  const values = cache.bars.map((b) => {
    if (source === 'open') return b.o;
    if (source === 'high') return b.h;
    if (source === 'low') return b.l;
    return b.c;
  });

  const indicator = input.indicator as string;
  let result: number[];
  if (indicator === 'sma') result = computeSMA(values, period);
  else if (indicator === 'ema') result = computeEMA(values, period);
  else if (indicator === 'rsi') result = computeRSI(values, period);
  else return `Unknown indicator: ${indicator}. Supported: sma, ema, rsi`;

  const startIdx = Math.max(0, result.length - count);
  const output = [];
  for (let i = startIdx; i < result.length; i++) {
    if (!isNaN(result[i]!)) {
      output.push({ time: new Date(cache.bars[i]!.t).toISOString(), value: result[i] });
    }
  }

  return JSON.stringify({ symbol: cache.symbol, indicator, period, source, values: output }, null, 2);
}

export default { tools, resources, resourceTemplates, handleTool, handleResource } satisfies DomainModule;
