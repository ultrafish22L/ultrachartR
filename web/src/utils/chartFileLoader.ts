/**
 * Shared utility for converting a deserialized ChartFile into chart-ready data.
 * Used by both File > Open and URL-based loading (F5 quick-load).
 */
import type { ChartFile } from '../services/FileService';
import type { OHLCVBar, SecurityData, ChartPeriod, ViewState, ChartConfig } from '../types/chart';
import type { ChartObject } from '../types/objects';
import type { PlanetLineObject } from '../types/planet';

export interface ParsedUchart {
  security: SecurityData | null;
  config: ChartConfig;
  viewState: Partial<ViewState>;
  objects: ChartObject[];
  planetLines: PlanetLineObject[];
  barCount: number;
}

/** Convert a deserialized ChartFile into addChart-compatible data */
export function parseChartFile(chartFile: ChartFile): ParsedUchart {
  let bars: OHLCVBar[] = [];
  if (chartFile.bars && chartFile.bars.length > 0) {
    bars = chartFile.bars.map((b) => ({
      time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
    }));
  }

  const security: SecurityData | null = chartFile.security ? {
    info: {
      symbol: chartFile.security.symbol,
      name: chartFile.security.name,
      conId: chartFile.security.conId,
      exchange: chartFile.security.exchange,
      lastTradeDate: chartFile.security.lastTradeDate,
      secType: chartFile.security.secType,
    },
    bars,
    period: chartFile.security.period as ChartPeriod,
    interval: chartFile.security.interval,
    lastUpdate: Date.now(),
  } : null;

  return {
    security,
    config: chartFile.config,
    viewState: chartFile.viewState,
    objects: chartFile.objects,
    planetLines: chartFile.planetLines,
    barCount: bars.length,
  };
}
