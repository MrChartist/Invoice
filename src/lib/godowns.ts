/**
 * Multi-godown stock (roadmap 6.10): the `godowns` master and stock transfer vouchers
 * (`stock_transfers`, numbered `STR/FY<yy-yy>/<seq>` per Indian financial year).
 *
 * Opt-in by data: the implicit "Main" godown always exists and is not stored; godown pickers
 * appear only once a second godown is created. Stock per godown is derived on read
 * (`src/lib/stock-tracking.ts`). Costing stays company-wide: a transfer moves quantity only,
 * never value, and nothing here posts to Books or the double-entry ledger.
 *
 * Transfers respect the period lock (create / edit / delete inside a locked period needs a PIN
 * override) and every change is written to the audit log.
 */

import { MAIN_GODOWN_ID, type Godown, type StockTransfer } from '../types/stock';
import { buildInvoiceNumber, getIndianFY, highestSequence } from './invoice-number';
import { num } from './invoice-calc';
import { DB_PREFIX, generateId, getTable, readRaw, setTable } from './storage';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';
import { assertRemovable, liveRemovalIssues } from './stock-timeline';
import { isVoidStatus } from './purchase-normalize';
import { descendantIds, treeRows, type TreeRow } from './stock-groups';

export const GODOWNS_TABLE = 'godowns';
export const TRANSFERS_TABLE = 'stock_transfers';
export const TRANSFER_PREFIX = 'STR';
export { MAIN_GODOWN_ID };

/* ── Pure ─────────────────────────────────────────────────────── */

/** Every godown, Main first. A stored row with id `main` only renames the default godown. */
export function godownList(stored: readonly Godown[]): Godown[] {
  const main = stored.find((g) => g.id === MAIN_GODOWN_ID);
  const rest = stored.filter((g) => g.id !== MAIN_GODOWN_ID && g.name?.trim());
  return [{ id: MAIN_GODOWN_ID, name: main?.name?.trim() || 'Main', ...(main?.parent_id ? { parent_id: main.parent_id } : {}) }, ...rest];
}

/* ── Godown hierarchy (WP-8): a godown may sit inside another (parent_id); stock stays per godown ── */

/** Godowns depth-first under their parents (Main and the other top-level godowns first, by name). */
export function godownTree(list: readonly Godown[]): TreeRow[] {
  return treeRows(list.map((g) => ({ id: g.id, name: g.name, ...(g.parent_id ? { parent_id: g.parent_id } : {}) })));
}

/** Why `parentId` cannot be the parent of godown `id`, or ''. */
export function godownParentIssue(id: string | undefined, parentId: string | undefined, list: readonly Godown[]): string {
  if (!parentId) return '';
  if (!list.some((g) => g.id === parentId)) return 'The parent godown no longer exists.';
  if (id && descendantIds(id, list).has(parentId)) return 'A godown cannot be placed inside itself or one of its sub-godowns.';
  return '';
}

/** Quantity per godown including every sub-godown below it (a warehouse shows its store rooms' stock too). */
export function rollUpGodowns(byGodown: Readonly<Record<string, number>>, list: readonly Godown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of list) {
    let sum = 0;
    for (const id of descendantIds(g.id, list)) sum += num(byGodown[id]);
    out[g.id] = Math.round((sum + Number.EPSILON) * 1000) / 1000 || 0;
  }
  return out;
}

/** Godown pickers and reports appear only once a second godown exists. */
export function isMultiGodown(stored: readonly Godown[]): boolean {
  return godownList(stored).length > 1;
}

/** 8F: godowns stock may not be sold from (kind 'expiry': expired / breakage stock). */
const NON_SALEABLE: ReadonlySet<string> = new Set(['expiry', 'wip', 'qc', 'transit', 'site', 'consignment']); // R4-A: shop floor, QC hold, in transit; R5-B6: works site; R8-C: consignment
export const nonSaleableGodowns = (list: readonly Godown[]): Set<string> => new Set(list.filter((g) => !!g.kind && NON_SALEABLE.has(g.kind)).map((g) => g.id));
/** R8-C (TR-C1): consignment godowns (principals' goods) — the one non-saleable kind an agency line may sell from. */
export const consignmentGodowns = (list: readonly Godown[]): Set<string> => new Set(list.filter((g) => g.kind === 'consignment').map((g) => g.id));
/**
 * R9 (RT-A decision for the append-only `Godown.kind` union): 'used' (second-hand goods taken in exchange / bought from
 * customers) is SALEABLE — it is deliberately not in `NON_SALEABLE` — but a sale line drawn from it is offered the
 * margin scheme (Rule 32(5), RT12) by the RT-D3 / RT-E3 screens through this set.
 */
export const usedGoodsGodowns = (list: readonly Godown[]): Set<string> => new Set(list.filter((g) => g.kind === 'used').map((g) => g.id));

