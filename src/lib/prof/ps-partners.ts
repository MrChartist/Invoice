/**
 * PS-D1 partners (table `partners`, `settings.manage`, audited): the deed's terms by date (profit-sharing ratio,
 * remuneration, interest on capital and on drawings), "Capital — <name>" and "Current — <name>" ledgers (group
 * `CAPITAL`, created on save), drawings (Dr Current / Cr cash or bank) and interest on drawings by the product method
 * (by month). Shares of the partners in the firm on a date must total 100 % (`shareProblems`; a run refuses otherwise).
 * Working papers — verify with your CA (PS20, PS34).
 */
import './ps-registry';
import type { Partner, PartnerTerm } from '../../types/prof-r14';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { round2 } from '../invoice-calc';
import { chartOf, loadUserAccounts, saveUserAccount, type GroupId } from '../ledger/accounts';
import { loadVouchers, saveVoucher } from '../ledger/vouchers';
import { loadOpenings } from '../ledger/openings';
import { PS_D_CLASSES, PS_TABLES } from './ps-shared';
import { PARTNER_INTEREST_CAP_RULES, psRuleAt } from '../prof-rules';

const T = PS_TABLES.partners;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export const loadPartners = (): Partner[] => getTable<Partner>(T).filter((p) => !!p && typeof p.id === 'string' && Array.isArray(p.terms));

/** The deed term in force on `date` (latest `from` ≤ date), if any. */
export function termOn(p: Pick<Partner, 'terms'>, date: string): PartnerTerm | undefined {
  return [...p.terms].filter((t) => t.from <= date).sort((a, b) => a.from.localeCompare(b.from)).pop();
}

/** Partners in the firm on `date` (joined, not yet left). */
export const activeOn = (all: readonly Partner[], date: string): Partner[] => all.filter((p) => p.joined <= date && (!p.left || p.left >= date));

/** Σ share % of the partners in the firm on `date`. */
export const sharesOn = (all: readonly Partner[], date: string): number => round2(activeOn(all, date).reduce((s, p) => s + n(termOn(p, date)?.share_pct), 0));

/** Every date (joins, exits, term starts) where the partners' shares do not total 100 %. */
export function shareProblems(all: readonly Partner[]): { date: string; total: number }[] {
  const dates = [...new Set(all.flatMap((p) => [p.joined, ...p.terms.map((t) => t.from), ...(p.left ? [nextDay(p.left)] : [])]))].filter((d) => DAY.test(d)).sort();
  return dates.map((date) => ({ date, total: sharesOn(all, date) })).filter((x) => activeOn(all, x.date).length > 0 && Math.abs(x.total - 100) > 0.005);
}

