/**
 * File service for chart save/load (JSON serialization).
 */
import { ChartConfig, CompactBar, SecurityData, SerializedSecurity, ViewState } from '../types/chart';
import { ChartObject } from '../types/objects';
import { PlanetLineObject } from '../types/planet';
import { migratePlanetLines } from '../utils/migratePlanetLines';
import { log } from './Logger';

/** Chart file format version */
const FILE_VERSION = 1;

/** Template file format version */
const TEMPLATE_VERSION = 1;

/** Template file format (.tem) — chart objects only */
export interface TemplateFile {
  version: number;
  objects: ChartObject[];
  savedAt: string;
}

/** Saved chart file format */
export interface ChartFile {
  version: number;
  security: SerializedSecurity | null;
  config: ChartConfig;
  viewState: Partial<ViewState>;
  objects: ChartObject[];
  planetLines: PlanetLineObject[];
  bars?: CompactBar[];
  savedAt: string;
}

/** Serialize chart to JSON string */
export function serializeChart(
  security: SecurityData | null,
  config: ChartConfig,
  viewState: ViewState,
  objects: ChartObject[],
  planetLines: PlanetLineObject[],
): string {
  const file: ChartFile = {
    version: FILE_VERSION,
    security: security
      ? {
          symbol: security.info.symbol,
          name: security.info.name,
          conId: security.info.conId,
          exchange: security.info.exchange,
          lastTradeDate: security.info.lastTradeDate,
          secType: security.info.secType,
          period: security.period,
          interval: security.interval,
        }
      : null,
    config,
    viewState: {
      scrollOffset: viewState.scrollOffset,
      pixelsPerBar: viewState.pixelsPerBar,
      autoScale: viewState.autoScale,
    },
    objects,
    planetLines: planetLines.map((pl) => ({
      ...pl,
      samples: [], // Don't save cached samples
      dirty: true,
    })),
    bars: security?.bars.map((b) => ({
      t: b.time,
      o: b.open,
      h: b.high,
      l: b.low,
      c: b.close,
      v: b.volume,
    })) ?? [],
    savedAt: new Date().toISOString(),
  };
  return JSON.stringify(file);
}

/** Deserialize chart from JSON string */
export function deserializeChart(json: string): ChartFile {
  const file = JSON.parse(json);
  if (!file || typeof file !== 'object') {
    throw new Error('Invalid chart file: not a JSON object');
  }
  if (!file.version || file.version > FILE_VERSION) {
    throw new Error(`Unsupported chart file version: ${file.version}`);
  }
  if (!file.config || typeof file.config !== 'object') {
    throw new Error('Invalid chart file: missing config');
  }
  if (!Array.isArray(file.objects)) file.objects = [];
  if (!Array.isArray(file.planetLines)) file.planetLines = [];
  if (file.planetLines.length) {
    file.planetLines = migratePlanetLines(file.planetLines);
  }
  return file as ChartFile;
}

/** Trigger a file download in the browser */
export function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Result from opening a file */
export interface OpenFileResult {
  content: string;
  filename: string;
}

/**
 * Save file using File System Access API and return the file handle for reuse.
 * First save shows the native picker; the returned handle enables silent re-saves.
 * Returns { handle, filename } or null if File System Access API is unavailable.
 */
export async function saveFileWithPickerGetHandle(
  content: string,
  suggestedName: string,
): Promise<{ handle: FileSystemFileHandle | null; filename: string } | null> {
  if ('showSaveFilePicker' in window) {
    let handle: any = null;
    try {
      handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [{
          description: 'UltraChart Files',
          accept: { 'application/json': ['.uchart', '.json'] },
        }],
      });
      // Chrome requires document focus for createWritable — the picker dialog
      // may briefly steal focus, so wait for it to return
      if (!document.hasFocus()) {
        await new Promise<void>((resolve) => {
          const onFocus = () => { window.removeEventListener('focus', onFocus); resolve(); };
          window.addEventListener('focus', onFocus);
          setTimeout(resolve, 500);
        });
      }
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { handle, filename: handle.name };
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      const chosenName = handle?.name ?? suggestedName;
      log.warn('FileService', `createWritable failed (${err.message}), falling back to download`);
      downloadFile(content, chosenName);
      return { handle: null, filename: chosenName };
    }
  }
  downloadFile(content, suggestedName);
  return { handle: null, filename: suggestedName };
}

/** Open a file picker and read a JSON file. Returns content + filename. */
export function openFile(accept = '.json,.uchart'): Promise<OpenFileResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({
        content: reader.result as string,
        filename: file.name,
      });
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };
    // Handle cancel — 'cancel' event fires when the user dismisses the picker
    input.addEventListener('cancel', () => {
      reject(new Error('No file selected'));
    });
    input.click();
  });
}

// ── Template (.tem) file support ──

/** Serialize chart objects to a .tem JSON string */
export function serializeTemplate(objects: ChartObject[]): string {
  const data: TemplateFile = {
    version: TEMPLATE_VERSION,
    objects: objects.map((o) => ({ ...o, selected: false })),
    savedAt: new Date().toISOString(),
  };
  return JSON.stringify(data);
}

/** Deserialize a .tem JSON string */
export function deserializeTemplate(json: string): TemplateFile {
  const data = JSON.parse(json);
  if (!data.version || !Array.isArray(data.objects)) {
    throw new Error('Invalid template file');
  }
  if (data.version > TEMPLATE_VERSION) {
    throw new Error(`Unsupported template version: ${data.version}`);
  }
  return data as TemplateFile;
}

/** Save template using File System Access API (native picker). */
export async function saveTemplateWithPicker(content: string, suggestedName: string): Promise<string> {
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [{
          description: 'UltraChart Template',
          accept: { 'application/json': ['.tem'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return handle.name;
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      downloadFile(content, suggestedName);
      return suggestedName;
    }
  }
  downloadFile(content, suggestedName);
  return suggestedName;
}

/** Open a .tem file picker. */
export function openTemplateFile(): Promise<OpenFileResult> {
  return openFile('.tem,.json');
}
