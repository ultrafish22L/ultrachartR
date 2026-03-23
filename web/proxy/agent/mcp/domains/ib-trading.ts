/**
 * IB Trading domain — order placement/cancellation tools + open orders/executions resources + trading prompts.
 */
import { fetchExpress, fetchExpressPost, jsonResult, resourceJson } from '../helpers.js';
import type { DomainModule, ToolDef, ResourceDef, ResourceContent, PromptDef, PromptMessage } from '../types.js';

// ── Resources ──────────────────────────────────────────────────

export const resources: ResourceDef[] = [
  {
    uri: 'ultrachart://orders/open',
    name: 'Open Orders',
    description: 'All currently active orders across all accounts with status, type, and fill info.',
    mimeType: 'application/json',
  },
  {
    uri: 'ultrachart://orders/completed',
    name: 'Completed Orders',
    description: 'Orders completed today with fill price, commission, and status.',
    mimeType: 'application/json',
  },
  {
    uri: 'ultrachart://executions',
    name: 'Executions',
    description: 'Today\'s execution reports: fill prices, quantities, commissions.',
    mimeType: 'application/json',
  },
];

export async function handleResource(uri: string): Promise<ResourceContent[]> {
  if (uri === 'ultrachart://orders/open') {
    const data = await fetchExpress('/orders/open');
    return resourceJson(uri, data ?? { error: 'Failed to get open orders. Is TWS connected?' });
  }
  if (uri === 'ultrachart://orders/completed') {
    const data = await fetchExpress('/orders/completed');
    return resourceJson(uri, data ?? { error: 'Failed to get completed orders.' });
  }
  if (uri === 'ultrachart://executions') {
    const data = await fetchExpress('/executions');
    return resourceJson(uri, data ?? { error: 'Failed to get executions.' });
  }
  throw new Error(`Unknown ib-trading resource: ${uri}`);
}

// ── Tools ──────────────────────────────────────────────────────

export const tools: ToolDef[] = [
  {
    name: 'ib_place_order',
    description: 'Place or modify an order on IB. Supports MKT, LMT, STP, STP LMT, TRAIL, MOC, LOC order types.',
    inputSchema: {
      type: 'object',
      properties: {
        conId: { type: 'number', description: 'Contract ID' },
        exchange: { type: 'string', description: 'Exchange (e.g., "CBOT")' },
        secType: { type: 'string', description: 'Security type (e.g., "FUT", "STK"). Default: "FUT"' },
        action: { type: 'string', description: 'BUY or SELL' },
        quantity: { type: 'number', description: 'Number of contracts/shares' },
        orderType: { type: 'string', description: 'Order type: MKT, LMT, STP, STP LMT, TRAIL, MOC, LOC' },
        lmtPrice: { type: 'number', description: 'Limit price (for LMT, STP LMT, LOC orders)' },
        auxPrice: { type: 'number', description: 'Stop price (for STP, STP LMT) or trail amount (for TRAIL)' },
        tif: { type: 'string', description: 'Time in force: DAY, GTC, IOC, GTD, OPG, FOK. Default: DAY' },
        account: { type: 'string', description: 'Account ID (required for multi-account setups)' },
        orderId: { type: 'number', description: 'Order ID to modify an existing order. Omit for new orders.' },
      },
      required: ['conId', 'exchange', 'action', 'quantity', 'orderType'],
    },
  },
  {
    name: 'ib_cancel_order',
    description: 'Cancel a specific open order by orderId.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'number', description: 'Order ID to cancel' },
      },
      required: ['orderId'],
    },
  },
  {
    name: 'ib_cancel_all_orders',
    description: 'Emergency: cancel ALL open orders across all accounts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ib_next_order_id',
    description: 'Get the next valid order ID from TWS. Call before placing an order if you need to track the ID.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ib_exercise_option',
    description: 'Exercise an options contract.',
    inputSchema: {
      type: 'object',
      properties: {
        conId: { type: 'number', description: 'Contract ID of the option' },
        exchange: { type: 'string', description: 'Exchange' },
        action: { type: 'number', description: '1 = exercise, 2 = lapse' },
        quantity: { type: 'number', description: 'Number of contracts to exercise' },
        account: { type: 'string', description: 'Account ID' },
      },
      required: ['conId', 'exchange', 'action', 'quantity'],
    },
  },
];

