/**
 * Per-client late-fee terms (roadmap 6.15) — the stored shape and its sanitiser only, with no
 * imports, so the client form can use it without pulling in the interest engine.
 * The maths and the "Add late fee" action live in `late-fee.ts`.
 */

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

export type ClientLateFeeMode = 'percent_pa' | 'flat';

export interface ClientLateFee {
  mode: ClientLateFeeMode;
  /** % a year (`percent_pa`) or rupees (`flat`). */
  rate: number;
  /** Interest-free days after the due date. */
  graceDays: number;
}

export const MAX_FLAT_FEE = 10_00_000;

/** Coerce a stored / hand-edited value; undefined when it is not a usable rule. */
export function sanitizeClientLateFee(v: unknown): ClientLateFee | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const mode: ClientLateFeeMode | null = o.mode === 'percent_pa' || o.mode === 'flat' ? o.mode : null;
  if (!mode) return undefined;
  const rate = r2(Math.min(Math.max(n(o.rate), 0), mode === 'percent_pa' ? 100 : MAX_FLAT_FEE));
  if (!(rate > 0)) return undefined;
  const graceDays = Math.round(Math.min(Math.max(n(o.graceDays), 0), 365));
  return { mode, rate, graceDays };
}

export function describeClientLateFee(fee: ClientLateFee): string {
  const base = fee.mode === 'percent_pa' ? `${fee.rate}% p.a. simple interest` : `flat ₹${fee.rate.toFixed(2)}`;
  return fee.graceDays > 0 ? `${base} after ${fee.graceDays} grace day${fee.graceDays === 1 ? '' : 's'}` : base;
}