export function godownName(list: readonly Godown[], id: string | undefined): string {
  const key = id || MAIN_GODOWN_ID;
  return list.find((g) => g.id === key)?.name ?? (key === MAIN_GODOWN_ID ? 'Main' : 'Unknown godown');
}

/** Next `STR/FY<yy-yy>/<seq>` for a transfer dated `date` (highest issued + 1: deletes never reuse a number). */
export function nextTransferNumber(existing: readonly string[], date?: string): string {
  const fy = getIndianFY(date).label;
  return buildInvoiceNumber(TRANSFER_PREFIX, fy, highestSequence([...existing], TRANSFER_PREFIX, fy) + 1);
}

/** Shape checks that need no stock data; returns an error message or ''. Stock checks live in stock-tracking. */
export function validateTransferShape(t: Pick<StockTransfer, 'date' | 'from_godown' | 'to_godown' | 'lines'>): string {
  if (!t.date) return 'Choose the transfer date.';
  if (!t.from_godown || !t.to_godown) return 'Choose both godowns.';
  if (t.from_godown === t.to_godown) return 'The two godowns must be different.';
  const lines = (t.lines ?? []).filter((l) => l.item_id);
  if (lines.length === 0) return 'Add at least one item to transfer.';
  if (lines.some((l) => num(l.qty) <= 0)) return 'Every line needs a quantity above zero.';
  return '';
}

/* ── Storage ──────────────────────────────────────────────────── */

const now = () => new Date().toISOString();

/**
 * Review M2: the live Sec 25(4) tax invoice / purchase bill raised for a transfer (`branch_transfer_id`),
 * if any. A cancelled invoice no longer counts; a bill counts while it exists and is not void.
 */
type PairInvoice = { branch_transfer_id?: string; status?: string; invoice_number?: string };
type PairBill = { branch_transfer_id?: string; status?: unknown; bill_number?: string };

export function transferPairOf(
  transferId: string,
  data: { invoices?: readonly PairInvoice[]; purchases?: readonly PairBill[] } = {},
): { invoice?: string; bill?: string } | null {
  if (!transferId) return null;
  const inv = (data.invoices ?? getTable<PairInvoice>('invoices')).find((i) => i?.branch_transfer_id === transferId && i.status !== 'Cancelled');
  const bill = (data.purchases ?? getTable<PairBill>('purchases')).find(
    (b) => b?.branch_transfer_id === transferId && !isVoidStatus(b.status),
  );
  if (!inv && !bill) return null;
  return { ...(inv ? { invoice: inv.invoice_number || 'invoice' } : {}), ...(bill ? { bill: bill.bill_number || 'bill' } : {}) };
}

function assertNoTransferPair(t: Pick<StockTransfer, 'id' | 'transfer_number'>, what: 'edit' | 'delete'): void {
  const pair = transferPairOf(t.id);
  if (!pair) return;
  const docs = [pair.invoice && `tax invoice ${pair.invoice}`, pair.bill && `purchase bill ${pair.bill}`].filter(Boolean).join(' and ');
  throw new Error(`Stock transfer ${t.transfer_number} has a branch-transfer ${docs} (Sec 25(4)). Cancel the invoice and delete the bill before you ${what} the transfer.`);
}

const lockSubject = (t: Pick<StockTransfer, 'id' | 'date' | 'transfer_number'>) => ({
  id: t.id,
  issue_date: t.date,
  invoice_number: t.transfer_number,
});

function logGodown(id: string, action: 'create' | 'update' | 'delete', summary: string): void {
  try {
    audit.record({ entity: 'godown', entity_id: id, action, summary });
  } catch {
    /* logging never breaks a save */
  }
}

/**
 * Everything that names a godown (any status, any document type, untracked items too): stock moves,
 * bill / invoice / recurring-template lines, transfers and the default-godown setting. Pure over raw rows.
 */
