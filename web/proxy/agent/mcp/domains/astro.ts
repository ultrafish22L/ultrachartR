/**
 * Astro Engine domain — training, scoring, backtesting tools + profile resources + workflow prompts.
 */
import { fetchExpress, fetchExpressPost, fetchExpressDelete, jsonResult, resourceJson } from '../helpers.js';
import type { DomainModule, ToolDef, ResourceDef, ResourceTemplateDef, ResourceContent, PromptDef, PromptMessage } from '../types.js';

// ── Resources ──────────────────────────────────────────────────

export const resources: ResourceDef[] = [
  {
    uri: 'ultrachart://astro/status',
    name: 'Astro Engine Status',
    description: 'Astro engine status: running, training active, profile count, active profiles per symbol.',
    mimeType: 'application/json',
  },
  {
    uri: 'ultrachart://astro/profiles',
    name: 'Astro Profiles',
    description: 'List all trained astro profiles with symbol, interval, best curve, score, and trained date.',
    mimeType: 'application/json',
  },
];

export const resourceTemplates: ResourceTemplateDef[] = [
  {
    uriTemplate: 'ultrachart://astro/profiles/{id}',
    name: 'Astro Profile Detail',
    description: 'Full details of a trained profile including all ranked curves with correlation metrics.',
    mimeType: 'application/json',
  },
];

