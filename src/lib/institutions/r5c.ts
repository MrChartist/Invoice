/**
 * R5-C shared bits: the package's table names (registries, the "no pack, no read" test), its pack ids, helper
 * accounts created by name (fixed names, §6 of the Round 5 PRD) and small tolerant readers. No DOM.
 */
import { chartOf, loadUserAccounts, saveUserAccount, type PrimaryGroupId } from '../ledger/accounts';
import { isoDay } from '../dates';
import { round2 } from '../invoice-calc';
import type { PackId } from '../industry-packs';

export const FEE_PLANS_TABLE = 'fee_plans';
export const FEE_RUNS_TABLE = 'fee_runs';
export const COMMON_CREDIT_TABLE = 'common_credit_runs';
export const DONATIONS_TABLE = 'donations';
export const FORM_10BD_TABLE = 'form_10bd_filings';
export const FORM_10BE_TABLE = 'form_10be';
export const PROPERTIES_TABLE = 'properties';
export const LEASES_TABLE = 'leases';
export const DEPOSITS_TABLE = 'security_deposits';

/** Every R5-C table. */
export const R5C_TABLES = [FEE_PLANS_TABLE, FEE_RUNS_TABLE, COMMON_CREDIT_TABLE, DONATIONS_TABLE, FORM_10BD_TABLE, FORM_10BE_TABLE, PROPERTIES_TABLE, LEASES_TABLE, DEPOSITS_TABLE] as const;

/** The packs of this package (business types institution / nonprofit / property imply them). */
export const R5C_PACKS: readonly PackId[] = ['fees', 'nonprofit', 'leases'];

/** Helper ledgers (created by name once). */
export const DONATIONS_ACCOUNT = 'Donations received';
export const CORPUS_ACCOUNT = 'Donations — corpus fund';
export const DEPOSITS_RECEIVED_ACCOUNT = 'Security deposits received';
export const INTER_FUND_ACCOUNT = 'Inter-fund transfers';

export class R5cError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R5cError';
  }
}

export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
export const money = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? round2(n) : 0;
};
export const day = (v: unknown): string => isoDay(v);
export const paise = (rupees: number): number => Math.round(rupees * 100);

const norm = (s: string) => s.trim().toLowerCase();

/** A user ledger found (or created) by name. */
export function ensureAccount(name: string, group: PrimaryGroupId, startCode: number): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => norm(a.name) === norm(name));
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = startCode;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name, group }).id;
}

/** Whole days from `a` to `b` (local days). */
export function daysFrom(a: string, b: string): number {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 864e5);
}

const normHead = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Column of the first header equal to (then containing) one of the synonyms, skipping `used`; −1 when none. */
export function findCol(headers: readonly string[], syn: readonly string[], used: ReadonlySet<number> = new Set()): number {
  for (const exact of [true, false]) {
    for (const w of syn) {
      const i = headers.findIndex((h, k) => !used.has(k) && (exact ? normHead(h) === w : normHead(h).includes(w)));
      if (i >= 0) return i;
    }
  }
  return -1;
}
