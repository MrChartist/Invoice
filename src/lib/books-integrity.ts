/**
 * Books integrity check (WP-7, P2 "integrity check"): what a CA looks at before signing off a year.
 *   - the trial balance balances (every posted voucher, and the whole ledger, Dr = Cr to the paisa);
 *   - the difference in opening balances is zero;
 *   - no orphaned links: receipts whose document is gone, supplier payments whose bill is gone,
 *     receipt rows allocated by a manual voucher that no longer exists, document links to missing
 *     documents, opening bills of deleted parties;
 *   - no "negative cash" days: the cash-in-hand balance never closes a day below zero;
 *   - whatever the ledger itself warned about (unknown accounts, unbalanced vouchers).
 * Pure; `loadIntegrityInput` reads storage. Working paper — verify with your CA.
 */

import type { Ledger } from './ledger/postings';
import { A } from './ledger/accounts';
import { readPurchase } from './purchase-normalize';

export type IntegrityArea = 'tb' | 'openings' | 'links' | 'cash' | 'ledger';

export interface IntegrityIssue {
  area: IntegrityArea;
  severity: 'error' | 'warning';
  message: string;
  /** Record id the issue is about, when there is one (for an "Edit log" / open link). */
  ref?: string;
}

export interface IntegrityInput {
  ledger: Ledger;
  invoices: ReadonlyArray<{ id: string; invoice_number?: string }>;
  transactions: ReadonlyArray<{ id: string; invoice_id?: string; voucher_id?: string; advance_id?: string; client_id?: string; amount?: number; date?: string }>;
  /** Raw `purchases` rows (read through `readPurchase`, Critical Rule 9). */
  purchases: readonly unknown[];
  purchasePayments: ReadonlyArray<{ id: string; purchase_id?: string; amount?: number; date?: string }>;
  docLinks: ReadonlyArray<{ id: string; from_id: string; to_id: string; relation?: string }>;
  openingBills: ReadonlyArray<{ id: string; party_id?: string; party_name?: string; side?: string }>;
  manualVoucherIds: readonly string[];
  clientIds: readonly string[];
  vendorIds: readonly string[];
  /** Debit-positive paise of each ledger opening (for the difference). */
  openingSum: number;
  /** Only vouchers up to this day count for the cash check (default: all). */
  asOf?: string;
}

export interface IntegrityReport {
  ok: boolean;
  totals: { dr: number; cr: number; diff: number };
  negativeCashDays: Array<{ date: string; balance: number }>;
  issues: IntegrityIssue[];
}

const MAX_LIST = 25;
const rupees = (p: number) => `₹${(Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function checkBooksIntegrity(input: IntegrityInput): IntegrityReport {
  const issues: IntegrityIssue[] = [];
  const add = (i: IntegrityIssue) => issues.push(i);

  /* Trial balance */
  let dr = 0;
  let cr = 0;
  for (const v of input.ledger.vouchers) {
    let vd = 0;
    let vc = 0;
    for (const l of v.lines) {
      vd += l.dr;
      vc += l.cr;
    }
    dr += vd;
    cr += vc;
    if (vd !== vc) add({ area: 'tb', severity: 'error', message: `${v.kind} ${v.number || v.id} (${v.date}) is out of balance by ${rupees(vd - vc)}.`, ref: v.manualId ?? v.id });
  }
  if (dr !== cr) add({ area: 'tb', severity: 'error', message: `The trial balance does not balance: debits ${rupees(dr)}, credits ${rupees(cr)}.` });
  if (input.openingSum !== 0) add({ area: 'openings', severity: 'warning', message: `Difference in opening balances: ${rupees(input.openingSum)} ${input.openingSum > 0 ? 'Dr' : 'Cr'} (posted to Opening balance difference, 1090).` });
  for (const w of input.ledger.warnings.slice(0, MAX_LIST)) add({ area: 'ledger', severity: 'warning', message: w });

  /* Orphaned links */
  const invoiceIds = new Set(input.invoices.map((i) => i.id));
  const billIds = new Set(input.openingBills.map((b) => b.id));
  const vouchers = new Set(input.manualVoucherIds);
  const purchaseIds = new Set<string>();
  for (const raw of input.purchases) {
    const p = readPurchase(raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}, []);
    if (p?.id) purchaseIds.add(p.id);
  }
  const links: IntegrityIssue[] = [];
  for (const t of input.transactions) {
    if (t.voucher_id && !vouchers.has(t.voucher_id)) links.push({ area: 'links', severity: 'warning', message: `Receipt ${rupees(Math.round((t.amount ?? 0) * 100))} of ${t.date ?? '?'} was allocated by a manual voucher that no longer exists.`, ref: t.id });
    else if (t.invoice_id && !invoiceIds.has(t.invoice_id) && !billIds.has(t.invoice_id) && !t.client_id && !t.advance_id) links.push({ area: 'links', severity: 'error', message: `Receipt ${rupees(Math.round((t.amount ?? 0) * 100))} of ${t.date ?? '?'} points at a document that no longer exists.`, ref: t.id });
  }
  for (const p of input.purchasePayments) {
    if (p.purchase_id && !purchaseIds.has(p.purchase_id)) links.push({ area: 'links', severity: 'error', message: `Supplier payment ${rupees(Math.round((p.amount ?? 0) * 100))} of ${p.date ?? '?'} points at a bill that no longer exists.`, ref: p.id });
  }
  for (const l of input.docLinks) {
    const missing = [l.from_id, l.to_id].filter((id) => !invoiceIds.has(id));
    if (missing.length) links.push({ area: 'links', severity: 'warning', message: `A document link (${l.relation ?? 'link'}) points at ${missing.length === 2 ? 'two documents' : 'a document'} that no longer exist${missing.length === 2 ? '' : 's'}.`, ref: l.id });
  }
  const clients = new Set(input.clientIds);
  const vendors = new Set(input.vendorIds);
  for (const b of input.openingBills) {
    if (!b.party_id) continue;
    const ok = b.side === 'payable' ? vendors.has(b.party_id) : clients.has(b.party_id);
    if (!ok) links.push({ area: 'links', severity: 'warning', message: `Opening bill of ${b.party_name || 'a party'} belongs to a party that was deleted.`, ref: b.id });
  }
  issues.push(...links.slice(0, MAX_LIST));
  if (links.length > MAX_LIST) add({ area: 'links', severity: 'warning', message: `…and ${links.length - MAX_LIST} more orphaned links.` });

  /* Negative cash days (cash in hand only: a bank may run an overdraft) */
  const byDay = new Map<string, number>();
  for (const v of input.ledger.vouchers) {
    if (input.asOf && v.date > input.asOf) continue;
    for (const l of v.lines) if (l.account === A.cash) byDay.set(v.date, (byDay.get(v.date) ?? 0) + l.dr - l.cr);
  }
  let bal = 0;
  const negativeCashDays: IntegrityReport['negativeCashDays'] = [];
  for (const [date, delta] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    bal += delta;
    if (bal < 0) negativeCashDays.push({ date, balance: bal });
  }
  if (negativeCashDays.length) {
    const first = negativeCashDays[0];
    add({ area: 'cash', severity: 'error', message: `Cash in hand closes below zero on ${negativeCashDays.length} day${negativeCashDays.length === 1 ? '' : 's'}, first on ${first.date} (${rupees(first.balance)} Cr): a payment was recorded before the cash came in, or a receipt is missing.` });
  }

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    totals: { dr, cr, diff: dr - cr },
    negativeCashDays: negativeCashDays.slice(0, 100),
    issues,
  };
}
