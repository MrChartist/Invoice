/**
 * R19-C bridge (the only one of R19-C, outside the `f-logistics` family): the shared lazy code the customs broker desk
 * needs — advances (duty deposits: `saveAdvance` with `pass_through`, `applyAdvance`, `refundAdvance`,
 * `advanceBalance`), purchases (disbursements: `purchasesDb` / `paymentsDb`, read back through `readPurchase`), live
 * billing (`billedBy`, the billable-cost rule of the invoice editor, over `localDb` invoices; `loadDisb` also feeds
 * R19-B's `planJob` → `billExtras`), `csv.ts` and `lg-save` (SB / BOE import). Engines take their data as arguments (`lg-disb.ts`, `lg-deposits.ts`, `lg-register.ts`). Rights, period locks
 * and audit are the called modules' own (`books.edit` for bills, `payment.record` for advances). A deposit is money
 * received (it shows once in the cash book); its application is the existing `advance_id` payment every cash reader
 * skips through `movedNoCash` — no new marker. Working papers — verify with your CA (LG10–LG12, LG26, LG27).
 */
import './lg-registry'; // the write-off stamp goes through `setTable` (tests/lg-registry.test.ts)
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { LgJob } from '../../types/logistics-r19';
import type { PurchaseRecord } from '../../types/purchases';
import { advanceBalance, applyAdvance, invoiceOpen, loadAdvances, refundAdvance, saveAdvance, senderSnapshot } from '../advances';
import { paymentsDb, purchasesDb } from '../purchases';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { withTablesRollback } from '../table-txn';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { getTable, setTable } from '../storage';
import { localDb } from '../localDb';
import { parseTable } from '../csv';
import { lgcT } from '../../i18n/areas/logistics-r19c';
import { loadJobs, saveJob } from './lg-save';
import { readLogisticsSettings } from './lg-settings';
import { docRefsFromTable } from './lg-register';
import { billedBy, disbRecord, disbRows, validateDisb, type DisbInput, type DisbSource, type LgDisbRow } from './lg-disb';
import { applyAmount, depositInput, type DepositBal, type DepositReceipt } from './lg-deposits';

/** One purchases row as the engine reads it (through `readPurchase`), or null when it is not a bill. */
export function disbSource(raw: unknown): DisbSource | null {
  const p = readPurchase(raw);
  const r = raw as Partial<PurchaseRecord>;
  return p ? { id: p.id, lg: r.lg, client_id: r.billable_to_client_id, date: p.date, total: p.total, payee: p.partyName, void: isVoidStatus(p.status) } : null;
}

/** Every disbursement on behalf with its billed state (a live invoice line names it, as the editor's billable costs do). */
export function loadDisb(today: string): LgDisbRow[] {
  const raw = purchasesDb.all();
  return disbRows(raw.map(disbSource).filter((x): x is DisbSource => !!x), billedBy(localDb.invoices.getAll(), new Map(raw.map((p) => [p.id, p.rebilled_in]))), today);
}

/** C1: save a disbursement (and its payment from our account when `pay` is given) in one rollback. */
export function addDisbursement(input: DisbInput, pay?: { method: string; reference?: string; bankAccountId?: string }): PurchaseRecord {
  const e = validateDisb(input);
  if (e.length) throw new Error(e[0]);
  return withTablesRollback(['purchases', 'purchase_payments'], () => {
    const row = purchasesDb.save(disbRecord(input));
    if (pay) paymentsDb.record(row.id, { amount: row.total, date: input.date, method: pay.method || 'Bank transfer', reference: pay.reference ?? input.ref, bankAccountId: pay.bankAccountId });
    return row;
  });
}

