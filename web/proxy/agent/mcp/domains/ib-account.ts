/**
 * IB Account domain — read-only account resources + daily briefing prompt.
 * All account data is exposed as resources (no side effects).
 */
import { fetchExpress, resourceJson } from '../helpers.js';
import type { DomainModule, ToolDef, ResourceDef, ResourceContent, PromptDef, PromptMessage } from '../types.js';

// ── Resources ──────────────────────────────────────────────────

export const resources: ResourceDef[] = [
  {
    uri: 'ultrachart://account/summary',
    name: 'Account Summary',
    description: 'Account summary: net liquidation, buying power, margin, available funds, total cash.',
    mimeType: 'application/json',
  },
  {
    uri: 'ultrachart://account/positions',
    name: 'Positions',
    description: 'All open positions with contract, quantity, average cost, market value, unrealized P&L.',
    mimeType: 'application/json',
  },
  {
    uri: 'ultrachart://account/pnl',
    name: 'Daily P&L',
    description: 'Daily P&L summary: daily, unrealized, and realized P&L.',
    mimeType: 'application/json',
  },
  {
    uri: 'ultrachart://account/managed',
    name: 'Managed Accounts',
    description: 'List of managed account IDs accessible through this TWS session.',
    mimeType: 'application/json',
  },
];

export async function handleResource(uri: string): Promise<ResourceContent[]> {
  switch (uri) {
    case 'ultrachart://account/summary': {
      const data = await fetchExpress('/account/summary');
      return resourceJson(uri, data ?? { error: 'Failed to get account summary. Is TWS connected?' });
    }
    case 'ultrachart://account/positions': {
      const data = await fetchExpress('/account/positions');
      return resourceJson(uri, data ?? { error: 'Failed to get positions.' });
    }
    case 'ultrachart://account/pnl': {
      const data = await fetchExpress('/account/pnl');
      return resourceJson(uri, data ?? { error: 'Failed to get P&L.' });
    }
    case 'ultrachart://account/managed': {
      const data = await fetchExpress('/account/managed');
      return resourceJson(uri, data ?? { error: 'Failed to get managed accounts.' });
    }
    default:
      throw new Error(`Unknown ib-account resource: ${uri}`);
  }
}

// ── Tools (none — account is read-only) ────────────────────────

export const tools: ToolDef[] = [];

export async function handleTool(name: string, _input: Record<string, unknown>): Promise<string> {
  throw new Error(`Unknown ib-account tool: ${name}`);
}

// ── Prompts ────────────────────────────────────────────────────

export const prompts: PromptDef[] = [
  {
    name: 'daily_briefing',
    description: 'Morning briefing: account summary, positions, P&L, active feeds, astro status.',
    arguments: [],
  },
];

export async function handlePrompt(name: string, _args: Record<string, string>): Promise<PromptMessage[]> {
  if (name !== 'daily_briefing') throw new Error(`Unknown ib-account prompt: ${name}`);

  const [account, positions, pnl, astroStatus] = await Promise.all([
    fetchExpress('/account/summary'),
    fetchExpress('/account/positions'),
    fetchExpress('/account/pnl'),
    fetchExpress('/astro/status'),
  ]);

  let text = '# Daily Briefing\n\nGive me a concise morning briefing based on this data.\n\n';
  if (account) text += `## Account Summary\n\`\`\`json\n${JSON.stringify(account, null, 2).slice(0, 1500)}\n\`\`\`\n\n`;
  if (positions) text += `## Positions\n\`\`\`json\n${JSON.stringify(positions, null, 2).slice(0, 2000)}\n\`\`\`\n\n`;
  if (pnl) text += `## P&L\n\`\`\`json\n${JSON.stringify(pnl, null, 2).slice(0, 500)}\n\`\`\`\n\n`;
  if (astroStatus) text += `## Astro Engine\n\`\`\`json\n${JSON.stringify(astroStatus, null, 2).slice(0, 500)}\n\`\`\`\n\n`;
  text += 'Summarize:\n1. Account health (margin usage, buying power)\n2. Position status (winners/losers, size)\n3. Key items needing attention today\n4. Any astro signals active';

  return [{ role: 'user', content: { type: 'text', text } }];
}

export default { tools, resources, prompts, handleTool, handleResource, handlePrompt } satisfies DomainModule;
