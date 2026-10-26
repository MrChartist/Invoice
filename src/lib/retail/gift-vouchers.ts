/**
 * Gift vouchers (R4-B1, `GV/FY<yy-yy>/<seq>`): sell / issue, redeem on an invoice, cancel with refund, breakage after
 * expiry, and the register. The counter's pieces (codes, balance, checks) are in `gift-voucher-core.ts`.
 *
 *  - Sale: NO invoice. One receipt voucher (RV) per sale through `saveVoucher` (period lock, roles, audit):
 *      Dr Cash / Bank (by tender) | Cr "Gift vouchers outstanding" (a user ledger under Other current liabilities,
 *      created on first use like the sales-commission ledger). Promotional vouchers post nothing.
 *  - Redemption: a normal receipt row on the bill with `gift_voucher_id` (POS tender or the payment dialog). The ledger
 *      posts it Dr Gift vouchers outstanding | Cr Debtors; the cash / bank book and bank matching leave it out.
 *  - Breakage: after expiry, "Recognise unredeemed balance" posts ONE journal for every expired balance not yet
 *      recognised: Dr Gift vouchers outstanding | Cr "Unredeemed voucher income" (Other income). Undo deletes it.
 *  - Cancel: only a voucher nothing was redeemed from; a sold one is refunded by a payment voucher (PV). Owner only.
 *
 * GST treatment follows Circular 243/37/2024-GST (vouchers are neither goods nor services) — working paper, verify
 * with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { GiftVoucher, GiftVoucherSettings } from '../../types/stores-r4';
import { num, round2 } from '../invoice-calc';
import { generateId, getTable, peekTable, setJson, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { audit } from '../audit';
import { isoDay } from '../dates';
import { nextSeriesNumberFor, parseSeries, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { toCsv } from '../csv';
import { localDb } from '../localDb';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import {
  GV_BREAKAGE_ACCOUNT, GV_LIABILITY_ACCOUNT, GV_METHOD, GV_SETTINGS_KEY, GV_TABLE, codeKey, expiryFrom, findVoucherByCode,
  liveRedeemIssue, makeVoucherCode, readGvSettings, stampVoucherPayment, voucherState, type VoucherState,
} from './gift-voucher-core';

export * from './gift-voucher-core';

const norm = (s: string) => s.trim().toLowerCase();
const nowIso = () => new Date().toISOString();

function log(v: Pick<GiftVoucher, 'id' | 'number'>, action: 'create' | 'update' | 'delete', summary: string): void {
  try {
    audit.record({ entity: 'payment', entity_id: v.id, action, doc_number: v.number, summary });
  } catch {
    /* logging never breaks a save */
  }
}

/* ── Ledgers ──────────────────────────────────────────────────── */

function ensureAccount(name: string, group: 'OTHER_CL' | 'OTHER_INCOME', start: number): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => norm(a.name) === norm(name));
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = start;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name, group }).id;
}

/** "Gift vouchers outstanding" under Other current liabilities (created on first use). */
export const ensureGiftVoucherAccount = (): string => ensureAccount(GV_LIABILITY_ACCOUNT, 'OTHER_CL', 2450);
/** "Unredeemed voucher income" under Other income (created on first use). */
export const ensureBreakageAccount = (): string => ensureAccount(GV_BREAKAGE_ACCOUNT, 'OTHER_INCOME', 4960);

const cashAccountFor = (method: string | undefined) => (norm(method ?? 'cash') === 'cash' ? A.cash : A.bank);
const paise = (rupees: number) => Math.round(round2(rupees) * 100);

/* ── Settings ─────────────────────────────────────────────────── */

