/**
 * PS-D2 TDS u/s 194T on payments to partners. Credits of salary, remuneration, commission, bonus or interest to a
 * partner's current account — monthly credits (`partner_runs` rows `kind: 'credit'`) and the year-end run — are
 * aggregated per partner per FY; the credit that crosses ₹20,000 (`tds-rules.ts`) is taxed on the FY's total so far
 * (catch-up, PS19 a / Q34), every later credit on itself. Deductions go to the TDS register through the existing
 * `saveManualDeduction` (26Q / Form 140 working paper, challans); a 31 March credit is due by 30 April (the March rule).
 * Drawings and the residual profit share never. Working paper — verify with your CA.
 */
import './ps-registry';
import type { Partner, PartnerCreditKind, PartnerRun } from '../../types/prof-r14';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import { deleteManualDeduction, depositDueDate, fyQuarterOf, saveManualDeduction, suggestTds, type PriorCredit, type TdsSuggestion } from '../tds-payables';
import { PS_D_ACCOUNTS, PS_D_CLASSES, PS_TABLES } from './ps-shared';
import { ensureLedger, loadPartners } from './ps-partners';

export const KINDS_194T: readonly PartnerCreditKind[] = ['salary', 'remuneration', 'commission', 'bonus', 'interest'];
const RUNS = PS_TABLES.partnerRuns;

export const loadPartnerRuns = (): PartnerRun[] => getTable<PartnerRun>(RUNS).filter((r) => !!r && typeof r.id === 'string');

const fyOf = (date: string) => fyQuarterOf(date)?.fy ?? +date.slice(0, 4);

/** The 194T credits of a partner in the FY of `date` (both monthly credits and year-end lines), as prior credits. */
export function partnerCredits(partnerId: string, fy: number, runs: readonly PartnerRun[] = loadPartnerRuns(), excludeId?: string): PriorCredit[] {
  const out: PriorCredit[] = [];
  for (const r of runs) {
    if (r.fy !== fy || r.id === excludeId) continue;
    if (r.kind === 'credit' && r.partner_id === partnerId) out.push({ id: r.id, date: r.date, base: round2(r.amount ?? 0), tds: round2(r.tds ?? 0), code: '194T' });
    for (const l of r.kind === 'year_end' ? r.lines ?? [] : []) {
      if (l.partner_id === partnerId && l.remuneration + l.interest > 0) out.push({ id: `${r.id}:${partnerId}`, date: r.date, base: round2(l.remuneration + l.interest), tds: round2(l.tds ?? 0), code: '194T' });
    }
  }
  // A credit taxed later by the catch-up is not caught up again: mark it (a token amount, never shown).
  const lastTaxed = out.filter((c) => c.tds > 0).map((c) => c.date).sort().pop();
  return lastTaxed ? out.map((c) => (c.tds > 0 || c.date > lastTaxed ? c : { ...c, tds: COVERED })) : out;
}
const COVERED = 1e-9;

/** 194T on a new credit of `amount` to `p` on `date` (null before 1 Apr 2025: no section). */
export function tds194tFor(p: Pick<Partner, 'id' | 'pan'>, date: string, amount: number, runs?: readonly PartnerRun[], excludeId?: string): TdsSuggestion | null {
  return suggestTds('194T', date, round2(amount), { pan: p.pan, deducteeType: 'INDIVIDUAL' }, partnerCredits(p.id, fyOf(date), runs, excludeId));
}

/** Record a 194T deduction in the TDS register (returns its row id), or '' when nothing is due. */
export function record194t(p: Partner, date: string, s: TdsSuggestion | null, note: string): string {
  if (!s || !(s.amount > 0)) return '';
  return saveManualDeduction({ vendor_id: p.vendor_id, vendor_name: p.name, pan: p.pan, deductee_type: 'INDIVIDUAL', section: '194T', date, base: s.base, rate: s.rate, amount: s.amount, notes: note }).id;
}

