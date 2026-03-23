/**
 * Memory manager — read/write/search memory files scoped to a context.
 */
import fs from 'fs';
import path from 'path';
import type { MemoryEntry } from './types.js';

export class MemoryManager {
  private memoryDir: string;

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
  }

  /** Write a memory entry */
  writeEntry(entry: MemoryEntry): string {
    const dir = this.getTypeDir(entry.contextId, entry.type);
    this.ensureDir(dir);
    const filename = `${entry.id}.json`;
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(entry, null, 2));
    return filepath;
  }

  /** Read a memory entry by ID from a context */
  readEntry(contextId: string, type: MemoryEntry['type'], id: string): MemoryEntry | null {
    const filepath = path.join(this.getTypeDir(contextId, type), `${id}.json`);
    if (!fs.existsSync(filepath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /** List entries by type in a context */
  listEntries(contextId: string, type: MemoryEntry['type']): MemoryEntry[] {
    const dir = this.getTypeDir(contextId, type);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const entries: MemoryEntry[] = [];
    for (const f of files) {
      try {
        entries.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')));
      } catch { /* skip corrupt entries */ }
    }
    return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Search entries by keyword across a context */
  searchEntries(contextId: string, keyword: string): MemoryEntry[] {
    const kw = keyword.toLowerCase();
    const results: MemoryEntry[] = [];
    for (const type of ['trade', 'strategy', 'knowledge', 'observation'] as const) {
      const entries = this.listEntries(contextId, type);
      for (const entry of entries) {
        if (
          entry.title.toLowerCase().includes(kw) ||
          entry.content.toLowerCase().includes(kw) ||
          entry.tags.some((t) => t.toLowerCase().includes(kw))
        ) {
          results.push(entry);
        }
      }
    }
    return results;
  }

  /** Search across global knowledge */
  searchGlobal(keyword: string): MemoryEntry[] {
    return this.searchEntries('global', keyword);
  }

  /** Generate a unique ID */
  static generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── Private helpers ──

  private getTypeDir(contextId: string, type: MemoryEntry['type']): string {
    if (contextId === 'global') {
      return path.join(this.memoryDir, 'global', `${type}s`);
    }
    return path.join(this.memoryDir, 'contexts', contextId, `${type}s`);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
