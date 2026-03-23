/**
 * Agent core — ReAct loop with streaming.
 * Receives user message + chart state, runs the LLM with tools,
 * executes tool calls, loops until the LLM returns text, streams to client.
 */
import type { LLMProvider, Message, ContentBlock, ChatEvent } from './providers/LLMProvider.js';
import { ClaudeProvider } from './providers/ClaudeProvider.js';
import { toolRegistry, type ChartState, type ToolContext } from './tools/ToolRegistry.js';
import { ContextManager } from './memory/ContextManager.js';
import { MemoryManager } from './memory/MemoryManager.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { registerAstroTools } from './tools/astroTools.js';
import type { AstroService } from '../services/AstroService.js';
import type { AgentSettings } from './memory/types.js';
import fs from 'fs';
import path from 'path';

const MAX_TOOL_ROUNDS = 10;

/** Events emitted during a chat turn */
export type AgentEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; result: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; message: string };

export class AgentCore {
  private provider: LLMProvider | null = null;
  private conversations = new Map<string, Message[]>();
  private contextManager: ContextManager;
  private memoryManager: MemoryManager;
  private memoryDir: string;
  private sourceDir: string;
  private settingsPath: string;

  constructor(memoryDir: string, sourceDir: string, astroService?: AstroService) {
    this.memoryDir = memoryDir;
    this.sourceDir = sourceDir;
    this.settingsPath = path.join(memoryDir, 'settings.json');
    this.contextManager = new ContextManager(memoryDir);
    this.memoryManager = new MemoryManager(memoryDir);

    // Register memory + context tools
    this.registerMemoryTools();
    this.registerContextTools();

    // Register astro tools if service provided
    if (astroService) {
      registerAstroTools(astroService);
    }
  }

  /** Configure or reconfigure the LLM provider */
  configureProvider(settings: Partial<AgentSettings>): void {
    const saved = this.loadSettings();
    const merged = { ...saved, ...settings };
    this.saveSettings(merged);

    if (merged.provider === 'claude' && merged.apiKey) {
      this.provider = new ClaudeProvider(merged.apiKey, merged.model);
    }
    // OpenAI and Ollama providers will be added in Phase 5
  }

  /** Get current settings */
  getSettings(): AgentSettings {
    return this.loadSettings();
  }

  /** Get context manager for route handlers */
  getContextManager(): ContextManager {
    return this.contextManager;
  }

