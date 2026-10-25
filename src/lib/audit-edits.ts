/**
 * Edit log for every books table (WP-7, gap P0-10 — Companies (Accounts) Rules, Rule 3(1) proviso:
 * an edit log of each change to the books, which cannot be disabled).
 *
 * `storage.setTable` reports each write through its single `onTableWrite` hook. For the tables in
 * `WATCHED_TABLES` the tracker diffs the rows by `id` (created / altered / deleted) and keeps a pending
 * before → after per row until either:
 *   - the module that made the change calls `audit.record` for that row id in the same task: the
 *     field-level changes are attached to its row (one row, the module's own wording); or
 *   - the task ends (microtask): every change nobody logged is recorded on its own
 *     ("Supplier ACME Traders edited: GSTIN … → …"). A bulk write of more than `BULK_DETAIL` rows
 *     becomes one summary row per table, so an import cannot flood the log, but is never silent.
 *
 * Logging is best-effort like the rest of the audit trail: nothing here can throw into a save.
 * Privacy: contact, bank and free-text fields are flagged "(changed)", never copied (as `audit.ts`).
 * `invoices` is not watched: `localDb` already logs every document change with a full diff.
 */

import type { AuditAction, AuditChange, AuditEntity } from '../types/audit';
import { DB_PREFIX, readRaw } from './storage';

export interface WatchedTable {
  entity: AuditEntity;
  /** Singular, for summaries: "Supplier ACME edited". */
  label: string;
}

/** Books / masters tables whose every row change reaches the audit log. */
export const WATCHED_TABLES: Readonly<Record<string, WatchedTable>> = {
  transactions: { entity: 'payment', label: 'Receipt' },
  clients: { entity: 'client', label: 'Client' },
  vendors: { entity: 'vendor', label: 'Supplier' },
  items_catalog: { entity: 'item', label: 'Catalogue item' },
  stock_items: { entity: 'item', label: 'Stock item' },
  stock_moves: { entity: 'stock_adjustment', label: 'Stock adjustment' },
  stock_transfers: { entity: 'stock_transfer', label: 'Stock transfer' },
  godowns: { entity: 'godown', label: 'Godown' },
  purchases: { entity: 'purchase', label: 'Purchase bill' },
  purchase_payments: { entity: 'purchase_payment', label: 'Supplier payment' },
  purchase_orders: { entity: 'purchase_order', label: 'Purchase order' },
  purchase_returns: { entity: 'purchase', label: 'Purchase return' },
  receipt_notes: { entity: 'purchase', label: 'Receipt note' },
  vendor_payments: { entity: 'vendor_payment', label: 'Supplier advance' },
  vouchers: { entity: 'voucher', label: 'Voucher' },
  accounts: { entity: 'account', label: 'Ledger' },
  groups: { entity: 'account', label: 'Group' },
  bank_accounts: { entity: 'account', label: 'Bank account' },
  ledger_openings: { entity: 'opening', label: 'Opening balance' },
  opening_bills: { entity: 'opening', label: 'Opening bill' },
  books_begin: { entity: 'opening', label: 'Books beginning date' },
  book_opening: { entity: 'opening', label: 'Cash / bank opening' },
  fixed_assets: { entity: 'fixed_asset', label: 'Fixed asset' },
  cost_centres: { entity: 'cost_centre', label: 'Cost centre' },
  budgets: { entity: 'budget', label: 'Budget' },
  cheques: { entity: 'cheque', label: 'Cheque' },
  deposit_slips: { entity: 'cheque', label: 'Deposit slip' },
  fx_bank_moves: { entity: 'voucher', label: 'Forex bank entry' },
  epay_batches: { entity: 'vendor_payment', label: 'e-Payment batch' },
  commission_postings: { entity: 'voucher', label: 'Commission posting' },
  business_loans: { entity: 'voucher', label: 'Business loan' },
  currency_rates: { entity: 'settings', label: 'Currency reference rate' },
  advances: { entity: 'advance', label: 'Advance' },
  recurring: { entity: 'recurring', label: 'Recurring schedule' },
  bank_statements: { entity: 'bank_statement', label: 'Bank statement line' },
  tds_challans: { entity: 'tds', label: 'TDS challan' },
  tds_deductions: { entity: 'tds', label: 'TDS deduction' },
  tds_returns: { entity: 'tds', label: 'TDS return mark' },
  rcm_documents: { entity: 'gst', label: 'RCM self-invoice / payment voucher' },
  // 7R
  gst_pmt09: { entity: 'gst', label: 'PMT-09 transfer' },
  gst_refunds: { entity: 'gst', label: 'GST refund claim' },
  isd_documents: { entity: 'gst', label: 'ISD document' },
  tds_justifications: { entity: 'tds', label: 'TRACES justification import' },
  // 8D
  gst_followups: { entity: 'gst', label: 'Supplier follow-up (2B)' },
  gstr2b_itc: { entity: 'gst', label: '2B ITC pushed to 3B' },
  gstr1_snapshots: { entity: 'gst', label: 'GSTR-1 as filed' },
  pos_day_close: { entity: 'pos_day_close', label: 'POS day close' },
  pos_shifts: { entity: 'pos_day_close', label: 'POS cashier shift' },
  pos_returns: { entity: 'invoice', label: 'POS return' },
  doc_links: { entity: 'invoice', label: 'Document link' },
  year_end: { entity: 'settings', label: 'Year-end checklist' },
};

