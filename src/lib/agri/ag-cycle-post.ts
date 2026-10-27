/**
 * AG-A4 pooled cycle bills (table `farmer_cycles`, `CYB/FY…`). Close writes ONE `purchases` row per cycle (vendor =
 * the centre's pooled vendor "Milk producers — <centre>" / "Farmers — <centre>", created on first use; lines per unit;
 * `bill_number` = the CYB number; `ag.cycle_id`), so stock, GSTR-3B Table 5 and the purchase register read it once.
 * Deductions on close:
 *  - feed / input: a receipt on the farmer's invoice with `exchange_purchase_id` = the cycle's purchase (the existing
 *    no-cash marker — cash readers skip it through `movedNoCash`); the books post it Dr Sundry creditors (party = the
 *    farmer) | Cr Debtors, so the set-off journal moves the total from the pooled payable to that same party;
 *  - advance / loan → Cr "Farmer advances"; share → Cr "Share application money — members"; insurance / union / other →
 *    a named ledger (created on first use).
 * The journal total is rolled into the purchase's `amount_paid` (as the R11 sub-contractor deductions), so payables show
 * the net due. Pay: one purchase payment per mode (bank / cash); the bank file is built separately (nothing is sent).
 * Reopen (closed, unpaid): its receipts, journal and purchase go through their own guards (recycle bin); the CYB number
 * stays used. Working paper — verify with your CA (AG26, AG27).
 */
import './ag-registry';
import type { FarmerCycle, FarmerCycleLine } from '../../types/agri-r12';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { PurchaseLine, Vendor } from '../../types/purchases';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { paymentsDb, purchasesDb } from '../purchases';
import { vendorsDb } from '../vendors';
import { A, chartOf, loadUserAccounts, saveUserAccount, type PrimaryGroupId } from '../ledger/accounts';
import { deleteVoucher, saveVoucher, VOUCHERS_TABLE } from '../ledger/vouchers';
import { AG_SERIES, AG_TABLES } from './ag-shared';
import { cycleTotals, settleLines } from './ag-cycles';

export const CYB = AG_SERIES.cycles;
const T = AG_TABLES.cycles;
export const SET_OFF_METHOD = 'Set-off';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const loadCycles = (): FarmerCycle[] => getTable<FarmerCycle>(T).filter((c) => c && typeof c.id === 'string');
const put = (c: FarmerCycle) => setTable(T, [...loadCycles().filter((x) => x.id !== c.id), c]);

/** Ledgers of the deductions (by name, created on first use). */
const LEDGERS: Readonly<Record<string, [string, PrimaryGroupId, number]>> = {
  advance: ['Farmer advances', 'LOANS_ADV_ST', 3650],
  loan: ['Farmer advances', 'LOANS_ADV_ST', 3650],
  share: ['Share application money — members', 'OTHER_CL', 2470],
  insurance: ['Cattle insurance recovered', 'OTHER_CL', 2480],
  union: ['Union deductions payable', 'OTHER_CL', 2490],
  other: ['Other deductions — farmers', 'OTHER_CL', 2495],
};
function ledgerId(name: string, group: PrimaryGroupId, code: number): string {
  const chart = chartOf(loadUserAccounts());
  const hit = chart.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const codes = new Set(chart.map((a) => a.code));
  while (codes.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name, group }).id;
}

/** The pooled vendor of a centre (created on first use; a pooled account of agriculturists). */
export function pooledVendor(centreName: string | undefined, source: FarmerCycle['source']): Vendor {
  const name = `${source === 'milk' ? 'Milk producers' : 'Farmers'} — ${centreName?.trim() || 'all centres'}`;
  return vendorsDb.all().find((v) => v.name.toLowerCase() === name.toLowerCase()) ?? vendorsDb.save({ name, principal_kind: 'agriculturist', notes: 'Pooled farmer cycle bills (AG-A4).' });
}

