/**
 * Branches / locations (WP-9, gap P1-19).
 *
 *  - Master: table `branches` (`Branch`), edited with `master.edit`.
 *  - Tagging (additive): `branch_id` on invoices (`InvoiceRecord`), purchases (`PurchaseRecord`)
 *    and manual vouchers (`ManualVoucher`). Untagged rows are **inferred**: a branch that names a
 *    sender profile (`profile_id`) or a GSTIN claims the documents issued from that profile /
 *    GSTIN (Tally's "branch = a registration"); a purchase whose place of supply is a branch's
 *    state goes to that branch only when exactly one branch is in that state.
 *  - Filtering: `branchOfInvoice` / `branchOfPurchase` / `branchOfVoucher` and the generic
 *    `filterByBranch`. Lists and the dashboard tiles use them; `branchSummary` is the branch-wise
 *    sales / purchases report.
 *
 * Integration point for the reports engine (WP-2, `src/lib/ledger/reports.ts`, not edited here):
 * reports should accept an option `{ branchId?: string }` and narrow their SOURCE rows before
 * postings with `branchPredicates(branchId)` (one predicate per table). `UNASSIGNED` selects rows
 * with no branch at all.
 */
import type { InvoiceRecord } from '../types/invoice';
import type { PurchaseRecord } from '../types/purchases';
import { requireAccess } from './access';
import { generateId, getTable, setTable } from './storage';
import { num, round2 } from './invoice-calc';

export const BRANCHES_TABLE = 'branches';
/** Filter value for "no branch". */
export const UNASSIGNED = '__none__';

export interface Branch {
  id: string;
  name: string;
  /** Short code printed in lists ("PUN"). */
  code?: string;
  /** GSTIN of the branch registration (a separate registration per state). */
  gstin?: string;
  /** Two-digit GST state code. */
  state_code?: string;
  /** Sender profile the branch issues from (multi-profile = multi-branch). */
  profile_id?: string;
  /** Godown that is this branch's stock location. */
  godown_id?: string;
  address?: string;
  /** Archived branches stay on old documents but are not offered for new ones. */
  inactive?: boolean;
  created_at?: string;
}

export function loadBranches(): Branch[] {
  return getTable<Branch>(BRANCHES_TABLE);
}

const clean = (s: unknown) => (typeof s === 'string' ? s.trim() : '');
const gstinKey = (g: unknown) => clean(g).toUpperCase();

export function validateBranch(b: Partial<Branch>, all: readonly Branch[]): string[] {
  const errors: string[] = [];
  const name = clean(b.name);
  if (!name) errors.push('Give the branch a name.');
  if (all.some((x) => x.id !== b.id && x.name.trim().toLowerCase() === name.toLowerCase())) errors.push(`A branch called "${name}" already exists.`);
  const g = gstinKey(b.gstin);
  if (g && !/^\d{2}[A-Z0-9]{13}$/.test(g)) errors.push('The GSTIN should be 15 characters, starting with the state code.');
  if (g && all.some((x) => x.id !== b.id && gstinKey(x.gstin) === g)) errors.push('Another branch already uses this GSTIN.');
  if (b.profile_id && all.some((x) => x.id !== b.id && x.profile_id === b.profile_id)) errors.push('Another branch already uses this business profile.');
  return errors;
}

export const branchesDb = {
  all: loadBranches,
  active: (): Branch[] => loadBranches().filter((b) => !b.inactive),
  get: (id: string): Branch | undefined => loadBranches().find((b) => b.id === id),
  save(input: Partial<Branch> & { name: string }): Branch {
    requireAccess('master.edit');
    const all = loadBranches();
    const errors = validateBranch(input, all);
    if (errors.length) throw new Error(errors[0]);
    const g = gstinKey(input.gstin);
    const row: Branch = {
      id: input.id || generateId(),
      name: clean(input.name),
      ...(clean(input.code) ? { code: clean(input.code).toUpperCase() } : {}),
      ...(g ? { gstin: g, state_code: g.slice(0, 2) } : clean(input.state_code) ? { state_code: clean(input.state_code) } : {}),
      ...(input.profile_id ? { profile_id: input.profile_id } : {}),
      ...(input.godown_id ? { godown_id: input.godown_id } : {}),
      ...(clean(input.address) ? { address: clean(input.address) } : {}),
      ...(input.inactive ? { inactive: true } : {}),
      created_at: all.find((b) => b.id === input.id)?.created_at ?? new Date().toISOString(),
    };
    setTable(BRANCHES_TABLE, all.some((b) => b.id === row.id) ? all.map((b) => (b.id === row.id ? row : b)) : [...all, row]);
    return row;
  },
  /** Documents keep their `branch_id`; lists show "Unknown branch" for it. */
  remove(id: string): void {
    requireAccess('master.edit');
    setTable(BRANCHES_TABLE, loadBranches().filter((b) => b.id !== id));
  },
};

/* ── Which branch a row belongs to ─────────────────────────────── */

