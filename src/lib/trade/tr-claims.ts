/**
 * TR-A2 / A3 claims to the principal (table `trade_claims`, numbered TCL/FY…).
 *
 * Scheme claim: for one principal and period, every issued sale carrying lines under that principal's schemes —
 * free lines valued by the scheme's basis (free goods at cost / at the selling rate / a fixed ₹ per free unit), or
 * for `discount_given` the line discount given on qualifying lines. Lines already on a live claim are not claimed
 * again. Price-protection claims (`kind: 'price_drop'`) come from a price-drop run (`tr-price-drop.ts`).
 * Statuses: draft → sent → settled / short-settled / rejected. Settlement (§8 Q10, TR4): **financial** by default —
 * journal Dr principal (Sundry creditors) / Cr "Scheme claims received" (no GST) — or the principal's **credit note
 * with GST** recorded as a supplier credit note (`purchase-returns.ts`, ITC reversal). Working paper — verify with
 * your CA.
 */
import './tr-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ClaimRow, TradeClaim } from '../../types/trade-r8';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { deleteVoucher } from '../ledger/vouchers';
import { purchaseReturnsDb } from '../purchase-returns';
import type { Scheme } from '../pricing';
import { TR_SERIES, TR_TABLES } from './tr-shared';
import { ensureLedger, postPair } from './tr-ledger';

export const CLAIMS_TABLE = TR_TABLES.claims;
export const CLAIMS_LEDGER = 'Scheme claims received';
const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export class ClaimError extends Error {}

export const loadClaims = (): readonly TradeClaim[] => peekTable<TradeClaim>(CLAIMS_TABLE).filter((r) => r && typeof r.id === 'string');

/** Issued, live sale documents dated in [from, to]. */
export const liveSales = (invoices: readonly InvoiceRecord[], from: string, to: string) =>
  invoices.filter((i) => SALES.has(i.doc_type) && i.status !== 'Draft' && i.status !== 'Cancelled' && i.issue_date >= from && i.issue_date <= to);

/**
 * Pure: the claim rows of `principalId`'s schemes in [from, to]. `cost(name)` = unit cost (at-cost basis);
 * `inScheme(s, line)` = the line qualifies for a discount-given scheme; `claimed` = keys `invoiceId|lineId` already on
 * a live claim.
 */
export function schemeClaimRows(
  invoices: readonly InvoiceRecord[], schemes: readonly Scheme[], principalId: string, from: string, to: string,
  opts: { cost: (name: string) => number; inScheme: (s: Scheme, line: InvoiceItem) => boolean; claimed?: ReadonlySet<string> },
): ClaimRow[] {
  const mine = schemes.filter((s) => s.principal_vendor_id === principalId);
  const rows: ClaimRow[] = [];
  for (const inv of liveSales(invoices, from, to)) {
    for (const l of inv.items ?? []) {
      if (opts.claimed?.has(`${inv.id}|${l.id}`)) continue;
      const free = l.free_of ? mine.find((s) => s.id === l.scheme_id) : undefined;
      const disc = !l.free_of && num(l.discount_percent) > 0 ? mine.find((s) => s.claim_basis === 'discount_given' && opts.inScheme(s, l)) : undefined;
      const s = free ?? disc;
      if (!s) continue;
      const qty = num(l.quantity);
      const paid = free ? (inv.items ?? []).find((x) => x.id === l.free_of) : undefined;
      const value = disc
        ? (qty * num(l.rate) * num(l.discount_percent)) / 100
        : s.claim_basis === 'fixed_per_unit' ? qty * num(s.claim_rate)
          : s.claim_basis === 'free_goods_at_rate' ? qty * (norm(paid?.name) === norm(l.name) ? num(paid?.rate) : opts.cost(l.name) || num(paid?.rate))
            : qty * opts.cost(l.name);
      rows.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, date: inv.issue_date, party: inv.client?.name ?? '', item: l.name, qty: disc ? qty : 0, free_qty: disc ? 0 : qty, value: round2(value), line_id: l.id });
    }
  }
  return rows;
}

/** `invoiceId|lineId` of rows on live (not rejected) scheme claims. */
export function claimedKeys(claims: readonly TradeClaim[]): Set<string> {
  return new Set(claims.filter((c) => c.kind === 'scheme' && c.status !== 'rejected').flatMap((c) => c.rows.map((r) => `${r.invoice_id}|${r.line_id}`)));
}

export const claimTotal = (rows: readonly ClaimRow[]) => round2(rows.reduce((t, r) => t + num(r.value), 0));

/** Save a claim (draft, numbered TCL/FY…). */
export function saveClaim(input: Omit<TradeClaim, 'id' | 'number' | 'amount' | 'status'>): TradeClaim {
  requireAccess('books.edit');
  if (!input.principal_id) throw new ClaimError('Choose the principal.');
  if (!input.rows.length) throw new ClaimError('Nothing to claim for this principal and period.');
  const all = getTable<TradeClaim>(CLAIMS_TABLE);
  const id = generateId();
  const number = nextSeriesNumberFor(TR_SERIES.claims, input.date, all.map((c) => c.number));
  assertUnlocked({ id, issue_date: input.date, invoice_number: number }, 'create');
  const now = new Date().toISOString();
  const row: TradeClaim = { ...input, id, number, amount: claimTotal(input.rows), status: 'draft', created_at: now, updated_at: now };
  setTable(CLAIMS_TABLE, [...all, row]);
  recordSeries(number);
  return row;
}

