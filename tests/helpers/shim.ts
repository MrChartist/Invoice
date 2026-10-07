/**
 * Test harness shared by the integration / property tests.
 *
 *  - an in-memory `localStorage` (Node has none) installed on import;
 *  - `resetStorage()` between scenarios;
 *  - `freezeDate()` to run code that reads "today" on a fixed local day;
 *  - `inTimeZone()` to prove a result does not depend on the machine's zone.
 *
 * Import this module FIRST in a test file so storage exists before any lib code runs.
 */
import { mock } from 'node:test';

const mem = new Map<string, string>();

const shim = {
  getItem: (k: string) => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
};

(globalThis as unknown as { localStorage: unknown }).localStorage = shim;

export function resetStorage(): void {
  mem.clear();
}

/** Copy of every key/value currently stored. */
export function dumpStorage(): Record<string, string> {
  return Object.fromEntries(mem.entries());
}

export function loadStorage(data: Record<string, string>): void {
  for (const [k, v] of Object.entries(data)) mem.set(k, v);
}

/** Make `new Date()` / `Date.now()` return this LOCAL wall-clock moment until `thawDate()`. */
export function freezeDate(localIso: string): void {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: new Date(localIso) });
}

export function thawDate(): void {
  mock.timers.reset();
}

/** Run `fn` once per time zone, restoring the original zone afterwards. */
export function inTimeZones(zones: string[], fn: (tz: string) => void): void {
  const previous = process.env.TZ;
  try {
    for (const tz of zones) {
      process.env.TZ = tz;
      fn(tz);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/** Zones chosen to straddle midnight-UTC in both directions (and a DST one). */
export const ZONES = [
  'UTC',
  'Asia/Kolkata',
  'America/Los_Angeles',
  'America/New_York',
  'Pacific/Auckland',
  'Pacific/Honolulu',
  'Asia/Kathmandu',
];

/** Seeded PRNG (mulberry32): deterministic fuzz without any dependency. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
