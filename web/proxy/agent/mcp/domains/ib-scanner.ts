/**
 * IB Scanner domain — market scanning tools + scanner params resource + scan prompt.
 */
import { fetchExpress, fetchExpressPost, jsonResult, resourceJson } from '../helpers.js';
import type { DomainModule, ToolDef, ResourceDef, ResourceContent, PromptDef, PromptMessage } from '../types.js';

// ── Resources ──────────────────────────────────────────────────

export const resources: ResourceDef[] = [
  {
    uri: 'ultrachart://scanner/params',
    name: 'Scanner Parameters',
    description: 'Available scan codes, instruments, and locations for IB market scanners.',
    mimeType: 'application/json',
  },
];

export async function handleResource(uri: string): Promise<ResourceContent[]> {
  if (uri === 'ultrachart://scanner/params') {
    const data = await fetchExpress('/scanner/params');
    return resourceJson(uri, data ?? { error: 'Failed to get scanner parameters. Is TWS connected?' });
  }
  throw new Error(`Unknown ib-scanner resource: ${uri}`);
}

// ── Tools ──────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  {
    name: 'ib_scan',
    description: 'Run a market scan on IB. Returns up to 50 matching instruments ranked by the scan criteria. Common scan codes: TOP_PERC_GAIN, TOP_PERC_LOSE, MOST_ACTIVE, HOT_BY_VOLUME, HIGH_OPT_IMP_VOLAT, TOP_TRADE_COUNT.',
    inputSchema: {
      type: 'object',
      properties: {
        scanCode: { type: 'string', description: 'Scan code (e.g., "MOST_ACTIVE", "TOP_PERC_GAIN")' },
        instrument: { type: 'string', description: 'Instrument type (e.g., "STK", "FUT.US"). Default: "STK"' },
        locationCode: { type: 'string', description: 'Location (e.g., "STK.US.MAJOR", "FUT.US"). Default: "STK.US.MAJOR"' },
        numberOfRows: { type: 'number', description: 'Max results (1-50). Default: 20' },
        abovePrice: { type: 'number', description: 'Minimum price filter' },
        belowPrice: { type: 'number', description: 'Maximum price filter' },
        aboveVolume: { type: 'number', description: 'Minimum volume filter' },
        marketCapAbove: { type: 'number', description: 'Minimum market cap' },
        marketCapBelow: { type: 'number', description: 'Maximum market cap' },
      },
      required: ['scanCode'],
    },
  },
  {
    name: 'ib_cancel_scan',
    description: 'Cancel an active scanner subscription.',
    inputSchema: {
      type: 'object',
      properties: {
        reqId: { type: 'number', description: 'Request ID of the scanner subscription to cancel' },
      },
      required: ['reqId'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'ib_scan': {
      const data = await fetchExpressPost('/scanner/scan', {
        scanCode: input.scanCode,
        instrument: input.instrument || 'STK',
        locationCode: input.locationCode || 'STK.US.MAJOR',
        numberOfRows: input.numberOfRows || 20,
        abovePrice: input.abovePrice,
        belowPrice: input.belowPrice,
        aboveVolume: input.aboveVolume,
        marketCapAbove: input.marketCapAbove,
        marketCapBelow: input.marketCapBelow,
      });
      return jsonResult(data, 'Failed to run scan. Is TWS connected?');
    }
    case 'ib_cancel_scan': {
      const data = await fetchExpressPost('/scanner/cancel', { reqId: input.reqId });
      return jsonResult(data, 'Failed to cancel scan.');
    }
    default:
      throw new Error(`Unknown ib-scanner tool: ${name}`);
  }
}

// ── Prompts ────────────────────────────────────────────────────

export const prompts: PromptDef[] = [
  {
    name: 'scan_and_analyze',
    description: 'Run a market scan and analyze the top results. Identifies interesting candidates for further research or trading.',
    arguments: [
      { name: 'scanCode', description: 'Scan code to run (e.g., "MOST_ACTIVE", "TOP_PERC_GAIN")', required: true },
      { name: 'instrument', description: 'Instrument type (e.g., "FUT.US"). Default: "STK"', required: false },
    ],
  },
];

export async function handlePrompt(name: string, args: Record<string, string>): Promise<PromptMessage[]> {
  if (name !== 'scan_and_analyze') throw new Error(`Unknown ib-scanner prompt: ${name}`);

  const text = `Run a market scan for: ${args.scanCode}${args.instrument ? ` (instrument: ${args.instrument})` : ''}\n\nAfter getting results, analyze the top 10:\n1. Look for any patterns or themes (sector concentration, price levels)\n2. Flag any that have unusual volume or price action\n3. Identify which ones might be worth pulling up in UltraChart for further analysis\n4. If any are futures I trade, note them specifically\n\nUse ib_scan to run the scan, then present the results with your analysis.`;

  return [{ role: 'user', content: { type: 'text', text } }];
}

export default { tools, resources, prompts, handleTool, handleResource, handlePrompt } satisfies DomainModule;
