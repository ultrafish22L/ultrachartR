/**
 * Tool registry — schema definitions + executor dispatch.
 * Tools are organized by category. The agent core calls executeTool() with the
 * tool name and input, and gets back a string result.
 */
import type { ToolDefinition } from '../providers/LLMProvider.js';

/** A registered tool implementation */
export interface ToolImpl {
  definition: ToolDefinition;
  /** Whether this tool requires human approval before executing */
  requiresApproval: boolean;
  /** Execute the tool and return a string result */
  execute: (input: Record<string, unknown>, context: ToolContext) => Promise<string>;
}

/** Context passed to tool execution — includes chart state, memory refs, etc. */
export interface ToolContext {
  /** Chart state sent from the browser with the request */
  chartState: ChartState | null;
  /** Base directory for memory files */
  memoryDir: string;
  /** Base directory for source code */
  sourceDir: string;
  /** Active context ID */
  activeContextId: string | null;
}

/** Chart state snapshot sent from the browser */
export interface ChartState {
  symbol: string;
  name: string;
  conId: number;
  exchange: string;
  period: string;
  interval: number;
  barCount: number;
  /** Last N bars (configurable, default 100) */
  recentBars: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  /** Drawing objects on the chart */
  objects: unknown[];
  /** Planet lines on the chart */
  planetLines: unknown[];
  /** View state */
  viewState: {
    scrollOffset: number;
    pixelsPerBar: number;
    priceMin: number;
    priceMax: number;
  };
}

class ToolRegistryImpl {
  private tools = new Map<string, ToolImpl>();

  register(tool: ToolImpl): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): ToolImpl | undefined {
    return this.tools.get(name);
  }

  /** Get all tool definitions for the LLM */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /** Execute a tool by name */
  async execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<{ result: string; requiresApproval: boolean }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { result: `Error: Unknown tool "${name}"`, requiresApproval: false };
    }
    if (tool.requiresApproval) {
      return { result: `APPROVAL_REQUIRED: Tool "${name}" requires human approval.`, requiresApproval: true };
    }
    try {
      const result = await tool.execute(input, context);
      return { result, requiresApproval: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { result: `Error executing "${name}": ${msg}`, requiresApproval: false };
    }
  }
}

export const toolRegistry = new ToolRegistryImpl();

// ── Register built-in chart read tools ──

toolRegistry.register({
  definition: {
    name: 'getChartBars',
    description: 'Get recent OHLCV bars from the active chart. Returns the most recent bars currently visible.',
    input_schema: {
      type: 'object',
      properties: {
        count: { type: 'number', description: 'Number of recent bars to return (default: 50, max: 500)' },
      },
    },
  },
  requiresApproval: false,
  execute: async (input, ctx) => {
    if (!ctx.chartState) return 'No chart is currently active.';
    const count = Math.min(Number(input.count) || 50, 500);
    const bars = ctx.chartState.recentBars.slice(-count);
    return JSON.stringify({
      symbol: ctx.chartState.symbol,
      period: ctx.chartState.period,
      interval: ctx.chartState.interval,
      barCount: ctx.chartState.barCount,
      bars,
    });
  },
});

toolRegistry.register({
  definition: {
    name: 'getChartConfig',
    description: 'Get the active chart configuration including symbol, timeframe, and security info.',
    input_schema: { type: 'object', properties: {} },
  },
  requiresApproval: false,
  execute: async (_input, ctx) => {
    if (!ctx.chartState) return 'No chart is currently active.';
    return JSON.stringify({
      symbol: ctx.chartState.symbol,
      name: ctx.chartState.name,
      conId: ctx.chartState.conId,
      exchange: ctx.chartState.exchange,
      period: ctx.chartState.period,
      interval: ctx.chartState.interval,
      barCount: ctx.chartState.barCount,
      viewState: ctx.chartState.viewState,
    });
  },
});

toolRegistry.register({
  definition: {
    name: 'getDrawingObjects',
    description: 'List all drawing objects currently on the chart (lines, rectangles, text, etc.).',
    input_schema: { type: 'object', properties: {} },
  },
  requiresApproval: false,
  execute: async (_input, ctx) => {
    if (!ctx.chartState) return 'No chart is currently active.';
    return JSON.stringify(ctx.chartState.objects);
  },
});

toolRegistry.register({
  definition: {
    name: 'getPlanetLines',
    description: 'List all planet lines on the chart.',
    input_schema: { type: 'object', properties: {} },
  },
  requiresApproval: false,
  execute: async (_input, ctx) => {
    if (!ctx.chartState) return 'No chart is currently active.';
    return JSON.stringify(ctx.chartState.planetLines);
  },
});

toolRegistry.register({
  definition: {
    name: 'getIndicator',
    description: 'Compute a technical indicator from the chart bars. Supported: sma, ema, rsi.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'Indicator type: sma, ema, rsi' },
        period: { type: 'number', description: 'Lookback period (default 14)' },
        source: { type: 'string', description: 'Price source: close, open, high, low (default: close)' },
      },
      required: ['type'],
    },
  },
  requiresApproval: false,
  execute: async (input, ctx) => {
    if (!ctx.chartState) return 'No chart is currently active.';
    const bars = ctx.chartState.recentBars;
    if (bars.length === 0) return 'No bars available.';

    const period = Number(input.period) || 14;
    const source = (input.source as string) || 'close';
    const values = bars.map((b) => {
      if (source === 'open') return b.open;
      if (source === 'high') return b.high;
      if (source === 'low') return b.low;
      return b.close;
    });

    const type = input.type as string;
    if (type === 'sma') {
      const result = computeSMA(values, period);
      return JSON.stringify({ type: 'sma', period, values: result.slice(-50) });
    }
    if (type === 'ema') {
      const result = computeEMA(values, period);
      return JSON.stringify({ type: 'ema', period, values: result.slice(-50) });
    }
    if (type === 'rsi') {
      const result = computeRSI(values, period);
      return JSON.stringify({ type: 'rsi', period, values: result.slice(-50) });
    }
    return `Unknown indicator type: ${type}`;
  },
});

// ── Indicator helpers ──

function computeSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j]!;
    result.push(Math.round(sum / period * 10000) / 10000);
  }
  return result;
}

function computeEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = data[0]!;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) { result.push(data[0]!); continue; }
    ema = data[i]! * k + ema * (1 - k);
    result.push(Math.round(ema * 10000) / 10000);
  }
  return result;
}

function computeRSI(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length < 2) return result;
  let avgGain = 0;
  let avgLoss = 0;
  // Initial average
  for (let i = 1; i <= period && i < data.length; i++) {
    const change = data[i]! - data[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = 0; i < data.length; i++) {
    if (i < period) { result.push(NaN); continue; }
    if (i === period) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
      continue;
    }
    const change = data[i]! - data[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(Math.round((100 - 100 / (1 + rs)) * 100) / 100);
  }
  return result;
}
