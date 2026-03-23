/**
 * Centralized preferences persistence via localStorage.
 * Single key 'ultrachart-preferences' stores all app preferences as JSON.
 */
import type { AppTheme } from '../context/WorkspaceContext';
import type { EphemerisBackend } from '../planet/EphemerisService';
import type { ChartConfig } from '../types/chart';
import { DEFAULT_CHART_CONFIG } from '../types/chart';
import { log } from './Logger';

export interface ChartLocation {
  latitude: number;
  longitude: number;
  elevation: number;
}

export interface ChartColors {
  bgEnabled: boolean;
  bgColor: string;
  sleepEnabled: boolean;
  sleepColor: string;
  lunchEnabled: boolean;
  lunchColor: string;
}

export type TimelineStyle = 'express' | 'legacy';

export type ChartDefaults = Partial<Pick<ChartConfig, 'style' | 'showVolume' | 'showSessionBands' | 'monochromeBars' | 'timeMode' | 'timelineStyle'>>;

export interface AppPreferences {
  theme: AppTheme;
  ephemerisBackend: EphemerisBackend | null; // null = auto-detect
  restoreWorkspace: boolean;
  location: ChartLocation;
  rightMargin: number;     // px of empty space before price axis
  chartColors: ChartColors;
  timelineStyle: TimelineStyle;
  chartDefaults: ChartDefaults;
}

const STORAGE_KEY = 'ultrachart-preferences';
const OLD_THEME_KEY = 'ultrachart-theme';

/** In-memory cache — avoids repeated JSON.parse from localStorage */
let cachedPreferences: AppPreferences | null = null;

const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'dark',
  ephemerisBackend: null,
  restoreWorkspace: true,
  location: { latitude: 34.02, longitude: -118.45, elevation: 22 },
  rightMargin: 0,
  chartColors: {
    bgEnabled: false,
    bgColor: '#0d1117',
    sleepEnabled: false,
    sleepColor: 'rgba(200, 70, 70, 0.18)',
    lunchEnabled: false,
    lunchColor: 'rgba(100, 120, 180, 0.14)',
  },
  timelineStyle: 'express',
  chartDefaults: {
    style: 'bar',
    showVolume: false,
    showSessionBands: true,
    monochromeBars: true,
    timeMode: 'natural',
    timelineStyle: 'legacy',
  },
};

/** Load preferences from localStorage, merging with defaults for forward-compat. */
export function loadPreferences(): AppPreferences {
  if (cachedPreferences) return { ...cachedPreferences };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
        throw new Error('Invalid preferences format');
      }
      // Validate nested objects before spreading to prevent type pollution
      const safeObj = (val: unknown): Record<string, unknown> =>
        (val && typeof val === 'object' && !Array.isArray(val)) ? val as Record<string, unknown> : {};
      const result: AppPreferences = {
        ...DEFAULT_PREFERENCES,
        ...stored,
        location: { ...DEFAULT_PREFERENCES.location, ...safeObj(stored.location) },
        chartColors: { ...DEFAULT_PREFERENCES.chartColors, ...safeObj(stored.chartColors) },
        chartDefaults: { ...DEFAULT_PREFERENCES.chartDefaults, ...safeObj(stored.chartDefaults) },
      };
      cachedPreferences = result;
      return { ...cachedPreferences };
    }

    // Migration: check old theme key
    const oldTheme = localStorage.getItem(OLD_THEME_KEY);
    if (oldTheme === 'light' || oldTheme === 'dark' || oldTheme === 'vibe') {
      cachedPreferences = { ...DEFAULT_PREFERENCES, theme: oldTheme as AppTheme };
      savePreferences(cachedPreferences);
      localStorage.removeItem(OLD_THEME_KEY);
      return { ...cachedPreferences };
    }
  } catch (e) {
    log.warn('Preferences', 'Failed to load:', e);
  }
  cachedPreferences = { ...DEFAULT_PREFERENCES };
  return { ...cachedPreferences };
}

/** Save full preferences object to localStorage and update in-memory cache. */
export function savePreferences(prefs: AppPreferences): void {
  cachedPreferences = { ...prefs };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch (e) {
    log.warn('Preferences', 'Failed to save:', e);
  }
}

/** Update a single preference key (in-memory merge + persist). */
export function updatePreference<K extends keyof AppPreferences>(
  key: K,
  value: AppPreferences[K],
): void {
  const prefs = loadPreferences();
  const updated = { ...prefs, [key]: value };
  savePreferences(updated);
}

/** Build a ChartConfig using saved user defaults, with optional overrides. */
export function getDefaultChartConfig(overrides?: Partial<ChartConfig>): ChartConfig {
  const prefs = loadPreferences();
  return { ...DEFAULT_CHART_CONFIG, ...prefs.chartDefaults, ...overrides };
}
