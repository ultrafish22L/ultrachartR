/**
 * Abstract LLM provider interface.
 * Same interface for Claude, OpenAI, and Ollama.
 */

/** Tool definition for LLM function calling */
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** A single message in the conversation */
export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

/** Parameters for a chat request */
export interface ChatParams {
  messages: Message[];
  tools?: ToolDefinition[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Events streamed from the LLM */
export type ChatEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; message: string };

/** Abstract LLM provider — implement for each backend */
export interface LLMProvider {
  name: string;
  chat(params: ChatParams): AsyncGenerator<ChatEvent>;
}
