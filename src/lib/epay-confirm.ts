/**
 * Recording supplier payments back from an e-payment file once the bank confirms (7U, roadmap 7.23).
 *
 * 1. Downloading an e-payment file (`bank-upload.ts`) also keeps the batch in table `epay_batches`
 *    (`EPB/FY<yy-yy>/<seq>`, Indian FY of the payment date): supplier, amount, mode, our reference
 *    and the last four digits of the beneficiary account. Nothing is recorded yet.
 * 2. When the bank confirms, import its response / status file or the statement rows (CSV; columns are
 *    recognised by name: reference / narration, amount / debit, status, UTR, date, account).
 * 3. Matching (`matchResponse`): our reference with the same amount first; else the amount and the
 *    beneficiary account's last four digits; else an amount that only one open row and one response
 *    row share (review M3: such an amount-only match is recorded as paid only once the user confirms it).
 *    A statement row has no status: being debited means paid; credit / negative rows are skipped.
 * 4. "Record payments" is all or nothing (`recordConfirmed`): every paid row becomes one supplier
 *    payment (`recordSupplierPayment`: oldest bills first, the rest on account) from the batch's bank
 *    account on the bank's date, reference = the UTR; failed rows are marked failed. One refusal
 *    (period lock, role, a bill that changed) restores every table.
 *
 * 8.46: payment approval inside the batch. When the purchase approval policy holds supplier payments above ₹Y and the
 * user cannot approve, `saveEpayBatch` refuses a batch with such a row unless it is sent for approval
 * (`forApproval`): the batch is kept with `approval.state = 'pending'` and NO file is made. The owner approves
 * (`decideEpayBatch`, `doc.approve`, audit + the shared `approvals` history as doc type PAYMENT) and downloads the
 * file from the batch, or rejects it with a reason. A batch still waiting (or rejected) records nothing.
 *
 * Bill balances come from `purchasesDb` + `balanceOf` (the shared `supplierPayable` reading of the
 * PurchaseRecord shape; contract row in `tests/purchase-contract.test.ts`). Pure above "Storage".
 */

import type { PurchaseRecord } from '../types/purchases';
import { parseCsvDetailed } from './csv';
import { parseBankAmount, parseBankDate } from './bank-recon';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { planAllocation, recordSupplierPayment, VENDOR_PAYMENTS_TABLE } from './billwise';
import { balanceOf, PAYMENTS_TABLE, PURCHASES_TABLE, purchasesDb } from './purchases';
import { isVoidStatus } from './purchase-normalize';
import { nextSeriesNumberFor, recordSeries } from './series-counters';
import { withTablesRollback } from './table-txn';
import { generateId, getTable, setTable } from './storage';
import { can, currentActor, requireAccess } from './access';
import { audit } from './audit';
import type { UploadMode, UploadPreset } from './bank-upload';
import { paymentApprovalRequired, readPurchaseApprovalPolicy } from './purchase-approval-gate';
import { APPROVALS_TABLE, approvalLog } from './approvals';

export const EPAY_BATCHES_TABLE = 'epay_batches';
export const EPAY_PREFIX = 'EPB';

export type EpayRowStatus = 'sent' | 'paid' | 'failed';

export interface EpayBatchRow {
  id: string;
  vendor_id?: string;
  vendor_name: string;
  amount: number;
  mode: UploadMode;
  reference: string;
  /** Last four characters of the beneficiary account (matching; never the full number). */
  account_last4?: string;
  status: EpayRowStatus;
  utr?: string;
  paid_on?: string;
  failure?: string;
  /** `purchase_payments.group_id` of the payment recorded for this row. */
  group_id?: string;
}

export interface EpayBatch {
  id: string;
  number: string;
  date: string;
  bank_account_id?: string;
  preset: UploadPreset;
  rows: EpayBatchRow[];
  total: number;
  created_at: string;
  /** 8.46: set when the batch was sent for the owner's approval (absent = made by someone who may approve). */
  approval?: EpayApproval;
}

