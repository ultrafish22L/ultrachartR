/**
 * Shared types for MCP domain modules.
 *
 * Each domain exports tools[], resources[], prompts[], and handler functions.
 * The server aggregates them and routes requests to the right domain.
 */

// ── Tool types (matches @modelcontextprotocol/sdk) ─────────────

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ── Resource types ─────────────────────────────────────────────

export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceTemplateDef {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

// ── Prompt types ───────────────────────────────────────────────

export interface PromptArgDef {
  name: string;
  description: string;
  required?: boolean;
}

export interface PromptDef {
  name: string;
  description: string;
  arguments?: PromptArgDef[];
}

export interface PromptMessage {
  role: 'user' | 'assistant';
  content: {
    type: 'text';
    text: string;
  };
}

// ── Domain module interface ────────────────────────────────────

export interface DomainModule {
  tools: ToolDef[];
  resources?: ResourceDef[];
  resourceTemplates?: ResourceTemplateDef[];
  prompts?: PromptDef[];

  handleTool(name: string, input: Record<string, unknown>): Promise<string>;
  handleResource?(uri: string): Promise<ResourceContent[]>;
  handlePrompt?(name: string, args: Record<string, string>): Promise<PromptMessage[]>;
}
