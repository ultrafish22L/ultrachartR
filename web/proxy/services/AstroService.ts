/**
 * AstroService — singleton wrapper around the Python Astro Engine.
 *
 * Manages engine lifecycle, profile storage (data/profiles/), and
 * converts between UltraChart cache format and engine inputs.
 *
 * Uses direct JSON bar ingestion via bridge.py train_json action.
 */

import { AstroEngine } from '../../../astro-engine/ts-bridge/engine.js';
import type { TrainedProfile, ScoreResult, PhaseCurveData, BacktestResult, Bar } from '../../../astro-engine/ts-bridge/types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROFILES_DIR = path.resolve(__dirname, '..', 'data', 'profiles');
const CACHE_DIR = path.resolve(__dirname, '..', 'cache');

// Ensure profiles directory exists
if (!fs.existsSync(PROFILES_DIR)) {
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// ── Planet ID mapping (UltraChart enum → astro-engine string) ────

const PLANET_MAP: Record<number, string> = {
  0: 'sun',
  1: 'moon',
  2: 'mercury',
  3: 'venus',
  4: 'mars',
  5: 'jupiter',
  6: 'saturn',
  7: 'uranus',
  8: 'neptune',
  9: 'pluto',
  10: 'meannode',
  11: 'truenode',
  12: 'meanapog',
  15: 'chiron',
};

const PERSPECTIVE_MAP: Record<string, string> = {
  heliocentric: 'helio',
  geocentric: 'geo',
  topocentric: 'topo',
};

export interface CurveFilter {
  planet: string;
  coordinate: string;
  frame: string;
}

/** Map a PlanetLineConfig (from UltraChart) to a curve label string */
export function mapPlanetLineToLabel(config: {
  planet: number;
  coordinate: string;
  perspective: string;
}): string | null {
  const planet = PLANET_MAP[config.planet];
  if (!planet) return null;
  const frame = PERSPECTIVE_MAP[config.perspective] || config.perspective;
  return `${planet}_${config.coordinate}_${frame}`;
}

/** Map PlanetLineConfig to CurveFilter */
export function mapPlanetLineToCurveFilter(config: {
  planet: number;
  coordinate: string;
  perspective: string;
}): CurveFilter | null {
  const planet = PLANET_MAP[config.planet];
  if (!planet) return null;
  const frame = PERSPECTIVE_MAP[config.perspective] || config.perspective;
  return { planet, coordinate: config.coordinate, frame };
}

// ── Profile metadata ─────────────────────────────────────────────

export interface ProfileSummary {
  id: string;
  filename: string;
  symbol: string;
  interval: string;
  bestCurve: string;
  bestScore: number;
  trainedAt: string;
  curvesCount: number;
}

// ── Cache file format (matches server.ts) ────────────────────────

interface CacheFile {
  version: number;
  symbol: string;
  conId: number;
  exchange: string;
  secType: string;
  lastTradeDate: string;
  interval: number;
  barSize: string;
  bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>;
}

// ── AstroService ─────────────────────────────────────────────────

export class AstroService {
  private engine: AstroEngine;
  private running = false;
  private training = false;
  private activeProfiles: Map<string, string> = new Map(); // symbol → profileId

  constructor() {
    this.engine = new AstroEngine();
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.running) return;
    await this.engine.start();
    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    await this.engine.stop();
    this.running = false;
  }

  getStatus(): {
    running: boolean;
    training: boolean;
    profileCount: number;
    activeProfiles: Record<string, string>;
  } {
    return {
      running: this.running,
      training: this.training,
      profileCount: this.listProfiles().length,
      activeProfiles: Object.fromEntries(this.activeProfiles),
    };
  }

  // ── Training ───────────────────────────────────────────────────

  /**
   * Train a profile from a cache file using direct JSON bar ingestion.
   */
  async train(
    cachePath: string,
    symbol: string,
    interval?: string,
    observer?: [number, number, number],
    tag?: string,
    curvesFilter?: string[],
  ): Promise<TrainedProfile & { profileId: string }> {
    const cache = this.readCache(cachePath);
    if (!cache) throw new Error(`Cache file not found: ${cachePath}`);

    const resolvedInterval = interval || this.barSizeToInterval(cache.barSize, cache.interval);
    const profileId = tag || `${symbol}_${resolvedInterval}_profile`;
    const profilePath = path.join(PROFILES_DIR, `${profileId}.json`);

    this.training = true;
    try {
      await this.start();

      const profile = await this.engine.trainFromJson(
        cache.bars as Bar[],
        symbol,
        resolvedInterval,
        observer,
        curvesFilter,
        profilePath,
      );

      // Engine saves to profilePath, but also write here to be safe
      if (!fs.existsSync(profilePath)) {
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
      }

      return { ...profile, profileId };
    } finally {
      this.training = false;
    }
  }

  /**
   * Train from a chart state — extracts bars and planet line curve filters.
   * The key method for "chart = setup definition" workflow.
   */
  async trainFromChart(
    chartState: {
      symbol: string;
      period: string;
      interval: number;
      recentBars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>;
      planetLines: Array<{ config: { planet: number; coordinate: string; perspective: string; latitude?: number; longitude?: number; elevation?: number } }>;
    },
    tag?: string,
  ): Promise<TrainedProfile & { profileId: string }> {
    const { symbol, interval: intervalMin, recentBars, planetLines } = chartState;

    if (!recentBars || recentBars.length === 0) throw new Error('No bars in chart state');

    // Convert recentBars to engine bar format
    const bars: Bar[] = recentBars.map(b => ({
      t: b.time, o: b.open, h: b.high, l: b.low, c: b.close, v: b.volume,
    }));

    // Extract curve filters from planet lines
    const curvesFilter: string[] = [];
    let observer: [number, number, number] | undefined;

    for (const pl of (planetLines || [])) {
      const label = mapPlanetLineToLabel(pl.config);
      if (label) curvesFilter.push(label);
      // Extract observer from first topocentric line
      if (!observer && pl.config.perspective === 'topocentric' && pl.config.latitude !== undefined) {
        observer = [pl.config.longitude || 0, pl.config.latitude || 0, pl.config.elevation || 0];
      }
    }

    const resolvedInterval = this.barSizeToInterval('', intervalMin);
    const profileId = tag || `${symbol}_${resolvedInterval}_${curvesFilter.join('-') || 'all'}`;
    const profilePath = path.join(PROFILES_DIR, `${profileId}.json`);

    this.training = true;
    try {
      await this.start();

      const profile = await this.engine.trainFromJson(
        bars,
        symbol,
        resolvedInterval,
        observer,
        curvesFilter.length > 0 ? curvesFilter : undefined,
        profilePath,
      );

      if (!fs.existsSync(profilePath)) {
        fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf-8');
      }

      return { ...profile, profileId };
    } finally {
      this.training = false;
    }
  }

  // ── Backtesting ────────────────────────────────────────────────

  async backtest(
    profileId: string,
    cachePath: string,
  ): Promise<BacktestResult> {
    const profilePath = this.resolveProfilePath(profileId);
    if (!fs.existsSync(profilePath)) throw new Error(`Profile not found: ${profileId}`);

    const cache = this.readCache(cachePath);
    if (!cache) throw new Error(`Cache file not found: ${cachePath}`);

    await this.start();
    return this.engine.backtest(profilePath, cache.bars as Bar[]);
  }

  // ── Scoring ────────────────────────────────────────────────────

  async score(
    profileId: string,
    at?: Date,
    observer?: [number, number, number],
  ): Promise<ScoreResult> {
    const profilePath = this.resolveProfilePath(profileId);
    if (!fs.existsSync(profilePath)) throw new Error(`Profile not found: ${profileId}`);

    await this.start();
    return this.engine.score(profilePath, at, observer);
  }

  // ── Phase Curves ───────────────────────────────────────────────

  async getPhaseCurves(
    start: Date,
    end: Date,
    intervalMinutes?: number,
    observer?: [number, number, number],
  ): Promise<PhaseCurveData[]> {
    await this.start();
    return this.engine.getPhaseCurves(start, end, intervalMinutes, observer);
  }

  // ── Profile CRUD ───────────────────────────────────────────────

  listProfiles(): ProfileSummary[] {
    if (!fs.existsSync(PROFILES_DIR)) return [];
    const files = fs.readdirSync(PROFILES_DIR).filter(f => f.endsWith('.json'));
    const results: ProfileSummary[] = [];

    for (const filename of files) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, filename), 'utf-8'));
        const profile = raw as TrainedProfile;
        results.push({
          id: filename.replace(/\.json$/, ''),
          filename,
          symbol: profile.market_symbol || 'unknown',
          interval: profile.market_interval || 'unknown',
          bestCurve: profile.best_curve || '',
          bestScore: profile.best_score || 0,
          trainedAt: profile.trained_at || '',
          curvesCount: profile.curves?.length || 0,
        });
      } catch { /* skip invalid files */ }
    }

    return results.sort((a, b) => b.trainedAt.localeCompare(a.trainedAt));
  }

  getProfile(profileId: string): TrainedProfile | null {
    const profilePath = this.resolveProfilePath(profileId);
    if (!fs.existsSync(profilePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(profilePath, 'utf-8')) as TrainedProfile;
    } catch { return null; }
  }

  deleteProfile(profileId: string): boolean {
    const profilePath = this.resolveProfilePath(profileId);
    if (!fs.existsSync(profilePath)) return false;
    fs.unlinkSync(profilePath);
    // Remove from active if it was active
    for (const [sym, id] of this.activeProfiles) {
      if (id === profileId) this.activeProfiles.delete(sym);
    }
    return true;
  }

  activateProfile(profileId: string): { symbol: string } {
    const profile = this.getProfile(profileId);
    if (!profile) throw new Error(`Profile not found: ${profileId}`);
    const symbol = profile.market_symbol;
    this.activeProfiles.set(symbol, profileId);
    return { symbol };
  }

  getActiveProfile(symbol: string): string | null {
    return this.activeProfiles.get(symbol) || null;
  }

  // ── Helpers ────────────────────────────────────────────────────

  private resolveProfilePath(profileId: string): string {
    // Security: prevent path traversal
    const safe = profileId.replace(/[^a-zA-Z0-9_\-]/g, '');
    return path.join(PROFILES_DIR, `${safe}.json`);
  }

  private readCache(cachePath: string): CacheFile | null {
    // Security: only allow simple filenames
    if (cachePath.includes('..') || cachePath.includes('/') || cachePath.includes('\\')) return null;
    const filepath = path.join(CACHE_DIR, cachePath);
    if (!fs.existsSync(filepath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      if (!parsed || !Array.isArray(parsed.bars)) return null;
      return parsed as CacheFile;
    } catch { return null; }
  }

  private barSizeToInterval(barSize: string, intervalMinutes: number): string {
    if (intervalMinutes >= 1440) return 'daily';
    if (intervalMinutes >= 60) return `${intervalMinutes / 60}h`;
    return `${intervalMinutes}min`;
  }
}
