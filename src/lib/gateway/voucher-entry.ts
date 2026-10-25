/**
 * Tally-style single-screen voucher entry (Phase 7) for Contra / Payment / Receipt / Journal, on top
 * of the manual voucher API (src/lib/ledger/vouchers.ts — numbering, period lock, audit, roles).
 * Pure helpers for the screen (src/components/gateway/VoucherEntry.tsx): Dr/Cr lines, auto-balancing,
 * ledger type-ahead over the chart of accounts + parties, and Alt+C inline creation.
 */
import type { Client } from '../../types/invoice';
import type { Vendor } from '../../types/purchases';
import { A, chartOf, groupOf, loadUserAccounts, saveUserAccount, type Account, type GroupId } from '../ledger/accounts';
import { isCashOrBankLedger } from '../bank-ledgers';
import { rupeesToPaise, type ManualVoucher, type ManualVoucherInput, type ManualVoucherType } from '../ledger/vouchers';
import { localDb } from '../localDb';
import { vendorsDb } from '../vendors';
import { requireAccess } from '../access';

export type EntrySide = 'dr' | 'cr';

export const ROUTE_TYPES: Record<string, ManualVoucherType> = {
  contra: 'CONTRA',
  payment: 'PAYMENT',
  receipt: 'RECEIPT',
  journal: 'JOURNAL',
};

export const typeRoute = (t: ManualVoucherType) => t.toLowerCase();

export interface EntryLine {
  key: number;
  side: EntrySide;
  account_id: string;
  party?: string;
  /** As typed (rupees). */
  amount: string;
  cost_centre_id?: string;
}

/** Side of the first line, as in TallyPrime's double-entry mode. */
export function firstSide(type: ManualVoucherType): EntrySide {
  return type === 'RECEIPT' || type === 'CONTRA' ? 'cr' : 'dr';
}

export const opposite = (s: EntrySide): EntrySide => (s === 'dr' ? 'cr' : 'dr');

/** Debit / credit totals in paise; `diff` = dr − cr. */
export function entryTotals(lines: readonly EntryLine[]): { dr: number; cr: number; diff: number } {
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    const p = rupeesToPaise(l.amount);
    if (l.side === 'dr') dr += p;
    else cr += p;
  }
  return { dr, cr, diff: dr - cr };
}

const toText = (paise: number) => (paise / 100).toFixed(2);

/** Amount that balances the voucher on `side`, given the other lines (0 when that side is already ahead). */
export function balancingAmount(lines: readonly EntryLine[], side: EntrySide, exceptKey?: number): number {
  const t = entryTotals(lines.filter((l) => l.key !== exceptKey));
  const need = side === 'cr' ? t.diff : -t.diff;
  return need > 0 ? need : 0;
}

/**
 * The next line Tally would offer after `lines`: on the side that is short, pre-filled with the
 * difference; when the voucher balances, a blank line continuing the last side (or null when it balances
 * and `onlyIfUnbalanced`).
 */
export function nextLine(lines: readonly EntryLine[], key: number, type: ManualVoucherType, onlyIfUnbalanced = false): EntryLine | null {
  const t = entryTotals(lines);
  if (t.diff === 0) {
    if (onlyIfUnbalanced) return null;
    const last = lines[lines.length - 1];
    return { key, side: last ? opposite(last.side) : firstSide(type), account_id: '', amount: '' };
  }
  const side: EntrySide = t.diff > 0 ? 'cr' : 'dr';
  return { key, side, account_id: '', amount: toText(Math.abs(t.diff)) };
}

/** Fill an empty amount on line `key` with what balances the voucher (Tally pre-fills the last line). */
export function autoFill(lines: readonly EntryLine[], key: number): EntryLine[] {
  return lines.map((l) => {
    if (l.key !== key || l.amount.trim()) return l;
    const amt = balancingAmount(lines, l.side, key);
    return amt ? { ...l, amount: toText(amt) } : l;
  });
}