export function nextDay(d: string): string {
  const t = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** Problems with one partner row (empty = fine). Shares above 100 % on any date are refused. */
export function validatePartner(p: Omit<Partner, 'id' | 'capital_account_id' | 'current_account_id'> & { id?: string }, others: readonly Partner[]): string[] {
  const e: string[] = [];
  if (!p.name?.trim()) e.push('Enter the partner’s name.');
  if (p.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(p.pan.toUpperCase())) e.push('PAN looks wrong (AAAAA9999A).');
  if (!DAY.test(p.joined ?? '')) e.push('Enter the date the partner joined.');
  if (p.left && (!DAY.test(p.left) || p.left < p.joined)) e.push('The exit date is before the joining date.');
  if (!p.terms?.length) e.push('Add the deed terms (share, remuneration, interest).');
  for (const t of p.terms ?? []) {
    if (!DAY.test(t.from)) e.push('Each term needs its start date.');
    if (!(n(t.share_pct) >= 0 && n(t.share_pct) <= 100)) e.push('Share must be between 0 and 100 %.');
    const cap = psRuleAt(PARTNER_INTEREST_CAP_RULES, t.from).value;
    if (n(t.interest_pct) < 0) e.push('Interest on capital cannot be negative.');
    else if (n(t.interest_pct) > cap) e.push(`Interest on capital above ${cap} % is not allowed as a deduction (Sec 40(b)) — the excess is disallowed; keep the deed rate and see the run, or enter ${cap} %.`);
    if (t.remuneration.mode === 'pct_book_profit' && !(n(t.remuneration.pct) > 0)) e.push('Enter the % of book profit.');
  }
  const draft = { ...p, id: p.id ?? '_new', capital_account_id: '', current_account_id: '' } as Partner;
  const all = [...others.filter((o) => o.id !== p.id), draft];
  for (const x of shareProblems(all)) if (x.total > 100.005) e.push(`Shares total ${x.total} % on ${x.date} (more than 100 %).`);
  return e;
}

/** Find a ledger by name, else create it under `group` with the first free code from `start`. */
export function ensureLedger(name: string, group: GroupId, start: number): string {
  const chart = chartOf(loadUserAccounts());
  const hit = chart.find((a) => a.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (hit) return hit.id;
  const codes = new Set(chart.map((a) => a.code));
  let c = start;
  while (codes.has(String(c))) c++;
  return saveUserAccount({ code: String(c), name, group }).id;
}

/** Save (add or edit) a partner; creates the capital and current ledgers on first save. Owner only, audited. */
export function savePartner(input: Omit<Partner, 'id' | 'capital_account_id' | 'current_account_id'> & { id?: string }): Partner {
  requireAccess('settings.manage');
  const all = loadPartners();
  const errors = validatePartner(input, all).filter((x) => !x.startsWith('Interest on capital above'));
  if (errors.length) throw new Error(errors[0]);
  const prev = input.id ? all.find((p) => p.id === input.id) : undefined;
  const name = input.name.trim();
  const row: Partner = {
    ...input,
    id: prev?.id ?? generateId(),
    name,
    ...(input.pan ? { pan: input.pan.toUpperCase() } : {}),
    terms: [...input.terms].map((t) => ({ ...t, share_pct: round2(n(t.share_pct)), interest_pct: round2(n(t.interest_pct)) })).sort((a, b) => a.from.localeCompare(b.from)),
    capital_account_id: prev?.capital_account_id || ensureLedger(`Capital — ${name}`, 'CAPITAL', 1020),
    current_account_id: prev?.current_account_id || ensureLedger(`Current — ${name}`, 'CAPITAL', 1040),
    created_at: prev?.created_at ?? new Date().toISOString(),
  };
  setTable(T, prev ? all.map((p) => (p.id === row.id ? row : p)) : [...all, row]);
  return row;
}

/**
 * A new profit-sharing ratio from `from` for the partners in the firm that day: each gets a term copied from the one in
 * force (remuneration, interest kept) with its new share. The shares must total 100 %. Owner only, audited.
 */
export function saveRatio(from: string, shares: Readonly<Record<string, number>>): Partner[] {
  requireAccess('settings.manage');
  if (!DAY.test(from)) throw new Error('Enter the date the new ratio starts.');
  const all = loadPartners();
  const inFirm = activeOn(all, from);
  const total = round2(inFirm.reduce((s, p) => s + n(shares[p.id]), 0));
  if (Math.abs(total - 100) > 0.005) throw new Error(`The new shares total ${total} %; they must total 100 %.`);
  const next = all.map((p) => {
    if (!inFirm.includes(p)) return p;
    const cur = termOn(p, from) ?? p.terms[0];
    const t: PartnerTerm = { ...cur, from, share_pct: round2(n(shares[p.id])) };
    return { ...p, terms: [...p.terms.filter((x) => x.from !== from), t].sort((a, b) => a.from.localeCompare(b.from)) };
  });
  setTable(T, next);
  return next;
}

/** Delete a partner who has no posting (the row goes to the recycle bin; ledgers stay). */
export function deletePartner(id: string): void {
  requireAccess('settings.manage');
  const all = loadPartners();
  const p = all.find((x) => x.id === id);
  if (!p) return;
  const used = getTable<{ partner_id?: string; lines?: { partner_id: string }[] }>(PS_TABLES.partnerRuns).some((r) => r?.partner_id === id || (r?.lines ?? []).some((l) => l.partner_id === id));
  const mine = (id: string) => id === p.current_account_id || id === p.capital_account_id;
  // QA19 U9: an opening balance on the partner's capital / current ledger is a balance too (not only vouchers).
  if (used || loadVouchers().some((v) => v.lines.some((l) => mine(l.account_id))) || loadOpenings().some((o) => mine(o.ledger_id) && o.dr - o.cr !== 0)) {
    throw new Error(`${p.name} has postings. Enter an exit date instead of deleting.`);
  }
  setTable(T, all.filter((x) => x.id !== id));
}

/** Drawings: Dr Current — partner / Cr the cash or bank ledger (a payment voucher, class "Partner drawings"). */
export function postDrawings(partnerId: string, amount: number, date: string, fromAccountId: string, narration = '') {
  const p = loadPartners().find((x) => x.id === partnerId);
  if (!p) throw new Error('Choose the partner.');
  const paise = Math.round(round2(amount) * 100);
  if (!(paise > 0)) throw new Error('Enter the amount drawn.');
  if (!fromAccountId) throw new Error('Choose the cash or bank account.');
  return saveVoucher({
    type: 'PAYMENT',
    date,
    narration: narration.trim() || `Drawings — ${p.name}`,
    lines: [{ account_id: p.current_account_id, dr: paise, cr: 0 }, { account_id: fromAccountId, dr: 0, cr: paise }],
    voucher_class: PS_D_CLASSES.drawings,
  });
}

/** Drawings of a partner in a period (₹), from vouchers debiting the current account with the drawings class. */
export function drawingsOf(p: Pick<Partner, 'current_account_id'>, from: string, to: string, vouchers = loadVouchers()): { date: string; amount: number }[] {
  return vouchers
    .filter((v) => v.voucher_class === PS_D_CLASSES.drawings && v.date >= from && v.date <= to)
    .flatMap((v) => v.lines.filter((l) => l.account_id === p.current_account_id && l.dr > 0).map((l) => ({ date: v.date, amount: round2(l.dr / 100) })));
}

/**
 * Interest on drawings by the product method, by month: each drawing × the months left in the FY counting its own month
 * (a drawing in April = 12, in March = 1) × rate ÷ 12. `fyEnd` is 31 March of the FY. The firm's income.
 */
export function interestOnDrawings(drawings: readonly { date: string; amount: number }[], ratePct: number, fyEnd: string): number {
  if (!(ratePct > 0)) return 0;
  const endIdx = +fyEnd.slice(0, 4) * 12 + +fyEnd.slice(5, 7);
  const product = drawings.reduce((s, d) => {
    const months = endIdx - (+d.date.slice(0, 4) * 12 + +d.date.slice(5, 7)) + 1;
    return s + (months > 0 && months <= 12 ? n(d.amount) * months : 0);
  }, 0);
  return round2((product * ratePct) / 100 / 12);
}