export async function handleResource(uri: string): Promise<ResourceContent[]> {
  if (uri === 'ultrachart://astro/status') {
    const data = await fetchExpress('/astro/status');
    return resourceJson(uri, data ?? { error: 'Proxy server not running.' });
  }

  if (uri === 'ultrachart://astro/profiles') {
    const data = await fetchExpress('/astro/profiles');
    return resourceJson(uri, data ?? { error: 'Proxy server not running.' });
  }

  const match = uri.match(/^ultrachart:\/\/astro\/profiles\/(.+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const data = await fetchExpress(`/astro/profiles/${encodeURIComponent(id)}`);
    return resourceJson(uri, data ?? { error: `Profile not found: ${id}` });
  }

  throw new Error(`Unknown astro resource: ${uri}`);
}

// ── Tools ──────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  {
    name: 'astro_start_engine',
    description: 'Start the Python astro engine subprocess. Lazy-starts on first use, but call this to pre-warm.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'astro_stop_engine',
    description: 'Stop the Python astro engine subprocess.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'astro_train',
    description: 'Train an astro profile from a cache file. Computes phase curves, correlates with price data, and saves a ranked profile. Training takes 30-60 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        cachePath: { type: 'string', description: 'Cache filename (e.g., "ZSK6_5m.json")' },
        symbol: { type: 'string', description: 'Symbol name (e.g., "ZSK6")' },
        interval: { type: 'string', description: 'Interval label (e.g., "5min", "daily"). Auto-detected if omitted.' },
        tag: { type: 'string', description: 'Profile name/tag. Auto-generated if omitted.' },
        curvesFilter: {
          type: 'array', items: { type: 'string' },
          description: 'Curve labels to train on (e.g., ["mercury_latitude_helio"]). Trains all if omitted.',
        },
        observer: {
          type: 'array', items: { type: 'number' },
          description: 'Observer location [longitude, latitude, elevation] for topocentric. Optional.',
        },
      },
      required: ['cachePath', 'symbol'],
    },
  },
  {
    name: 'astro_score',
    description: 'Score current market conditions using a trained profile. Returns composite direction (-1 to +1), individual curve signals, and timing notes.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string', description: 'Profile ID (filename without .json)' },
        at: { type: 'string', description: 'ISO datetime to score at. Defaults to now.' },
        observer: {
          type: 'array', items: { type: 'number' },
          description: 'Observer location [lon, lat, elev]. Optional.',
        },
      },
      required: ['profileId'],
    },
  },
  {
    name: 'astro_phase_curves',
    description: 'Compute raw phase curves (planetary positions over time) for a date range. Returns Mercury/Moon curves with values, speeds, and turning points.',
    inputSchema: {
      type: 'object',
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
    name: 'astro_backtest',
    description: 'Backtest a trained profile against historical data. Walks each bar, scores with the profile, and measures directional accuracy.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string', description: 'Profile ID to backtest' },
        cachePath: { type: 'string', description: 'Cache filename with historical bars to test against' },
      },
      required: ['profileId', 'cachePath'],
    },
  },
  {
    name: 'astro_delete_profile',
    description: 'Delete a trained profile.',
    inputSchema: {
      type: 'object',
      properties: {
        profileId: { type: 'string', description: 'Profile ID to delete' },
      },
      required: ['profileId'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'astro_start_engine': {
      const data = await fetchExpressPost('/astro/start', {});
      return jsonResult(data, 'Failed to start astro engine. Is the proxy server running?');
    }
    case 'astro_stop_engine': {
      const data = await fetchExpressPost('/astro/stop', {});
      return jsonResult(data, 'Failed to stop astro engine.');
    }
    case 'astro_train': {
      const data = await fetchExpressPost('/astro/train', {
        cachePath: input.cachePath, symbol: input.symbol, interval: input.interval,
        tag: input.tag, curvesFilter: input.curvesFilter, observer: input.observer,
      });
      return jsonResult(data, 'Failed to train. Is the proxy server running?');
    }
    case 'astro_score': {
      const data = await fetchExpressPost('/astro/score', {
        profileId: input.profileId, at: input.at, observer: input.observer,
      });
      return jsonResult(data, 'Failed to score. Is the proxy server running?');
    }
    case 'astro_phase_curves': {
      const data = await fetchExpressPost('/astro/phase-curves', {
        start: input.start, end: input.end,
        intervalMinutes: input.intervalMinutes, observer: input.observer,
      });
      return jsonResult(data, 'Failed to get phase curves. Is the proxy server running?');
    }
    case 'astro_backtest': {
      const data = await fetchExpressPost('/astro/backtest', {
        profileId: input.profileId, cachePath: input.cachePath,
      });
      return jsonResult(data, 'Failed to run backtest. Is the proxy server running?');
    }
    case 'astro_delete_profile': {
      const data = await fetchExpressDelete(`/astro/profiles/${encodeURIComponent(input.profileId as string)}`);
      return jsonResult(data, `Failed to delete profile: ${input.profileId}`);
    }
    default:
      throw new Error(`Unknown astro tool: ${name}`);
  }
}

// ── Prompts ────────────────────────────────────────────────────

export const prompts: PromptDef[] = [
  {
    name: 'train_setup',
    description: 'Train an astro profile using the current chart setup. Loads chart state to extract planet line curves, then trains on the specified cache.',
    arguments: [
      { name: 'cachePath', description: 'Cache filename to train on', required: true },
      { name: 'tag', description: 'Profile name/tag (auto-generated if omitted)', required: false },
    ],
  },
  {
    name: 'backtest_compare',
    description: 'Backtest two astro profiles against the same data and compare results.',
    arguments: [
      { name: 'profileIdA', description: 'First profile ID', required: true },
      { name: 'profileIdB', description: 'Second profile ID', required: true },
      { name: 'cachePath', description: 'Cache filename to backtest against', required: true },
    ],
  },
  {
    name: 'astro_sweep',
    description: 'Try every planet line combination on a cache file. Train each, backtest, rank by directional accuracy.',
    arguments: [
      { name: 'cachePath', description: 'Cache filename to sweep', required: true },
    ],
  },
];

export async function handlePrompt(name: string, args: Record<string, string>): Promise<PromptMessage[]> {
  if (name === 'train_setup') {
    const chartState = await fetchExpress('/chart/state');
    let planetLineInfo = 'No chart state available — planet lines could not be extracted.';
    if (chartState && typeof chartState === 'object' && 'planetLines' in (chartState as Record<string, unknown>)) {
      const lines = (chartState as Record<string, unknown>).planetLines;
      planetLineInfo = `Planet lines from current chart:\n\`\`\`json\n${JSON.stringify(lines, null, 2)}\n\`\`\``;
    }

    const text = `Train an astro profile on cache file: ${args.cachePath}${args.tag ? ` (tag: ${args.tag})` : ''}\n\n${planetLineInfo}\n\nExtract the planet, coordinate, and perspective from each planet line to build a curves filter. Then call astro_train with the appropriate curvesFilter parameter. Report the results including best curve, composite score, and curve rankings.`;
    return [{ role: 'user', content: { type: 'text', text } }];
  }

  if (name === 'backtest_compare') {
    const text = `Backtest these two astro profiles against ${args.cachePath} and compare:\n\n- Profile A: ${args.profileIdA}\n- Profile B: ${args.profileIdB}\n\nRun astro_backtest on each, then present a comparison table with directional accuracy, composite agreement, and signal counts. Recommend which profile to activate.`;
    return [{ role: 'user', content: { type: 'text', text } }];
  }

  if (name === 'astro_sweep') {
    const text = `Run a comprehensive astro sweep on: ${args.cachePath}\n\nFor each supported planet line combination (Mercury longitude/latitude × helio/geo, Moon longitude/latitude × helio/geo):\n1. Train a profile with that single curve\n2. Backtest it against the same cache\n3. Record directional accuracy\n\nThen present a ranked summary table of all combinations. Identify the top 3 performers and suggest whether any multi-curve combination might outperform the individual curves.`;
    return [{ role: 'user', content: { type: 'text', text } }];
  }

  throw new Error(`Unknown astro prompt: ${name}`);
}

export default { tools, resources, resourceTemplates, prompts, handleTool, handleResource, handlePrompt } satisfies DomainModule;
