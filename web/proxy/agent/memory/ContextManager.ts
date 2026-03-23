/**
 * Context manager — create/switch/list named learning contexts.
 * Each context has its own observations, strategies, and knowledge files.
 */
import fs from 'fs';
import path from 'path';
import type { AgentContext, MemoryIndex } from './types.js';

const INDEX_VERSION = 1;

export class ContextManager {
  private memoryDir: string;
  private indexPath: string;
  private index: MemoryIndex;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.indexPath = path.join(memoryDir, 'index.json');
    this.ensureDir(memoryDir);
    this.index = this.loadIndex();
  }

  /** Get all contexts */
  listContexts(): AgentContext[] {
    return this.index.contexts;
  }

  /** Get the active context */
  getActiveContext(): AgentContext | null {
    if (!this.index.activeContextId) return null;
    return this.index.contexts.find((c) => c.id === this.index.activeContextId) ?? null;
  }

  /** Get active context ID */
  getActiveContextId(): string | null {
    return this.index.activeContextId;
  }

  /** Create a new context */
  createContext(name: string, description: string): AgentContext {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Check for duplicates
    if (this.index.contexts.some((c) => c.id === id)) {
      throw new Error(`Context "${id}" already exists`);
    }

    const ctx: AgentContext = {
      id,
      name,
      description,
      createdAt: new Date().toISOString(),
      observationConfig: null,
      modes: { observe: false, instruct: false, anticipate: false },
    };

    // Create directories
    const ctxDir = path.join(this.memoryDir, 'contexts', id);
    this.ensureDir(path.join(ctxDir, 'observations'));
    this.ensureDir(path.join(ctxDir, 'strategies'));
    this.ensureDir(path.join(ctxDir, 'knowledge'));

    // Write config
    fs.writeFileSync(path.join(ctxDir, 'config.json'), JSON.stringify(ctx, null, 2));

    // Update index
    this.index.contexts.push(ctx);
    if (!this.index.activeContextId) {
      this.index.activeContextId = id;
    }
    this.saveIndex();

    return ctx;
  }

  /** Switch active context */
  switchContext(contextId: string): AgentContext {
    const ctx = this.index.contexts.find((c) => c.id === contextId);
    if (!ctx) throw new Error(`Context "${contextId}" not found`);
    this.index.activeContextId = contextId;
    this.saveIndex();
    return ctx;
  }

  /** Update context modes */
  updateModes(contextId: string, modes: Partial<AgentContext['modes']>): AgentContext {
    const ctx = this.index.contexts.find((c) => c.id === contextId);
    if (!ctx) throw new Error(`Context "${contextId}" not found`);
    Object.assign(ctx.modes, modes);
    this.saveContextConfig(ctx);
    this.saveIndex();
    return ctx;
  }

  /** Update observation config */
  updateObservationConfig(contextId: string, config: AgentContext['observationConfig']): void {
    const ctx = this.index.contexts.find((c) => c.id === contextId);
    if (!ctx) throw new Error(`Context "${contextId}" not found`);
    ctx.observationConfig = config;
    this.saveContextConfig(ctx);
    this.saveIndex();
  }

  /** Get the directory path for a context */
  getContextDir(contextId: string): string {
    return path.join(this.memoryDir, 'contexts', contextId);
  }

  // ── Private helpers ──

  private loadIndex(): MemoryIndex {
    if (fs.existsSync(this.indexPath)) {
      try {
        const raw = fs.readFileSync(this.indexPath, 'utf-8');
        return JSON.parse(raw);
      } catch {
        // Corrupted index — start fresh
      }
    }
    return { version: INDEX_VERSION, contexts: [], activeContextId: null, entries: [] };
  }

  private saveIndex(): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  private saveContextConfig(ctx: AgentContext): void {
    const ctxDir = path.join(this.memoryDir, 'contexts', ctx.id);
    this.ensureDir(ctxDir);
    fs.writeFileSync(path.join(ctxDir, 'config.json'), JSON.stringify(ctx, null, 2));
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
