/**
 * CN-B2: secured advance (table `secured_advances`) — the client pays 75% (contract term) of the assessed value of
 * non-perishable materials brought to site. Default per CN7: NOT an advance for supply — a liability "Secured advance
 * from clients" (no GST), booked by a bank receipt journal (class "Secured advance"). It is recovered on RA bills as
 * the material is used (deduction `secured_advance`, `ref_id` = this row); the recovery receipt moves it out of the
 * liability through the RA deductions clearing account (`ra-receivable.ts`). What is recovered is read from the live
 * RA bills, never stored twice. Deleting removes the row and its journal together (both reach the recycle bin and
 * come back together). Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { SecuredAdvance } from '../../types/construction-r11';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { deleteVoucher, rupeesToPaise, saveVoucher } from '../ledger/vouchers';
import { bankLedgerId } from '../bank-ledgers';
import { ruleAt } from '../tax-rules';
import { ADVANCE_DEFAULTS } from '../construction-rules';
import { ensureAccountByName, SECURED_ACCOUNT } from '../works/ra-receivable';
import './cn-registry';

export const SECURED_TABLE = 'secured_advances';
export const SECURED_CLASS = 'Secured advance';

export const loadSecured = (): SecuredAdvance[] => peekTable<SecuredAdvance>(SECURED_TABLE).filter((s) => s && typeof s.id === 'string');

/** Value of the materials and the advance (pct % of it, default 75). */
export function securedAmount(materials: readonly { qty: number; rate: number }[], pct: number): { value: number; amount: number } {
  const value = round2(materials.reduce((s, m) => s + num(m.qty) * num(m.rate), 0));
  return { value, amount: round2((value * pct) / 100) };
}

/** Recovered so far: Σ `secured_advance` rows naming it on RA bills that are not cancelled. */
export const securedRecovered = (id: string, invoices: readonly Pick<InvoiceRecord, 'status' | 'ra_deductions'>[]): number =>
  round2(invoices.filter((i) => i.status !== 'Cancelled').reduce((s, i) => s + (i.ra_deductions ?? []).filter((d) => d.kind === 'secured_advance' && d.ref_id === id).reduce((t, d) => t + num(d.amount), 0), 0));

/** Pure: recovery for `qtyUsed` of the material (at its average rate × pct), or a typed amount; never past the balance. */
export function securedRecovery(sa: Pick<SecuredAdvance, 'materials' | 'pct' | 'amount'>, recovered: number, use: { qty?: number; amount?: number }): number {
  const left = round2(num(sa.amount) - recovered);
  if (!(left > 0)) return 0;
  const qty = sa.materials.reduce((s, m) => s + num(m.qty), 0);
  const want = num(use.amount) > 0 ? num(use.amount) : qty > 0 ? (num(use.qty) * (securedAmount(sa.materials, sa.pct).value / qty) * num(sa.pct)) / 100 : 0;
  return round2(Math.min(Math.max(want, 0), left));
}

export interface SecuredInput {
  contract_id: string;
  party: string;
  date: string;
  materials: { description: string; qty: number; unit?: string; rate: number; item_id?: string }[];
  pct?: number;
  mode?: string;
  bank_account_id?: string;
}

/** Record a secured advance received: the row and the bank receipt journal, all or nothing. */
export function recordSecured(i: SecuredInput): SecuredAdvance {
  requireAccess('doc.create');
  const pct = num(i.pct) > 0 ? num(i.pct) : ruleAt(ADVANCE_DEFAULTS, i.date).secured_pct;
  const materials = i.materials.filter((m) => m.description?.trim() && num(m.qty) > 0 && num(m.rate) > 0).map((m) => ({ ...m, description: m.description.trim(), value: round2(num(m.qty) * num(m.rate)) }));
  const { amount } = securedAmount(materials, pct);
  if (!(amount > 0) || !i.contract_id) throw new Error('Enter the materials at site (quantity and rate).');
  return withTablesRollback([SECURED_TABLE, 'vouchers', 'accounts'], () => {
    const p = rupeesToPaise(amount);
    const cash = i.mode === 'cash' ? A.cash : bankLedgerId(i.bank_account_id);
    const v = saveVoucher({ type: 'RECEIPT', date: i.date, voucher_class: SECURED_CLASS, narration: `Secured advance ${pct}% on materials at site — ${i.party}`, lines: [{ account_id: cash, dr: p, cr: 0 }, { account_id: ensureAccountByName(...SECURED_ACCOUNT), dr: 0, cr: p }] });
    const row: SecuredAdvance = { id: generateId(), contract_id: i.contract_id, date: i.date, materials, pct, amount, mode: i.mode || 'bank', ...(i.bank_account_id ? { bank_account_id: i.bank_account_id } : {}), voucher_id: v.id, status: 'open', created_at: new Date().toISOString() };
    setTable(SECURED_TABLE, [...getTable<SecuredAdvance>(SECURED_TABLE), row]);
    return row;
  });
}

/** Delete a secured advance nothing has recovered yet, with its journal (both to the recycle bin). */
export function deleteSecured(id: string, invoices: readonly InvoiceRecord[]): void {
  requireAccess('doc.create');
  if (securedRecovered(id, invoices) > 0) throw new Error('RA bills already recover this secured advance.');
  const row = loadSecured().find((s) => s.id === id);
  withTablesRollback([SECURED_TABLE, 'vouchers', 'recycle_bin'], () => {
    setTable(SECURED_TABLE, getTable<SecuredAdvance>(SECURED_TABLE).filter((s) => s.id !== id));
    if (row?.voucher_id) deleteVoucher(row.voucher_id);
  });
}