function update(id: string, fn: (c: TradeClaim) => TradeClaim): TradeClaim {
  const all = getTable<TradeClaim>(CLAIMS_TABLE);
  const c = all.find((x) => x.id === id);
  if (!c) throw new ClaimError('Claim not found.');
  const next = { ...fn(c), updated_at: new Date().toISOString() };
  setTable(CLAIMS_TABLE, all.map((x) => (x.id === id ? next : x)));
  return next;
}

export function markClaim(id: string, to: 'sent' | 'rejected'): TradeClaim {
  requireAccess('books.edit');
  return update(id, (c) => {
    if (c.status === 'settled' || c.status === 'short') throw new ClaimError(`Claim ${c.number} is settled.`);
    return { ...c, status: to };
  });
}

export interface Settlement {
  mode: 'financial' | 'gst';
  note_no: string;
  date: string;
  amount: number;
  /** GST variant: the rate on the principal's credit note (taxable = amount less GST). */
  gst_rate?: number;
  interstate?: boolean;
}

/** Record the principal's credit note against the claim (short-settled when below the claim). */
export function settleClaim(id: string, s: Settlement): TradeClaim {
  requireAccess('books.edit');
  const c = loadClaims().find((x) => x.id === id);
  if (!c) throw new ClaimError('Claim not found.');
  if (c.status === 'settled' || c.status === 'short' || c.status === 'rejected') throw new ClaimError(`Claim ${c.number} is ${c.status}.`);
  const amount = round2(num(s.amount));
  if (!(amount > 0) || !s.note_no.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(s.date)) throw new ClaimError("Enter the principal's credit note number, date and amount.");
  return withTablesRollback([CLAIMS_TABLE, 'vouchers', 'accounts', 'purchase_returns', 'purchases', 'series_counters'], () => {
    let voucher_id: string | undefined;
    let return_id: string | undefined;
    if (s.mode === 'gst') {
      const rate = num(s.gst_rate, 18);
      const taxable = round2(amount / (1 + rate / 100));
      return_id = purchaseReturnsDb.create({
        kind: 'SUPPLIER_CN', date: s.date, vendorId: c.principal_id, vendorName: c.principal_name, supplierNoteNumber: s.note_no.trim(), supplierNoteDate: s.date,
        reason: '02', goodsReturned: false, mode: s.interstate ? 'IGST' : 'CGST_SGST', itcEligible: true,
        lines: [{ id: generateId(), name: `${c.kind === 'scheme' ? 'Scheme' : 'Price-protection'} claim ${c.number}`, quantity: 1, rate: taxable, tax_rate: rate }],
        notes: `Against claim ${c.number}`,
      }).id;
    } else {
      voucher_id = postPair({ type: 'JOURNAL', date: s.date, dr: A.creditors, drParty: c.principal_name, cr: ensureLedger(CLAIMS_LEDGER, 'OTHER_INCOME', 4950), amount, narration: `${c.principal_name} credit note ${s.note_no.trim()} against claim ${c.number} (financial, no GST)`, cls: 'Trade claim' }).id;
    }
    return update(id, (x) => ({ ...x, status: amount + 0.004 < x.amount ? 'short' : 'settled', settlement: { mode: s.mode, note_no: s.note_no.trim(), date: s.date, amount, ...(voucher_id ? { voucher_id } : {}), ...(return_id ? { return_id } : {}) } }));
  });
}

/** Undo a settlement (its journal / supplier note goes; the claim is "sent" again). */
export function unsettleClaim(id: string): TradeClaim {
  requireAccess('books.edit');
  const c = loadClaims().find((x) => x.id === id);
  if (!c?.settlement) throw new ClaimError('This claim has no settlement.');
  return withTablesRollback([CLAIMS_TABLE, 'vouchers', 'purchase_returns', 'purchases'], () => {
    if (c.settlement!.voucher_id) deleteVoucher(c.settlement!.voucher_id);
    if (c.settlement!.return_id) purchaseReturnsDb.remove(c.settlement!.return_id);
    return update(id, (x) => ({ ...x, status: 'sent', settlement: undefined }));
  });
}

/** Claim statement rows (CSV / print; header first). */
export function claimCsv(c: TradeClaim): (string | number)[][] {
  return [
    ['Invoice no', 'Date', 'Retailer', 'Item', 'Qty', 'Free qty', 'Value'],
    ...c.rows.map((r) => [r.invoice_number, r.date, r.party, r.item, r.qty, r.free_qty, r.value]),
    ['', '', '', 'Total', '', '', c.amount],
  ];
}

/** Delete a draft or rejected claim (recycle bin through the watched table); its TCL number stays reserved. */
export function deleteClaim(id: string): void {
  requireAccess('books.edit');
  const all = getTable<TradeClaim>(CLAIMS_TABLE);
  const c = all.find((x) => x.id === id);
  if (!c) return;
  if (c.status !== 'draft' && c.status !== 'rejected') throw new ClaimError(`Claim ${c.number} is ${c.status}: reject it first.`);
  assertUnlocked({ id, issue_date: c.date, invoice_number: c.number }, 'delete');
  setTable(CLAIMS_TABLE, all.filter((x) => x.id !== id));
}
