/**
 * Shared chart state snapshot — cached from agent chat for MCP access.
 * Separate module to avoid circular imports between server.ts and agentRoutes.ts.
 */

let latestChartState: unknown = null;

export function setLatestChartState(state: unknown): void {
  latestChartState = state;
}

export function getLatestChartState(): unknown {
  return latestChartState;
}
