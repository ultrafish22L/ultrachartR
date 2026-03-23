/**
 * Feed domain — real-time streaming control tools.
 */
import { fetchExpressPost, jsonResult } from '../helpers.js';
import type { DomainModule, ToolDef } from '../types.js';

export const tools: ToolDef[] = [
  {
    name: 'feed_start',
    description: 'Start real-time streaming for a cache file. Bars will be appended to the cache as they arrive from TWS.',
    inputSchema: {
      type: 'object',
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
      type: 'object',
      properties: {
        cachePath: { type: 'string', description: 'Cache filename to stop streaming' },
      },
      required: ['cachePath'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'feed_start': {
      const data = await fetchExpressPost('/feed/start', { cachePath: input.cachePath });
      return jsonResult(data, 'Failed to start feed. Is the proxy server running and connected to TWS?');
    }
    case 'feed_stop': {
      const data = await fetchExpressPost('/feed/stop', { cachePath: input.cachePath });
      return jsonResult(data, 'Failed to stop feed.');
    }
    default:
      throw new Error(`Unknown feed tool: ${name}`);
  }
}

export default { tools, handleTool } satisfies DomainModule;
