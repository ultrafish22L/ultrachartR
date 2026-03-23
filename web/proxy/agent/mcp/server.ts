#!/usr/bin/env node
/**
 * UltraChart MCP Server v2.0
 *
 * Domain-driven architecture with all 3 MCP primitives:
 *   - Tools:     model-driven actions (trade, train, import, scan)
 *   - Resources: read-only context via URI (positions, cache, profiles)
 *   - Prompts:   user-invoked workflow templates (trade setup, analysis, astro sweep)
 *
 * Shares agent-memory/ files with the built-in agent chat.
 *
 * Usage:  npx tsx agent/mcp/server.ts     (from web/proxy/)
 *   or:   npm run mcp                     (from web/proxy/)
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { DomainModule } from './types.js';

// ── Domain imports ─────────────────────────────────────────────
import * as memory from './domains/memory.js';
import * as cache from './domains/cache.js';
import * as chart from './domains/chart.js';
import * as feed from './domains/feed.js';
import * as ibMarket from './domains/ib-market.js';
import * as ibTrading from './domains/ib-trading.js';
import * as ibAccount from './domains/ib-account.js';
import * as ibScanner from './domains/ib-scanner.js';
import * as ibOptions from './domains/ib-options.js';
import * as astro from './domains/astro.js';

// ── Aggregate all domains ──────────────────────────────────────

const domains: DomainModule[] = [
  memory, cache, chart, feed,
  ibMarket, ibTrading, ibAccount, ibScanner, ibOptions,
  astro,
];

const allTools = domains.flatMap(d => d.tools);
const allResources = domains.flatMap(d => d.resources ?? []);
const allResourceTemplates = domains.flatMap(d => d.resourceTemplates ?? []);
const allPrompts = domains.flatMap(d => d.prompts ?? []);

// Build lookup maps for routing
const toolToDomain = new Map<string, DomainModule>();
for (const d of domains) {
  for (const t of d.tools) toolToDomain.set(t.name, d);
}

const promptToDomain = new Map<string, DomainModule>();
for (const d of domains) {
  for (const p of (d.prompts ?? [])) promptToDomain.set(p.name, d);
}

// ── MCP Server Setup ───────────────────────────────────────────

const server = new Server(
  { name: 'ultrachart', version: '2.0.0' },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  },
);

// ── Tool handlers ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const input = (args ?? {}) as Record<string, unknown>;
  const domain = toolToDomain.get(name);

  if (!domain) {
    return {
      content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }

  try {
    const result = await domain.handleTool(name, input);
    return { content: [{ type: 'text' as const, text: result }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text' as const, text: `Error: ${msg}` }],
      isError: true,
    };
  }
});

// ── Resource handlers ──────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: allResources,
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: allResourceTemplates,
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  // Try each domain that has a resource handler
  for (const d of domains) {
    if (!d.handleResource) continue;
    // Check if this domain owns the URI (static or template match)
    const ownsStatic = (d.resources ?? []).some(r => r.uri === uri);
    const ownsTemplate = (d.resourceTemplates ?? []).some(rt => {
      // Simple template matching: convert {param} to regex
      const pattern = rt.uriTemplate.replace(/\{[^}]+\}/g, '[^/]+');
      return new RegExp(`^${pattern}$`).test(uri);
    });

    if (ownsStatic || ownsTemplate) {
      try {
        const contents = await d.handleResource(uri);
        return { contents };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          contents: [{ uri, mimeType: 'text/plain', text: `Error: ${msg}` }],
        };
      }
    }
  }

  return {
    contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource: ${uri}` }],
  };
});

// ── Prompt handlers ────────────────────────────────────────────

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: allPrompts,
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const domain = promptToDomain.get(name);

  if (!domain || !domain.handlePrompt) {
    throw new Error(`Unknown prompt: ${name}`);
  }

  const messages = await domain.handlePrompt(name, (args ?? {}) as Record<string, string>);
  return { messages };
});

// ── Start server ───────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('UltraChart MCP server v2.0 started');
  console.error(`  Tools: ${allTools.length}`);
  console.error(`  Resources: ${allResources.length} + ${allResourceTemplates.length} templates`);
  console.error(`  Prompts: ${allPrompts.length}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