/** More row changes than this in one write (and not logged by the module) → one summary row. */
export const BULK_DETAIL = 40;
const MAX_CHANGES = 15;
const EXCERPT = 60;

/** Never copied into the log, only flagged as changed. */
const HIDDEN = /(email|phone|mobile|address|account_no|accountnumber|ifsc|^bank_|beneficiary|upi|notes?$|narration_private|^pan$|password|pin_hash|logo|signature|^data$|serials)/i;
/** Bookkeeping fields that change on every save and say nothing. */
const IGNORED = new Set(['id', 'created_at', 'updated_at']);
/** Fields shown on a create / delete row (the rest of the record is in the backup). */
const KEY_FIELDS = [
  'number', 'invoice_number', 'bill_number', 'note_number', 'transfer_number', 'voucher_number', 'slip_number', 'receipt_number',
  'name', 'vendor_name', 'client_name', 'party_name', 'type', 'kind', 'date', 'issue_date', 'ledger_id', 'account_id',
  'amount', 'total', 'dr', 'cr', 'status', 'method', 'qty',
];
const REF_FIELDS = ['number', 'invoice_number', 'bill_number', 'note_number', 'transfer_number', 'voucher_number', 'slip_number', 'receipt_number', 'ref_no', 'name', 'vendor_name', 'party_name', 'ledger_id'];

type Row = Record<string, unknown>;

const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const rowId = (r: unknown): string => {
  if (!isObj(r)) return '';
  const id = r.id;
  return typeof id === 'string' ? id : typeof id === 'number' ? String(id) : '';
};
const excerpt = (t: string, n = EXCERPT) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

