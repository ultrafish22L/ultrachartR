/**
 * IB Options domain — option chain lookup and pricing tools.
 */
import { fetchExpress, fetchExpressPost, jsonResult } from '../helpers.js';
import type { DomainModule, ToolDef } from '../types.js';

export const tools: ToolDef[] = [
  {
    name: 'ib_option_chains',
    description: 'Get option chain parameters for an underlying: available strikes and expirations per exchange.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Underlying symbol (e.g., "ZS", "SPY")' },
        conId: { type: 'number', description: 'Underlying contract ID' },
        secType: { type: 'string', description: 'Security type of underlying (e.g., "FUT", "STK"). Default: "STK"' },
      },
      required: ['symbol', 'conId'],
    },
  },
  {
    name: 'ib_calc_option_price',
    description: 'Calculate theoretical option price and greeks given volatility and underlying price.',
    inputSchema: {
      type: 'object',
      properties: {
        conId: { type: 'number', description: 'Option contract ID' },
        exchange: { type: 'string', description: 'Exchange' },
        volatility: { type: 'number', description: 'Implied volatility (decimal, e.g., 0.25 for 25%)' },
        underPrice: { type: 'number', description: 'Current underlying price' },
      },
      required: ['conId', 'exchange', 'volatility', 'underPrice'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'ib_option_chains': {
      const params = new URLSearchParams({
        symbol: input.symbol as string,
        conId: String(input.conId),
        secType: (input.secType as string) || 'STK',
      });
      const data = await fetchExpress(`/options/chains?${params}`);
      return jsonResult(data, 'Failed to get option chains. Is TWS connected?');
    }
    case 'ib_calc_option_price': {
      const data = await fetchExpressPost('/options/price', {
        conId: input.conId, exchange: input.exchange,
        volatility: input.volatility, underPrice: input.underPrice,
      });
      return jsonResult(data, 'Failed to calculate option price.');
    }
    default:
      throw new Error(`Unknown ib-options tool: ${name}`);
  }
}

export default { tools, handleTool } satisfies DomainModule;
