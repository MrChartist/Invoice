/**
 * Branch-wise books (WP-9 × WP-2, gap P1-19): the reports engine's `{ branchId }` option.
 *
 * Every ledger voucher belongs to exactly one branch (or to none), decided from its SOURCE row with
 * the same rules as the lists (`branchPredicates` / `branchOf*` in `src/lib/branch.ts`):
 *  - sales invoices / credit notes (`sale:` / `cn:`): `branchOfInvoice` (own tag, else the branch
 *    that names the sender profile or GSTIN);
 *  - receipts (`rcpt:`) and advance adjustments (`advadj:`) follow the invoice they settle;
 *  - bills / expenses (`pur:` / `exp:`): `branchOfPurchase` (own tag, else the only branch in the
 *    bill's place-of-supply state); supplier payments (`pay:`) and debit notes (`pdn:`) follow
 *    their bill;
 *  - manual vouchers (`mv:` and their automatic reversals): their `branch_id`;
 *  - everything else (openings, depreciation, payroll, challans, advances received, on-account
 *    supplier payments) is company-level: it shows under "No branch", as does a row tagged with a
 *    branch that was deleted.
 *
 * Because whole vouchers are kept or dropped, each branch's trial balance balances on its own and
 * the branches plus "No branch" add up to the company trial balance exactly. Report-time closing
 * stock is company-wide and is not apportioned to branches (callers pass no valuer for a branch).
 * Pure. Working papers — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import { branchOfInvoice, branchOfPurchase, matchesBranch, type Branch } from '../branch';
import { num } from '../invoice-calc';
import { toPaise } from '../export-shared';
import { toIsoDate, type BooksData } from '../books';
import type { Ledger, LedgerVoucher } from './postings';
import type { ManualVoucher } from './vouchers';

/** Option accepted by the report builders (trial balance, P&L, balance sheet, cash flow, group summary, registers). */
export interface ReportScope {
  /** '' / absent = whole company; a branch id; or `UNASSIGNED` for rows with no branch. */
  branchId?: string;
}

type Source = Pick<BooksData, 'invoices' | 'transactions' | 'purchases' | 'purchasePayments' | 'purchaseReturns'> & { manual: readonly ManualVoucher[] };

/** Voucher id → branch id ('' = no branch), from the ledger's source rows. */
export function voucherBranches(src: Source, vouchers: readonly LedgerVoucher[], branches: readonly Branch[]): Map<string, string> {
  const inv = new Map<string, string>();
  for (const i of src.invoices) if (i?.id) inv.set(i.id, branchOfInvoice(i as InvoiceRecord, branches));
  const pur = new Map<string, string>();
  for (const p of src.purchases) {
    const id = (p as { id?: unknown }).id;
    if (typeof id === 'string' && id) pur.set(id, branchOfPurchase(p as unknown as PurchaseRecord, branches));
  }
  const rcpt = new Map<string, string>();
  for (const t of src.transactions) if (t?.id) rcpt.set(String(t.id), inv.get(t.invoice_id) ?? '');
  const pay = new Map<string, string>();
  for (const pp of src.purchasePayments) {
    const b = pur.get(String(pp.purchase_id ?? '')) ?? '';
    // Same key as postings.ts `supplierPaymentVoucher` (id, else purchase-date-amount).
    const key = pp.id ?? `${pp.purchase_id}-${toIsoDate(pp.date)}-${Math.abs(toPaise(num(pp.amount)))}`;
    pay.set(String(key), b);
  }
  const pdn = new Map<string, string>();
  for (const r of src.purchaseReturns ?? []) if (r?.id) pdn.set(r.id, pur.get(r.purchase_id ?? '') ?? '');
  const man = new Map<string, string>();
  for (const m of src.manual) if (m?.id) man.set(m.id, m.branch_id ?? '');

  const known = new Set(branches.map((b) => b.id));
  const out = new Map<string, string>();
  for (const v of vouchers) {
    let b = '';
    if (v.manualId) b = man.get(v.manualId) ?? '';
    else {
      const i = v.id.indexOf(':');
      const kind = v.id.slice(0, i);
      const ref = v.id.slice(i + 1);
      if (kind === 'sale' || kind === 'cn') b = inv.get(ref) ?? '';
      else if (kind === 'rcpt' || kind === 'advadj') b = rcpt.get(ref) ?? '';
      else if (kind === 'pur' || kind === 'exp') b = pur.get(ref) ?? '';
      else if (kind === 'pay') b = pay.get(ref) ?? '';
      else if (kind === 'pdn') b = pdn.get(ref) ?? '';
    }
    // A tag naming a deleted branch counts as "No branch", so the branches always partition the books.
    if (b && known.has(b)) out.set(v.id, b);
  }
  return out;
}

/** The branch a ledger voucher belongs to ('' = company level / no branch). */
export function branchOfLedgerVoucher(ledger: Ledger, v: Pick<LedgerVoucher, 'id'>): string {
  return ledger.voucherBranch?.get(v.id) ?? '';
}

const cache = new WeakMap<Ledger, Map<string, Ledger>>();

/**
 * The ledger narrowed to one branch (same accounts, only that branch's vouchers). No scope, or a
 * ledger built without branch data, returns the ledger itself. Cached per ledger and branch.
 */
export function scopeLedger(ledger: Ledger, scope?: ReportScope): Ledger {
  const id = scope?.branchId;
  if (!id) return ledger;
  let m = cache.get(ledger);
  if (!m) cache.set(ledger, (m = new Map()));
  const hit = m.get(id);
  if (hit) return hit;
  const scoped: Ledger = {
    ...ledger,
    vouchers: ledger.vouchers.filter((v) => matchesBranch(branchOfLedgerVoucher(ledger, v), id)),
    branchId: id,
  };
  m.set(id, scoped);
  return scoped;
}

/** Branch ids that own at least one voucher, plus '' when company-level vouchers exist. */
export function branchesInLedger(ledger: Ledger): string[] {
  const set = new Set<string>();
  for (const v of ledger.vouchers) set.add(branchOfLedgerVoucher(ledger, v));
  return [...set];
}