function humanize(key: string): string {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Paise voucher lines (`{account_id, dr, cr}`) read as "sales Cr 1,000.00; bank Dr 1,000.00". */
function linesText(v: unknown[]): string | null {
  if (!v.every((l) => isObj(l) && typeof l.account_id === 'string' && (typeof l.dr === 'number' || typeof l.cr === 'number'))) return null;
  return excerpt(
    (v as Row[]).map((l) => {
      const dr = Number(l.dr) || 0;
      const amt = ((dr || Number(l.cr) || 0) / 100).toFixed(2);
      return `${l.account_id}${l.party ? ` (${String(l.party)})` : ''} ${dr ? 'Dr' : 'Cr'} ${amt}`;
    }).join('; '),
    160,
  );
}

function show(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number' || typeof v === 'string') return excerpt(String(v).replace(/\s+/g, ' ').trim()) || null;
  if (Array.isArray(v)) return linesText(v) ?? `${v.length} ${v.length === 1 ? 'entry' : 'entries'}`;
  return excerpt(JSON.stringify(v));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Field-level before → after of two versions of one row (pure). Capped; privacy rules applied. */
export function genericChanges(before: Row | null, after: Row | null): AuditChange[] {
  const out: AuditChange[] = [];
  let more = 0;
  const add = (c: AuditChange) => (out.length < MAX_CHANGES ? out.push(c) : more++);
  if (!before || !after) {
    const r = (after ?? before) as Row;
    for (const k of KEY_FIELDS) {
      if (!(k in r) || HIDDEN.test(k)) continue;
      const v = show(r[k]);
      if (v !== null) add({ field: humanize(k), from: before ? v : null, to: after ? v : null });
    }
    if (Array.isArray(r.lines)) add({ field: 'Lines', from: before ? show(r.lines) : null, to: after ? show(r.lines) : null });
    return out;
  }
  const keys = [...new Set([...Object.keys(after), ...Object.keys(before)])].filter((k) => !IGNORED.has(k));
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (same(a, b)) continue;
    if (HIDDEN.test(k)) {
      add({ field: humanize(k), from: '(hidden)', to: '(changed)' });
      continue;
    }
    let from = show(a);
    let to = show(b);
    if (from === to) {
      // Same summary (e.g. an edited line inside an unchanged count): still say it changed.
      from = from ?? '(empty)';
      to = `${to ?? ''} (edited)`.trim();
    }
    add({ field: humanize(k), from, to });
  }
  if (more) out.push({ field: 'More fields', from: null, to: `+${more}` });
  return out;
}

export function refOf(r: Row | null): string {
  if (!r) return '';
  for (const k of REF_FIELDS) {
    const v = r[k];
    if ((typeof v === 'string' && v.trim()) || typeof v === 'number') return excerpt(String(v).trim(), 40);
  }
  return '';
}

function summarize(changes: AuditChange[], max = 3): string {
  const shown = changes.slice(0, max).map((c) => `${c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`);
  const rest = changes.length - max;
  return shown.join('; ') + (rest > 0 ? `; +${rest} more` : '');
}

/* ── Tracker ───────────────────────────────────────────────────── */

interface Pending {
  table: string;
  id: string;
  before: Row | null;
  after: Row | null;
}

export interface EditRecordInput {
  entity: AuditEntity;
  entity_id: string;
  action: AuditAction;
  summary: string;
  changes?: AuditChange[];
  doc_number?: string;
}

/** What `audit.record` attaches to a module's own row. */
export interface TakenEdit {
  action: 'create' | 'update' | 'delete';
  changes: AuditChange[];
}

const pending = new Map<string, Pending>();
/** Per table: the raw JSON last seen and each row's JSON, so a save only re-serialises the new rows. */
const seen = new Map<string, { raw: string | null; byId: Map<string, string> }>();
let recorder: ((input: EditRecordInput) => void) | null = null;
let scheduled = false;

function indexRaw(raw: string | null): Map<string, string> {
  const byId = new Map<string, string>();
  if (!raw) return byId;
  try {
    const rows = JSON.parse(raw) as unknown;
    if (Array.isArray(rows)) for (const r of rows) {
      const id = rowId(r);
      if (id) byId.set(id, JSON.stringify(r));
    }
  } catch {
    /* unreadable before-state: every row reads as new */
  }
  return byId;
}

function queue(table: string, id: string, before: Row | null, after: Row | null): void {
  // Keyed by row id (what `audit.record` names); the same id in a second table gets its own slot.
  const clash = pending.get(id);
  const key = clash && clash.table !== table ? `${table}:${id}` : id;
  const prev = pending.get(key);
  if (prev && prev.table === table) {
    prev.after = after;
    if (!prev.before && !prev.after) pending.delete(key);
  } else {
    pending.set(key, { table, id, before, after });
  }
}

const parse = (s: string): Row | null => {
  try {
    const v = JSON.parse(s) as unknown;
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
};

/** The `onTableWrite` observer. */
export function observeTableWrite(name: string, prevRaw: string | null, rows: readonly unknown[]): void {
  if (!WATCHED_TABLES[name]) return;
  const cached = seen.get(name);
  const before = cached && cached.raw === prevRaw ? cached.byId : indexRaw(prevRaw);
  const next = new Map<string, string>();
  for (const r of rows) {
    const id = rowId(r);
    if (!id || next.has(id)) continue;
    const s = JSON.stringify(r);
    next.set(id, s);
    const old = before.get(id);
    if (old === undefined) queue(name, id, null, r as Row);
    else if (old !== s) queue(name, id, parse(old), r as Row);
  }
  for (const [id, s] of before) if (!next.has(id)) queue(name, id, parse(s), null);
  seen.set(name, { raw: readRaw(DB_PREFIX + name), byId: next });
  if (pending.size && !scheduled) {
    scheduled = true;
    queueMicrotask(drainEdits);
  }
}

function actionOf(p: Pending): 'create' | 'update' | 'delete' {
  return !p.before ? 'create' : !p.after ? 'delete' : 'update';
}

/** Hand the pending change of row `id` to the module that is logging it (or undefined). */
export function takeEdit(id: string): TakenEdit | undefined {
  if (!id || !pending.size) return undefined;
  const p = pending.get(id);
  if (!p) return undefined;
  pending.delete(id);
  return { action: actionOf(p), changes: genericChanges(p.before, p.after) };
}

/** Merge a module's own changes with the tracked field changes (module first, no duplicate fields). */
export function mergeChanges(own: AuditChange[] | undefined, tracked: AuditChange[]): AuditChange[] {
  const mine = own ?? [];
  const fields = new Set(mine.map((c) => c.field.toLowerCase()));
  return [...mine, ...tracked.filter((c) => !fields.has(c.field.toLowerCase()))].slice(0, 24);
}

/** Record every change no module logged. Runs at the end of the task; exported for tests. */
export function drainEdits(): void {
  scheduled = false;
  if (!pending.size) return;
  const all = [...pending.values()];
  pending.clear();
  const rec = recorder;
  if (!rec) return;
  const byTable = new Map<string, Pending[]>();
  for (const p of all) byTable.set(p.table, [...(byTable.get(p.table) ?? []), p]);
  for (const [table, list] of byTable) {
    const w = WATCHED_TABLES[table];
    try {
      if (list.length > BULK_DETAIL) {
        const n = { create: 0, update: 0, delete: 0 };
        for (const p of list) n[actionOf(p)]++;
        const refs = list.slice(0, 10).map((p) => refOf(p.after ?? p.before) || p.id);
        rec({
          entity: w.entity,
          entity_id: table,
          action: n.delete && !n.create && !n.update ? 'delete' : n.create && !n.update && !n.delete ? 'create' : 'update',
          summary: `${w.label}s changed in one save: ${n.create} added, ${n.update} altered, ${n.delete} removed`,
          changes: [
            { field: 'Added', from: null, to: String(n.create) },
            { field: 'Altered', from: null, to: String(n.update) },
            { field: 'Removed', from: null, to: String(n.delete) },
            { field: 'First rows', from: null, to: excerpt(refs.join(', '), 160) },
          ],
        });
        continue;
      }
      for (const p of list) {
        const action = actionOf(p);
        const changes = genericChanges(p.before, p.after);
        if (action === 'update' && !changes.length) continue;
        const ref = refOf(p.after ?? p.before);
        const what = `${w.label}${ref ? ` ${ref}` : ''}`;
        rec({
          entity: w.entity,
          entity_id: p.id,
          action,
          ...(ref ? { doc_number: ref } : {}),
          summary: action === 'create' ? `${what} added` : action === 'delete' ? `${what} deleted` : `${what} edited: ${summarize(changes)}`,
          changes,
        });
      }
    } catch {
      /* best effort */
    }
  }
}

/** Wire the tracker to the audit writer (called once by `audit.ts`). */
export function setEditRecorder(fn: ((input: EditRecordInput) => void) | null): void {
  recorder = fn;
}

/** Tests: forget pending changes and cached table states. */
export function resetEditTracker(): void {
  pending.clear();
  seen.clear();
  scheduled = false;
}
