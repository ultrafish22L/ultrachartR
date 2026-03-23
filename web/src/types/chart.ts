/** OHLCV bar data - mirrors legacy cSampleSec */
export interface OHLCVBar {
  time: number;    // Unix timestamp in ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Chart time periods - mirrors legacy chartINTRADAY, chartDAY, etc. */
export type ChartPeriod = 'intraday' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** Chart display style - mirrors legacy chartBAR, chartLINE */
export type ChartStyle = 'candlestick' | 'bar' | 'line';

/** Time axis mode - mirrors legacy DoTradesOnly / DoSessionOnly */
export type TimeMode = 'compressed' | 'natural';

/** Timeline display style */
export type TimelineStyle = 'express' | 'legacy';

/** Security metadata */
export interface SecurityInfo {
  symbol: string;
  name: string;
  conId?: number;      // IB contract ID
  exchange?: string;
  currency?: string;
  lastTradeDate?: string;   // YYYYMMDD for futures
  secType?: string;          // FUT, STK, OPT, IND
  description?: string;      // e.g. "Soybean Futures"
}

/** Complete security data for a loaded chart */
export interface SecurityData {
  info: SecurityInfo;
  bars: OHLCVBar[];
  period: ChartPeriod;
  interval: number;     // minutes for intraday, 0 otherwise
  lastUpdate: number;   // timestamp of last data update
}

/** Viewport state - zoom/scroll */
export interface ViewState {
  /** Number of bars scrolled from the right edge (0 = latest bar at right) */
  scrollOffset: number;
  /** Pixels per bar (higher = more zoomed in) */
  pixelsPerBar: number;
  /** Price axis range */
  priceMin: number;
  priceMax: number;
  /** Auto-scale price axis to visible data */
  autoScale: boolean;
}

/** Pixel rectangle */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2D point */
export interface Point {
  x: number;
  y: number;
}

/** Pen style for drawing */
export interface PenStyle {
  color: string;
  width: number;
  dash?: number[];
}

/** Chart configuration */
export interface ChartConfig {
  style: ChartStyle;
  period: ChartPeriod;
  interval: number;
  timeMode: TimeMode;
  showGrid: boolean;
  showCrosshair: boolean;
  showVolume: boolean;
  showSessionBands: boolean;
  monochromeBars: boolean;
  volumeHeight: number;   // fraction of chart height (0-0.4)
  timelineStyle: TimelineStyle;
}

/** Default chart configuration */
export const DEFAULT_CHART_CONFIG: ChartConfig = {
  style: 'bar',
  period: 'daily',
  interval: 0,
  timeMode: 'natural',
  showGrid: true,
  showCrosshair: true,
  showVolume: false,
  showSessionBands: true,
  monochromeBars: true,
  volumeHeight: 0.15,
  timelineStyle: 'legacy',
};

/** Default view state */
export const DEFAULT_VIEW_STATE: ViewState = {
  scrollOffset: 0,
  pixelsPerBar: 8,
  priceMin: 0,
  priceMax: 100,
  autoScale: true,
};

// ─── Compact Serialization Types ──────────────────────────────────

/** Compact bar format for .uchart files and workspace session storage */
export interface CompactBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Serialized security metadata (used in .uchart files and workspace sessions) */
export interface SerializedSecurity {
  symbol: string;
  name: string;
  conId?: number;
  exchange?: string;
  lastTradeDate?: string;
  secType?: string;
  period: string;
  interval: number;
}

// ─── Cache File Types ─────────────────────────────────────────────

/** Cache file format stored on the bridge server */
export interface CacheFile {
  version: number;
  symbol: string;
  conId: number;
  exchange: string;
  secType: string;
  lastTradeDate: string;
  interval: number;       // minutes (0 for daily/weekly/monthly)
  barSize: string;        // IB bar size string
  bars: Array<{
    t: number; o: number; h: number; l: number; c: number; v: number;
  }>;
}

/** Cache file listing info */
export interface CacheInfo {
  path: string;
  symbol: string;
  conId: number;
  exchange: string;
  interval: number;
  barSize: string;
  barCount: number;
  lastBarTime: number;
}

/** Interval option for the import dialog */
export interface IntervalOption {
  label: string;
  interval: number;   // minutes (0 for daily/weekly/monthly)
  barSize: string;     // IB bar size string
  period: ChartPeriod;
}

/** Available interval options */
export const INTERVAL_OPTIONS: IntervalOption[] = [
  { label: '1 min',   interval: 1,  barSize: '1 min',   period: 'intraday' },
  { label: '5 min',   interval: 5,  barSize: '5 mins',  period: 'intraday' },
  { label: '15 min',  interval: 15, barSize: '15 mins', period: 'intraday' },
  { label: '30 min',  interval: 30, barSize: '30 mins', period: 'intraday' },
  { label: '1 hour',  interval: 60, barSize: '1 hour',  period: 'intraday' },
  { label: 'Daily',   interval: 0,  barSize: '1 day',   period: 'daily' },
  { label: 'Weekly',  interval: 0,  barSize: '1 week',  period: 'weekly' },
  { label: 'Monthly', interval: 0,  barSize: '1 month', period: 'monthly' },
];

/** Format YYYYMMDD lastTradeDate to "May '26" style */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatContractDate(lastTradeDate?: string): string {
  if (!lastTradeDate || lastTradeDate.length < 6) return '';
  const year = lastTradeDate.substring(2, 4);
  const month = parseInt(lastTradeDate.substring(4, 6), 10);
  if (month < 1 || month > 12) return '';
  return `${MONTHS_SHORT[month - 1]} '${year}`;
}