/** Save a draft (numbered `CYB/FY…` on first save; the number is never reused). Lines are recomputed. */
export function saveCycleDraft(input: Omit<FarmerCycle, 'id' | 'number' | 'status'> & { id?: string }): FarmerCycle {
  requireAccess('doc.create');
  if (!DAY.test(input.period_from) || !DAY.test(input.period_to) || input.period_to < input.period_from) throw new Error('Choose the cycle period.');
  const prev = input.id ? loadCycles().find((c) => c.id === input.id) : undefined;
  if (prev && prev.status !== 'draft') throw new Error(`${prev.number} is closed: reopen it first.`);
  const lines = settleLines(input.lines.filter((l) => l.farmer_id && (num(l.qty) > 0 || num(l.amount) > 0)));
  const dup = lines.find((l, i) => lines.findIndex((x) => x.farmer_id === l.farmer_id) !== i);
  if (dup) throw new Error(`${dup.name ?? 'A farmer'} is on two lines: one line per farmer.`);
  const number = prev?.number ?? nextSeriesNumberFor(CYB, input.period_to, loadCycles().map((c) => c.number));
  const row: FarmerCycle = { ...prev, ...input, id: prev?.id ?? generateId(), number, status: 'draft', lines, created_at: prev?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() };
  withTablesRollback([T, 'series_counters'], () => {
    put(row);
    recordSeries(number);
  });
  return row;
}

/** Group lines into one purchase line per unit (cow / buffalo milk come from B as their own `unit` labels). */
function purchaseLines(lines: readonly FarmerCycleLine[], source: FarmerCycle['source']): PurchaseLine[] {
  const by = new Map<string, { qty: number; amount: number }>();
  for (const l of lines) {
    const k = l.unit || 'KG';
    const g = by.get(k) ?? { qty: 0, amount: 0 };
    g.qty = Math.round((g.qty + num(l.qty)) * 1000) / 1000;
    g.amount = round2(g.amount + num(l.amount) + num(l.bonus));
    by.set(k, g);
  }
  return [...by.entries()].map(([unit, g]) => ({ id: generateId(), name: source === 'milk' ? 'Milk (pooled from farmers)' : 'Farm produce (pooled from farmers)', unit, quantity: g.qty, rate: g.qty > 0 ? Number((g.amount / g.qty).toFixed(4)) : g.amount, tax_rate: 0 }));
}

/** Close a draft: the pooled purchase, the set-off receipts and the deductions journal (`books.edit`). */
export function closeCycle(id: string, centreName?: string): FarmerCycle {
  requireAccess('books.edit');
  const c = loadCycles().find((x) => x.id === id);
  if (!c) throw new Error('Cycle not found.');
  if (c.status !== 'draft') throw new Error(`${c.number} is already closed.`);
  if (!c.lines.length) throw new Error('Add the farmers\' lines first.');
  assertUnlocked({ id: c.id, issue_date: c.period_to }, 'create');
  const lines = settleLines(c.lines);
  const t = cycleTotals({ lines });
  const invoices = getTable<InvoiceRecord>('invoices');
  return withTablesRollback([T, 'purchases', 'purchase_payments', 'transactions', 'invoices', 'vendors', VOUCHERS_TABLE, 'accounts', 'series_counters'], () => {
    const vendor = pooledVendor(centreName, c.source);
    const pl = purchaseLines(lines, c.source);
    const gross = round2(pl.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0));
    const bill = purchasesDb.save({
      kind: 'PURCHASE', vendor_id: vendor.id, vendor_name: vendor.name, bill_number: c.number, date: c.period_to, category: c.source === 'milk' ? 'Milk purchases' : 'Farm produce purchase',
      lines: pl, taxable: gross, cgst: 0, sgst: 0, igst: 0, total: gross, amount_paid: round2(Math.min(t.deductions, gross)), itc_eligible: false, ag: { cycle_id: c.id },
      notes: `Pooled cycle bill ${c.number}: ${lines.length} farmer(s), ${c.period_from} to ${c.period_to}; farmer-wise split on the cycle. Verify with your CA (AG26).`,
    });
    const p = (n: number) => Math.round(n * 100);
    const jv: { account_id: string; dr: number; cr: number; party?: string }[] = [];
    const receiptIds: string[] = [];
    for (const l of lines) for (const d of l.deductions) {
      if (!(num(d.amount) > 0)) continue;
      if (d.kind === 'feed' || d.kind === 'input') {
        const inv = invoices.find((i) => i.id === d.ref_id);
        if (!inv) throw new Error(`${l.name ?? 'A farmer'}: the invoice of a feed / input deduction was not found.`);
        const r = localDb.payments.record({ invoiceId: inv.id, amount: d.amount, method: SET_OFF_METHOD, date: c.period_to, reference: c.number, note: `Set off against milk / produce money (${c.number})` });
        setTable('transactions', getTable<Payment>('transactions').map((x) => (x.id === r.id ? { ...x, exchange_purchase_id: bill.id } : x)));
        receiptIds.push(r.id);
        jv.push({ account_id: A.creditors, dr: 0, cr: p(d.amount), party: inv.client?.company?.trim() || inv.client?.name?.trim() || l.name });
      } else {
        const [n, g, code] = LEDGERS[d.kind] ?? LEDGERS.other;
        jv.push({ account_id: ledgerId(n, g, code), dr: 0, cr: p(d.amount) });
      }
    }
    let journalId: string | undefined;
    if (t.deductions > 0) {
      journalId = saveVoucher({ type: 'JOURNAL', date: c.period_to, voucher_class: 'Farmer cycle deductions', narration: `Deductions on ${c.number} (${c.period_from} to ${c.period_to})`, lines: [{ account_id: A.creditors, dr: p(t.deductions), cr: 0, party: vendor.name }, ...jv] }).id;
    }
    const row: FarmerCycle = { ...c, lines, status: 'closed', purchase_id: bill.id, ...(journalId ? { journal_id: journalId } : {}), receipt_ids: receiptIds, updated_at: new Date().toISOString() };
    put(row);
    return row;
  });
}

