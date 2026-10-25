/**
 * Configurable dashboard tiles (WP-9, gap P1-17 / TallyPrime "Add Tile").
 *
 * Loaded lazily by `components/dashboard/DashboardTiles.tsx` after first paint, so the dashboard's
 * initial JS and first render are unchanged. Each tile is a pure function over a `TileData`
 * snapshot, optionally narrowed to one branch (`branch.ts`). Which tiles a user sees is kept per
 * signed-in user under `mrchartist_inv_dashboard_tiles` ({ [userId | 'default']: TileId[] }).
 */
import type { InvoiceRecord, Payment } from '../types/invoice';
import type { PurchaseRecord } from '../types/purchases';
import { DB_PREFIX, getJson, setJson } from './storage';
import { num, round2 } from './invoice-calc';
import { summarize, type CreditLink } from './stats';
import { accountBalanceAt, buildVouchers, gstSummary, type BooksData } from './books';
import { branchOfInvoice, branchOfPurchase, branchSummary, matchesBranch, type Branch, type BranchRow } from './branch';
import { getIndianFY } from './invoice-number';
import { localDayOf } from './dates';

export const TILE_PREFS_KEY = `${DB_PREFIX}dashboard_tiles`;

export type TileId = 'receivables' | 'payables' | 'cashBank' | 'topItems' | 'lowStock' | 'gstDue' | 'branches' | 'approvals' | 'amcDue' | 'loyalty';

export const ALL_TILES: readonly TileId[] = ['receivables', 'payables', 'cashBank', 'gstDue', 'topItems', 'lowStock', 'branches', 'approvals', 'amcDue', 'loyalty'];
export const DEFAULT_TILES: readonly TileId[] = ['receivables', 'payables', 'cashBank', 'gstDue', 'topItems', 'lowStock'];

export function loadTilePrefs(userId = 'default'): TileId[] {
  const all = getJson<Record<string, unknown> | null>(TILE_PREFS_KEY, null);
  const mine = all && Array.isArray(all[userId]) ? (all[userId] as unknown[]) : all && Array.isArray(all.default) ? (all.default as unknown[]) : null;
  if (!mine) return [...DEFAULT_TILES];
  return mine.filter((t): t is TileId => ALL_TILES.includes(t as TileId));
}

export function saveTilePrefs(tiles: readonly TileId[], userId = 'default'): void {
  const all = getJson<Record<string, unknown> | null>(TILE_PREFS_KEY, null) ?? {};
  setJson(TILE_PREFS_KEY, { ...all, [userId]: ALL_TILES.filter((t) => tiles.includes(t)) });
}

export interface TileData {
  books: BooksData;
  links: CreditLink[];
  branches: Branch[];
  /** Stock positions (inventory), loaded only when a stock tile is shown. */
  stock?: { name: string; qty: number; unit: string; reorder: number; isLow: boolean }[];
}

/** Narrow the snapshot to one branch: documents, their payments, purchases and their payments. */
export function forBranch(data: TileData, branch: string | undefined): TileData {
  if (!branch) return data;
  const invoices = data.books.invoices.filter((i) => matchesBranch(branchOfInvoice(i, data.branches), branch));
  const ids = new Set(invoices.map((i) => i.id));
  const purchases = (data.books.purchases as unknown as PurchaseRecord[]).filter((p) => matchesBranch(branchOfPurchase(p, data.branches), branch));
  const pids = new Set(purchases.map((p) => p.id));
  return {
    ...data,
    books: {
      ...data.books,
      invoices,
      transactions: data.books.transactions.filter((t: Payment) => ids.has(t.invoice_id)),
      purchases: purchases as unknown as BooksData['purchases'],
      purchasePayments: data.books.purchasePayments.filter((p) => !p.purchase_id || pids.has(p.purchase_id)),
      advances: branch ? [] : data.books.advances,
    },
  };
}

export interface TopItem {
  name: string;
  qty: number;
  value: number;
}

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);

/** Best sellers by taxable value in the period (credit notes subtract). `qty` is in the item's base unit. */
export function topItems(invoices: readonly InvoiceRecord[], from: string, to: string, limit = 5): TopItem[] {
  const map = new Map<string, TopItem>();
  for (const inv of invoices) {
    if (inv.status === 'Draft' || inv.status === 'Cancelled' || inv.issue_date < from || inv.issue_date > to) continue;
    const sign = SALES.has(inv.doc_type) ? 1 : inv.doc_type === 'CREDIT_NOTE' ? -1 : 0;
    if (!sign) continue;
    for (const l of inv.items ?? []) {
      const name = (l.name || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const row = map.get(key) ?? { name, qty: 0, value: 0 };
      // Base units (WP-8): a line typed as 2 BOX of 12 counts 24, so it adds up with lines in NOS. Inline,
      // not units.ts, to keep the dashboard chunk small.
      row.qty += sign * num(l.quantity) * (num(l.unit_factor) > 0 ? num(l.unit_factor) : 1);
      row.value += sign * num(l.quantity) * num(l.rate) * (1 - num(l.discount_percent) / 100);
      map.set(key, row);
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, qty: round2(r.qty), value: round2(r.value) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export interface TileValues {
  receivables: { outstanding: number; overdue: number; overdueCount: number };
  payables: { due: number; bills: number };
  cashBank: { cash: number; bank: number };
  gstDue: { month: string; payable: number; cess: number };
  topItems: TopItem[];
  lowStock: { name: string; qty: number; unit: string; reorder: number }[];
  branches: BranchRow[];
}

/** Every tile's figures for `today` (local day). */
export function computeTiles(data: TileData, today: string = localDayOf(new Date())): TileValues {
  const b = data.books;
  const now = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)), 12);
  const sum = summarize(b.invoices, now, data.links, 'INR');
  const purchases = b.purchases as unknown as PurchaseRecord[];
  const open = purchases.filter((p) => num(p.total) - num(p.amount_paid) > 0.004);
  const vouchers = buildVouchers(b);
  const month = today.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const gst = gstSummary(b, { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` } as never);
  const fy = getIndianFY(today);
  const fyStart = `${fy.startYear}-04-01`;
  return {
    receivables: { outstanding: round2(sum.outstanding), overdue: round2(sum.overdueAmount), overdueCount: sum.overdueCount },
    payables: { due: round2(open.reduce((s, p) => s + num(p.total) - num(p.amount_paid), 0)), bills: open.length },
    cashBank: { cash: accountBalanceAt(vouchers, b.openings, 'cash', today), bank: accountBalanceAt(vouchers, b.openings, 'bank', today) },
    gstDue: { month, payable: round2(Math.max(gst.netPayable, 0)), cess: round2(num(gst.outputCess)) },
    topItems: topItems(b.invoices, fyStart, today),
    lowStock: (data.stock ?? []).filter((s) => s.isLow).slice(0, 5).map(({ name, qty, unit, reorder }) => ({ name, qty, unit, reorder })),
    branches: branchSummary(data.branches, b.invoices, purchases, fyStart, today),
  };
}