/** Lines that carry something (account or amount). */
export const filledLines = (lines: readonly EntryLine[]) => lines.filter((l) => l.account_id || l.amount.trim());

/** Build the manual-voucher input. Cost centres are kept on income / expense lines only. */
export function toVoucherInput(
  v: { id?: string; type: ManualVoucherType; date: string; narration: string; number?: string },
  lines: readonly EntryLine[],
  chart: readonly Account[],
): ManualVoucherInput {
  const byId = new Map(chart.map((a) => [a.id, a]));
  const pnl = (id: string) => {
    const a = byId.get(id);
    const n = a ? groupOf(a.group).nature : undefined;
    return n === 'income' || n === 'expense';
  };
  return {
    ...(v.id ? { id: v.id } : {}),
    ...(v.number ? { number: v.number } : {}),
    type: v.type,
    date: v.date,
    narration: v.narration,
    lines: filledLines(lines).map((l) => {
      const p = rupeesToPaise(l.amount);
      return {
        account_id: l.account_id,
        dr: l.side === 'dr' ? p : 0,
        cr: l.side === 'cr' ? p : 0,
        ...(l.party ? { party: l.party } : {}),
        ...(l.cost_centre_id && pnl(l.account_id) ? { cost_centre_id: l.cost_centre_id } : {}),
      };
    }),
  };
}

/** Editable lines from a stored voucher. */
export function linesFromVoucher(v: ManualVoucher, nextKey: () => number): EntryLine[] {
  return v.lines.map((l) => ({
    key: nextKey(),
    side: l.dr > 0 ? 'dr' : 'cr',
    account_id: l.account_id,
    ...(l.party ? { party: l.party } : {}),
    amount: toText(l.dr > 0 ? l.dr : l.cr),
    ...(l.cost_centre_id ? { cost_centre_id: l.cost_centre_id } : {}),
  }));
}

/* ── Ledger type-ahead ─────────────────────────────────────────── */

export type LedgerKind = 'account' | 'customer' | 'vendor';

export interface LedgerOption {
  key: string;
  account_id: string;
  party?: string;
  name: string;
  /** Group label (accounts) or the control account (parties). */
  sub: string;
  kind: LedgerKind;
}

export const optionKey = (account_id: string, party?: string) => (party ? `${account_id}|${party}` : account_id);

/**
 * Everything a line can post to: chart accounts, and each customer (Sundry debtors) / vendor (Sundry
 * creditors) as a party sub-ledger. A contra voucher offers cash & bank accounts only.
 */
export function ledgerOptions(chart: readonly Account[], clients: readonly Pick<Client, 'name'>[], vendors: readonly Pick<Vendor, 'name'>[], type: ManualVoucherType): LedgerOption[] {
  const accounts = type === 'CONTRA' ? chart.filter((a) => isCashOrBankLedger(a)) : chart;
  const out: LedgerOption[] = accounts.map((a) => ({ key: a.id, account_id: a.id, name: a.name, sub: `${a.code} · ${groupOf(a.group).label}`, kind: 'account' }));
  if (type === 'CONTRA') return out;
  const debtors = chart.find((a) => a.id === A.debtors);
  const creditors = chart.find((a) => a.id === A.creditors);
  const seen = new Set<string>();
  for (const c of clients) {
    const name = (c.name ?? '').trim();
    if (!name || !debtors || seen.has(`c|${name.toLowerCase()}`)) continue;
    seen.add(`c|${name.toLowerCase()}`);
    out.push({ key: optionKey(debtors.id, name), account_id: debtors.id, party: name, name, sub: debtors.name, kind: 'customer' });
  }
  for (const v of vendors) {
    const name = (v.name ?? '').trim();
    if (!name || !creditors || seen.has(`v|${name.toLowerCase()}`)) continue;
    seen.add(`v|${name.toLowerCase()}`);
    out.push({ key: optionKey(creditors.id, name), account_id: creditors.id, party: name, name, sub: creditors.name, kind: 'vendor' });
  }
  return out;
}

