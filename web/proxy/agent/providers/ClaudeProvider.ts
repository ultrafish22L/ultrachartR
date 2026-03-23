/**
 * Claude (Anthropic) LLM provider.
 * Uses the Messages API with streaming and tool use.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, ChatParams, ChatEvent, Message, ContentBlock } from './LLMProvider.js';

export class ClaudeProvider implements LLMProvider {
  name = 'claude';
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async *chat(params: ChatParams): AsyncGenerator<ChatEvent> {
    const messages = params.messages.map((m) => this.toAnthropicMessage(m));

    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: params.maxTokens ?? 4096,
        temperature: params.temperature ?? 0.7,
        system: params.systemPrompt ?? '',
        messages,
        tools: params.tools?.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
      });

      let currentToolId = '';
      let currentToolName = '';
      let toolInputJson = '';
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of stream) {
        if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens;
        }

        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolId = block.id;
            currentToolName = block.name;
            toolInputJson = '';
          }
        }

        if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta') {
            yield { type: 'text', content: delta.text };
          } else if (delta.type === 'input_json_delta') {
            toolInputJson += delta.partial_json;
          }
        }

        if (event.type === 'content_block_stop') {
          if (currentToolId && currentToolName) {
            let input: Record<string, unknown> = {};
            try {
              input = toolInputJson ? JSON.parse(toolInputJson) : {};
            } catch {
              input = { _raw: toolInputJson };
            }
            yield { type: 'tool_use', id: currentToolId, name: currentToolName, input };
            currentToolId = '';
            currentToolName = '';
            toolInputJson = '';
          }
        }

        if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens;
        }
      }

      yield { type: 'done', usage: { inputTokens, outputTokens } };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'error', message: msg };
    }
  }

  private toAnthropicMessage(msg: Message): Anthropic.MessageParam {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    // Convert ContentBlock[] to Anthropic format
    const blocks: Anthropic.ContentBlockParam[] = (msg.content as ContentBlock[]).map((b) => {
      if (b.type === 'text') return { type: 'text' as const, text: b.text };
      if (b.type === 'tool_use') {
        return {
          type: 'tool_use' as const,
          id: b.id,
          name: b.name,
          input: b.input,
        };
      }
      if (b.type === 'tool_result') {
        return {
          type: 'tool_result' as const,
          tool_use_id: b.tool_use_id,
          content: b.content,
          is_error: b.is_error,
        };
      }
      return { type: 'text' as const, text: '' };
    });

    return { role: msg.role, content: blocks };
  }
}