export interface EpayApproval {
  state: 'pending' | 'approved' | 'rejected';
  requested_by: string;
  requested_at: string;
  decided_by?: string;
  decided_at?: string;
  note?: string;
}

export interface BankResponseRow {
  /** 1-based data row number in the file. */
  line: number;
  reference: string;
  amount: number;
  status: 'paid' | 'failed' | 'pending';
  utr: string;
  date: string;
  account: string;
  reason: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const last4 = (s: string | undefined) => {
  const c = String(s ?? '').replace(/[^A-Za-z0-9]/g, '');
  return c ? c.slice(-4).toUpperCase() : '';
};

function col(headers: string[], ...names: RegExp[]): number {
  for (const re of names) {
    const i = headers.findIndex((h) => re.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

const PAID = /^(s|y|paid|success(ful)?|processed|executed|completed?|credited|settled|done|ok|approved|transaction successful)$/;
const FAILED = /^(f|n|failed|failure|rejected|returned|reversed|cancelled|canceled|unsuccessful|error|declined|return)$/;

/** Status text → paid / failed / pending. */
export function responseStatus(raw: string): 'paid' | 'failed' | 'pending' {
  const s = raw.trim().toLowerCase();
  if (!s) return 'pending';
  if (PAID.test(s) || /success|processed|executed|credited|paid/.test(s)) return 'paid';
  if (FAILED.test(s) || /fail|reject|return|revers|cancel/.test(s)) return 'failed';
  return 'pending';
}

/**
 * Read a bank response / status file or statement rows (CSV / TSV, header row found by name). A file
 * without a status column (a statement) reads every debit row as paid. Throws on a file with no
 * amount column.
 */
export function parseBankResponse(text: string): BankResponseRow[] {
  const { rows } = parseCsvDetailed(text);
  if (!rows.length) return [];
  const hi = rows.findIndex((r) => r.some((c) => /amount|debit|withdrawal/i.test(c)));
  if (hi < 0) throw new Error('No amount / debit column found in the file.');
  const headers = rows[hi].map((h) => h.trim().toLowerCase());
  const iRef = col(headers, /^(customer |cust |our |client |payment )?ref(erence)?( no\.?| number)?$/, /ref/, /narration|description|particulars|remarks/);
  const iNarr = col(headers, /narration|description|particulars|remarks/);
  const iAmt = col(headers, /^(transaction |txn |payment )?amount/, /debit|withdrawal/, /amount/);
  const iStatus = col(headers, /status/, /^result$/);
  const iUtr = col(headers, /utr/, /bank ref|chq|cheque|txn id|transaction id/);
  const iDate = col(headers, /value date/, /(payment|transaction|txn|processed) date/, /date/);
  const iAcc = col(headers, /bene(ficiary)? ?(a\/?c|acc|account)/, /credit (a\/?c|account)/, /account/);
  const iReason = col(headers, /reason|remark|error/);
  // Review M3: a Dr / Cr (or transaction type) column; credit rows are money coming IN, never a payment.
  const iSide = col(headers, /^(dr ?\/ ?cr|cr ?\/ ?dr|d ?\/ ?c|c ?\/ ?d|dr cr|drcr|debit ?\/ ?credit|credit ?\/ ?debit)$/, /^(txn |transaction |entry )?type$/);
  const out: BankResponseRow[] = [];
  rows.slice(hi + 1).forEach((r, k) => {
    const amt = parseBankAmount(r[iAmt] ?? '');
    if (!amt || !(Math.abs(amt.value) > 0)) return;
    // Credits and reversals (negative / bracketed figures, "Cr" markers) are not payments made.
    if (amt.value < 0 || amt.side === 'Cr') return;
    if (iSide >= 0 && iSide !== iAmt && /^(c|cr|cr\.|credit|credited|deposit)$/i.test((r[iSide] ?? '').trim())) return;
    const ref = (r[iRef] ?? '').trim();
    const narr = iNarr >= 0 && iNarr !== iRef ? (r[iNarr] ?? '').trim() : '';
    out.push({
      line: k + 1,
      reference: [ref, narr].filter(Boolean).join(' '),
      amount: round2(Math.abs(amt.value)),
      status: iStatus >= 0 ? responseStatus(r[iStatus] ?? '') : 'paid',
      utr: iUtr >= 0 && iUtr !== iRef ? (r[iUtr] ?? '').trim() : '',
      date: iDate >= 0 ? parseBankDate(r[iDate] ?? '') : '',
      account: iAcc >= 0 ? last4(r[iAcc]) : '',
      reason: iReason >= 0 && iReason !== iRef && iReason !== iNarr ? (r[iReason] ?? '').trim() : '',
    });
  });
  return out;
}

export interface EpayMatch {
  rowId: string;
  line: number;
  status: 'paid' | 'failed' | 'pending';
  utr: string;
  date: string;
  how: 'reference' | 'account' | 'amount';
  reason?: string;
}

export interface MatchResult {
  matches: EpayMatch[];
  /** Response lines that matched nothing. */
  unmatched: number[];
  /** Batch rows still open with no response row. */
  open: string[];
}

/** Match a batch's open rows to response rows (each response row used once). */
export function matchResponse(batch: Pick<EpayBatch, 'rows'>, response: readonly BankResponseRow[]): MatchResult {
  const open = batch.rows.filter((r) => r.status === 'sent');
  const used = new Set<number>();
  const matched = new Set<string>();
  const matches: EpayMatch[] = [];
  const same = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.005;
  const take = (row: EpayBatchRow, resp: BankResponseRow, how: EpayMatch['how']) => {
    used.add(resp.line);
    matched.add(row.id);
    matches.push({ rowId: row.id, line: resp.line, status: resp.status, utr: resp.utr, date: resp.date, how, ...(resp.reason ? { reason: resp.reason } : {}) });
  };
  // 1. reference + amount
  for (const row of open) {
    const ref = norm(row.reference);
    if (ref.length < 3) continue;
    const hit = response.find((r) => !used.has(r.line) && same(r.amount, row.amount) && norm(r.reference).includes(ref));
    if (hit) take(row, hit, 'reference');
  }
  // 2. amount + account last four
  for (const row of open) {
    if (matched.has(row.id) || !row.account_last4) continue;
    const hit = response.find((r) => !used.has(r.line) && same(r.amount, row.amount) && r.account === row.account_last4);
    if (hit) take(row, hit, 'account');
  }
  // 3. amount shared by exactly one open row and one response row
  for (const row of open) {
    if (matched.has(row.id)) continue;
    const rows = open.filter((o) => !matched.has(o.id) && same(o.amount, row.amount));
    const resp = response.filter((r) => !used.has(r.line) && same(r.amount, row.amount));
    if (rows.length === 1 && resp.length === 1) take(row, resp[0], 'amount');
  }
  return {
    matches,
    unmatched: response.filter((r) => !used.has(r.line)).map((r) => r.line),
    open: open.filter((r) => !matched.has(r.id)).map((r) => r.id),
  };
}

/** Open bills of a supplier, oldest due first (bill balances via `balanceOf`). */
export function openBillsOf(bills: readonly PurchaseRecord[], vendor: { id?: string; name: string }): { purchaseId: string; balance: number; due: string }[] {
  const name = vendor.name.trim().toLowerCase();
  return bills
    .filter((b) => {
      if (!b || isVoidStatus((b as { status?: unknown }).status)) return false;
      const byName = !b.vendor_id && String(b.vendor_name ?? '').trim().toLowerCase() === name;
      return vendor.id ? b.vendor_id === vendor.id || byName : byName;
    })
    .map((b) => ({ purchaseId: b.id, balance: balanceOf(b), due: b.due_date || b.date }))
    .filter((b) => b.balance > 0.004);
}

/* ── Storage ──────────────────────────────────────────────────── */

export class EpayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpayError';
  }
}

export const loadEpayBatches = (): EpayBatch[] => getTable<EpayBatch>(EPAY_BATCHES_TABLE).filter((b) => b && typeof b.id === 'string' && Array.isArray(b.rows));

/** 8.46: amounts in a batch that the signed-in user may not pay without the owner's approval. */
export function epayAmountsOverLimit(amounts: readonly number[], policy = readPurchaseApprovalPolicy(), canApprove = can('doc.approve')): number[] {
  return amounts.filter((a) => paymentApprovalRequired(a, policy, canApprove));
}

/** 8.46: may the batch's file go to the bank / its payments be recorded? (no approval asked, or approved) */
export const epayBatchCleared = (b: Pick<EpayBatch, 'approval'>): boolean => !b.approval || b.approval.state === 'approved';

/**
 * Keep a downloaded batch (rows still "sent"). 8.46: a batch holding a payment above the approval limit of a user
 * who may not approve is refused unless `forApproval` — then it is kept as waiting for approval (no file).
 */
export function saveEpayBatch(input: { date: string; bank_account_id?: string; preset: UploadPreset; rows: readonly { vendorId?: string; vendorName: string; amount: number; mode: UploadMode; reference: string; accountNo?: string }[] }, opts: { forApproval?: boolean } = {}): EpayBatch {
  requireAccess('books.edit');
  const date = isoDay(input.date);
  if (!date) throw new EpayError('Choose the payment date.');
  if (!input.rows.length) throw new EpayError('Add at least one payment.');
  const held = epayAmountsOverLimit(input.rows.map((r) => num(r.amount))).length > 0;
  if (held && !opts.forApproval) throw new EpayError("This batch has a payment above your approval limit: send it for the owner's approval.");
  const all = loadEpayBatches();
  const batch: EpayBatch = {
    id: generateId(),
    number: nextSeriesNumberFor(EPAY_PREFIX, date, all.map((b) => b.number)),
    date,
    ...(input.bank_account_id && input.bank_account_id !== 'default' ? { bank_account_id: input.bank_account_id } : {}),
    preset: input.preset,
    rows: input.rows.map((r) => ({
      id: generateId(),
      ...(r.vendorId ? { vendor_id: r.vendorId } : {}),
      vendor_name: r.vendorName.trim(),
      amount: round2(num(r.amount)),
      mode: r.mode,
      reference: r.reference.trim(),
      ...(last4(r.accountNo) ? { account_last4: last4(r.accountNo) } : {}),
      status: 'sent' as const,
    })),
    total: round2(input.rows.reduce((s, r) => s + num(r.amount), 0)),
    created_at: new Date().toISOString(),
    ...(held ? { approval: { state: 'pending' as const, requested_by: actorName(), requested_at: new Date().toISOString() } } : {}),
  };
  setTable(EPAY_BATCHES_TABLE, [...all, batch]);
  recordSeries(batch.number);
  if (held) logSafe(`Sent e-payment batch ${batch.number} (₹${batch.total.toFixed(2)}) for approval`, batch);
  return batch;
}

const actorName = () => { const a = currentActor(); return a ? a.name || a.role : ''; };
const logSafe = (summary: string, b: EpayBatch) => {
  try {
    audit.record({ entity: 'vendor_payment', entity_id: b.id, action: 'update', doc_number: b.number, summary });
  } catch {
    /* logging never breaks a save */
  }
};

/** 8.46: the owner approves (the file may then be downloaded) or rejects (reason required) a batch sent for approval. */
export function decideEpayBatch(id: string, decision: 'approved' | 'rejected', note = ''): EpayBatch {
  requireAccess('doc.approve');
  const b = loadEpayBatches().find((x) => x.id === id);
  if (!b || b.approval?.state !== 'pending') throw new EpayError('This batch is not waiting for approval.');
  if (decision === 'rejected' && !note.trim()) throw new EpayError('Add a reason so the clerk knows what to change.');
  const by = actorName() || 'Owner';
  const at = new Date().toISOString();
  const next: EpayBatch = { ...b, approval: { ...b.approval, state: decision, decided_by: by, decided_at: at, ...(note.trim() ? { note: note.trim() } : {}) } };
  withTablesRollback([EPAY_BATCHES_TABLE, APPROVALS_TABLE], () => {
    setTable(EPAY_BATCHES_TABLE, loadEpayBatches().map((x) => (x.id === id ? next : x)));
    setTable(APPROVALS_TABLE, [...approvalLog(), {
      id: generateId(), doc_id: b.id, doc_number: b.number, doc_type: 'PAYMENT', amount: b.total, decision,
      requested_by: b.approval!.requested_by, requested_at: b.approval!.requested_at, decided_by: by, decided_at: at, ...(note.trim() ? { note: note.trim() } : {}),
    }]);
  });
  logSafe(`${decision === 'approved' ? 'Approved' : 'Rejected'} e-payment batch ${b.number} (₹${b.total.toFixed(2)})${note.trim() ? ` — ${note.trim()}` : ''}`, b);
  return next;
}

export interface RecordResult {
  paid: number;
  failed: number;
  total: number;
}

/**
 * Record the confirmed rows of a batch, all or nothing: paid → one supplier payment each (bills
 * oldest due first, any rest on account), failed → marked failed, pending → left open. A paid
 * amount-only match counts only when its row id is in `confirmedRows` (the user ticked it).
 */
/** Review M3: an amount-only match that says "paid" records money only after the user confirms it. */
export const needsConfirmation = (m: Pick<EpayMatch, 'how' | 'status'>): boolean => m.how === 'amount' && m.status === 'paid';

export function recordConfirmed(batchId: string, matches: readonly EpayMatch[], confirmedRows: readonly string[] = []): RecordResult {
  requireAccess('books.edit');
  const batch = loadEpayBatches().find((b) => b.id === batchId);
  if (!batch) throw new EpayError('e-Payment batch not found.');
  if (!epayBatchCleared(batch)) throw new EpayError(`Batch ${batch.number} has not been approved.`);
  const ok = new Set(confirmedRows);
  // Unconfirmed amount-only matches stay open (as if the bank had not answered for them yet).
  const byRow = new Map(matches.filter((m) => !needsConfirmation(m) || ok.has(m.rowId)).map((m) => [m.rowId, m]));
  if (![...byRow.values()].some((m) => m.status !== 'pending')) throw new EpayError('Nothing confirmed to record.');
  return withTablesRollback([PAYMENTS_TABLE, PURCHASES_TABLE, VENDOR_PAYMENTS_TABLE, EPAY_BATCHES_TABLE], () => {
    let paid = 0;
    let failed = 0;
    let total = 0;
    const rows = batch.rows.map((row) => {
      const m = byRow.get(row.id);
      if (!m || row.status !== 'sent' || m.status === 'pending') return row;
      if (m.status === 'failed') {
        failed++;
        return { ...row, status: 'failed' as const, ...(m.reason ? { failure: m.reason } : {}), ...(m.utr ? { utr: m.utr } : {}) };
      }
      const date = isoDay(m.date) || batch.date;
      const bills = openBillsOf(purchasesDb.all(), { id: row.vendor_id, name: row.vendor_name });
      const plan = planAllocation(row.amount, bills);
      const res = recordSupplierPayment({
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        date,
        amount: row.amount,
        method: 'Bank transfer',
        reference: m.utr || row.reference || batch.number,
        bankAccountId: batch.bank_account_id,
        allocations: plan.lines,
        remainderKind: 'ON_ACCOUNT',
      });
      paid++;
      total = round2(total + row.amount);
      return { ...row, status: 'paid' as const, paid_on: date, ...(m.utr ? { utr: m.utr } : {}), group_id: res.groupId };
    });
    setTable(EPAY_BATCHES_TABLE, loadEpayBatches().map((b) => (b.id === batchId ? { ...b, rows } : b)));
    try {
      audit.record({ entity: 'vendor_payment', entity_id: batch.id, action: 'update', doc_number: batch.number, summary: `e-Payment batch ${batch.number}: ${paid} payment(s) of ₹${total.toFixed(2)} recorded from the bank's confirmation${failed ? `, ${failed} failed` : ''}` });
    } catch {
      /* logging never breaks a save */
    }
    return { paid, failed, total };
  });
}
