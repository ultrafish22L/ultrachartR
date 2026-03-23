/**
 * TypeScript bridge to the Python Astro Engine.
 *
 * Spawns a Python subprocess and communicates via JSON over stdio.
 * Each command is a single JSON line in, single JSON response out.
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import type {
  EngineCommand,
  EngineResponse,
  ScoreResult,
  TrainedProfile,
  PhaseCurveData,
  BacktestResult,
  Bar,
} from './types';

const ENGINE_DIR = path.resolve(__dirname, '..');
const BRIDGE_SCRIPT = path.join(ENGINE_DIR, 'bridge.py');

export class AstroEngine {
  private proc: ChildProcess | null = null;
  private pending: Map<number, { resolve: (v: EngineResponse) => void; reject: (e: Error) => void }> = new Map();
  private nextId = 1;
  private buffer = '';

  async start(): Promise<void> {
    if (this.proc) return;

    this.proc = spawn('python', [BRIDGE_SCRIPT], {
      cwd: ENGINE_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout!.setEncoding('utf-8');
    this.proc.stdout!.on('data', (chunk: string) => {
      this.buffer += chunk;
      this._processBuffer();
    });

    this.proc.stderr!.setEncoding('utf-8');
    this.proc.stderr!.on('data', (chunk: string) => {
      console.error('[astro-engine stderr]', chunk.trimEnd());
    });

    this.proc.on('exit', (code) => {
      console.error(`[astro-engine] process exited with code ${code}`);
      this.proc = null;
      // Reject all pending
      for (const [, p] of this.pending) {
        p.reject(new Error(`Engine process exited with code ${code}`));
      }
      this.pending.clear();
    });

    // Wait for ready signal
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Engine startup timeout')), 10000);
      const handler = (chunk: string) => {
        if (chunk.includes('"ready":true')) {
          clearTimeout(timeout);
          this.proc!.stdout!.removeListener('data', handler);
          resolve();
        }
      };
      this.proc!.stdout!.on('data', handler);
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    this.proc.stdin!.write(JSON.stringify({ action: 'quit' }) + '\n');
    await new Promise<void>((resolve) => {
      this.proc!.on('exit', () => resolve());
      setTimeout(() => {
        this.proc?.kill();
        resolve();
      }, 3000);
    });
    this.proc = null;
  }

  private _processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as EngineResponse & { _id?: number };
        const id = response._id;
        if (id !== undefined && this.pending.has(id)) {
          const p = this.pending.get(id)!;
          this.pending.delete(id);
          p.resolve(response);
        }
      } catch {
        // Not JSON — ignore
      }
    }
  }

  private async _send(cmd: EngineCommand & { _id?: number }): Promise<EngineResponse> {
    if (!this.proc) {
      await this.start();
    }

    const id = this.nextId++;
    cmd._id = id;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin!.write(JSON.stringify(cmd) + '\n');
    });
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async score(
    profilePath: string,
    at?: Date,
    observer?: [number, number, number],
  ): Promise<ScoreResult> {
    const resp = await this._send({
      action: 'score',
      profile_path: profilePath,
      at: at?.toISOString(),
      observer,
    });
    if (!resp.ok) throw new Error((resp as any).error);
    return (resp as any).data as ScoreResult;
  }

  async train(
    dataPath: string,
    symbol: string,
    interval: string = 'daily',
    observer?: [number, number, number],
    curvesFilter?: string[],
  ): Promise<TrainedProfile> {
    const resp = await this._send({
      action: 'train',
      data_path: dataPath,
      symbol,
      interval,
      observer,
      curves_filter: curvesFilter,
    });
    if (!resp.ok) throw new Error((resp as any).error);
    return (resp as any).data as TrainedProfile;
  }

  async trainFromJson(
    bars: Bar[],
    symbol: string,
    interval: string = 'daily',
    observer?: [number, number, number],
    curvesFilter?: string[],
    outputPath?: string,
  ): Promise<TrainedProfile> {
    const resp = await this._send({
      action: 'train_json',
      bars,
      symbol,
      interval,
      observer,
      curves_filter: curvesFilter,
      output_path: outputPath,
    });
    if (!resp.ok) throw new Error((resp as any).error);
    return (resp as any).data as TrainedProfile;
  }

  async backtest(
    profilePath: string,
    bars?: Bar[],
    dataPath?: string,
    symbol?: string,
    interval?: string,
  ): Promise<BacktestResult> {
    const resp = await this._send({
      action: 'backtest',
      profile_path: profilePath,
      bars,
      data_path: dataPath,
      symbol,
      interval,
    });
    if (!resp.ok) throw new Error((resp as any).error);
    return (resp as any).data as BacktestResult;
  }

  async getPhaseCurves(
    start: Date,
    end: Date,
    intervalMinutes: number = 1440,
    observer?: [number, number, number],
  ): Promise<PhaseCurveData[]> {
    const resp = await this._send({
      action: 'phase_curves',
      start: start.toISOString(),
      end: end.toISOString(),
      interval_minutes: intervalMinutes,
      observer,
    });
    if (!resp.ok) throw new Error((resp as any).error);
    return (resp as any).data as PhaseCurveData[];
  }

  async generateChart(
    profilePath: string,
    dataPath: string,
    symbol: string,
    outputPath: string,
    curves?: string[],
  ): Promise<string> {
    const resp = await this._send({
      action: 'chart',
      profile_path: profilePath,
      data_path: dataPath,
      symbol,
      curves,
      output_path: outputPath,
    });
    if (!resp.ok) throw new Error((resp as any).error);
    return (resp as any).data.chart_path;
  }
}