  /**
   * Run a single chat turn with the ReAct loop.
   * Yields AgentEvents as they occur (text chunks, tool calls, results).
   */
  async *chat(
    sessionId: string,
    userMessage: string,
    chartState: ChartState | null,
  ): AsyncGenerator<AgentEvent> {
    if (!this.provider) {
      yield { type: 'error', message: 'No LLM provider configured. Set your API key in agent settings.' };
      return;
    }

    // Get or create conversation history
    let messages = this.conversations.get(sessionId);
    if (!messages) {
      messages = [];
      this.conversations.set(sessionId, messages);
    }

    // Add user message
    messages.push({ role: 'user', content: userMessage });

    // Build system prompt
    const activeCtx = this.contextManager.getActiveContext();
    const recentMemory = this.getRecentMemorySummary();
    const systemPrompt = buildSystemPrompt(activeCtx, recentMemory, chartState);

    // Tool context
    const toolCtx: ToolContext = {
      chartState,
      memoryDir: this.memoryDir,
      sourceDir: this.sourceDir,
      activeContextId: this.contextManager.getActiveContextId(),
    };

    // ReAct loop
    let totalInput = 0;
    let totalOutput = 0;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const textParts: string[] = [];
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      // Stream from LLM
      for await (const event of this.provider.chat({
        messages,
        tools: toolRegistry.getDefinitions(),
        systemPrompt,
        maxTokens: this.loadSettings().maxTokens,
        temperature: this.loadSettings().temperature,
      })) {
        if (event.type === 'text') {
          textParts.push(event.content);
          yield { type: 'text', content: event.content };
        } else if (event.type === 'tool_use') {
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          yield { type: 'tool_call', name: event.name, input: event.input };
        } else if (event.type === 'done') {
          totalInput += event.usage.inputTokens;
          totalOutput += event.usage.outputTokens;
        } else if (event.type === 'error') {
          yield { type: 'error', message: event.message };
          return;
        }
      }

      // Build assistant message
      const assistantContent: ContentBlock[] = [];
      if (textParts.length > 0) {
        assistantContent.push({ type: 'text', text: textParts.join('') });
      }
      for (const tc of toolCalls) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      messages.push({ role: 'assistant', content: assistantContent });

      // If no tool calls, we're done
      if (toolCalls.length === 0) break;

      // Execute tools and add results
      const toolResults: ContentBlock[] = [];
      for (const tc of toolCalls) {
        const { result, requiresApproval } = await toolRegistry.execute(tc.name, tc.input, toolCtx);
        if (requiresApproval) {
          // For now, just report that approval is needed
          const approvalMsg = `Tool "${tc.name}" requires human approval. This will be implemented in a future phase.`;
          yield { type: 'tool_result', name: tc.name, result: approvalMsg };
          toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: approvalMsg });
        } else {
          yield { type: 'tool_result', name: tc.name, result };
          toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
        }
      }

      // Add tool results as user message (Anthropic format)
      messages.push({ role: 'user', content: toolResults });
    }

    // Trim conversation if it gets too long (keep last 50 messages)
    if (messages.length > 60) {
      const trimmed = messages.slice(-50);
      this.conversations.set(sessionId, trimmed);
    }

    yield { type: 'done', usage: { inputTokens: totalInput, outputTokens: totalOutput } };
  }

  /** Clear a session's conversation history */
  clearSession(sessionId: string): void {
    this.conversations.delete(sessionId);
  }

  // ── Memory tools registration ──

  private registerMemoryTools(): void {
    const mm = this.memoryManager;

    toolRegistry.register({
      definition: {
        name: 'searchMemory',
        description: 'Search memory entries by keyword in the active context.',
        input_schema: {
          type: 'object',
          properties: {
            keyword: { type: 'string', description: 'Keyword to search for' },
          },
          required: ['keyword'],
        },
      },
      requiresApproval: false,
      execute: async (input, ctx) => {
        const contextId = ctx.activeContextId || 'global';
        const results = mm.searchEntries(contextId, input.keyword as string);
        const globalResults = mm.searchGlobal(input.keyword as string);
        return JSON.stringify({
          contextResults: results.slice(0, 10).map((e) => ({ id: e.id, type: e.type, title: e.title, tags: e.tags })),
          globalResults: globalResults.slice(0, 5).map((e) => ({ id: e.id, type: e.type, title: e.title, tags: e.tags })),
        });
      },
    });

    toolRegistry.register({
      definition: {
        name: 'readMemory',
        description: 'Read a specific memory entry by ID.',
        input_schema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Memory entry ID' },
            type: { type: 'string', description: 'Entry type: trade, strategy, knowledge, observation' },
          },
          required: ['id', 'type'],
        },
      },
      requiresApproval: false,
      execute: async (input, ctx) => {
        const contextId = ctx.activeContextId || 'global';
        const entry = mm.readEntry(contextId, input.type as any, input.id as string);
        if (!entry) return 'Entry not found.';
        return JSON.stringify(entry);
      },
    });

    toolRegistry.register({
      definition: {
        name: 'writeMemory',
        description: 'Store a new memory entry in the active context.',
        input_schema: {
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
      requiresApproval: false,
      execute: async (input, ctx) => {
        const contextId = ctx.activeContextId || 'global';
        const entry = {
          id: MemoryManager.generateId(),
          type: input.type as any,
          title: input.title as string,
          content: input.content as string,
          tags: (input.tags as string[]) || [],
          contextId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        mm.writeEntry(entry);
        return `Memory entry saved: ${entry.title} (${entry.id})`;
      },
    });

    toolRegistry.register({
      definition: {
        name: 'listMemories',
        description: 'List memory entries by type in the active context.',
        input_schema: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Entry type: trade, strategy, knowledge, observation' },
          },
          required: ['type'],
        },
      },
      requiresApproval: false,
      execute: async (input, ctx) => {
        const contextId = ctx.activeContextId || 'global';
        const entries = mm.listEntries(contextId, input.type as any);
        return JSON.stringify(entries.slice(0, 20).map((e) => ({
          id: e.id, title: e.title, tags: e.tags, updatedAt: e.updatedAt,
        })));
      },
    });
  }

  // ── Context tools registration ──

  private registerContextTools(): void {
    const cm = this.contextManager;

    toolRegistry.register({
      definition: {
        name: 'createContext',
        description: 'Create a new named learning context for a specific trading technique or research area.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Context name (e.g., "Morning Star Setups")' },
            description: { type: 'string', description: 'Brief description of this context' },
          },
          required: ['name', 'description'],
        },
      },
      requiresApproval: false,
      execute: async (input) => {
        const ctx = cm.createContext(input.name as string, input.description as string);
        return `Context "${ctx.name}" created (id: ${ctx.id}). It is now the active context.`;
      },
    });

    toolRegistry.register({
      definition: {
        name: 'switchContext',
        description: 'Switch to a different learning context.',
        input_schema: {
          type: 'object',
          properties: {
            contextId: { type: 'string', description: 'Context ID to switch to' },
          },
          required: ['contextId'],
        },
      },
      requiresApproval: false,
      execute: async (input) => {
        const ctx = cm.switchContext(input.contextId as string);
        return `Switched to context "${ctx.name}".`;
      },
    });

    toolRegistry.register({
      definition: {
        name: 'listContexts',
        description: 'List all learning contexts with their status.',
        input_schema: { type: 'object', properties: {} },
      },
      requiresApproval: false,
      execute: async () => {
        const contexts = cm.listContexts();
        const active = cm.getActiveContextId();
        return JSON.stringify(contexts.map((c) => ({
          id: c.id, name: c.name, description: c.description,
          active: c.id === active,
          modes: c.modes,
          hasObservationConfig: !!c.observationConfig,
        })));
      },
    });
  }

  // ── Helpers ──

  private getRecentMemorySummary(): string {
    const contextId = this.contextManager.getActiveContextId();
    if (!contextId) return '';
    const strategies = this.memoryManager.listEntries(contextId, 'strategy');
    const knowledge = this.memoryManager.listEntries(contextId, 'knowledge');
    const parts: string[] = [];
    if (strategies.length > 0) {
      parts.push('Recent strategies: ' + strategies.slice(0, 3).map((s) => s.title).join(', '));
    }
    if (knowledge.length > 0) {
      parts.push('Recent knowledge: ' + knowledge.slice(0, 3).map((k) => k.title).join(', '));
    }
    return parts.join('\n');
  }

  private loadSettings(): AgentSettings {
    const defaults = {
      provider: 'claude' as const,
      apiKey: '',
      model: 'claude-sonnet-4-20250514',
      ollamaUrl: 'http://localhost:11434',
      maxTokens: 4096,
      temperature: 0.7,
    };
    if (fs.existsSync(this.settingsPath)) {
      try {
        return { ...defaults, ...JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8')) };
      } catch { /* use defaults */ }
    }
    return defaults;
  }

  private saveSettings(settings: AgentSettings): void {
    const dir = path.dirname(this.settingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
  }
}
