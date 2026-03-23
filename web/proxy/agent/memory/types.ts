/**
 * Type definitions for the agent memory and context system.
 */

/** A named learning context (e.g., "morning-star-setups", "seasonal-spreads") */
export interface AgentContext {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  /** What to observe in this context (configured by human) */
  observationConfig: ObservationConfig | null;
  /** Mode toggles */
  modes: {
    observe: boolean;
    instruct: boolean;
    anticipate: boolean;
  };
}

/** Observation configuration — defined during config phase with human */
export interface ObservationConfig {
  /** What actions to track (e.g., drawing objects, price levels, timeframe switches) */
  trackActions: string[];
  /** What conditions matter (e.g., RSI levels, planet positions, time of day) */
  trackConditions: string[];
  /** Free-form notes from the config conversation */
  notes: string;
  configuredAt: string;
}

/** A memory entry (trade, strategy, knowledge, observation) */
export interface MemoryEntry {
  id: string;
  type: 'trade' | 'strategy' | 'knowledge' | 'observation';
  title: string;
  content: string;
  tags: string[];
  contextId: string;
  createdAt: string;
  updatedAt: string;
}

/** Index file for quick lookup across memory entries */
export interface MemoryIndex {
  version: number;
  contexts: AgentContext[];
  activeContextId: string | null;
  entries: Array<{
    id: string;
    type: MemoryEntry['type'];
    title: string;
    tags: string[];
    contextId: string;
    filePath: string;
  }>;
}

/** Agent settings (persisted) */
export interface AgentSettings {
  provider: 'claude' | 'openai' | 'ollama';
  apiKey: string;
  model: string;
  ollamaUrl: string;
  maxTokens: number;
  temperature: number;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  provider: 'claude',
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  ollamaUrl: 'http://localhost:11434',
  maxTokens: 4096,
  temperature: 0.7,
};
