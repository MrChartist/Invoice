/**
 * R4-C4 recycle bin ("Recently deleted"): whole deleted rows of every edit-logged table (captured by the audit edit
 * observer, `binRows` in `audit-edits.ts`) and of invoices (`localDb.invoices.remove`), kept for 30 days (setting
 * 7–90) under a 5 MB cap; restored in one tap through the table's own save path, so the period lock, roles and
 * numbering run again.
 *
 *  - A deleted number stays used: the capture records the series high-water mark, so the bin never has to compete
 *    with a new document for its number; a restore is still refused if a live row holds the same id or number.
 *  - A child whose parent is gone (a receipt whose invoice was deleted) is restored together with the parent.
 *  - Restores, permanent deletes and purges are audited. Entries in a locked period need the PIN to be deleted.
 *  - Table `recycle_bin`: backed up, never synced (a delete already syncs as a tombstone and a restore as a new
 *    version), excluded from every report, GST and export path. Payroll rows are listed only with `payroll.view`.
 */
import type { BinEntry } from '../../types/trade-r4';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import { BIN_TABLE, WATCHED_TABLES, refOf } from '../audit-edits';
import { audit } from '../audit';
import { asSystem, can, currentActor, requireAccess, requireTableWrite } from '../access';
import { assertUnlocked, getLockUntil, isDateLocked } from '../period-lock';
import { DB_PREFIX, getJson, getTable, peekTable, setJson, setTable } from '../storage';
import { releaseAttachments } from '../attachments';
import { parseSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { round2 } from '../invoice-calc';
import { localDb } from '../localDb';
import { purchasesDb } from '../purchases';
import { BIN_RETENTION } from '../trade/trade-rules';
import { PAYROLL_TABLES } from './payroll-tables';

export { BIN_TABLE };
export const BIN_SETTINGS_KEY = `${DB_PREFIX}bin_settings`;

type Row = Record<string, unknown>;
const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

/* ── Display ─────────────────────────────────────────────────── */

const DAY_FIELDS = ['issue_date', 'date', 'bill_date', 'voucher_date'];
const NUMBER_FIELDS = ['invoice_number', 'number', 'voucher_number', 'bill_number', 'receipt_number', 'irm_no'];

export function tableLabel(table: string): string {
  if (table === 'invoices') return 'Document';
  return WATCHED_TABLES[table]?.label ?? table.replace(/_/g, ' ');
}

/** Label, number and document day of an entry (stored values win; derived from the row otherwise). */
export function describeEntry(e: BinEntry): { label: string; number: string; day: string; name: string } {
  const r = isObj(e.row) ? e.row : {};
  const number = e.number ?? NUMBER_FIELDS.map((k) => str(r[k])).find(Boolean) ?? '';
  const day = e.period_day ?? DAY_FIELDS.map((k) => str(r[k]).slice(0, 10)).find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ?? '';
  const client = isObj(r.client) ? str(r.client.name) : '';
  const name = client || str(r.vendor_name) || str(r.name) || str(r.party_name) || refOf(r);
  const docLabel = e.table === 'invoices' && str(r.doc_type) ? str(r.doc_type).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : '';
  return { label: e.label ?? (docLabel || tableLabel(e.table)), number, day, name };
}

/* ── Who sees what ───────────────────────────────────────────── */

const PAYROLL_ENTITIES = new Set(['payroll', 'employee']);
export const isPayrollTable = (table: string) => PAYROLL_TABLES.has(table) || PAYROLL_ENTITIES.has(WATCHED_TABLES[table]?.entity ?? '');

/** Owner: every entry; others: their own deletes. Payroll rows only with `payroll.view`. */
export function visibleEntries(entries: readonly BinEntry[], viewer: { all: boolean; name?: string; payroll: boolean }): BinEntry[] {
  return entries.filter((e) => e && (viewer.payroll || !isPayrollTable(e.table)) && (viewer.all || (!!viewer.name && e.deleted_by === viewer.name) || (!viewer.name && !e.deleted_by)));
}

export function currentViewer() {
  const actor = currentActor();
  return { all: can('data.erase'), name: actor?.name, payroll: can('payroll.view') };
}

/* ── Retention ───────────────────────────────────────────────── */

export function binRetentionDays(): number {
  const d = Math.round(Number(getJson<{ days?: number }>(BIN_SETTINGS_KEY, {}).days));
  return Number.isFinite(d) && d >= BIN_RETENTION.min && d <= BIN_RETENTION.max ? d : BIN_RETENTION.days;
}
export function setBinRetentionDays(days: number): void {
  requireAccess('settings.manage');
  const d = Math.round(days);
  if (!(d >= BIN_RETENTION.min && d <= BIN_RETENTION.max)) throw new Error('binDaysRange');
  setJson(BIN_SETTINGS_KEY, { days: d });
}

/** Entries to keep / purge: older than `days`, then the oldest until the bin fits `maxBytes`. Pure. */
export function planPurge(entries: readonly BinEntry[], now: Date, days: number, maxBytes: number = BIN_RETENTION.maxBytes): { keep: BinEntry[]; purged: BinEntry[] } {
  const cutoff = now.getTime() - days * 86400000;
  const sorted = [...entries].sort((a, b) => a.deleted_at.localeCompare(b.deleted_at));
  const purged: BinEntry[] = [];
  let keep = sorted.filter((e) => {
    const t = Date.parse(e.deleted_at);
    if (Number.isFinite(t) && t < cutoff) {
      purged.push(e);
      return false;
    }
    return true;
  });
  let size = keep.reduce((s, e) => s + JSON.stringify(e).length, 2);
  while (size > maxBytes && keep.length) {
    const drop = keep[0];
    keep = keep.slice(1);
    size -= JSON.stringify(drop).length + 1;
    purged.push(drop);
  }
  return { keep, purged };
}

const attIds = (list: readonly BinEntry[]) => list.flatMap((e) => (Array.isArray(e.attachments) ? (e.attachments as { id?: string }[]).map((a) => str(a?.id)).filter(Boolean) : []));

/** Start-up purge (lazily after first paint): expired / over-cap entries go, with one audit row. */
export function purgeBin(now: Date = new Date()): number {
  const entries = peekTable<BinEntry>(BIN_TABLE);
  if (!entries.length) return 0;
  const { keep, purged } = planPurge(entries, now, binRetentionDays());
  if (!purged.length) return 0;
  asSystem(() => setTable(BIN_TABLE, keep));
  releaseAttachments(attIds(purged));
  audit.record({
    entity: 'system', entity_id: BIN_TABLE, action: 'delete', by: 'system',
    summary: `Recycle bin: ${purged.length} entr${purged.length === 1 ? 'y' : 'ies'} older than ${binRetentionDays()} days (or over the 5 MB cap) removed for good`,
    changes: [{ field: 'Removed', from: null, to: purged.slice(0, 10).map((e) => `${tableLabel(e.table)} ${describeEntry(e).number || e.row_id}`).join(', ') }],
  });
  return purged.length;
}

/* ── Restore planning (pure) ─────────────────────────────────── */

/** Child tables whose rows hang off a parent row (restored together when the parent is gone). */
export const PARENTS: Readonly<Record<string, { table: string; field: string }>> = {
  transactions: { table: 'invoices', field: 'invoice_id' },
  purchase_payments: { table: 'purchases', field: 'purchase_id' },
};

export type RestoreRefusal = 'exists' | 'numberReused' | 'parentMissing' | 'locked';
export interface RestorePlan {
  ok: boolean;
  refusal?: RestoreRefusal;
  /** The live row holding the number (numberReused). */
  number?: string;
  /** Parent bin entry to restore first (parentMissing with a parent in the bin). */
  parentEntry?: BinEntry;
  /** Child entries deleted together with this one (offered as "restore with its N payments"). */
  children: BinEntry[];
  day: string;
}

/** Live rows of a table (read-only), for the planner. */
export type LiveReader = (table: string) => readonly Row[];

const numberOf = (table: string, r: Row): string => {
  const v = table === 'invoices' ? str(r.invoice_number) : str(r.number);
  return table === 'invoices' || parseSeries(v) ? v : '';
};

export function planRestore(e: BinEntry, live: LiveReader, bin: readonly BinEntry[], lockUntil: string = getLockUntil()): RestorePlan {
  const r = isObj(e.row) ? e.row : {};
  const day = describeEntry(e).day;
  const rows = live(e.table);
  const children = Object.entries(PARENTS)
    .filter(([, p]) => p.table === e.table)
    .flatMap(([child, p]) => bin.filter((b) => b.table === child && isObj(b.row) && str(b.row[p.field]) === e.row_id));
  const base = { children, day };
  if (rows.some((x) => str(x?.id) === e.row_id)) return { ok: false, refusal: 'exists', ...base };
  const num = numberOf(e.table, r);
  if (num) {
    const k = num.trim().toUpperCase();
    if (rows.some((x) => numberOf(e.table, x).trim().toUpperCase() === k)) return { ok: false, refusal: 'numberReused', number: num, ...base };
  }
  const parent = PARENTS[e.table];
  if (parent) {
    const pid = str(r[parent.field]);
    if (pid && !live(parent.table).some((x) => str(x?.id) === pid)) {
      const parentEntry = [...bin].reverse().find((b) => b.table === parent.table && b.row_id === pid);
      return { ok: false, refusal: 'parentMissing', ...(parentEntry ? { parentEntry } : {}), ...base };
    }
  }
  if (day && isDateLocked(day, lockUntil)) return { ok: false, refusal: 'locked', ...base };
  return { ok: true, ...base };
}

/* ── Restore (guards run in the table's own save path) ────────── */

export class RestoreError extends Error {
  refusal: RestoreRefusal | 'missing';
  plan?: RestorePlan;
  constructor(refusal: RestoreRefusal | 'missing', message: string, plan?: RestorePlan) {
    super(message);
    this.refusal = refusal;
    this.plan = plan;
  }
}

const liveReader: LiveReader = (t) => peekTable<Row>(t);

function putBack(e: BinEntry): void {
  const row = { ...(e.row as Row) };
  if (e.table === 'invoices') {
    // localDb's save runs roles, rights, the period lock, the number check and the audit row.
    saveInvoice(row as unknown as InvoiceRecord);
    return;
  }
  if (e.table === 'purchases') {
    savePurchase(row as unknown as PurchaseRecord);
    return;
  }
  requireTableWrite(e.table);
  const day = describeEntry(e).day;
  if (day) assertUnlocked({ id: e.row_id, issue_date: day, invoice_number: describeEntry(e).number || undefined }, 'create');
  if (e.table === 'transactions') {
    // Same rights as recording it; a bad-debt write-off row also needs doc.deleteIssued (as removing one does, QA5-1).
    requireAccess('payment.record');
    if (row.write_off) requireAccess('doc.deleteIssued');
    const inv = getTable<InvoiceRecord>('invoices').find((i) => i.id === str(row.invoice_id));
    if (inv) assertUnlocked(inv, 'pay');
    setTable('transactions', [...getTable<Payment>('transactions'), row as unknown as Payment]);
    // The invoice re-derives what it has received (the ledger rows are the floor).
    if (inv) saveInvoice(inv);
    return;
  }
  setTable(e.table, [...getTable<Row>(e.table), row]);
  if (e.table === 'purchase_payments') {
    const bill = getTable<PurchaseRecord>('purchases').find((b) => b.id === str(row.purchase_id));
    if (bill) {
      const paid = round2(getTable<Row>('purchase_payments').filter((p) => p.purchase_id === bill.id).reduce((s, p) => s + Number(p.amount || 0) + Math.max(Number(p.tds_amount || 0), 0), 0));
      if (paid > Number(bill.amount_paid || 0) + 0.004) savePurchase({ ...bill, amount_paid: paid });
    }
  }
}

const saveInvoice = (inv: InvoiceRecord) => void localDb.invoices.save(inv);
const savePurchase = (bill: PurchaseRecord) => void purchasesDb.save(bill);

const REFUSAL_TEXT: Record<RestoreRefusal, (e: BinEntry, p: RestorePlan) => string> = {
  exists: (e) => `${tableLabel(e.table)} ${describeEntry(e).number || ''} is already back in the books.`.replace(/\s+/g, ' '),
  numberReused: (_e, p) => `${p.number} has been reused by another record, so this one cannot come back with it.`,
  parentMissing: (e, p) => (p.parentEntry ? `Restore ${describeEntry(p.parentEntry).number || tableLabel(p.parentEntry.table)} first — or restore both together.` : `The record ${tableLabel(e.table).toLowerCase()} belongs to is gone and not in the bin.`),
  locked: (_e, p) => `The books are locked up to ${getLockUntil()}; this record is dated ${p.day}. Unlock with the PIN to restore it.`,
};

/**
 * Restore bin entry `id` (with `withParent`, its deleted parent first; with `withChildren`, the rows deleted with
 * it). All or nothing; each restored entry leaves the bin and gets a `restore` audit row naming the bin id.
 * A locked period needs an active PIN override (`grantOverride`) — the save path's own lock check honours it.
 */
export function restoreEntry(id: string, opts: { withParent?: boolean; withChildren?: boolean } = {}): BinEntry[] {
  const bin = peekTable<BinEntry>(BIN_TABLE);
  const e = bin.find((b) => b.id === id);
  if (!e) throw new RestoreError('missing', 'That entry is no longer in the bin.');
  const plan = planRestore(e, liveReader, bin);
  const order: BinEntry[] = [];
  if (!plan.ok && plan.refusal !== 'locked') {
    if (plan.refusal === 'parentMissing' && opts.withParent && plan.parentEntry) order.push(plan.parentEntry);
    else throw new RestoreError(plan.refusal!, REFUSAL_TEXT[plan.refusal!](e, plan), plan);
  }
  order.push(e);
  if (opts.withChildren) order.push(...plan.children);
  const tables = [...new Set([BIN_TABLE, ...order.map((x) => x.table), 'invoices', 'transactions', 'purchases', 'purchase_payments', 'series_counters'])];
  withTablesRollback(tables, () => {
    for (const x of order) putBack(x);
    const done = new Set(order.map((x) => x.id));
    setTable(BIN_TABLE, getTable<BinEntry>(BIN_TABLE).filter((b) => !done.has(b.id)));
  });
  for (const x of order) {
    const d = describeEntry(x);
    audit.record({
      entity: (WATCHED_TABLES[x.table]?.entity ?? 'invoice'),
      entity_id: x.row_id,
      action: 'restore',
      ...(d.number ? { doc_number: d.number } : {}),
      summary: `Restored ${d.label.toLowerCase()} ${d.number || d.name || ''} from the recycle bin (bin ${x.id})`.replace(/\s+/g, ' ').trim(),
    });
  }
  return order;
}

/** Entries in a locked period (deleting those for good needs the PIN). */
export const lockedEntries = (entries: readonly BinEntry[], lockUntil: string = getLockUntil()) => entries.filter((e) => {
  const d = describeEntry(e).day;
  return !!d && isDateLocked(d, lockUntil);
});

/** Delete entries for good (owner). `pinOk` must be true when any of them is in a locked period. Audited. */
export function deleteForGood(ids: readonly string[], opts: { pinOk?: boolean } = {}): number {
  requireAccess('data.erase');
  const want = new Set(ids);
  const all = peekTable<BinEntry>(BIN_TABLE);
  const gone = all.filter((e) => want.has(e.id));
  if (!gone.length) return 0;
  if (lockedEntries(gone).length && !opts.pinOk) throw new Error('binNeedsPin');
  setTable(BIN_TABLE, all.filter((e) => !want.has(e.id)));
  releaseAttachments(attIds(gone));
  audit.record({
    entity: 'system', entity_id: BIN_TABLE, action: 'delete',
    summary: `Deleted for good from the recycle bin: ${gone.length} entr${gone.length === 1 ? 'y' : 'ies'}`,
    changes: [{ field: 'Entries', from: null, to: gone.slice(0, 10).map((e) => `${tableLabel(e.table)} ${describeEntry(e).number || e.row_id} (bin ${e.id})`).join(', ') }],
  });
  return gone.length;
}
