/**
 * Duplicate supplier bill guard (8.42) — QuickBooks / Xero "this bill may be a duplicate".
 *
 *  - **Duplicate**: same supplier (GSTIN when both rows have one, else the vendor id, else the
 *    normalised name) + the same normalised bill number in the same Indian financial year. A supplier
 *    may not reuse an invoice number inside an FY (Rule 46(b)), so this is almost always a double entry.
 *  - **Possible duplicate**: same supplier, same total (to the rupee) and dates within ±3 days.
 *
 * Both are soft warnings: the bill form shows them and saves on a second press (override). The
 * exception report lists every pair found in the books. Pure — no storage.
 */

import type { PurchaseRecord } from '../types/purchases';

export const NEAR_DUPLICATE_DAYS = 3;

type BillLike = Pick<PurchaseRecord, 'vendor_name' | 'bill_number' | 'date' | 'total'> &
  Partial<Pick<PurchaseRecord, 'id' | 'vendor_id' | 'vendor_gstin' | 'kind' | 'status'>>;

/** `INV/0042`, `inv-42`, `INV 042` → `INV42`. Leading zeros of each number run are dropped. */
export function normaliseBillNo(no: string | undefined): string {
  return String(no ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/\d+/g, (run) => run.replace(/^0+(?=\d)/, ''));
}

const normName = (s: string | undefined) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Do two rows name the same supplier? GSTIN wins when both have one. */
export function sameSupplier(a: BillLike, b: BillLike): boolean {
  const ga = String(a.vendor_gstin ?? '').trim().toUpperCase();
  const gb = String(b.vendor_gstin ?? '').trim().toUpperCase();
  if (ga && gb) return ga === gb;
  if (a.vendor_id && b.vendor_id) return a.vendor_id === b.vendor_id;
  const na = normName(a.vendor_name);
  return !!na && na === normName(b.vendor_name);
}

const dayNo = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 : NaN;
};
/** Indian FY start year of a bare day (April–March), NaN when unreadable. */
const fyOf = (d: string) => {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(d);
  return m ? (+m[2] >= 4 ? +m[1] : +m[1] - 1) : NaN;
};

export interface DuplicateCheck {
  /** Same supplier + bill number in the same FY. */
  exact: PurchaseRecord[];
  /** Same supplier + amount, dates within ±3 days (and not already in `exact`). */
  near: PurchaseRecord[];
}

/** Bills in `existing` that `bill` may duplicate (rows with the same id are the bill itself). */
export function findBillDuplicates(bill: BillLike, existing: readonly PurchaseRecord[]): DuplicateCheck {
  const out: DuplicateCheck = { exact: [], near: [] };
  const no = normaliseBillNo(bill.bill_number);
  const fy = fyOf(bill.date);
  const day = dayNo(bill.date);
  for (const p of existing) {
    if (!p || p.status === 'draft' || (bill.id && p.id === bill.id) || !sameSupplier(bill, p)) continue;
    if (no && Number.isFinite(fy) && normaliseBillNo(p.bill_number) === no && fyOf(p.date) === fy) {
      out.exact.push(p);
      continue;
    }
    if (Math.abs((Number(p.total) || 0) - (Number(bill.total) || 0)) < 0.5 && Number(bill.total) > 0 && Math.abs(dayNo(p.date) - day) <= NEAR_DUPLICATE_DAYS) out.near.push(p);
  }
  return out;
}

export interface DuplicatePair {
  kind: 'exact' | 'near';
  a: PurchaseRecord;
  b: PurchaseRecord;
}

/** Every duplicate / possible-duplicate pair in the books (for the exception report), oldest first. */
export function duplicateBillPairs(purchases: readonly PurchaseRecord[]): DuplicatePair[] {
  // Bucket by supplier first so a large purchase book stays fast (pairs are only looked for inside a bucket).
  const buckets = new Map<string, PurchaseRecord[]>();
  for (const p of purchases) {
    if (!p || p.status === 'draft' || !p.date) continue;
    const key = String(p.vendor_gstin ?? '').trim().toUpperCase() || (p.vendor_id ? `id:${p.vendor_id}` : `n:${normName(p.vendor_name)}`);
    buckets.set(key, [...(buckets.get(key) ?? []), p]);
  }
  const out: DuplicatePair[] = [];
  for (const list of buckets.values()) {
    const rows = list.sort((x, y) => x.date.localeCompare(y.date) || String(x.id).localeCompare(String(y.id)));
    for (let i = 0; i < rows.length; i++) {
      const hit = findBillDuplicates(rows[i], rows.slice(i + 1));
      for (const b of hit.exact) out.push({ kind: 'exact', a: rows[i], b });
      for (const b of hit.near) out.push({ kind: 'near', a: rows[i], b });
    }
  }
  return out.sort((x, y) => x.a.date.localeCompare(y.a.date));
}