const expenseFor = (k: PartnerCreditKind) => (k === 'interest' ? ensureLedger(PS_D_ACCOUNTS.interest, 'FINANCE', 6290) : ensureLedger(PS_D_ACCOUNTS.remuneration, 'INDIRECT_EXPENSES', 6180));

/**
 * A monthly credit to a partner: Dr Partners' remuneration (or Interest on partners' capital) / Cr Current — partner
 * (net of TDS) / Cr TDS payable; the 194T row in the register; one `partner_runs` row (all or nothing).
 */
export function creditPartner(input: { partnerId: string; kind: PartnerCreditKind; amount: number; date: string; notes?: string }): PartnerRun {
  requireAccess('books.edit');
  const p = loadPartners().find((x) => x.id === input.partnerId);
  if (!p) throw new Error('Choose the partner.');
  if (!KINDS_194T.includes(input.kind)) throw new Error('Choose what is credited.');
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new Error('Enter the amount credited.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Choose the date.');
  return withTablesRollback([RUNS, 'vouchers', 'accounts', 'tds_deductions'], () => {
    const s = tds194tFor(p, input.date, amount);
    const id = generateId();
    const tdsRow = record194t(p, input.date, s, `194T on ${input.kind} credited to ${p.name}`);
    const tds = tdsRow ? s!.amount : 0;
    const paise = Math.round(amount * 100);
    const tdsPaise = Math.round(tds * 100);
    const v = saveVoucher({
      type: 'JOURNAL',
      date: input.date,
      narration: `${input.kind[0].toUpperCase()}${input.kind.slice(1)} credited to ${p.name}${tds ? ` — TDS u/s 194T ₹${tds}` : ''}: verify with your CA`,
      lines: [
        { account_id: expenseFor(input.kind), dr: paise, cr: 0 },
        { account_id: p.current_account_id, dr: 0, cr: paise - tdsPaise },
        ...(tdsPaise ? [{ account_id: A.tdsPayable, dr: 0, cr: tdsPaise }] : []),
      ],
      voucher_class: PS_D_CLASSES.credit,
    });
    const row: PartnerRun = { id, kind: 'credit', date: input.date, fy: fyOf(input.date), partner_id: p.id, credit_kind: input.kind, amount, ...(tds ? { tds, tds_row_id: tdsRow } : {}), voucher_ids: [v.id], ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}), created_at: new Date().toISOString() };
    setTable(RUNS, [...loadPartnerRuns(), row]);
    return row;
  });
}

/** Undo a monthly credit or a year-end run: its journals and TDS rows go through their own deletes (recycle bin). */
export function undoPartnerRun(id: string): void {
  requireAccess('books.edit');
  const r = loadPartnerRuns().find((x) => x.id === id);
  if (!r) return;
  withTablesRollback([RUNS, 'vouchers', 'tds_deductions', 'transactions', 'invoices'], () => {
    setTable(RUNS, loadPartnerRuns().filter((x) => x.id !== id));
    for (const v of r.voucher_ids ?? []) deleteVoucher(v);
    for (const t of [r.tds_row_id, ...(r.lines ?? []).map((l) => l.tds_row_id)]) if (t) deleteManualDeduction(t);
  });
}

/** One row per partner for the 194T view: FY credits, aggregate, TDS deducted, the threshold and the deposit due dates. */
export function register194t(fy: number, partners: readonly Partner[] = loadPartners(), runs: readonly PartnerRun[] = loadPartnerRuns()) {
  return partners.map((p) => {
    const credits = partnerCredits(p.id, fy, runs).sort((a, b) => a.date.localeCompare(b.date));
    return {
      partner: p,
      credits: credits.map((c) => ({ ...c, tds: round2(c.tds), due: c.tds >= 0.01 ? depositDueDate(c.date) : '' })),
      total: round2(credits.reduce((s, c) => s + c.base, 0)),
      tds: round2(credits.reduce((s, c) => s + c.tds, 0)),
    };
  });
}