export function saveGvSettings(next: GiftVoucherSettings): GiftVoucherSettings {
  requireAccess('settings.manage');
  const months = Math.floor(num(next.validity_months));
  if (!(months > 0 && months <= 120)) throw new Error('Validity must be 1 to 120 months.');
  const prefix = String(next.prefix ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'GV';
  const row: GiftVoucherSettings = { validity_months: months, allow_partial: next.allow_partial !== false, prefix };
  setJson(GV_SETTINGS_KEY, row);
  return row;
}

/* ── Store ────────────────────────────────────────────────────── */

export interface SellInput {
  /** How many vouchers (bulk issue). */
  count: number;
  face_value: number;
  /** Sale / issue date (YYYY-MM-DD). */
  issued_on: string;
  /** Default: issue date + the validity in settings. */
  expires_on?: string;
  buyer?: string;
  branch_id?: string;
  promo?: boolean;
  /** Tender of the sale (Cash / UPI / Card / Cheque / Bank transfer); ignored for promotional vouchers. */
  method?: string;
  note?: string;
}

export const giftVouchersDb = {
  all: (): GiftVoucher[] => getTable<GiftVoucher>(GV_TABLE).filter((v) => v && typeof v.id === 'string'),
  get: (id: string): GiftVoucher | undefined => giftVouchersDb.all().find((v) => v.id === id),
  byCode: (code: string): GiftVoucher | undefined => findVoucherByCode(code, giftVouchersDb.all()),
  nextNumber: (date: string): string => nextSeriesNumberFor(readGvSettings().prefix, date, giftVouchersDb.all().map((v) => v.number)),

  /**
   * Sell (or, `promo`, give away) `count` vouchers of `face_value`. A sale posts one receipt voucher for the lot:
   * Dr Cash / Bank | Cr Gift vouchers outstanding. No invoice is raised (Circular 243/37/2024-GST).
   */
  sell(input: SellInput, fill?: (bytes: Uint8Array) => void): { vouchers: GiftVoucher[]; receipt?: string } {
    requireAccess('doc.create');
    const count = Math.floor(num(input.count));
    const face = round2(num(input.face_value));
    const date = isoDay(input.issued_on);
    if (!date || date !== input.issued_on) throw new Error('Choose the sale date.');
    if (!(count >= 1 && count <= 500)) throw new Error('Issue 1 to 500 vouchers at a time.');
    if (!(face > 0)) throw new Error('Enter the voucher value.');
    const settings = readGvSettings();
    const expires = input.expires_on ? isoDay(input.expires_on) : expiryFrom(date, settings.validity_months);
    if (!expires || expires < date) throw new Error('The expiry date must be on or after the sale date.');
    const tables = [GV_TABLE, 'series_counters', ...(input.promo ? [] : ['vouchers', 'accounts'])];
    const out = withTablesRollback(tables, () => {
      const rows = giftVouchersDb.all();
      const numbers = rows.map((v) => v.number);
      const codes = new Set(rows.map((v) => codeKey(v.code)));
      const made: GiftVoucher[] = [];
      for (let i = 0; i < count; i++) {
        const number = nextSeriesNumberFor(settings.prefix, date, numbers);
        numbers.push(number);
        const seq = parseSeries(number)?.seq ?? numbers.length;
        let code = makeVoucherCode(date, seq, fill);
        for (let tries = 0; codes.has(codeKey(code)) && tries < 20; tries++) code = makeVoucherCode(date, seq, fill);
        if (codes.has(codeKey(code))) throw new Error('Could not make a unique voucher code — try again.');
        codes.add(codeKey(code));
        made.push({
          id: generateId(), number, code, face_value: face, issued_on: date, expires_on: expires, status: 'active',
          ...(input.promo ? { promo: true } : { tender: input.method || 'Cash' }),
          ...(input.buyer?.trim() ? { buyer: input.buyer.trim() } : {}),
          ...(input.branch_id ? { branch_id: input.branch_id } : {}),
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
          created_at: nowIso(),
        });
      }
      let receipt: string | undefined;
      if (input.promo) {
        assertUnlocked({ id: made[0].id, issue_date: date, invoice_number: made[0].number }, 'create');
      } else {
        const liability = ensureGiftVoucherAccount();
        const amount = paise(face * count);
        const v = saveVoucher({
          type: 'RECEIPT', date,
          narration: `Sale of ${count} gift voucher${count === 1 ? '' : 's'} ${made[0].number}${count > 1 ? ` – ${made[made.length - 1].number}` : ''} × ₹${face}${input.buyer?.trim() ? ` to ${input.buyer.trim()}` : ''} (${input.method || 'Cash'}) — no invoice: not a supply (Circular 243/37/2024-GST), verify with your CA`,
          lines: [{ account_id: cashAccountFor(input.method), dr: amount, cr: 0 }, { account_id: liability, dr: 0, cr: amount }],
          voucher_class: 'Gift voucher sale',
          ...(input.branch_id ? { branch_id: input.branch_id } : {}),
        });
        receipt = v.number;
        for (const m of made) m.sale_voucher_id = v.id;
      }
      setTable(GV_TABLE, [...rows, ...made]);
      recordSeries(made[made.length - 1].number);
      return { vouchers: made, receipt };
    });
    log(out.vouchers[0], 'create', `${input.promo ? 'Issued promotional' : 'Sold'} ${count} gift voucher${count === 1 ? '' : 's'} of ₹${face} (${out.vouchers[0].number}${count > 1 ? ` – ${out.vouchers[count - 1].number}` : ''})${out.receipt ? `, receipt ${out.receipt}` : ''}`);
    return out;
  },

  /**
   * Cancel a voucher nothing was redeemed from (owner). A sold voucher is refunded by a payment voucher:
   * Dr Gift vouchers outstanding | Cr Cash / Bank.
   */
  cancel(id: string, date: string, reason?: string): GiftVoucher {
    requireAccess('doc.deleteIssued');
    const v = giftVouchersDb.get(id);
    if (!v) throw new Error('This gift voucher no longer exists.');
    if (v.status === 'cancelled') throw new Error(`Gift voucher ${v.number} is already cancelled.`);
    if (!isoDay(date)) throw new Error('Choose the refund date.');
    const st = voucherState(v, getTable<Payment>('transactions'), date, getTable<InvoiceRecord>('invoices'));
    if (st.redeemed + st.promoUsed > 0) throw new Error(`Gift voucher ${v.number} has been used (₹${round2(st.redeemed + st.promoUsed)}), so it cannot be cancelled.`);
    if (v.breakage_voucher_id) throw new Error(`The unredeemed balance of ${v.number} was recognised as income. Undo that first.`);
    const saved = withTablesRollback([GV_TABLE, 'vouchers', 'accounts'], () => {
      let refund: string | undefined;
      if (!v.promo && v.sale_voucher_id) {
        const amount = paise(v.face_value);
        refund = saveVoucher({
          type: 'PAYMENT', date,
          narration: `Refund of cancelled gift voucher ${v.number}${v.buyer ? ` to ${v.buyer}` : ''}${reason?.trim() ? ` — ${reason.trim()}` : ''}`,
          lines: [{ account_id: ensureGiftVoucherAccount(), dr: amount, cr: 0 }, { account_id: cashAccountFor(v.tender), dr: 0, cr: amount }],
          voucher_class: 'Gift voucher refund',
          ...(v.branch_id ? { branch_id: v.branch_id } : {}),
        }).id;
      } else {
        assertUnlocked({ id: v.id, issue_date: date, invoice_number: v.number }, 'cancel');
      }
      const next: GiftVoucher = { ...v, status: 'cancelled', ...(refund ? { refund_voucher_id: refund } : {}), ...(reason?.trim() ? { note: reason.trim() } : {}), updated_at: nowIso() };
      setTable(GV_TABLE, giftVouchersDb.all().map((x) => (x.id === id ? next : x)));
      return next;
    });
    log(saved, 'update', `Cancelled gift voucher ${v.number}${saved.refund_voucher_id ? ` and refunded ₹${v.face_value}` : ''}`);
    return saved;
  },

  /** Expired balances not yet recognised on `asOf` (sold vouchers only: a promotional one carries no liability). */
  breakageDue(asOf: string): { voucher: GiftVoucher; balance: number }[] {
    const pays = peekTable<Payment>('transactions');
    const invs = peekTable<InvoiceRecord>('invoices');
    return giftVouchersDb.all()
      .filter((v) => !v.promo && v.status !== 'cancelled' && !v.breakage_voucher_id && v.expires_on < asOf)
      .map((v) => ({ voucher: v, balance: voucherState(v, pays, asOf, invs).balance }))
      .filter((r) => r.balance > 0.004);
  },

  /**
   * "Recognise unredeemed balance": one journal on `date` for every voucher expired before `asOf` with a balance:
   * Dr Gift vouchers outstanding | Cr Unredeemed voucher income. No GST (breakage is not a supply — verify with your CA).
   */
  recogniseBreakage(asOf: string, date: string): { journal: string; count: number; amount: number } {
    requireAccess('books.edit');
    if (!isoDay(asOf) || !isoDay(date)) throw new Error('Choose the dates.');
    const due = giftVouchersDb.breakageDue(asOf);
    if (!due.length) throw new Error('No expired gift voucher has a balance left to recognise.');
    const amount = round2(due.reduce((s, r) => s + r.balance, 0));
    const out = withTablesRollback([GV_TABLE, 'vouchers', 'accounts'], () => {
      const j = saveVoucher({
        type: 'JOURNAL', date,
        narration: `Unredeemed balance of ${due.length} expired gift voucher${due.length === 1 ? '' : 's'} (${due.slice(0, 5).map((r) => r.voucher.number).join(', ')}${due.length > 5 ? ', …' : ''}) recognised as income — no GST: breakage is not a supply (Circular 243/37/2024-GST); verify with your CA`,
        lines: [{ account_id: ensureGiftVoucherAccount(), dr: paise(amount), cr: 0 }, { account_id: ensureBreakageAccount(), dr: 0, cr: paise(amount) }],
        voucher_class: 'Gift voucher breakage',
      });
      const ids = new Map(due.map((r) => [r.voucher.id, r.balance]));
      setTable(GV_TABLE, giftVouchersDb.all().map((v) => (ids.has(v.id) ? { ...v, status: 'expired' as const, breakage_voucher_id: j.id, breakage_amount: ids.get(v.id), updated_at: nowIso() } : v)));
      return { journal: j.number, id: j.id };
    });
    log({ id: out.id, number: out.journal }, 'create', `Recognised ₹${amount} unredeemed balance of ${due.length} expired gift voucher(s) as income (${out.journal})`);
    return { journal: out.journal, count: due.length, amount };
  },

  /** Undo a breakage journal: it is deleted (period lock applies) and the balances are outstanding again. */
  undoBreakage(journalId: string): number {
    requireAccess('books.edit');
    const hit = giftVouchersDb.all().filter((v) => v.breakage_voucher_id === journalId);
    if (!hit.length) throw new Error('No gift voucher was recognised by this journal.');
    withTablesRollback([GV_TABLE, 'vouchers'], () => {
      deleteVoucher(journalId);
      setTable(GV_TABLE, giftVouchersDb.all().map((v) => {
        if (v.breakage_voucher_id !== journalId) return v;
        const { breakage_voucher_id: _j, breakage_amount: _a, ...rest } = v;
        void _j;
        void _a;
        return { ...rest, status: 'active' as const, updated_at: nowIso() };
      }));
    });
    log({ id: journalId, number: '' }, 'delete', `Undid the gift-voucher breakage journal (${hit.length} voucher(s))`);
    return hit.length;
  },
};

/**
 * Pay an invoice with a gift voucher (the payment dialog): checks the code, balance and expiry, records a normal
 * receipt with method "Gift voucher" and stamps `gift_voucher_id` — all or nothing.
 */
export function redeemOnInvoice(x: { invoiceId: string; code: string; amount: number; date: string }): { payment: Payment; voucher: GiftVoucher } {
  requireAccess('payment.record');
  const v = findVoucherByCode(x.code, giftVouchersDb.all());
  if (!v) throw new Error('No gift voucher has this code.');
  const issue = liveRedeemIssue(v.id, x.amount, x.date);
  if (issue) throw new Error(issue);
  const payment = withTablesRollback(['transactions', 'invoices', 'series_counters'], () => {
    const p = localDb.payments.record({ invoiceId: x.invoiceId, amount: round2(num(x.amount)), method: GV_METHOD, reference: v.number, date: x.date });
    stampVoucherPayment(p.id, v.id);
    return { ...p, gift_voucher_id: v.id };
  });
  return { payment, voucher: v };
}

/* ── Register ─────────────────────────────────────────────────── */

export interface GvRegisterRow {
  voucher: GiftVoucher;
  state: VoucherState;
}

export interface GvRegisterTotals {
  issued: number;
  /** Face value of vouchers SOLD in the period (promotional ones excluded). */
  soldValue: number;
  promoValue: number;
  /** Redeemed in the period (receipts + promo discounts dated in it). */
  redeemed: number;
  /** Outstanding balance of live vouchers on the `day`. */
  balance: number;
  /** Balance of expired vouchers not yet recognised, plus breakage recognised. */
  expired: number;
}

export interface GvRegister {
  rows: GvRegisterRow[];
  totals: GvRegisterTotals;
  byBranch: { branch_id: string; totals: GvRegisterTotals }[];
}

const zero = (): GvRegisterTotals => ({ issued: 0, soldValue: 0, promoValue: 0, redeemed: 0, balance: 0, expired: 0 });

/** Register for vouchers issued in [from, to] (and redemptions dated in it), by issuing branch. Pure. */
export function gvRegister(
  vouchers: readonly GiftVoucher[], payments: readonly Payment[], invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[],
  opt: { from?: string; to?: string; day: string; branch?: string },
): GvRegister {
  const from = opt.from || '0000-01-01';
  const to = opt.to || '9999-12-31';
  const rows: GvRegisterRow[] = [];
  const totals = zero();
  const branches = new Map<string, GvRegisterTotals>();
  const inRange = (d: string) => d >= from && d <= to;
  for (const v of vouchers) {
    if (opt.branch !== undefined && opt.branch !== '' && (v.branch_id ?? '') !== opt.branch) continue;
    const state = voucherState(v, payments, opt.day, invoices);
    const issuedIn = inRange(v.issued_on);
    const redeemedIn = round2(state.payments.filter((p) => inRange(p.date)).reduce((s, p) => s + num(p.amount), 0)
      + (v.promo_uses ?? []).filter((u) => inRange(u.date)).reduce((s, u) => s + num(u.amount), 0));
    if (!issuedIn && redeemedIn <= 0) continue;
    rows.push({ voucher: v, state });
    const b = branches.get(v.branch_id ?? '') ?? zero();
    for (const t of [totals, b]) {
      if (issuedIn && v.status !== 'cancelled') {
        t.issued++;
        if (v.promo) t.promoValue = round2(t.promoValue + num(v.face_value));
        else t.soldValue = round2(t.soldValue + num(v.face_value));
      }
      t.redeemed = round2(t.redeemed + redeemedIn);
      if (state.status === 'active') t.balance = round2(t.balance + state.balance);
      if (state.status === 'expired' && !v.promo) t.expired = round2(t.expired + state.balance + state.breakage);
    }
    branches.set(v.branch_id ?? '', b);
  }
  rows.sort((a, b) => b.voucher.issued_on.localeCompare(a.voucher.issued_on) || b.voucher.number.localeCompare(a.voucher.number, undefined, { numeric: true }));
  return { rows, totals, byBranch: [...branches.entries()].map(([branch_id, t]) => ({ branch_id, totals: t })) };
}

export interface GvHistoryRow {
  date: string;
  what: string;
  ref: string;
  amount: number;
}

/** Everything that happened to one voucher, oldest first. Pure. */
export function gvHistory(v: GiftVoucher, payments: readonly Payment[], invoices: readonly Pick<InvoiceRecord, 'id' | 'invoice_number'>[]): GvHistoryRow[] {
  const numbers = new Map(invoices.map((i) => [i.id, i.invoice_number]));
  const out: GvHistoryRow[] = [{ date: v.issued_on, what: v.promo ? 'Issued (promotional)' : `Sold (${v.tender ?? 'Cash'})`, ref: v.number, amount: num(v.face_value) }];
  for (const p of payments.filter((x) => x.gift_voucher_id === v.id)) out.push({ date: p.date, what: 'Redeemed', ref: numbers.get(p.invoice_id) ?? p.reference ?? '', amount: -num(p.amount) });
  for (const u of v.promo_uses ?? []) out.push({ date: u.date, what: 'Used as discount', ref: u.number, amount: -num(u.amount) });
  if (v.breakage_voucher_id) out.push({ date: v.expires_on, what: 'Unredeemed balance recognised as income', ref: '', amount: -num(v.breakage_amount) });
  if (v.status === 'cancelled') out.push({ date: (v.updated_at ?? '').slice(0, 10) || v.issued_on, what: v.refund_voucher_id ? 'Cancelled and refunded' : 'Cancelled', ref: '', amount: v.refund_voucher_id ? -num(v.face_value) : 0 });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function gvRegisterCsv(reg: GvRegister, branchName: (id: string) => string): string {
  return toCsv([
    ['Gift voucher register — working paper (verify with your CA)'],
    ['Number', 'Code', 'Promotional', 'Face value', 'Issued on', 'Expires on', 'Buyer', 'Branch', 'Redeemed', 'Recognised as income', 'Balance', 'Status'],
    ...reg.rows.map((r) => [
      r.voucher.number, r.voucher.code, r.voucher.promo ? 'Yes' : '', r.voucher.face_value, r.voucher.issued_on, r.voucher.expires_on,
      r.voucher.buyer ?? '', r.voucher.branch_id ? branchName(r.voucher.branch_id) : '', round2(r.state.redeemed + r.state.promoUsed), r.state.breakage, r.state.balance, r.state.status,
    ]),
    [],
    ['Issued', reg.totals.issued], ['Sold value', reg.totals.soldValue], ['Promotional value', reg.totals.promoValue],
    ['Redeemed in period', reg.totals.redeemed], ['Outstanding balance', reg.totals.balance], ['Expired', reg.totals.expired],
  ]);
}
