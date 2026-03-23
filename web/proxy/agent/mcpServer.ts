#!/usr/bin/env node
/**
 * MCP Server for UltraChart
 *
 * Exposes UltraChart's memory, context, and chart data tools via MCP protocol.
 * Designed for Claude Desktop / Claude Code integration.
 *
 * Shares the same agent-memory/ files as the built-in agent, so knowledge
 * learned via either interface is available to the other.
 *
 * Usage:  npx tsx agent/mcpServer.ts          (from web/proxy/)
 *   or:   npm run mcp                         (from web/proxy/)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ContextManager } from './memory/ContextManager.js';
import { MemoryManager } from './memory/MemoryManager.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve paths relative to project structure
const MEMORY_DIR = path.resolve(__dirname, '..', '..', 'agent-memory');
const CACHE_DIR = path.resolve(__dirname, '..', 'cache');
const EXPRESS_URL = 'http://127.0.0.1:5050';

// Initialize shared managers (same files as built-in agent)
const contextManager = new ContextManager(MEMORY_DIR);
const memoryManager = new MemoryManager(MEMORY_DIR);

// ── Cache file reading ──────────────────────────────────────────

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
  // Security: only allow simple filenames, no path traversal
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

// ── Indicator helpers (same as ToolRegistry) ────────────────────

function computeSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j]!;
    result.push(Math.round(sum / period * 10000) / 10000);
  }
  return result;
}

function computeEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = data[0]!;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) { result.push(data[0]!); continue; }
    ema = data[i]! * k + ema * (1 - k);
    result.push(Math.round(ema * 10000) / 10000);
  }
  return result;
}

function computeRSI(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length < 2) return result;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period && i < data.length; i++) {
    const change = data[i]! - data[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = 0; i < data.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    if (i === period) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
      continue;
    }
    const change = data[i]! - data[i - 1]!;
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
  }
  return result;
}

// ── Helper: call Express server ─────────────────────────────────

async function fetchExpress(urlPath: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${EXPRESS_URL}${urlPath}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchExpressPost(urlPath: string, body: unknown): Promise<unknown | null> {
  try {
    const res = await fetch(`${EXPRESS_URL}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      try { return JSON.parse(text); } catch { return { error: text || `HTTP ${res.status}` }; }
    }
    return await res.json();
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchExpressDelete(urlPath: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${EXPRESS_URL}${urlPath}`, { method: 'DELETE' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── MCP Server Setup ────────────────────────────────────────────

const server = new Server(
  { name: 'ultrachart', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

// ── Tool definitions ────────────────────────────────────────────

const TOOLS = [
  // Context tools
  {
    name: 'list_contexts',
    description: 'List all learning contexts with their status and active flag.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'create_context',
    description: 'Create a new named learning context for a specific trading technique or research area.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Context name (e.g., "Morning Star Setups")' },
        description: { type: 'string', description: 'Brief description of this context' },
      },
      required: ['name', 'description'],
    },
  },
  {
    name: 'switch_context',
    description: 'Switch to a different learning context by ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contextId: { type: 'string', description: 'Context ID to switch to' },
      },
      required: ['contextId'],
    },
  },
  // Memory tools
  {
    name: 'search_memory',
    description: 'Search memory entries by keyword in the active context and global knowledge.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: { type: 'string', description: 'Keyword to search for' },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'read_memory',
    description: 'Read a specific memory entry by ID and type.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Memory entry ID' },
        type: { type: 'string', description: 'Entry type: trade, strategy, knowledge, observation' },
      },
      required: ['id', 'type'],
    },
  },
  {
    name: 'write_memory',
    description: 'Store a new memory entry in the active context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Entry type: trade, strategy, knowledge, observation' },
        title: { type: 'string', description: 'Short title for the entry' },
        content: { type: 'string', description: 'Full content of the entry' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
      },
      required: ['type', 'title', 'content'],
    },
  },
  {
    name: 'list_memories',
    description: 'List memory entries by type in the active context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Entry type: trade, strategy, knowledge, observation' },
      },
      required: ['type'],
    },
  },
  // Cache / chart data tools
  {
    name: 'list_caches',
    description: 'List available cache files with symbol, bar count, and timeframe info.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'load_cache_bars',
    description: 'Load OHLCV bars from a cache file. Returns the most recent N bars.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filename: { type: 'string', description: 'Cache filename (e.g., "ZSK6_5m.json")' },
        count: { type: 'number', description: 'Number of recent bars to return (default: 100, max: 1000)' },
      },
      required: ['filename'],
    },
  },
  {
    name: 'compute_indicator',
    description: 'Compute a technical indicator (SMA, EMA, RSI) from a cache file\'s bars.',
    inputSchema: {
      type: 'object' as const,
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
  // Live chart state (requires UltraChart running)
  {
    name: 'get_chart_state',
    description: 'Get the current chart state from the running UltraChart app. Returns symbol, bars, drawing objects, planet lines, and view state. Requires UltraChart + proxy server running, and at least one agent chat interaction to populate the snapshot.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // ── IB / TWS tools ──────────────────────────────────────────────
  {
    name: 'ib_status',
    description: 'Check TWS/IB Gateway connection status. Returns connected and authenticated flags.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'ib_search',
    description: 'Search for contracts on IB. Returns matching symbols with conId, exchange, secType.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        symbol: { type: 'string', description: 'Symbol to search (e.g., "ZS", "ES")' },
        secType: { type: 'string', description: 'Security type (e.g., "FUT", "STK"). Default: FUT' },
        exchange: { type: 'string', description: 'Exchange (e.g., "CBOT", "CME"). Optional.' },
        currency: { type: 'string', description: 'Currency (e.g., "USD"). Optional.' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'ib_history',
    description: 'Fetch historical OHLCV bars from IB. Returns bars with timestamp, open, high, low, close, volume.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        conId: { type: 'number', description: 'Contract ID from ib_search' },
        exchange: { type: 'string', description: 'Exchange (required for futures even with conId)' },
        duration: { type: 'string', description: 'Duration string (e.g., "2 M", "1 Y", "5 D"). Default: "2 M"' },
        bar: { type: 'string', description: 'Bar size (e.g., "5 mins", "1 day", "1 hour"). Default: "5 mins"' },
        rth: { type: 'number', description: '1 for regular trading hours only, 0 for all. Default: 0' },
        end: { type: 'string', description: 'End date/time (e.g., "20260322 16:00:00"). Default: now.' },
        show: { type: 'string', description: 'Data type (e.g., "TRADES", "MIDPOINT"). Default: "TRADES"' },
      },
      required: ['conId'],
    },
  },
  {
    name: 'ib_contract_details',
    description: 'Get full contract details from IB for a given conId. Returns expiry, multiplier, trading hours, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        conId: { type: 'number', description: 'Contract ID' },
      },
      required: ['conId'],
    },
  },
  {
    name: 'ib_import',
    description: 'Import historical data from IB and save as a cache file. Creates or appends to a JSON cache in proxy/cache/.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        conId: { type: 'number', description: 'Contract ID' },
        symbol: { type: 'string', description: 'Symbol name (e.g., "ZSK6")' },
        exchange: { type: 'string', description: 'Exchange (e.g., "CBOT")' },
        interval: { type: 'number', description: 'Interval in minutes (e.g., 5 for 5-min bars, 1440 for daily)' },
        barSize: { type: 'string', description: 'IB bar size string (e.g., "5 mins", "1 day")' },
        startDate: { type: 'string', description: 'Start date YYYYMMDD (e.g., "20250101")' },
        secType: { type: 'string', description: 'Security type. Default: "FUT"' },
        lastTradeDate: { type: 'string', description: 'Last trade date for futures (e.g., "20260520")' },
        cachePath: { type: 'string', description: 'Custom cache filename. Auto-generated if omitted.' },
      },
      required: ['conId', 'symbol', 'exchange', 'interval', 'barSize', 'startDate'],
    },
  },
  {
    name: 'ib_sync',
    description: 'Gap-fill a cache file from its last bar to now. Fetches missing bars from IB and appends them.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cachePath: { type: 'string', description: 'Cache filename to sync (e.g., "ZSK6_5m.json")' },
      },
      required: ['cachePath'],
    },
  },

  // ── Feed (real-time streaming) tools ────────────────────────────
  {
    name: 'feed_start',
    description: 'Start real-time streaming for a cache file. Bars will be appended to the cache as they arrive from TWS.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cachePath: { type: 'string', description: 'Cache filename to stream (e.g., "ZSK6_5m.json")' },
      },
      required: ['cachePath'],
    },
  },
  {
    name: 'feed_stop',
    description: 'Stop real-time streaming for a cache file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cachePath: { type: 'string', description: 'Cache filename to stop streaming' },
      },
      required: ['cachePath'],
    },
  },

  // ── Chart file tools ────────────────────────────────────────────
  {
    name: 'chart_list',
    description: 'List saved .uchart chart files with name, size, and modification date.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'chart_load',
    description: 'Load a saved .uchart chart file. Returns the full chart JSON (security, bars, objects, planet lines, view state).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Chart filename (e.g., "ZSK6_5m.uchart")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'chart_save',
    description: 'Save a .uchart chart file. Content is the full chart JSON string.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Chart filename (must end with .uchart)' },
        content: { type: 'string', description: 'Chart JSON content string' },
      },
      required: ['name', 'content'],
    },
  },

  // ── Astro Engine tools ──────────────────────────────────────────
  {
    name: 'astro_status',
    description: 'Get astro engine status: running, training active, profile count, active profiles per symbol.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'astro_start_engine',
    description: 'Start the Python astro engine subprocess. Lazy-starts on first use, but call this to pre-warm.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'astro_stop_engine',
    description: 'Stop the Python astro engine subprocess.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'astro_train',
    description: 'Train an astro profile from a cache file. Computes phase curves for all supported planets (or filtered subset), correlates with price data, and saves a ranked profile. Training takes 30-60 seconds.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cachePath: { type: 'string', description: 'Cache filename (e.g., "ZSK6_5m.json")' },
        symbol: { type: 'string', description: 'Symbol name (e.g., "ZSK6")' },
        interval: { type: 'string', description: 'Interval label (e.g., "5min", "daily"). Auto-detected from cache if omitted.' },
        tag: { type: 'string', description: 'Profile name/tag. Auto-generated if omitted.' },
        curvesFilter: {
          type: 'array', items: { type: 'string' },
          description: 'Curve labels to train on (e.g., ["mercury_latitude_helio", "moon_longitude_geo"]). Trains all if omitted.',
        },
        observer: {
          type: 'array', items: { type: 'number' },
          description: 'Observer location [longitude, latitude, elevation] for topocentric frame. Optional.',
        },
      },
      required: ['cachePath', 'symbol'],
    },
  },
  {
    name: 'astro_score',
    description: 'Score current market conditions using a trained profile. Returns composite direction (-1 to +1), individual curve signals, and timing notes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        profileId: { type: 'string', description: 'Profile ID (filename without .json)' },
        at: { type: 'string', description: 'ISO datetime to score at. Defaults to now.' },
        observer: {
          type: 'array', items: { type: 'number' },
          description: 'Observer location [lon, lat, elev] for topocentric. Optional.',
        },
      },
      required: ['profileId'],
    },
  },
  {
    name: 'astro_phase_curves',
    description: 'Compute raw phase curves (planetary positions over time) for a date range. Returns all 12 Mercury/Moon curves with values, speeds, and turning points.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start: { type: 'string', description: 'Start date ISO (e.g., "2025-01-01")' },
        end: { type: 'string', description: 'End date ISO (e.g., "2026-03-22")' },
        intervalMinutes: { type: 'number', description: 'Interval in minutes (default: 1440 = daily)' },
        observer: {
          type: 'array', items: { type: 'number' },
          description: 'Observer location [lon, lat, elev]. Optional.',
        },
      },
      required: ['start', 'end'],
    },
  },
  {
    name: 'astro_list_profiles',
    description: 'List all trained astro profiles with symbol, interval, best curve, score, and trained date.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'astro_get_profile',
    description: 'Get full details of a trained profile including all ranked curves with correlation metrics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        profileId: { type: 'string', description: 'Profile ID (filename without .json)' },
      },
      required: ['profileId'],
    },
  },
  {
    name: 'astro_delete_profile',
    description: 'Delete a trained profile.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        profileId: { type: 'string', description: 'Profile ID to delete' },
      },
      required: ['profileId'],
    },
  },
  {
    name: 'astro_backtest',
    description: 'Backtest a trained profile against historical data. Walks through each bar, scores with the profile, and measures directional accuracy.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        profileId: { type: 'string', description: 'Profile ID to backtest' },
        cachePath: { type: 'string', description: 'Cache filename with historical bars to test against' },
      },
      required: ['profileId', 'cachePath'],
    },
  },
];

// ── Request handlers ────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args ?? {}) as Record<string, unknown>;

  try {
    const result = await executeTool(name, input);
    return { content: [{ type: 'text' as const, text: result }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ── Tool execution ──────────────────────────────────────────────

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    // ── Context tools ──
    case 'list_contexts': {
      const contexts = contextManager.listContexts();
      const activeId = contextManager.getActiveContextId();
      return JSON.stringify(contexts.map((c) => ({
        id: c.id, name: c.name, description: c.description,
        active: c.id === activeId,
        modes: c.modes,
        hasObservationConfig: !!c.observationConfig,
      })), null, 2);
    }

    case 'create_context': {
      const ctx = contextManager.createContext(input.name as string, input.description as string);
      return `Context "${ctx.name}" created (id: ${ctx.id}). It is now the active context.`;
    }

    case 'switch_context': {
      const ctx = contextManager.switchContext(input.contextId as string);
      return `Switched to context "${ctx.name}".`;
    }

    // ── Memory tools ──
    case 'search_memory': {
      const contextId = contextManager.getActiveContextId() || 'global';
      const results = memoryManager.searchEntries(contextId, input.keyword as string);
      const globalResults = memoryManager.searchGlobal(input.keyword as string);
      return JSON.stringify({
        activeContext: contextId,
        contextResults: results.slice(0, 10).map((e) => ({
          id: e.id, type: e.type, title: e.title, tags: e.tags,
        })),
        globalResults: globalResults.slice(0, 5).map((e) => ({
          id: e.id, type: e.type, title: e.title, tags: e.tags,
        })),
      }, null, 2);
    }

    case 'read_memory': {
      const contextId = contextManager.getActiveContextId() || 'global';
      const entry = memoryManager.readEntry(
        contextId,
        input.type as 'trade' | 'strategy' | 'knowledge' | 'observation',
        input.id as string,
      );
      if (!entry) return 'Entry not found.';
      return JSON.stringify(entry, null, 2);
    }

    case 'write_memory': {
      const contextId = contextManager.getActiveContextId() || 'global';
      const entry = {
        id: MemoryManager.generateId(),
        type: input.type as 'trade' | 'strategy' | 'knowledge' | 'observation',
        title: input.title as string,
        content: input.content as string,
        tags: (input.tags as string[]) || [],
        contextId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      memoryManager.writeEntry(entry);
      return `Memory entry saved: ${entry.title} (${entry.id}) in context "${contextId}"`;
    }

    case 'list_memories': {
      const contextId = contextManager.getActiveContextId() || 'global';
      const entries = memoryManager.listEntries(
        contextId,
        input.type as 'trade' | 'strategy' | 'knowledge' | 'observation',
      );
      return JSON.stringify(entries.slice(0, 20).map((e) => ({
        id: e.id, title: e.title, tags: e.tags, updatedAt: e.updatedAt,
      })), null, 2);
    }

    // ── Cache / chart data tools ──
    case 'list_caches': {
      if (!fs.existsSync(CACHE_DIR)) return '[]';
      const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
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
      return JSON.stringify(results, null, 2);
    }

    case 'load_cache_bars': {
      const cache = readCacheFile(input.filename as string);
      if (!cache) return `Cache file not found: ${input.filename}`;
      const count = Math.min(Number(input.count) || 100, 1000);
      const bars = cache.bars.slice(-count);
      return JSON.stringify({
        symbol: cache.symbol,
        conId: cache.conId,
        exchange: cache.exchange,
        interval: cache.interval,
        barSize: cache.barSize,
        totalBars: cache.bars.length,
        returnedBars: bars.length,
        bars,
      }, null, 2);
    }

    case 'compute_indicator': {
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

      // Return last N values with timestamps
      const startIdx = Math.max(0, result.length - count);
      const output = [];
      for (let i = startIdx; i < result.length; i++) {
        if (!isNaN(result[i]!)) {
          output.push({
            time: new Date(cache.bars[i]!.t).toISOString(),
            value: result[i],
          });
        }
      }

      return JSON.stringify({
        symbol: cache.symbol,
        indicator,
        period,
        source,
        values: output,
      }, null, 2);
    }

    // ── Live chart state ──
    case 'get_chart_state': {
      const data = await fetchExpress('/chart/state');
      if (data === null) {
        return 'UltraChart proxy server is not running on port 5050. Start it to access chart state.';
      }
      return JSON.stringify(data, null, 2);
    }

    // ── IB / TWS tools ──
    case 'ib_status': {
      const data = await fetchExpress('/status');
      if (data === null) return 'Proxy server not running or not reachable on port 5050.';
      return JSON.stringify(data, null, 2);
    }

    case 'ib_search': {
      const params = new URLSearchParams();
      params.set('symbol', input.symbol as string);
      if (input.secType) params.set('secType', input.secType as string);
      if (input.exchange) params.set('exchange', input.exchange as string);
      if (input.currency) params.set('currency', input.currency as string);
      const data = await fetchExpress(`/search?${params}`);
      if (data === null) return 'Failed to search. Is the proxy server running and connected to TWS?';
      return JSON.stringify(data, null, 2);
    }

    case 'ib_history': {
      const params = new URLSearchParams();
      params.set('conId', String(input.conId));
      if (input.exchange) params.set('exchange', input.exchange as string);
      if (input.duration) params.set('duration', input.duration as string);
      if (input.bar) params.set('bar', input.bar as string);
      if (input.rth !== undefined) params.set('rth', String(input.rth));
      if (input.end) params.set('end', input.end as string);
      if (input.show) params.set('show', input.show as string);
      const data = await fetchExpress(`/history?${params}`);
      if (data === null) return 'Failed to fetch history. Is TWS connected?';
      return JSON.stringify(data, null, 2);
    }

    case 'ib_contract_details': {
      const data = await fetchExpress(`/contractDetails?conId=${input.conId}`);
      if (data === null) return 'Failed to get contract details. Is TWS connected?';
      return JSON.stringify(data, null, 2);
    }

    case 'ib_import': {
      const data = await fetchExpressPost('/import', {
        conId: input.conId,
        symbol: input.symbol,
        exchange: input.exchange,
        interval: input.interval,
        barSize: input.barSize,
        startDate: input.startDate,
        secType: input.secType,
        lastTradeDate: input.lastTradeDate,
        cachePath: input.cachePath,
      });
      if (data === null) return 'Failed to import. Is the proxy server running and connected to TWS?';
      return JSON.stringify(data, null, 2);
    }

    case 'ib_sync': {
      const data = await fetchExpressPost('/sync', {
        cachePath: input.cachePath,
      });
      if (data === null) return 'Failed to sync. Is the proxy server running and connected to TWS?';
      return JSON.stringify(data, null, 2);
    }

    // ── Feed tools ──
    case 'feed_start': {
      const data = await fetchExpressPost('/feed/start', {
        cachePath: input.cachePath,
      });
      if (data === null) return 'Failed to start feed. Is the proxy server running and connected to TWS?';
      return JSON.stringify(data, null, 2);
    }

    case 'feed_stop': {
      const data = await fetchExpressPost('/feed/stop', {
        cachePath: input.cachePath,
      });
      if (data === null) return 'Failed to stop feed.';
      return JSON.stringify(data, null, 2);
    }

    // ── Chart file tools ──
    case 'chart_list': {
      const data = await fetchExpress('/chart/list');
      if (data === null) return 'Failed to list charts. Is the proxy server running?';
      return JSON.stringify(data, null, 2);
    }

    case 'chart_load': {
      const data = await fetchExpress(`/chart/load?name=${encodeURIComponent(input.name as string)}`);
      if (data === null) return `Failed to load chart: ${input.name}`;
      return JSON.stringify(data, null, 2);
    }

    case 'chart_save': {
      const data = await fetchExpressPost('/chart/save', {
        name: input.name,
        content: input.content,
      });
      if (data === null) return 'Failed to save chart. Is the proxy server running?';
      return JSON.stringify(data, null, 2);
    }

    // ── Astro Engine tools ──
    case 'astro_status': {
      const data = await fetchExpress('/astro/status');
      if (data === null) return 'Proxy server not running.';
      return JSON.stringify(data, null, 2);
    }

    case 'astro_start_engine': {
      const data = await fetchExpressPost('/astro/start', {});
      if (data === null) return 'Failed to start astro engine. Is the proxy server running?';
      return JSON.stringify(data, null, 2);
    }

    case 'astro_stop_engine': {
      const data = await fetchExpressPost('/astro/stop', {});
      if (data === null) return 'Failed to stop astro engine.';
      return JSON.stringify(data, null, 2);
    }

    case 'astro_train': {
      const data = await fetchExpressPost('/astro/train', {
        cachePath: input.cachePath,
        symbol: input.symbol,
        interval: input.interval,
        tag: input.tag,
        curvesFilter: input.curvesFilter,
        observer: input.observer,
      });
      if (data === null) return 'Failed to train. Is the proxy server running?';
      return JSON.stringify(data, null, 2);
    }

    case 'astro_score': {
      const data = await fetchExpressPost('/astro/score', {
        profileId: input.profileId,
        at: input.at,
        observer: input.observer,
      });
      if (data === null) return 'Failed to score. Is the proxy server running?';
      return JSON.stringify(data, null, 2);
    }

    case 'astro_phase_curves': {
      const data = await fetchExpressPost('/astro/phase-curves', {
        start: input.start,
        end: input.end,
        intervalMinutes: input.intervalMinutes,
        observer: input.observer,
      });
      if (data === null) return 'Failed to get phase curves. Is the proxy server running?';
      return JSON.stringify(data, null, 2);
    }

    case 'astro_list_profiles': {
      const data = await fetchExpress('/astro/profiles');
      if (data === null) return 'Proxy server not running.';
      return JSON.stringify(data, null, 2);
    }

    case 'astro_get_profile': {
      const data = await fetchExpress(`/astro/profiles/${encodeURIComponent(input.profileId as string)}`);
      if (data === null) return `Profile not found: ${input.profileId}`;
      return JSON.stringify(data, null, 2);
    }

    case 'astro_delete_profile': {
      const data = await fetchExpressDelete(`/astro/profiles/${encodeURIComponent(input.profileId as string)}`);
      if (data === null) return `Failed to delete profile: ${input.profileId}`;
      return JSON.stringify(data, null, 2);
    }

    case 'astro_backtest': {
      const data = await fetchExpressPost('/astro/backtest', {
        profileId: input.profileId,
        cachePath: input.cachePath,
      });
      if (data === null) return 'Failed to run backtest. Is the proxy server running?';
      return JSON.stringify(data, null, 2);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Start server ────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr (stdout is used for MCP protocol)
  console.error('UltraChart MCP server started');
  console.error(`  Memory dir: ${MEMORY_DIR}`);
  console.error(`  Cache dir: ${CACHE_DIR}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
