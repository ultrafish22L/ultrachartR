/**
 * Chart domain — chart file management (save tool) + chart state/files (resources) + analysis prompts.
 */
import { fetchExpress, fetchExpressPost, jsonResult, resourceJson } from '../helpers.js';
import type { DomainModule, ToolDef, ResourceDef, ResourceTemplateDef, ResourceContent, PromptDef, PromptMessage } from '../types.js';

// ── Resources ──────────────────────────────────────────────────

export const resources: ResourceDef[] = [
  {
    uri: 'ultrachart://charts',
    name: 'Chart Files',
    description: 'List saved .uchart chart files with name, size, and modification date.',
    mimeType: 'application/json',
  },
  {
    uri: 'ultrachart://chart/state',
    name: 'Live Chart State',
    description: 'Current chart state from the running UltraChart app: symbol, bars, planet lines, drawing objects, view state. Requires UltraChart + proxy running.',
    mimeType: 'application/json',
  },
];

export const resourceTemplates: ResourceTemplateDef[] = [
  {
    uriTemplate: 'ultrachart://chart/{name}',
    name: 'Chart File',
    description: 'Load a saved .uchart file with full chart JSON (security, bars, objects, planet lines, view state).',
    mimeType: 'application/json',
  },
];

export async function handleResource(uri: string): Promise<ResourceContent[]> {
  if (uri === 'ultrachart://charts') {
    const data = await fetchExpress('/chart/list');
    return resourceJson(uri, data ?? { error: 'Proxy server not running.' });
  }

  if (uri === 'ultrachart://chart/state') {
    const data = await fetchExpress('/chart/state');
    return resourceJson(uri, data ?? { error: 'UltraChart proxy not running on port 5050.' });
  }

  // ultrachart://chart/{name}
  const match = uri.match(/^ultrachart:\/\/chart\/(?!state$)(.+)$/);
  if (match) {
    const name = decodeURIComponent(match[1]);
    const data = await fetchExpress(`/chart/load?name=${encodeURIComponent(name)}`);
    return resourceJson(uri, data ?? { error: `Failed to load chart: ${name}` });
  }

  throw new Error(`Unknown chart resource: ${uri}`);
}

// ── Tools ──────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  {
    name: 'chart_save',
    description: 'Save a .uchart chart file. Content is the full chart JSON string.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Chart filename (must end with .uchart)' },
        content: { type: 'string', description: 'Chart JSON content string' },
      },
      required: ['name', 'content'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (name !== 'chart_save') throw new Error(`Unknown chart tool: ${name}`);
  const data = await fetchExpressPost('/chart/save', { name: input.name, content: input.content });
  return jsonResult(data, 'Failed to save chart. Is the proxy server running?');
}

// ── Prompts ────────────────────────────────────────────────────

export const prompts: PromptDef[] = [
  {
    name: 'analyze_chart',
    description: 'Analyze a cached chart with indicators and planet lines. Loads bars, computes SMA/EMA/RSI, includes chart state if available.',
    arguments: [
      { name: 'cachePath', description: 'Cache filename to analyze (e.g., "ZSK6_5m.json")', required: true },
    ],
  },
  {
    name: 'compare_setups',
    description: 'Compare two cached datasets side by side with indicators.',
    arguments: [
      { name: 'cachePathA', description: 'First cache filename', required: true },
      { name: 'cachePathB', description: 'Second cache filename', required: true },
    ],
  },
];

export async function handlePrompt(name: string, args: Record<string, string>): Promise<PromptMessage[]> {
  if (name === 'analyze_chart') {
    const cachePath = args.cachePath;
    const chartState = await fetchExpress('/chart/state');
    const cacheList = await fetchExpress(`/cache/load?cachePath=${encodeURIComponent(cachePath)}`);

    let context = `Analyze the chart for cache file: ${cachePath}\n\n`;
    if (chartState) {
      context += `## Live Chart State\n\`\`\`json\n${JSON.stringify(chartState, null, 2).slice(0, 2000)}\n\`\`\`\n\n`;
    }
    if (cacheList) {
      context += `## Recent Bars\n\`\`\`json\n${JSON.stringify(cacheList, null, 2).slice(0, 3000)}\n\`\`\`\n\n`;
    }
    context += 'What patterns do you see? Consider price action, volume, any planet line correlations, and suggest potential trade setups.';

    return [{ role: 'user', content: { type: 'text', text: context } }];
  }

  if (name === 'compare_setups') {
    const context = `Compare these two market data setups side by side:\n\n- Setup A: ${args.cachePathA}\n- Setup B: ${args.cachePathB}\n\nLoad both cache files, compute SMA(20), EMA(50), RSI(14) on each. Compare trend, momentum, and relative strength. Which setup looks more favorable and why?`;
    return [{ role: 'user', content: { type: 'text', text: context } }];
  }

  throw new Error(`Unknown chart prompt: ${name}`);
}

export default { tools, resources, resourceTemplates, prompts, handleTool, handleResource, handlePrompt } satisfies DomainModule;
