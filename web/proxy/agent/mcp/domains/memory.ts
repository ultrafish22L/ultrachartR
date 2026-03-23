/**
 * Memory & Context domain — tools for agent memory CRUD and context switching.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { ContextManager } from '../../memory/ContextManager.js';
import { MemoryManager } from '../../memory/MemoryManager.js';
import type { DomainModule, ToolDef } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'agent-memory');

const contextManager = new ContextManager(MEMORY_DIR);
const memoryManager = new MemoryManager(MEMORY_DIR);

export const tools: ToolDef[] = [
  {
    name: 'list_contexts',
    description: 'List all learning contexts with their status and active flag.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_context',
    description: 'Create a new named learning context for a specific trading technique or research area.',
    inputSchema: {
      type: 'object',
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
      type: 'object',
      properties: {
        contextId: { type: 'string', description: 'Context ID to switch to' },
      },
      required: ['contextId'],
    },
  },
  {
    name: 'search_memory',
    description: 'Search memory entries by keyword in the active context and global knowledge.',
    inputSchema: {
      type: 'object',
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
      type: 'object',
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
      type: 'object',
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
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Entry type: trade, strategy, knowledge, observation' },
      },
      required: ['type'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
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

    default:
      throw new Error(`Unknown memory tool: ${name}`);
  }
}

export default { tools, handleTool } satisfies DomainModule;
