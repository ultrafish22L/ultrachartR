/**
 * Astro Engine agent chat tools.
 *
 * These tools are registered in the ToolRegistry so the built-in agent chat
 * can control the training module. They call AstroService directly (in-process).
 *
 * The key tool is `trainFromCurrentChart` — it reads the chart state
 * (security + planet lines) passed with every agent chat message and
 * uses it to train a profile. The chart IS the setup definition.
 */

import { toolRegistry } from './ToolRegistry.js';
import type { AstroService } from '../../services/AstroService.js';
import { mapPlanetLineToLabel } from '../../services/AstroService.js';

export function registerAstroTools(astro: AstroService): void {

  toolRegistry.register({
    definition: {
      name: 'trainFromCurrentChart',
      description: 'Train an astro profile using the current chart\'s security (bars) and planet lines as the setup definition. The chart tells the engine what market to analyze and which planetary curves to correlate with. This is the primary way to create training datasets.',
      input_schema: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Profile name/tag. Auto-generated from setup if omitted.' },
        },
      },
    },
    requiresApproval: false,
    execute: async (input, ctx) => {
      if (!ctx.chartState) return 'No chart is currently active. Open a chart first.';
      if (!ctx.chartState.recentBars || ctx.chartState.recentBars.length === 0) {
        return 'Chart has no bars loaded.';
      }

      try {
        const result = await astro.trainFromChart(
          ctx.chartState as any,
          input.tag as string | undefined,
        );
        return JSON.stringify({
          profileId: result.profileId,
          symbol: result.market_symbol,
          interval: result.market_interval,
          bestCurve: result.best_curve,
          bestScore: result.best_score,
          curvesRanked: result.curves.length,
          trainedAt: result.trained_at,
        }, null, 2);
      } catch (err: unknown) {
        return `Training failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  toolRegistry.register({
    definition: {
      name: 'trainFromCache',
      description: 'Train an astro profile from a specific cache file with optional curve filter.',
      input_schema: {
        type: 'object',
        properties: {
          cachePath: { type: 'string', description: 'Cache filename (e.g., "ZSK6_5m.json")' },
          symbol: { type: 'string', description: 'Symbol name' },
          interval: { type: 'string', description: 'Interval label. Auto-detected if omitted.' },
          tag: { type: 'string', description: 'Profile name/tag.' },
          curvesFilter: {
            type: 'array', items: { type: 'string' },
            description: 'Curve labels to train on. Trains all if omitted.',
          },
        },
        required: ['cachePath', 'symbol'],
      },
    },
    requiresApproval: false,
    execute: async (input) => {
      try {
        const result = await astro.train(
          input.cachePath as string,
          input.symbol as string,
          input.interval as string | undefined,
          undefined,
          input.tag as string | undefined,
          input.curvesFilter as string[] | undefined,
        );
        return JSON.stringify({
          profileId: result.profileId,
          symbol: result.market_symbol,
          interval: result.market_interval,
          bestCurve: result.best_curve,
          bestScore: result.best_score,
          curvesRanked: result.curves.length,
        }, null, 2);
      } catch (err: unknown) {
        return `Training failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  toolRegistry.register({
    definition: {
      name: 'getAstroStatus',
      description: 'Check astro engine status: running, training active, profile count, active profiles.',
      input_schema: { type: 'object', properties: {} },
    },
    requiresApproval: false,
    execute: async () => JSON.stringify(astro.getStatus(), null, 2),
  });

  toolRegistry.register({
    definition: {
      name: 'scoreProfile',
      description: 'Score current market conditions using a trained profile. Returns composite direction and timing notes.',
      input_schema: {
        type: 'object',
        properties: {
          profileId: { type: 'string', description: 'Profile ID. Uses active profile for current symbol if omitted.' },
          at: { type: 'string', description: 'ISO datetime to score at. Defaults to now.' },
        },
      },
    },
    requiresApproval: false,
    execute: async (input, ctx) => {
      let profileId = input.profileId as string | undefined;

      // If no profileId, try active profile for current chart symbol
      if (!profileId && ctx.chartState) {
        profileId = astro.getActiveProfile(ctx.chartState.symbol) || undefined;
      }
      if (!profileId) return 'No profile specified and no active profile for this symbol.';

      try {
        const atDate = input.at ? new Date(input.at as string) : undefined;
        const result = await astro.score(profileId, atDate);
        return JSON.stringify(result, null, 2);
      } catch (err: unknown) {
        return `Scoring failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  toolRegistry.register({
    definition: {
      name: 'listProfiles',
      description: 'List all trained astro profiles with summary info.',
      input_schema: { type: 'object', properties: {} },
    },
    requiresApproval: false,
    execute: async () => {
      const profiles = astro.listProfiles();
      if (profiles.length === 0) return 'No trained profiles yet.';
      return JSON.stringify(profiles, null, 2);
    },
  });

  toolRegistry.register({
    definition: {
      name: 'getProfile',
      description: 'Get full details of a trained profile including all ranked curves.',
      input_schema: {
        type: 'object',
        properties: {
          profileId: { type: 'string', description: 'Profile ID' },
        },
        required: ['profileId'],
      },
    },
    requiresApproval: false,
    execute: async (input) => {
      const profile = astro.getProfile(input.profileId as string);
      if (!profile) return `Profile not found: ${input.profileId}`;
      return JSON.stringify(profile, null, 2);
    },
  });

  toolRegistry.register({
    definition: {
      name: 'deleteProfile',
      description: 'Delete a trained astro profile.',
      input_schema: {
        type: 'object',
        properties: {
          profileId: { type: 'string', description: 'Profile ID to delete' },
        },
        required: ['profileId'],
      },
    },
    requiresApproval: false,
    execute: async (input) => {
      const deleted = astro.deleteProfile(input.profileId as string);
      return deleted ? `Profile "${input.profileId}" deleted.` : `Profile not found: ${input.profileId}`;
    },
  });

  toolRegistry.register({
    definition: {
      name: 'activateProfile',
      description: 'Set a trained profile as active for its symbol. Active profiles are used for live scoring.',
      input_schema: {
        type: 'object',
        properties: {
          profileId: { type: 'string', description: 'Profile ID to activate' },
        },
        required: ['profileId'],
      },
    },
    requiresApproval: false,
    execute: async (input) => {
      try {
        const result = astro.activateProfile(input.profileId as string);
        return `Profile "${input.profileId}" activated for ${result.symbol}.`;
      } catch (err: unknown) {
        return `Activation failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  toolRegistry.register({
    definition: {
      name: 'backtestProfile',
      description: 'Run a backtest of a trained profile against historical data. Returns directional accuracy and per-curve signal accuracy.',
      input_schema: {
        type: 'object',
        properties: {
          profileId: { type: 'string', description: 'Profile ID to backtest' },
          cachePath: { type: 'string', description: 'Cache filename with historical bars' },
        },
        required: ['profileId', 'cachePath'],
      },
    },
    requiresApproval: false,
    execute: async (input) => {
      try {
        const result = await astro.backtest(
          input.profileId as string,
          input.cachePath as string,
        );
        return JSON.stringify(result, null, 2);
      } catch (err: unknown) {
        return `Backtest failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });
}