export async function handleTool(name: string, input: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'ib_place_order': {
      const data = await fetchExpressPost('/order/place', {
        conId: input.conId, exchange: input.exchange, secType: input.secType || 'FUT',
        action: input.action, quantity: input.quantity, orderType: input.orderType,
        lmtPrice: input.lmtPrice, auxPrice: input.auxPrice,
        tif: input.tif || 'DAY', account: input.account, orderId: input.orderId,
      });
      return jsonResult(data, 'Failed to place order. Is TWS connected?');
    }
    case 'ib_cancel_order': {
      const data = await fetchExpressPost('/order/cancel', { orderId: input.orderId });
      return jsonResult(data, 'Failed to cancel order.');
    }
    case 'ib_cancel_all_orders': {
      const data = await fetchExpressPost('/order/cancel-all', {});
      return jsonResult(data, 'Failed to cancel all orders.');
    }
    case 'ib_next_order_id': {
      const data = await fetchExpress('/order/next-id');
      return jsonResult(data, 'Failed to get next order ID.');
    }
    case 'ib_exercise_option': {
      const data = await fetchExpressPost('/options/exercise', {
        conId: input.conId, exchange: input.exchange,
        action: input.action, quantity: input.quantity, account: input.account,
      });
      return jsonResult(data, 'Failed to exercise option.');
    }
    default:
      throw new Error(`Unknown ib-trading tool: ${name}`);
  }
}

// ── Prompts ────────────────────────────────────────────────────

export const prompts: PromptDef[] = [
  {
    name: 'trade_setup',
    description: 'Pre-fill context for placing a trade: account state, positions, recent bars, astro score. Helps decide size, order type, and timing.',
    arguments: [
      { name: 'symbol', description: 'Symbol to trade (e.g., "ZSK6")', required: true },
      { name: 'action', description: '"buy" or "sell"', required: true },
    ],
  },
  {
    name: 'order_review',
    description: 'Review all open orders and positions. Flag orders that need attention: stops too tight, unfilled limits, risk concentration.',
    arguments: [],
  },
];

export async function handlePrompt(name: string, args: Record<string, string>): Promise<PromptMessage[]> {
  if (name === 'trade_setup') {
    const [account, positions, orders, chartState, astroStatus] = await Promise.all([
      fetchExpress('/account/summary'),
      fetchExpress('/account/positions'),
      fetchExpress('/orders/open'),
      fetchExpress('/chart/state'),
      fetchExpress('/astro/status'),
    ]);

    let text = `I want to ${args.action.toUpperCase()} ${args.symbol}. Help me decide position size, order type, and timing.\n\n`;

    if (account) text += `## Account\n\`\`\`json\n${JSON.stringify(account, null, 2).slice(0, 1000)}\n\`\`\`\n\n`;
    if (positions) text += `## Current Positions\n\`\`\`json\n${JSON.stringify(positions, null, 2).slice(0, 1500)}\n\`\`\`\n\n`;
    if (orders) text += `## Open Orders\n\`\`\`json\n${JSON.stringify(orders, null, 2).slice(0, 1000)}\n\`\`\`\n\n`;
    if (chartState) text += `## Chart State\n\`\`\`json\n${JSON.stringify(chartState, null, 2).slice(0, 2000)}\n\`\`\`\n\n`;
    if (astroStatus) text += `## Astro Status\n\`\`\`json\n${JSON.stringify(astroStatus, null, 2).slice(0, 500)}\n\`\`\`\n\n`;

    text += 'Based on this context, recommend:\n1. Position size (considering existing positions and buying power)\n2. Order type (market, limit, stop)\n3. Entry price level if limit\n4. Stop loss level\n5. Any timing considerations from astro signals';

    return [{ role: 'user', content: { type: 'text', text } }];
  }

  if (name === 'order_review') {
    const [orders, positions, pnl] = await Promise.all([
      fetchExpress('/orders/open'),
      fetchExpress('/account/positions'),
      fetchExpress('/account/pnl'),
    ]);

    let text = 'Review my open orders and positions. Flag anything that needs attention.\n\n';
    if (orders) text += `## Open Orders\n\`\`\`json\n${JSON.stringify(orders, null, 2).slice(0, 2000)}\n\`\`\`\n\n`;
    if (positions) text += `## Positions\n\`\`\`json\n${JSON.stringify(positions, null, 2).slice(0, 2000)}\n\`\`\`\n\n`;
    if (pnl) text += `## P&L\n\`\`\`json\n${JSON.stringify(pnl, null, 2).slice(0, 500)}\n\`\`\`\n\n`;
    text += 'Check for:\n- Stops too tight or too wide\n- Unfilled limits that should be adjusted\n- Risk concentration in any single position\n- Orders that may conflict with each other';

    return [{ role: 'user', content: { type: 'text', text } }];
  }

  throw new Error(`Unknown ib-trading prompt: ${name}`);
}

export default { tools, resources, prompts, handleTool, handleResource, handlePrompt } satisfies DomainModule;