/** Record the cycle's payment: one purchase payment per mode (bank / cash), after the bank confirms (`books.edit`). */
export function payCycle(id: string, date: string, opts: { bankAccountId?: string; reference?: string } = {}): FarmerCycle {
  requireAccess('books.edit');
  const c = loadCycles().find((x) => x.id === id);
  if (!c || c.status !== 'closed' || !c.purchase_id) throw new Error('Close the cycle before paying it.');
  if (!DAY.test(date)) throw new Error('Choose the payment date.');
  const t = cycleTotals(c);
  return withTablesRollback([T, 'purchases', 'purchase_payments'], () => {
    const ids: string[] = [];
    if (t.bank > 0) ids.push(paymentsDb.record(c.purchase_id!, { amount: t.bank, date, method: 'Bank transfer', reference: opts.reference || c.number, bankAccountId: opts.bankAccountId }).id);
    if (t.cash > 0) ids.push(paymentsDb.record(c.purchase_id!, { amount: t.cash, date, method: 'Cash', reference: c.number }).id);
    const row: FarmerCycle = { ...c, status: 'paid', payment_ids: ids, updated_at: new Date().toISOString() };
    put(row);
    return row;
  });
}

/** Reopen a closed, unpaid cycle: its receipts, journal and purchase go (recycle bin); the lines can be edited again. */
export function reopenCycle(id: string): FarmerCycle {
  requireAccess('books.edit');
  const c = loadCycles().find((x) => x.id === id);
  if (!c || c.status === 'draft') throw new Error('Only a closed cycle can be reopened.');
  if (c.status === 'paid') throw new Error(`${c.number} is paid: delete its payments in Expenses first.`);
  return withTablesRollback([T, 'purchases', 'purchase_payments', 'transactions', 'invoices', VOUCHERS_TABLE], () => {
    for (const r of c.receipt_ids ?? []) if (getTable<Payment>('transactions').some((x) => x.id === r)) localDb.payments.remove(r);
    if (c.journal_id) deleteVoucher(c.journal_id);
    if (c.purchase_id && purchasesDb.get(c.purchase_id)) purchasesDb.remove(c.purchase_id, { confirmStock: true });
    const { purchase_id: _p, journal_id: _j, receipt_ids: _r, ...rest } = c;
    void _p; void _j; void _r;
    const row: FarmerCycle = { ...rest, status: 'draft', updated_at: new Date().toISOString() };
    put(row);
    return row;
  });
}

/** Delete a draft (recycle bin; its CYB number stays used). */
export function deleteCycle(id: string): void {
  requireAccess('doc.create');
  const c = loadCycles().find((x) => x.id === id);
  if (c && c.status !== 'draft') throw new Error('Reopen the cycle before deleting it.');
  setTable(T, loadCycles().filter((x) => x.id !== id));
}
