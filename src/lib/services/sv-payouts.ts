/**
 * SV-A3 commission payouts (table `staff_payouts`, `books.edit`, audited "Staff payout", dated `date`): one per staff ×
 * month, never twice.
 *  - employee linked to payroll (payroll module on) → a payroll adjustment (earning, "Commission <month>", reference =
 *    the payout id) that the next payroll run picks up as today (salary TDS u/s 192 there);
 *  - otherwise → a journal Dr "Staff commission" | Cr Sundry creditors (the staff member as party), with opt-in TDS for a
 *    freelancer (194J doctors, 194H others — SV16) recorded in the TDS register.
 * Undo removes the adjustment / journal / TDS row through their own deletes (recycle bin). Verify with your CA.
 */
import './sv-registry';
import type { ServiceStaff, StaffPayout } from '../../types/services-r10';
import type { PayrollAdjustment } from '../../types/payroll';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import { deleteManualDeduction, saveManualDeduction, suggestTds } from '../tds-payables';
import { SV_TABLES } from './sv-shared';
import type { Statement } from './sv-commission';

export const STAFF_COMMISSION_ACCOUNT = 'Staff commission';
const ADJ = 'payroll_adjustments';
export const loadPayouts = (): StaffPayout[] => getTable<StaffPayout>(SV_TABLES.payouts).filter((r) => !!r && typeof r.id === 'string');

/** Is a month already paid out for this staff member? */
export const paidOut = (all: readonly Pick<StaffPayout, 'staff_id' | 'month'>[], staffId: string, month: string): boolean => all.some((p) => p.staff_id === staffId && p.month === month);

/** The default TDS section of a freelancer (opt-in): 194J for doctors, 194H for others (SV16). */
export const defaultTdsSection = (s: Pick<ServiceStaff, 'role' | 'tds_section'>): string => s.tds_section || (s.role === 'doctor' ? '194J' : '194H');

/** Where a payout goes. */
export const payoutRoute = (s: Pick<ServiceStaff, 'employment' | 'employee_id'>, payrollOn: boolean): StaffPayout['route'] => (s.employment === 'employee' && s.employee_id && payrollOn ? 'payroll' : 'journal');

function ensureAccount(): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => a.name.trim().toLowerCase() === STAFF_COMMISSION_ACCOUNT.toLowerCase());
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = 6197;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name: STAFF_COMMISSION_ACCOUNT, group: 'INDIRECT_EXPENSES' }).id;
}

const TDS_ACCOUNT: Record<string, string> = { '194J': A.tds194j, '194H': A.tds194h, '194C': A.tds194c };

/** Post a month's commission for one staff member. */
export function postPayout(staff: ServiceStaff, month: string, st: Pick<Statement, 'total' | 'lines'> & Partial<Pick<Statement, 'tips'>>, opts: { date: string; payrollOn: boolean; tds?: boolean }): StaffPayout {
  requireAccess('books.edit');
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose the month.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error('Choose the payout date.');
  const all = loadPayouts();
  if (paidOut(all, staff.id, month)) throw new Error(`Commission of ${staff.name} for ${month} is already paid out.`);
  const amount = round2(st.total);
  if (!(amount > 0)) throw new Error('No commission earned in this month.');
  const route = payoutRoute(staff, opts.payrollOn);
  const tips = round2(Math.min(Math.max(st.tips ?? 0, 0), amount));
  const base = { id: generateId(), staff_id: staff.id, staff_name: staff.name, month, date: opts.date, amount, route, ...(tips ? { tips } : {}), created_at: new Date().toISOString() };
  if (route === 'payroll') {
    return withTablesRollback([SV_TABLES.payouts, ADJ], () => {
      const adj: PayrollAdjustment = { id: generateId(), employee_id: staff.employee_id!, month, kind: 'earning', tag: 'bonus', name: `Commission ${month}${tips ? ` (incl. tips ₹${tips})` : ''}`, amount, reference: base.id, created_at: base.created_at };
      setTable(ADJ, [...getTable<PayrollAdjustment>(ADJ), adj]);
      const row: StaffPayout = { ...base, adjustment_id: adj.id };
      setTable(SV_TABLES.payouts, [...all, row]);
      return row;
    });
  }
  return withTablesRollback([SV_TABLES.payouts, 'vouchers', 'accounts', 'tds_deductions'], () => {
    const expense = ensureAccount();
    const section = defaultTdsSection(staff);
    let tds = 0;
    let tdsRow: string | undefined;
    if (opts.tds && staff.employment === 'freelance') {
      const vendor = getTable<{ id: string; pan?: string; name?: string }>('vendors').find((v) => v.id === staff.vendor_id);
      // Tips are passed through: outside the TDS base (SV70 — verify with your CA).
      const prior = all.filter((p) => p.staff_id === staff.id).map((p) => ({ id: p.id, date: p.date, base: round2(p.amount - (p.tips ?? 0)), tds: p.tds ?? 0, code: section }));
      const s = suggestTds(section, opts.date, round2(amount - tips), { pan: vendor?.pan }, prior);
      if (s && s.amount > 0) {
        tds = s.amount;
        tdsRow = saveManualDeduction({ vendor_id: staff.vendor_id, vendor_name: vendor?.name || staff.name, pan: vendor?.pan, section, date: opts.date, base: s.threshold.taxableBase, rate: s.rate, amount: s.amount, notes: `Staff commission ${month} (SV-A3)` }).id;
      }
    }
    const paise = Math.round(amount * 100);
    const tdsPaise = Math.round(tds * 100);
    const v = saveVoucher({
      type: 'JOURNAL',
      date: opts.date,
      narration: `Commission payable to ${staff.name} for ${month} (${st.lines.length} line(s))${tips ? `, incl. tips ₹${tips} passed through` : ''}${tds ? ` — TDS u/s ${section}` : ''}: verify with your CA`,
      lines: [
        { account_id: expense, dr: paise, cr: 0 },
        { account_id: A.creditors, dr: 0, cr: paise - tdsPaise, party: staff.name },
        ...(tdsPaise > 0 ? [{ account_id: TDS_ACCOUNT[section] ?? A.tdsPayable, dr: 0, cr: tdsPaise }] : []),
      ],
      voucher_class: 'Staff commission',
    });
    const row: StaffPayout = { ...base, voucher_id: v.id, voucher_number: v.number, ...(tds ? { tds, tds_row_id: tdsRow } : {}) };
    setTable(SV_TABLES.payouts, [...all, row]);
    return row;
  });
}

/** Undo a payout: its payroll adjustment, journal and TDS row go through their own deletes. */
export function undoPayout(id: string): void {
  requireAccess('books.edit');
  const row = loadPayouts().find((p) => p.id === id);
  if (!row) return;
  withTablesRollback([SV_TABLES.payouts, ADJ, 'vouchers', 'tds_deductions'], () => {
    if (row.adjustment_id) setTable(ADJ, getTable<PayrollAdjustment>(ADJ).filter((a) => a.id !== row.adjustment_id));
    if (row.voucher_id) deleteVoucher(row.voucher_id);
    if (row.tds_row_id) deleteManualDeduction(row.tds_row_id);
    setTable(SV_TABLES.payouts, loadPayouts().filter((p) => p.id !== id));
  });
}
