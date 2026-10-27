/**
 * AG-B2 milk analyser input: plain ASCII lines over Web Serial (the `scale-serial.ts` pattern — feature-detected, the
 * port used only after the user picks it, nothing sent to the device). Presets: "generic CSV" (configurable field order
 * and separator) and "key=value" (`FAT=4.5 SNF=8.6 CLR=28 W=0`). Some analysers send fixed-point numbers ("045" =
 * 4.5): `div` divides every value. The profile is device-local (`mrchartist_milk_analyser`, never backed up or synced).
 * Proprietary protocols are out of scope (PRD non-goal): anything else is typed.
 */
import { splitFrames } from '../scale-barcode';

export type AnalyserField = 'fat' | 'snf' | 'clr' | 'water' | 'skip';
export interface AnalyserProfile { preset: 'csv' | 'kv'; sep: string; order: AnalyserField[]; div: number; baud: number }
export interface AnalyserReading { fat: number; snf: number; clr?: number; water_pct?: number }

export const ANALYSER_KEY = 'mrchartist_milk_analyser';
export const DEFAULT_ANALYSER: AnalyserProfile = { preset: 'csv', sep: ',', order: ['fat', 'snf', 'clr', 'water'], div: 1, baud: 9600 };
const FIELDS: readonly AnalyserField[] = ['fat', 'snf', 'clr', 'water', 'skip'];
const KEYS: Readonly<Record<string, AnalyserField>> = { fat: 'fat', f: 'fat', snf: 'snf', s: 'snf', clr: 'clr', c: 'clr', lr: 'clr', water: 'water', w: 'water', wat: 'water', aw: 'water' };

export function cleanAnalyser(raw: unknown): AnalyserProfile {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AnalyserProfile>;
  const order = Array.isArray(r.order) ? r.order.filter((f) => FIELDS.includes(f)) : [];
  return {
    preset: r.preset === 'kv' ? 'kv' : 'csv',
    sep: typeof r.sep === 'string' && r.sep.length === 1 ? r.sep : ',',
    order: order.includes('fat') && order.includes('snf') ? order : DEFAULT_ANALYSER.order,
    div: [1, 10, 100].includes(Number(r.div)) ? Number(r.div) : 1,
    baud: [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(Number(r.baud)) ? Number(r.baud) : 9600,
  };
}
export function loadAnalyser(): AnalyserProfile {
  try {
    return cleanAnalyser(JSON.parse(localStorage.getItem(ANALYSER_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_ANALYSER };
  }
}
export function saveAnalyser(p: AnalyserProfile): void {
  try {
    localStorage.setItem(ANALYSER_KEY, JSON.stringify(cleanAnalyser(p)));
  } catch {
    /* storage blocked: the profile lasts for this page only */
  }
}

/** One frame → a reading, or null for a partial / unreadable frame (fat and SNF are required, each 0–20 %). */
export function parseAnalyserFrame(line: string, p: AnalyserProfile = DEFAULT_ANALYSER): AnalyserReading | null {
  const vals: Partial<Record<AnalyserField, number>> = {};
  const put = (f: AnalyserField | undefined, raw: string) => {
    const n = Number(raw.replace(/[^\d.-]/g, ''));
    if (f && f !== 'skip' && raw.trim() && Number.isFinite(n)) vals[f] = n / p.div;
  };
  if (p.preset === 'kv') for (const m of line.matchAll(/([A-Za-z]+)\s*[=:]\s*(-?\d+(?:\.\d+)?)/g)) put(KEYS[m[1].toLowerCase()], m[2]);
  else line.split(p.sep === ' ' ? /\s+/ : p.sep).forEach((t, i) => put(p.order[i], t));
  const ok = (n: number | undefined) => n !== undefined && n >= 0 && n <= 20;
  if (!ok(vals.fat) || !ok(vals.snf)) return null;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { fat: r2(vals.fat!), snf: r2(vals.snf!), ...(vals.clr !== undefined ? { clr: r2(vals.clr) } : {}), ...(vals.water !== undefined ? { water_pct: r2(vals.water) } : {}) };
}

/* ── Web Serial (browser only) ── */

interface PortLike { open(o: { baudRate: number }): Promise<void>; close(): Promise<void>; readable: ReadableStream<Uint8Array> | null }
const serial = (): { requestPort(): Promise<PortLike> } | null => (typeof navigator !== 'undefined' ? (navigator as Navigator & { serial?: { requestPort(): Promise<PortLike> } }).serial ?? null : null);
export const analyserSupported = (): boolean => !!serial();
let port: PortLike | null = null;

/** Read lines until one parses (or `timeoutMs` passes → null). Opens and closes the port each time. */
export async function readAnalyser(p: AnalyserProfile = loadAnalyser(), timeoutMs = 4000): Promise<AnalyserReading | null> {
  const s = serial();
  if (!s) throw new Error('This browser has no Web Serial (Chrome / Edge on a computer): type the readings.');
  port ??= await s.requestPort();
  await port.open({ baudRate: p.baud });
  const reader = port.readable?.getReader();
  const timer = setTimeout(() => void reader?.cancel().catch(() => {}), timeoutMs);
  const dec = new TextDecoder('ascii');
  let buf = '';
  try {
    for (;;) {
      const r = await reader?.read();
      if (!r || r.done) return null;
      buf += dec.decode(r.value, { stream: true });
      const { frames, rest } = splitFrames(buf);
      buf = rest.slice(-256);
      for (const f of frames) {
        const hit = parseAnalyserFrame(f, p);
        if (hit) return hit;
      }
    }
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
    await port.close().catch(() => {});
  }
}
