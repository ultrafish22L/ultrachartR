/**
 * TypeScript interfaces for the Astro Engine Python bridge.
 * These types match the JSON output from the Python modules.
 */

// ---------------------------------------------------------------------------
// Phase Curves
// ---------------------------------------------------------------------------

export type PlanetId = 'mercury' | 'moon';
export type CoordinateId = 'longitude' | 'latitude';
export type FrameId = 'helio' | 'geo' | 'topo';
export type DirectionId = 'rising' | 'falling' | 'turning_up' | 'turning_down' | 'stationary';

export interface PhaseCurveData {
  label: string;
  planet: string;
  coordinate: string;
  frame: string;
  interval_minutes: number;
  count: number;
  timestamps_jd: number[];
  datetimes_iso: string[];
  values: number[];
  speeds: number[];
  turning_point_indices: number[];
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

export interface CorrelationResult {
  curve_label: string;
  market: string;
  pearson_r: number;
  pearson_p: number;
  spearman_r: number;
  spearman_p: number;
  optimal_lag: number;
  lagged_pearson_r: number;
  lagged_pearson_p: number;
  direction_agreement: number;
  direction_p: number;
  rolling_corr_mean: number;
  rolling_corr_std: number;
  pct_windows_positive: number;
  stability_score: number;
  composite_score: number;
  n_samples: number;
  window_size: number;
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export interface CurveProfile {
  curve_label: string;
  planet: string;
  coordinate: string;
  frame: string;
  optimal_lag: number;
  best_window_size: number;
  pearson_r: number;
  direction_agreement: number;
  composite_score: number;
  stability_score: number;
  p_value: number;
  in_sample_score: number;
  out_of_sample_score: number;
  generalization_ratio: number;
}

export interface TrainedProfile {
  market_symbol: string;
  market_interval: string;
  trained_at: string;
  train_start: string;
  train_end: string;
  best_curve: string;
  best_score: number;
  curves: CurveProfile[];
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface PhaseSignal {
  curve: string;
  direction: DirectionId;
  value: number;
  speed: number;
  correlation: number;
  lag_bars: number;
  confidence: number;
  next_turning: string | null;
  bars_to_turning: number | null;
}

export interface ScoreResult {
  timestamp: string;
  market: string;
  composite_direction: number;
  strongest_signal: string;
  timing_note: string;
  signals: PhaseSignal[];
}

// ---------------------------------------------------------------------------
// Engine commands
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Backtest
// ---------------------------------------------------------------------------

export interface BacktestResult {
  direction_accuracy: number;
  correct_predictions: number;
  total_predictions: number;
  total_bars: number;
  signals_by_curve: Record<string, {
    accuracy: number;
    correct: number;
    total: number;
  }>;
}

// ---------------------------------------------------------------------------
// Curve filter (for selective training)
// ---------------------------------------------------------------------------

export interface CurveFilter {
  planet: string;
  coordinate: string;
  frame: string;
}

// ---------------------------------------------------------------------------
// Engine commands
// ---------------------------------------------------------------------------

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type EngineCommand =
  | { action: 'score'; profile_path: string; at?: string; observer?: [number, number, number] }
  | { action: 'train'; data_path: string; symbol: string; interval: string; observer?: [number, number, number]; curves_filter?: string[] }
  | { action: 'train_json'; bars: Bar[]; symbol: string; interval: string; observer?: [number, number, number]; curves_filter?: string[]; output_path?: string }
  | { action: 'backtest'; profile_path: string; bars?: Bar[]; data_path?: string; symbol?: string; interval?: string }
  | { action: 'phase_curves'; start: string; end: string; interval_minutes: number; observer?: [number, number, number] }
  | { action: 'chart'; profile_path: string; data_path: string; symbol: string; curves?: string[]; output_path: string };

export type EngineResponse =
  | { ok: true; action: string; data: ScoreResult | TrainedProfile | PhaseCurveData[] | BacktestResult | { chart_path: string } }
  | { ok: false; action: string; error: string };
