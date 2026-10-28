/**
 * R15-A3 party netting: a party who is both customer and supplier — a client and a vendor with the same name or GSTIN,
 * or linked by hand (`Vendor.client_id`) — has open invoices set off against open bills in one step.
 *
 * Posting reuses the R9 / R12 no-cash marker (NO new marker): one receipt row per (invoice, bill) pair on `transactions`
 * with `exchange_purchase_id` = the bill and `method: 'netting'`, so `movedNoCash` already keeps it out of every cash /
 * bank reader and `ledger/postings.ts` already posts it Dr Sundry creditors (party) / Cr Debtors (party). The bill side is
 * the generalised roll-up `exchangeSettled` (live receipt rows): `syncNettedPaid` keeps the bill's `amount_paid` (and
 * `exchange_paid`, the R9 field) equal to cash paid + live netting rows, and the bill-wise payables reader shows the rows
 * as dated adjustments. Deleting / reversing a netting receipt frees both sides. TDS and RCM on the bill are untouched.
 * Working paper — verify with your CA (TV26, TV27).
 */
import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import type { PurchaseRecord, Vendor } from '../types/purchases';
import { can, requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { num, round2 } from './invoice-calc';
import { localDb } from './localDb';
import { assertUnlocked } from './period-lock';
import { isVoidStatus, supplierPayable } from './purchase-normalize';
import { generateId, getTable, peekTable, setTable } from './storage';
import { isRevenueDoc } from './stats';
import { receivableBalance } from './rcm';
import { withTablesRollback } from './table-txn';
import { exchangeSettled, ownFlow, syncNettedPaid } from './retail/rt-doc-hooks';

/**
 * The generalised roll-up and the bill sync live beside R9's URD sync (`rt-doc-hooks.ts`, already on the registry
 * chunk every lazy screen preloads), so the R9 hooks (bill cancel / delete, recycle-bin restore) re-settle netted bills
 * too without pulling this module into their preload lists.
 */
export { exchangeSettled, syncNettedPaid };

declare module '../types/invoice' {
  interface Payment {
    /** R15-A3: the netting action this receipt belongs to (one id per "Set off"; reversal removes them together). */
    netting_id?: string;
  }
}

export const NETTING_METHOD = 'netting';
/** Approval cap for clerks (₹): any netting above it needs the owner (default 0 = every netting by a clerk). */
export const NETTING_CLERK_CAP = 0;

const key = (s: unknown) => String(s ?? '').trim().toLowerCase();

export const isNettingRow = (p: Partial<Payment>): boolean => p.method === NETTING_METHOD && !!p.exchange_purchase_id;


/** The client a vendor stands for: the hand link, else the same GSTIN, else the same name. */
export function clientOfVendor(v: Vendor, clients: readonly Client[]): Client | undefined {
  if (v.client_id) return clients.find((c) => c.id === v.client_id);
  const g = key(v.gstin);
  return (g && clients.find((c) => key(c.gstin) === g)) || clients.find((c) => key(c.name) === key(v.name) || (!!c.company && key(c.company) === key(v.name)));
}

/** Every customer ↔ supplier pair. */
export function nettingParties(clients: readonly Client[], vendors: readonly Vendor[]): { client: Client; vendor: Vendor }[] {
  const out: { client: Client; vendor: Vendor }[] = [];
  for (const vendor of vendors) {
    const client = clientOfVendor(vendor, clients);
    if (client) out.push({ client, vendor });
  }
  return out;
}

export interface OpenItem { id: string; number: string; date: string; open: number; currency: string; rcm?: boolean }

const ofClient = (inv: InvoiceRecord, c: Client) =>
  inv.client?.id ? inv.client.id === c.id : key(inv.client?.name) === key(c.name) || (!!c.gstin && key(inv.client?.gstin) === key(c.gstin));

/** Open customer invoices of a client, oldest first. */
export function openInvoices(client: Client, invoices: readonly InvoiceRecord[]): OpenItem[] {
  return invoices
    .filter((i) => isRevenueDoc(i) && i.status !== 'Draft' && i.status !== 'Cancelled' && ofClient(i, client) && receivableBalance(i) > 0.004)
    .map((i) => ({ id: i.id, number: i.invoice_number, date: i.issue_date, open: round2(receivableBalance(i)), currency: (i.currency || 'INR').toUpperCase() }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Open supplier bills of a vendor (purchases rows read as stored; `supplierPayable` is the shared reader), oldest first. */
export function openBills(vendor: Vendor, purchases: readonly PurchaseRecord[]): OpenItem[] {
  return purchases
    .filter((b) => (b.vendor_id ? b.vendor_id === vendor.id : key(b.vendor_name) === key(vendor.name)) && !isVoidStatus(b.status) && !ownFlow(b))
    .map((b) => ({ id: b.id, number: b.bill_number, date: b.date, open: round2(Math.max(supplierPayable(b) - num(b.amount_paid), 0)), currency: 'INR', rcm: !!b.reverse_charge }))
    .filter((b) => b.open > 0.004)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Split `amount` over the picked invoices and bills, oldest first: one (invoice, bill, amount) per receipt row. */
export function pairNetting(invs: readonly OpenItem[], bills: readonly OpenItem[], amount: number): { invoiceId: string; billId: string; amount: number }[] {
  const out: { invoiceId: string; billId: string; amount: number }[] = [];
  const left = bills.map((b) => b.open);
  let rest = round2(amount);
  let j = 0;
  for (const inv of invs) {
    let take = round2(Math.min(inv.open, rest));
    while (take > 0.004 && j < bills.length) {
      const a = round2(Math.min(take, left[j]));
      if (a > 0.004) out.push({ invoiceId: inv.id, billId: bills[j].id, amount: a });
      left[j] = round2(left[j] - a);
      take = round2(take - a);
      rest = round2(rest - a);
      if (left[j] <= 0.004) j++;
    }
    if (rest <= 0.004) break;
  }
  return out;
}

export interface NettingInput {
  clientId: string;
  vendorId: string;
  invoiceIds: readonly string[];
  billIds: readonly string[];
  amount: number;
  date: string;
  /** The user confirms the reverse-charge GST on picked RCM bills is paid (TV27). */
  rcmPaid?: boolean;
}

export class NettingError extends Error {}

/** Set off: one receipt per (invoice, bill) pair, all or nothing, one audit line (`books.edit`; clerks above the cap → owner). */
export function postNetting(input: NettingInput): { nettingId: string; receipts: Payment[] } {
  requireAccess('books.edit');
  const amount = round2(num(input.amount));
  if (!can('doc.approve') && amount > NETTING_CLERK_CAP) throw new NettingError('Netting needs the owner\'s approval: ask the owner to set it off.');
  const date = isoDay(input.date);
  if (!date) throw new NettingError('Choose the netting date.');
  if (!(amount > 0)) throw new NettingError('Enter an amount above zero.');
  assertUnlocked({ id: 'netting', issue_date: date }, 'create');
  const client = localDb.clients.getAll().find((c) => c.id === input.clientId);
  const vendor = getTable<Vendor>('vendors').find((v) => v.id === input.vendorId);
  if (!client || !vendor || clientOfVendor(vendor, [client])?.id !== client.id) throw new NettingError('This customer and supplier are not one party.');
  const all = getTable<PurchaseRecord>('purchases');
  for (const id of input.billIds) {
    const b = all.find((x) => x.id === id);
    if (!b) throw new NettingError('A picked bill was not found.');
    if (b.used_goods || b.old_metal) throw new NettingError(`${b.bill_number}: a buy-back / old-gold voucher settles through its own exchange.`);
    if (b.reverse_charge && !input.rcmPaid) throw new NettingError(`${b.bill_number} is under reverse charge: pay the RCM first and confirm it.`);
  }
  const invs = openInvoices(client, localDb.invoices.getAll()).filter((i) => input.invoiceIds.includes(i.id));
  const bills = openBills(vendor, all).filter((b) => input.billIds.includes(b.id));
  if (invs.length !== input.invoiceIds.length || bills.length !== input.billIds.length) throw new NettingError('A picked invoice or bill is no longer open.');
  if (invs.some((i) => i.currency !== 'INR')) throw new NettingError('Invoices and bills are in different currencies.');
  const cap = Math.min(round2(invs.reduce((s, i) => s + i.open, 0)), round2(bills.reduce((s, b) => s + b.open, 0)));
  if (amount > cap + 0.004) throw new NettingError(`At most ${cap.toFixed(2)} can be set off.`);
  const nettingId = generateId();
  const pairs = pairNetting(invs, bills, amount);
  const no = (id: string) => bills.find((b) => b.id === id)?.number ?? '';
  const receipts = withTablesRollback(['transactions', 'invoices', 'purchases', 'series_counters'], () => {
    const ids: string[] = [];
    for (const p of pairs) {
      ids.push(localDb.payments.record({ invoiceId: p.invoiceId, amount: p.amount, method: NETTING_METHOD, date, reference: no(p.billId), note: `Netting against bill ${no(p.billId)}` }).id);
    }
    const pair = new Map(ids.map((id, n) => [id, pairs[n].billId]));
    const rows = getTable<Payment>('transactions').map((t) => (pair.has(t.id) ? { ...t, exchange_purchase_id: pair.get(t.id), netting_id: nettingId } : t));
    setTable('transactions', rows);
    syncNettedPaid(bills.map((b) => b.id));
    return rows.filter((t) => pair.has(t.id));
  });
  audit.record({ entity: 'vendor_payment', entity_id: nettingId, action: 'create', summary: `Netting ${amount.toFixed(2)}: ${client.name} (customer) against ${vendor.name} (supplier), ${pairs.length} set-off(s) on ${date}` });
  return { nettingId, receipts };
}

/** Nettings on record (newest first), grouped by `netting_id`. */
export function nettings(payments: readonly Payment[] = peekTable<Payment>('transactions')): { id: string; date: string; amount: number; rows: Payment[] }[] {
  const m = new Map<string, Payment[]>();
  for (const p of payments) if (isNettingRow(p) && p.netting_id) m.set(p.netting_id, [...(m.get(p.netting_id) ?? []), p]);
  return [...m].map(([id, rows]) => ({ id, date: rows[0].date, amount: round2(rows.reduce((s, r) => s + num(r.amount), 0)), rows })).sort((a, b) => b.date.localeCompare(a.date));
}

/** Reverse a netting: its receipts go through the data layer (recycle bin); both sides are open again. */
export function reverseNetting(nettingId: string): void {
  requireAccess('books.edit');
  const n = nettings().find((x) => x.id === nettingId);
  if (!n) throw new NettingError('This netting was not found.');
  assertUnlocked({ id: 'netting', issue_date: n.date }, 'delete');
  withTablesRollback(['transactions', 'invoices', 'purchases'], () => {
    for (const r of n.rows) localDb.payments.remove(r.id);
    syncNettedPaid(n.rows.map((r) => r.exchange_purchase_id!));
  });
  audit.record({ entity: 'vendor_payment', entity_id: nettingId, action: 'delete', summary: `Netting of ${n.amount.toFixed(2)} on ${n.date} reversed` });
}