export function godownReferences(
  id: string,
  t: {
    moves?: readonly { godown_id?: string }[];
    invoices?: readonly { items?: readonly { godown_id?: string }[] }[];
    purchases?: readonly { lines?: readonly { godown_id?: string }[] }[];
    transfers?: readonly Pick<StockTransfer, 'from_godown' | 'to_godown'>[];
    recurring?: readonly { template?: { items?: readonly { godown_id?: string }[] } }[];
    defaultGodown?: string;
    /** Phase 7: BOMs, manufacturing journals, stock journals, physical stock counts. */
    boms?: readonly { components?: readonly { godown_id?: string }[]; outputs?: readonly { godown_id?: string }[] }[];
    stockVouchers?: readonly {
      godown_id?: string;
      components?: readonly { godown_id?: string }[]; outputs?: readonly { godown_id?: string }[];
      consume?: readonly { godown_id?: string }[]; produce?: readonly { godown_id?: string }[]; lines?: readonly { godown_id?: string }[];
    }[];
  },
): string[] {
  const out: string[] = [];
  const lines = (rows: readonly { godown_id?: string }[] | undefined) => (rows ?? []).some((l) => l?.godown_id === id);
  if ((t.moves ?? []).some((m) => m?.godown_id === id)) out.push('stock adjustments');
  if ((t.purchases ?? []).some((p) => lines(p?.lines))) out.push('purchase bills');
  if ((t.invoices ?? []).some((d) => lines(d?.items))) out.push('documents (including drafts, quotations and cancelled ones)');
  if ((t.transfers ?? []).some((x) => x?.from_godown === id || x?.to_godown === id)) out.push('stock transfers');
  if ((t.recurring ?? []).some((r) => lines(r?.template?.items))) out.push('recurring templates');
  if ((t.boms ?? []).some((b) => lines(b?.components) || lines(b?.outputs))) out.push('bills of materials');
  if ((t.stockVouchers ?? []).some((v) => v?.godown_id === id || lines(v?.components) || lines(v?.outputs) || lines(v?.consume) || lines(v?.produce) || lines(v?.lines))) {
    out.push('manufacturing / stock journals or physical stock counts');
  }
  if (t.defaultGodown === id) out.push('the default-godown setting');
  return out;
}

/** 7M: a Material Out / In names this godown (as the job worker's premises or on a line). */
function jobWorkGodownInUse(id: string): boolean {
  const named = (rows: readonly { job_worker_godown?: string; lines?: readonly { godown_id?: string }[]; received?: readonly { godown_id?: string }[] }[]) =>
    rows.some((r) => r?.job_worker_godown === id || (r?.lines ?? []).some((l) => l?.godown_id === id) || (r?.received ?? []).some((l) => l?.godown_id === id));
  return named(getTable('job_work_out')) || named(getTable('job_work_in'));
}

/** `godownReferences` over the stored data. */
export function liveGodownReferences(id: string): string[] {
  let defaultGodown: string | undefined;
  try {
    defaultGodown = (JSON.parse(readRaw(`${DB_PREFIX}inventory_settings`) || '{}') as { defaultGodown?: string }).defaultGodown;
  } catch {
    defaultGodown = undefined;
  }
  return godownReferences(id, {
    moves: getTable('stock_moves'),
    invoices: getTable('invoices'),
    purchases: getTable('purchases'),
    transfers: getTable<StockTransfer>(TRANSFERS_TABLE),
    recurring: getTable('recurring'),
    defaultGodown,
    boms: getTable('boms'),
    stockVouchers: [...getTable<{ godown_id?: string }>('manufacturing_vouchers'), ...getTable<{ godown_id?: string }>('stock_journals'), ...getTable<{ godown_id?: string }>('physical_stock')],
  });
}