/** Type-ahead: name prefix first, then a word prefix, then code / group / anywhere. */
export function searchLedgers(options: readonly LedgerOption[], query: string, limit = 8): LedgerOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, limit);
  const scored: Array<{ o: LedgerOption; r: number; i: number }> = [];
  options.forEach((o, i) => {
    const n = o.name.toLowerCase();
    let r = -1;
    if (n.startsWith(q)) r = 0;
    else if (n.split(/[\s(&/-]+/).some((w) => w.startsWith(q))) r = 1;
    else if (n.includes(q)) r = 2;
    else if (o.sub.toLowerCase().includes(q)) r = 3;
    if (r >= 0) scored.push({ o, r, i });
  });
  return scored
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.o);
}

/** Label for a line's current ledger. */
export function lineLabel(line: Pick<EntryLine, 'account_id' | 'party'>, byId: ReadonlyMap<string, Account>): string {
  if (line.party) return line.party;
  return byId.get(line.account_id)?.name ?? '';
}

/* ── Alt+C: create a ledger / party inline ─────────────────────── */

/** Next free numeric code in the group's block (e.g. 6390 → 6391), or `U<n>` when none fits. */
export function nextAccountCode(chart: readonly Account[], group: GroupId): string {
  const taken = new Set(chart.map((a) => a.code.toLowerCase()));
  const nums = chart.filter((a) => a.group === group && /^\d+$/.test(a.code)).map((a) => Number(a.code));
  if (nums.length) {
    for (let c = Math.max(...nums) + 1; c < Math.max(...nums) + 200; c++) if (!taken.has(String(c))) return String(c);
  }
  for (let n = 1; ; n++) if (!taken.has(`u${n}`)) return `U${n}`;
}

export type CreateLedgerInput =
  | { kind: 'account'; name: string; group: GroupId }
  | { kind: 'customer'; name: string; gstin?: string }
  | { kind: 'vendor'; name: string; gstin?: string };

/**
 * Create the ledger and return it as a type-ahead option. Accounts go to the chart (audited by
 * saveUserAccount); customers to clients, vendors to vendors (as party sub-ledgers of debtors /
 * creditors). Throws with a user-facing message when the name is empty, taken or the role may not.
 */
export function createLedgerInline(input: CreateLedgerInput): LedgerOption {
  const name = input.name.trim();
  if (!name) throw new Error('Enter a name.');
  requireAccess('master.edit');
  const chart = chartOf(loadUserAccounts());
  if (input.kind === 'account') {
    const a = saveUserAccount({ code: nextAccountCode(chart, input.group), name, group: input.group });
    return { key: a.id, account_id: a.id, name: a.name, sub: `${a.code} · ${groupOf(a.group).label}`, kind: 'account' };
  }
  if (input.kind === 'customer') {
    localDb.clients.upsert({ name, ...(input.gstin?.trim() ? { gstin: input.gstin.trim().toUpperCase() } : {}) });
    const debtors = chart.find((a) => a.id === A.debtors);
    return { key: optionKey(A.debtors, name), account_id: A.debtors, party: name, name, sub: debtors?.name ?? '', kind: 'customer' };
  }
  const exists = vendorsDb.all().find((v) => v.name.trim().toLowerCase() === name.toLowerCase());
  const v = exists ?? vendorsDb.save({ name, ...(input.gstin?.trim() ? { gstin: input.gstin.trim() } : {}) } as Omit<Vendor, 'id'>);
  const creditors = chart.find((a) => a.id === A.creditors);
  return { key: optionKey(A.creditors, v.name), account_id: A.creditors, party: v.name, name: v.name, sub: creditors?.name ?? '', kind: 'vendor' };
}
