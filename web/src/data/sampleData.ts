import { OHLCVBar, SecurityData } from '../types/chart';
import zs5minData from './zs_5min.json';
import zsDailyData from './zs_daily.json';

/**
 * Real ZS (Soybeans May 2026) 5-min intraday data from IB TWS.
 * ~4400 bars, Jan 29 - Feb 27, 2026.
 */
export function getZS5minBars(): OHLCVBar[] {
  return zs5minData as OHLCVBar[];
}

/**
 * Real ZS (Soybeans May 2026) daily data from IB TWS.
 * ~250 bars, Feb 2025 - Feb 2026.
 */
export function getZSDailyBars(): OHLCVBar[] {
  return zsDailyData as OHLCVBar[];
}

/** Default sample security data - real ZS daily */
export function getSampleSecurity(): SecurityData {
  return {
    info: {
      symbol: 'ZS',
      name: 'Soybeans May 2026',
      exchange: 'CBOT',
      currency: 'USD',
    },
    bars: getZSDailyBars(),
    period: 'daily',
    interval: 0,
    lastUpdate: Date.now(),
  };
}

/** Intraday sample data - real ZS 5-min bars */
export function getIntradaySampleSecurity(): SecurityData {
  return {
    info: {
      symbol: 'ZS',
      name: 'Soybeans May 2026',
      exchange: 'CBOT',
      currency: 'USD',
    },
    bars: getZS5minBars(),
    period: 'intraday',
    interval: 5,
    lastUpdate: Date.now(),
  };
}
