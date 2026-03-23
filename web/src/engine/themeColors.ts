// Canvas-accessible theme colors, kept in sync with CSS custom properties.
// Call refreshThemeColors() whenever the theme changes.

import { loadPreferences, type ChartColors } from '../services/PreferencesService';

export const themeColors = {
  chartBg: '#0d1117',
  chartGrid: '#1c2333',
  chartGridMajor: '#283044',
  chartCrosshair: '#4a5568',
  candleUp: '#26a69a',
  candleDown: '#ef5350',
  volumeUp: '#26a69a40',
  volumeDown: '#ef535040',
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textAccent: '#60a5fa',
  borderPrimary: '#2d3748',
  borderSecondary: '#1e293b',
  bgTertiary: '#0f1626',
  selectionStroke: '#60a5fa',
  selectionColor: '#3b82f6',
  objectStroke: '#e2e8f0',
  sessionSleep: 'rgba(200, 70, 70, 0.18)',
  sessionLunch: 'rgba(100, 120, 180, 0.14)',
};

export function refreshThemeColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (prop: string) => s.getPropertyValue(prop).trim();
  themeColors.chartBg = v('--chart-bg') || themeColors.chartBg;
  themeColors.chartGrid = v('--chart-grid') || themeColors.chartGrid;
  themeColors.chartGridMajor = v('--chart-grid-major') || themeColors.chartGridMajor;
  themeColors.chartCrosshair = v('--chart-crosshair') || themeColors.chartCrosshair;
  themeColors.candleUp = v('--chart-candle-up') || themeColors.candleUp;
  themeColors.candleDown = v('--chart-candle-down') || themeColors.candleDown;
  themeColors.volumeUp = v('--chart-volume-up') || themeColors.volumeUp;
  themeColors.volumeDown = v('--chart-volume-down') || themeColors.volumeDown;
  themeColors.textPrimary = v('--text-primary') || themeColors.textPrimary;
  themeColors.textSecondary = v('--text-secondary') || themeColors.textSecondary;
  themeColors.textMuted = v('--text-muted') || themeColors.textMuted;
  themeColors.textAccent = v('--text-accent') || themeColors.textAccent;
  themeColors.borderPrimary = v('--border-primary') || themeColors.borderPrimary;
  themeColors.borderSecondary = v('--border-secondary') || themeColors.borderSecondary;
  themeColors.bgTertiary = v('--bg-tertiary') || themeColors.bgTertiary;
  themeColors.selectionStroke = v('--text-accent') || themeColors.selectionStroke;
  themeColors.selectionColor = v('--accent-primary') || themeColors.selectionColor;
  themeColors.objectStroke = v('--text-primary') || themeColors.objectStroke;

  // Apply user color overrides from preferences
  applyColorOverrides();
}

/** Apply chart color overrides from preferences on top of theme defaults.
 *  Uses cached preferences when no colors argument is provided. */
export function applyColorOverrides(colors?: ChartColors) {
  const cc = colors ?? loadPreferences().chartColors; // loadPreferences() now uses in-memory cache
  if (cc.bgEnabled && cc.bgColor) {
    themeColors.chartBg = cc.bgColor;
  }
  if (cc.sleepEnabled && cc.sleepColor) {
    themeColors.sessionSleep = cc.sleepColor;
  } else {
    themeColors.sessionSleep = 'rgba(200, 70, 70, 0.18)';
  }
  if (cc.lunchEnabled && cc.lunchColor) {
    themeColors.sessionLunch = cc.lunchColor;
  } else {
    themeColors.sessionLunch = 'rgba(100, 120, 180, 0.14)';
  }
}

// Initialize on first import
if (typeof document !== 'undefined') {
  refreshThemeColors();
}