/** C3: write off an unrecoverable disbursement (memo stamp `lg.wo`, no journal; refused in a locked period). */
export function writeOffDisb(id: string, date: string, reason: string, by?: string): void {
  requireAccess('books.edit');
  if (!reason.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(lgcT('eWo'));
  assertUnlocked({ issue_date: date }, 'edit');
  const rows = getTable<PurchaseRecord>('purchases');
  const p = rows.find((x) => x?.id === id && x.lg?.on_behalf);
  if (!p?.lg || p.lg.wo) throw new Error(lgcT('eNotOpen'));
  setTable('purchases', rows.map((x) => (x === p ? { ...p, lg: { ...p.lg!, wo: { date, reason: reason.trim(), ...(by ? { by } : {}) } } } : x)));
}

/** C2: the duty deposits (pass-through advances tied to a job) with their balances. */
export function loadDeposits(): DepositBal[] {
  const pay = localDb.payments.getAll();
  const inv = localDb.invoices.getAll();
  return loadAdvances().filter((a) => a.lg?.job_id && a.pass_through).map((a) => {
    const b = advanceBalance(a, pay, inv);
    return { id: a.id, job_id: a.lg!.job_id, number: a.number, date: a.date, amount: b.amount, applied: b.adjusted, refunded: b.refunded, open: b.open };
  });
}

/** C2: receive a deposit for a job (Receipt Voucher at 0 %, pass-through). POS = the client's State, else ours. */
export function addDeposit(job: Pick<LgJob, 'id' | 'number' | 'client_id'>, x: DepositReceipt) {
  const c = localDb.clients.getById(job.client_id);
  if (!c) throw new Error(lgcT('eClient'));
  const pos = c.state_code || senderSnapshot()?.stateCode || '';
  return saveAdvance(depositInput(job, { id: c.id, name: c.name, ...(c.gstin ? { gstin: c.gstin } : {}), ...(c.state_code ? { state_code: c.state_code } : {}) }, pos, x));
}

/** The job's issued rupee invoices that still owe something (where a deposit can be applied). */
export function jobOpenInvoices(jobId: string): { id: string; number: string; open: number }[] {
  return localDb.invoices.getAll().filter((i: InvoiceRecord) => i.lg?.job_id === jobId && i.status !== 'Draft' && i.status !== 'Cancelled' && (i.currency || 'INR').toUpperCase() === 'INR')
    .map((i) => ({ id: i.id, number: i.invoice_number, open: invoiceOpen(i) })).filter((i) => i.open > 0.004);
}

/** C2: apply a deposit to an invoice of its job (the smaller of what is left on each). */
export function applyDeposit(dep: DepositBal, invoiceId: string, date?: string) {
  const inv = jobOpenInvoices(dep.job_id).find((i) => i.id === invoiceId);
  if (!inv) throw new Error(lgcT('noInv'));
  return applyAdvance({ advanceId: dep.id, invoiceId, amount: applyAmount(dep.open, inv.open), ...(date ? { date } : {}) });
}

/** C2: refund what is left of a deposit (Refund Voucher) with the job in the narration. */
export const refundDeposit = (dep: DepositBal, jobNo: string, date: string, method: string) => refundAdvance(dep.id, { amount: dep.open, date, method, note: `Excess duty deposit — job ${jobNo}` });

/** C4: the client's IEC and KYC (numbers and dates only, LG27). */
export function saveKyc(c: Client, lg: NonNullable<Client['lg']>): void {
  localDb.clients.upsert({ ...c, lg });
}

/** C: shipping bill / bill of entry numbers from a CSV file (typed in ICEGATE, exported by the broker — no network call); all or nothing. */
export function importDocRefs(text: string): { updated: number; errors: string[] } {
  const all = loadJobs();
  const { ok, errors } = docRefsFromTable(parseTable(text), all);
  const prefix = readLogisticsSettings().job_prefix;
  withTablesRollback(['lg_jobs', 'series_counters'], () => ok.forEach((o) => saveJob({ ...loadJobs().find((j) => j.id === o.id)!, refs: o.refs }, prefix)));
  return { updated: ok.length, errors };
}
