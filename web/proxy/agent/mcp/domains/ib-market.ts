/**
 * IB Market Data domain — contract search, historical data, import, sync + status/contract resources.
 */
import { fetchExpress, fetchExpressPost, jsonResult, resourceJson } from '../helpers.js';
import type { DomainModule, ToolDef, ResourceDef, ResourceTemplateDef, ResourceContent } from '../types.js';

// ── Resources ──────────────────────────────────────────────────

export const resources: ResourceDef[] = [
  {
    uri: 'ultrachart://status',
    name: 'TWS Status',
    description: 'Interactive Brokers TWS/IB Gateway connection status.',
    mimeType: 'application/json',
  },
];

export const resourceTemplates: ResourceTemplateDef[] = [
  {
    uriTemplate: 'ultrachart://contract/{conId}',
    name: 'Contract Details',
    description: 'Full contract details from IB for a given conId: expiry, multiplier, trading hours, etc.',
    mimeType: 'application/json',
  },
];

export async function handleResource(uri: string): Promise<ResourceContent[]> {
  if (uri === 'ultrachart://status') {
    const data = await fetchExpress('/status');
    return resourceJson(uri, data ?? { error: 'Proxy server not running on port 5050.' });
  }

  const match = uri.match(/^ultrachart:\/\/contract\/(\d+)$/);
  if (match) {
    const conId = match[1];
    const data = await fetchExpress(`/contractDetails?conId=${conId}`);
    return resourceJson(uri, data ?? { error: `Failed to get contract details for conId ${conId}.` });
  }

  throw new Error(`Unknown ib-market resource: ${uri}`);
}

// ── Tools ──────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  {
    name: 'ib_search',
    description: 'Search for contracts on IB. Returns matching symbols with conId, exchange, secType.',
    inputSchema: {
      type: 'object',
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
      type: 'object',
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
    name: 'ib_import',
    description: 'Import historical data from IB and save as a cache file. Creates or appends to a JSON cache in proxy/cache/.',
    inputSchema: {
      type: 'object',
      properties: {
        conId: { type: 'number', description: 'Contract ID' },
        symbol: { type: 'string', description: 'Symbol name (e.g., "ZSK6")' },
        exchange: { type: 'string', description: 'Exchange (e.g., "CBOT")' },
        interval: { type: 'number', description: 'Interval in minutes (e.g., 5, 1440 for daily)' },
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
      type: 'object',
      properties: {
        cachePath: { type: 'string', description: 'Cache filename to sync (e.g., "ZSK6_5m.json")' },
      },
      required: ['cachePath'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'ib_search': {
      const params = new URLSearchParams();
      params.set('symbol', input.symbol as string);
      if (input.secType) params.set('secType', input.secType as string);
      if (input.exchange) params.set('exchange', input.exchange as string);
      if (input.currency) params.set('currency', input.currency as string);
      const data = await fetchExpress(`/search?${params}`);
      return jsonResult(data, 'Failed to search. Is the proxy server running and connected to TWS?');
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
      return jsonResult(data, 'Failed to fetch history. Is TWS connected?');
    }

    case 'ib_import': {
      const data = await fetchExpressPost('/import', {
        conId: input.conId, symbol: input.symbol, exchange: input.exchange,
        interval: input.interval, barSize: input.barSize, startDate: input.startDate,
        secType: input.secType, lastTradeDate: input.lastTradeDate, cachePath: input.cachePath,
      });
      return jsonResult(data, 'Failed to import. Is the proxy server running and connected to TWS?');
    }

    case 'ib_sync': {
      const data = await fetchExpressPost('/sync', { cachePath: input.cachePath });
      return jsonResult(data, 'Failed to sync. Is the proxy server running and connected to TWS?');
    }

    default:
      throw new Error(`Unknown ib-market tool: ${name}`);
  }
}

export default { tools, resources, resourceTemplates, handleTool, handleResource } satisfies DomainModule;