export function branchOfInvoice(inv: Pick<InvoiceRecord, 'branch_id' | 'sender'>, branches: readonly Branch[]): string {
  if (inv.branch_id) return inv.branch_id;
  const pid = inv.sender?.id;
  if (pid) {
    const byProfile = branches.find((b) => b.profile_id === pid);
    if (byProfile) return byProfile.id;
  }
  const g = gstinKey(inv.sender?.companyGstin);
  if (g) {
    const byGstin = branches.find((b) => gstinKey(b.gstin) === g);
    if (byGstin) return byGstin.id;
  }
  return '';
}

export function branchOfPurchase(p: Pick<PurchaseRecord, 'branch_id' | 'place_of_supply'>, branches: readonly Branch[]): string {
  if (p.branch_id) return p.branch_id;
  const st = clean(p.place_of_supply);
  if (!st) return '';
  const inState = branches.filter((b) => b.state_code === st);
  return inState.length === 1 ? inState[0].id : '';
}

export function branchOfVoucher(v: { branch_id?: string }): string {
  return v.branch_id ?? '';
}

/** Does a row's branch match the filter? '' = every branch, `UNASSIGNED` = rows without one. */
export function matchesBranch(rowBranch: string, filter: string | undefined): boolean {
  if (!filter) return true;
  if (filter === UNASSIGNED) return !rowBranch;
  return rowBranch === filter;
}

export function filterByBranch<T>(rows: readonly T[], filter: string | undefined, branchOf: (row: T) => string): T[] {
  if (!filter) return [...rows];
  return rows.filter((r) => matchesBranch(branchOf(r), filter));
}

/** One predicate per source table, for the reports engine's `{ branchId }` option (see header). */
export function branchPredicates(filter: string | undefined, branches: readonly Branch[] = loadBranches()) {
  return {
    invoice: (inv: Pick<InvoiceRecord, 'branch_id' | 'sender'>) => matchesBranch(branchOfInvoice(inv, branches), filter),
    purchase: (p: Pick<PurchaseRecord, 'branch_id' | 'place_of_supply'>) => matchesBranch(branchOfPurchase(p, branches), filter),
    voucher: (v: { branch_id?: string }) => matchesBranch(branchOfVoucher(v), filter),
  };
}

/* ── Branch-wise summary ───────────────────────────────────────── */

export interface BranchRow {
  id: string;
  name: string;
  sales: number;
  returns: number;
  purchases: number;
  documents: number;
  bills: number;
}

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DEBIT_NOTE']);
const live = (i: Pick<InvoiceRecord, 'status'>) => i.status !== 'Draft' && i.status !== 'Cancelled';

/**
 * Taxable sales / credit notes / purchases per branch for a period (local days, inclusive),
 * with a row for documents that have no branch. Rupees at face value (foreign-currency documents
 * converted with their exchange rate when present).
 */
export function branchSummary(
  branches: readonly Branch[],
  invoices: readonly InvoiceRecord[],
  purchases: readonly PurchaseRecord[],
  from = '',
  to = '9999-12-31',
): BranchRow[] {
  const rows = new Map<string, BranchRow>();
  const row = (id: string): BranchRow => {
    let r = rows.get(id);
    if (!r) {
      const b = branches.find((x) => x.id === id);
      r = { id, name: id ? b?.name ?? 'Unknown branch' : 'No branch', sales: 0, returns: 0, purchases: 0, documents: 0, bills: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const b of branches) row(b.id);
  const inr = (i: InvoiceRecord) => num(i.taxable_value) * ((i.currency || 'INR').toUpperCase() !== 'INR' && num(i.exchange_rate) > 0 ? num(i.exchange_rate) : 1);
  for (const inv of invoices) {
    if (!live(inv) || inv.issue_date < from || inv.issue_date > to) continue;
    if (SALES.has(inv.doc_type)) {
      const r = row(branchOfInvoice(inv, branches));
      r.sales += inr(inv);
      r.documents++;
    } else if (inv.doc_type === 'CREDIT_NOTE') {
      row(branchOfInvoice(inv, branches)).returns += inr(inv);
    }
  }
  for (const p of purchases) {
    if (p.date < from || p.date > to) continue;
    const r = row(branchOfPurchase(p, branches));
    r.purchases += num(p.taxable);
    r.bills++;
  }
  const out = [...rows.values()].map((r) => ({ ...r, sales: round2(r.sales), returns: round2(r.returns), purchases: round2(r.purchases) }));
  // Keep the "No branch" row only when something is in it.
  return out.filter((r) => r.id || r.documents || r.bills || r.returns);
}

/** Tag rows with a branch in one write (`invoices` go through the caller's own save path). */
export function tagPurchases(ids: readonly string[], branchId: string): number {
  requireAccess('books.edit');
  const want = new Set(ids);
  let n = 0;
  const rows = getTable<PurchaseRecord>('purchases').map((p) => {
    if (!want.has(p.id)) return p;
    n++;
    const next = { ...p };
    if (branchId) next.branch_id = branchId;
    else delete next.branch_id;
    return next;
  });
  if (n) setTable('purchases', rows);
  return n;
}