export const godownsDb = {
  stored: (): Godown[] => getTable<Godown>(GODOWNS_TABLE),
  list: (): Godown[] => godownList(godownsDb.stored()),
  isMulti: (): boolean => isMultiGodown(godownsDb.stored()),

  /** Add or rename a godown. Names are unique (case-insensitive). */
  save(input: { id?: string; name: string; address?: string; parent_id?: string; job_worker?: boolean; vendor_id?: string; kind?: Godown['kind'] | '' }): Godown {
    const name = input.name.trim();
    if (!name) throw new Error('Enter a godown name.');
    const rows = godownsDb.stored();
    const list = godownList(rows);
    if (list.some((g) => g.id !== input.id && g.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new Error(`A godown named "${name}" already exists.`);
    }
    const existing = input.id ? rows.find((g) => g.id === input.id) : undefined;
    const parentIssue = godownParentIssue(input.id, input.parent_id, list);
    if (parentIssue) throw new Error(parentIssue);
    const { parent_id: _oldParent, job_worker: oldJw, vendor_id: oldVendor, kind: oldKind, ...base } = existing ?? ({} as Partial<Godown>);
    void _oldParent;
    // 7M: a job worker's premises (absent in the input = unchanged on an edit).
    const jw = input.job_worker ?? oldJw;
    const vendor = jw ? (input.vendor_id ?? oldVendor) : undefined;
    const row: Godown = {
      ...base,
      id: input.id || generateId(),
      name,
      ...(input.address?.trim() ? { address: input.address.trim() } : {}),
      ...(input.parent_id ? { parent_id: input.parent_id } : {}),
      ...(jw ? { job_worker: true } : {}),
      ...(vendor ? { vendor_id: vendor } : {}),
      // 8F: van / expiry godown (absent in the input = unchanged; '' = ordinary).
      ...((input.kind ?? oldKind) ? { kind: (input.kind ?? oldKind) as Godown['kind'] } : {}),
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    setTable(GODOWNS_TABLE, existing ? rows.map((g) => (g.id === row.id ? row : g)) : [...rows, row]);
    logGodown(row.id, existing ? 'update' : 'create', existing ? `Godown "${existing.name}" ${existing.name !== name ? `renamed to "${name}"` : 'edited'}` : `Godown "${name}" added`);
    return row;
  },

  /** Delete a godown. Refused for Main and while any record still points at it (`inUse`). */
  remove(id: string, inUse: boolean): void {
    if (id === MAIN_GODOWN_ID) throw new Error('The main godown cannot be deleted.');
    if (jobWorkGodownInUse(id)) throw new Error('Job work challans (Material Out / In) use this godown, so it cannot be deleted.');
    if (inUse) throw new Error('Stock, bills, invoices or transfers still use this godown, so it cannot be deleted.');
    if (godownsDb.list().some((g) => g.parent_id === id)) throw new Error('Move or delete the godowns inside it first.');
    const row = godownsDb.stored().find((g) => g.id === id);
    setTable(GODOWNS_TABLE, godownsDb.stored().filter((g) => g.id !== id));
    logGodown(id, 'delete', `Godown "${row?.name ?? id}" deleted`);
  },
};

export const transfersDb = {
  all: (): StockTransfer[] => getTable<StockTransfer>(TRANSFERS_TABLE),
  get: (id: string): StockTransfer | undefined => transfersDb.all().find((t) => t.id === id),
  /** Above every existing number and the series high-water mark (a deleted latest number is not reused). */
  nextNumber: (date?: string): string => nextSeriesNumberFor(TRANSFER_PREFIX, date, transfersDb.all().map((t) => t.transfer_number)),

  /**
   * Insert or update (by id). A new transfer without a number gets the next one in its FY.
   * Throws `PeriodLockedError` inside a locked period; audited.
   */
  save(input: Omit<StockTransfer, 'id' | 'transfer_number'> & { id?: string; transfer_number?: string }): StockTransfer {
    const shape = validateTransferShape(input);
    if (shape) throw new Error(shape);
    const rows = transfersDb.all();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (existing) assertNoTransferPair(existing, 'edit');
    if (existing) assertUnlocked(lockSubject(existing), 'edit');
    const asked = (input.transfer_number ?? '').trim();
    // An edit that moves the date into another FY takes a number from that FY's series (as advances do).
    const keep = existing && numberFitsFy(existing.transfer_number, input.date) ? existing.transfer_number : '';
    const number = (asked && asked !== existing?.transfer_number ? asked : '') || keep || transfersDb.nextNumber(input.date);
    const id = existing?.id ?? input.id ?? generateId();
    const state = assertUnlocked(lockSubject({ id, date: input.date, transfer_number: number }), existing ? 'edit' : 'create');
    if (rows.some((r) => r.id !== id && r.transfer_number.toUpperCase() === number.toUpperCase())) {
      throw new Error(`Transfer number ${number} is already used.`);
    }
    const record: StockTransfer = {
      ...existing,
      ...input,
      id,
      transfer_number: number,
      lines: input.lines.filter((l) => l.item_id && num(l.qty) > 0),
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    setTable(TRANSFERS_TABLE, existing ? rows.map((r) => (r.id === id ? record : r)) : [...rows, record]);
    recordSeries(number);
    const units = record.lines.reduce((s, l) => s + num(l.qty), 0);
    audit.record({
      entity: 'stock_transfer',
      entity_id: id,
      action: existing ? 'update' : 'create',
      doc_number: number,
      summary: `${existing ? 'Edited' : 'Created'} stock transfer ${number}: ${record.lines.length} line${record.lines.length === 1 ? '' : 's'}, ${units} unit${units === 1 ? '' : 's'}${state === 'overridden' ? ' (period lock overridden)' : ''}`,
    });
    return record;
  },

  /**
   * Delete a transfer (period lock respected; audited). Refused when a later document took serials it
   * moved; when later documents used the moved quantity, `confirmStock` must be set (StockDependencyError).
   */
  remove(id: string, opts: { confirmStock?: boolean } = {}): void {
    const t = transfersDb.get(id);
    if (!t) return;
    assertNoTransferPair(t, 'delete');
    assertUnlocked(lockSubject(t), 'delete');
    assertRemovable(liveRemovalIssues({ refType: 'transfer', refId: id }), opts.confirmStock);
    setTable(TRANSFERS_TABLE, transfersDb.all().filter((r) => r.id !== id));
    audit.record({
      entity: 'stock_transfer',
      entity_id: id,
      action: 'delete',
      doc_number: t.transfer_number,
      summary: `Deleted stock transfer ${t.transfer_number}`,
    });
  },
};
