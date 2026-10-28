/**
 * R4-C7 field-level sync conflict resolution (pure). Figma-style: when the same row was edited on two devices, the
 * user keeps both changes field by field instead of picking a whole row.
 *
 *  - Masters (clients, suppliers, catalogue, stock items, godowns, ledgers, cost centres): every top-level field
 *    has Mine / Theirs.
 *  - Documents and vouchers: fields move in groups so totals stay consistent — "Lines, taxes & totals" is one
 *    choice; "Number & date" (a number is never mixed from both sides), "Party & addresses", "Dates & due",
 *    "Notes / terms", "Status" and "Other details" are separate.
 *  - Labels in plain words with formatted values; contact / bank fields show "(changed)" without `settings.manage`.
 *  - `validateMerged` re-normalises and recalculates a merged sales document and refuses a total that no longer
 *    matches its lines ("choose lines and totals from one side").
 *  - "Merge non-overlapping masters" (bulk) needs no base version: it is offered only when the remote version
 *    follows on from a version this device knew (version vectors), and takes each differing field from the side
 *    that has a value where the other is empty; a field set differently on both sides is an overlap (left for the
 *    user). A true 3-way merge needs base rows (open question).
 */
import { normalizeRecord } from '../../store/invoice-defaults';
import { calcInputFromRecord, calculateInvoice } from '../invoice-calc';
import { formatCurrency, formatDate } from '../utils';
import type { InvoiceRecord } from '../../types/invoice';

export type FieldPick = 'mine' | 'theirs';
/** Field key (masters) or group id (documents) → side. Unpicked differences keep "mine". */
export type FieldPicks = Record<string, FieldPick>;

type Row = Record<string, unknown>;
const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const MASTER_TABLES: ReadonlySet<string> = new Set(['clients', 'vendors', 'items_catalog', 'stock_items', 'godowns', 'accounts', 'cost_centres', 'groups', 'bank_accounts']);
export const DOCUMENT_TABLES: ReadonlySet<string> = new Set(['invoices', 'purchases', 'vouchers', 'purchase_orders', 'receipt_notes', 'purchase_returns', 'stock_transfers', 'advances']);

/** Table name of a sync key (`mrchartist_inv_clients` → `clients`). */
export const tableOfKey = (key: string) => key.replace(/^mrchartist_inv_/, '');
export const mergeKind = (table: string): 'master' | 'document' | 'none' => (MASTER_TABLES.has(table) ? 'master' : DOCUMENT_TABLES.has(table) ? 'document' : 'none');

/* ── Groups of document fields ───────────────────────────────── */

export type GroupId = 'number' | 'lines' | 'party' | 'dates' | 'notes' | 'status' | 'other';
export const GROUP_ORDER: readonly GroupId[] = ['number', 'lines', 'party', 'dates', 'notes', 'status', 'other'];
export const GROUP_LABELS: Record<GroupId, string> = {
  number: 'Number & date',
  lines: 'Lines, taxes & totals',
  party: 'Party & addresses',
  dates: 'Dates & due',
  notes: 'Notes / terms',
  status: 'Status',
  other: 'Other details',
};

const GROUP_FIELDS: Record<Exclude<GroupId, 'other'>, readonly string[]> = {
  number: ['invoice_number', 'number', 'voucher_number', 'bill_number', 'note_number', 'transfer_number', 'receipt_number', 'issue_date', 'date', 'doc_type', 'type', 'kind'],
  lines: [
    'items', 'lines', 'subtotal', 'discount_type', 'discount_rate', 'discount_amount', 'taxable_value', 'taxable', 'cgst_amount', 'sgst_amount',
    'igst_amount', 'tax_amount', 'cgst', 'sgst', 'igst', 'cess_amount', 'round_off', 'round_off_enabled', 'round_mode', 'total', 'balance_due',
    'amount_paid', 'amount', 'tax_rate', 'shipping', 'other_charges', 'charges_taxable', 'gst_mode', 'place_of_supply', 'supply_type',
    'price_includes_tax', 'reverse_charge', 'rcm_tax_excluded', 'tcs_enabled', 'tcs_rate', 'tcs_base', 'tcs_label', 'tcs_amount', 'tds_enabled',
    'tds_section', 'tds_rate', 'tds_on_taxable', 'tds_amount', 'tds_base', 'currency', 'exchange_rate', 'landed_costs', 'landed_basis',
    'itc_eligible', 'itc_reversed', 'itc_reversal_reason', 'import_type', 'boe_duty', 'loyalty_redeem', 'offer', 'exempt_kind', 'pos',
  ],
  party: ['client', 'ship_to', 'attention', 'vendor_id', 'vendor_name', 'vendor_gstin', 'party', 'party_name', 'client_id', 'client_name'],
  dates: ['due_date', 'order_closed_on', 'shipping_bill_date', 'boe_date', 'reverse_on', 'challan_return_by', 'valid_until'],
  notes: ['notes', 'terms', 'narration', 'remarks'],
  status: ['status', 'quote_status', 'approval', 'variant', 'post_dated'],
};
const FIELD_GROUP = new Map<string, GroupId>();
for (const [g, fields] of Object.entries(GROUP_FIELDS)) for (const f of fields) FIELD_GROUP.set(f, g as GroupId);
/** Bookkeeping fields never offered (they follow the result). */
const SILENT = new Set(['id', 'created_at', 'updated_at']);

export const groupOf = (field: string): GroupId => FIELD_GROUP.get(field) ?? 'other';

/* ── Labels and values ───────────────────────────────────────── */

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Name', company: 'Company', gstin: 'GSTIN', pan: 'PAN', email: 'Email', phone: 'Phone', mobile: 'Mobile', address: 'Address',
  city: 'City', state: 'State', state_code: 'State code', pin: 'PIN code', country: 'Country', credit_limit: 'Credit limit', credit_days: 'Credit days',
  opening_balance: 'Opening balance', price_level_id: 'Price level', group_id: 'Group', notes: 'Notes', rate: 'Rate', hsn: 'HSN / SAC', unit: 'Unit',
  tax_rate: 'GST rate %', type: 'Type', code: 'Code', alias: 'Alias', reorder_level: 'Reorder level', opening_qty: 'Opening quantity',
  opening_rate: 'Opening rate', mrp: 'MRP', bank_account_no: 'Bank account no.', bank_ifsc: 'IFSC', bank_name: 'Bank', upi: 'UPI ID',
  msme_udyam: 'Udyam no.', tds_section: 'TDS section', area_id: 'Area', beat_id: 'Beat', agent_id: 'Sales agent', kind: 'Kind', address_line: 'Address',
};
const MONEY = new Set(['credit_limit', 'opening_balance', 'rate', 'mrp', 'opening_rate', 'total', 'amount', 'taxable', 'amount_paid', 'balance_due']);
const DATES = new Set(['date', 'issue_date', 'due_date', 'valid_until', 'boe_date', 'shipping_bill_date']);
/** Contact and bank fields: shown as "(changed)" without `settings.manage`. */
export const PRIVATE_FIELD = /(email|phone|mobile|address|account_no|ifsc|^bank_|beneficiary|upi|^pan$)/i;

export const humanize = (key: string) => {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const fieldLabel = (key: string) => FIELD_LABELS[key] ?? humanize(key);

/** Display value: money / dates formatted, objects summarised, private fields hidden unless allowed. */
export function showValue(key: string, v: unknown, opts: { seePrivate: boolean; currency?: string } = { seePrivate: true }): string {
  if (!opts.seePrivate && PRIVATE_FIELD.test(key)) return '(changed)';
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return MONEY.has(key) ? formatCurrency(v, opts.currency || 'INR') : String(v);
  if (typeof v === 'string') {
    if (DATES.has(key) && /^\d{4}-\d{2}-\d{2}/.test(v)) return formatDate(v.slice(0, 10));
    return v.length > 60 ? `${v.slice(0, 59)}…` : v;
  }
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'entry' : 'entries'}`;
  if (isObj(v)) {
    const name = v.name ?? v.company ?? v.label;
    return typeof name === 'string' && name ? name : '(details)';
  }
  return String(v);
}

/* ── Differences ─────────────────────────────────────────────── */

export interface FieldDiff {
  key: string;
  label: string;
  mine: unknown;
  theirs: unknown;
}
export interface GroupDiff {
  id: GroupId;
  label: string;
  fields: FieldDiff[];
}

export function fieldDiffs(local: unknown, remote: unknown): FieldDiff[] {
  if (!isObj(local) || !isObj(remote)) return [];
  const keys = [...new Set([...Object.keys(local), ...Object.keys(remote)])].filter((k) => !SILENT.has(k));
  return keys.filter((k) => !same(local[k], remote[k])).map((k) => ({ key: k, label: fieldLabel(k), mine: local[k], theirs: remote[k] }));
}

/** Document differences by group (groups with no difference left out), in display order. */
export function groupDiffs(local: unknown, remote: unknown): GroupDiff[] {
  const by = new Map<GroupId, FieldDiff[]>();
  for (const d of fieldDiffs(local, remote)) {
    const g = groupOf(d.key);
    by.set(g, [...(by.get(g) ?? []), d]);
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ id: g, label: GROUP_LABELS[g], fields: by.get(g)! }));
}

/* ── Merge ───────────────────────────────────────────────────── */

/**
 * The merged row: `local` with the fields (masters) or groups (documents) picked "theirs" taken from `remote`.
 * A field the chosen side does not have is removed. `updated_at` is the later of the two.
 */
export function mergeRows(table: string, local: unknown, remote: unknown, picks: FieldPicks): Row {
  if (!isObj(local) || !isObj(remote)) throw new Error('Both versions must exist to merge them.');
  const kind = mergeKind(table);
  const out: Row = { ...local };
  for (const d of fieldDiffs(local, remote)) {
    const pick = kind === 'document' ? picks[groupOf(d.key)] : picks[d.key];
    if (pick !== 'theirs') continue;
    if (d.key in remote) out[d.key] = remote[d.key];
    else delete out[d.key];
  }
  const ua = [local.updated_at, remote.updated_at].filter((x): x is string => typeof x === 'string').sort().pop();
  if (ua) out.updated_at = ua;
  return out;
}

const recalcGap = (r: Row): number => {
  const rec = normalizeRecord(r) as InvoiceRecord;
  return Math.abs(calculateInvoice(calcInputFromRecord(rec)).total - (Number(r.total) || 0));
};
const voucherGap = (r: Row): number => {
  const lines = Array.isArray(r.lines) ? (r.lines as Row[]) : [];
  return Math.abs(lines.reduce((s, l) => s + (Number(l.dr) || 0) - (Number(l.cr) || 0), 0));
};

/**
 * '' when the merged row is consistent, else a reason key: 'mergeTotals' (a sales document whose recalculated
 * total no longer matches, although the side its lines came from matched) or 'mergeUnbalanced' (a voucher).
 */
export function validateMerged(table: string, merged: Row, local: Row, remote: Row, picks: FieldPicks): '' | 'mergeTotals' | 'mergeUnbalanced' {
  if (table === 'invoices') {
    const source = picks.lines === 'theirs' ? remote : local;
    if (recalcGap(merged) > 0.011 && recalcGap(source) <= 0.011) return 'mergeTotals';
  }
  if (table === 'vouchers' && voucherGap(merged) !== 0) return 'mergeUnbalanced';
  return '';
}

/* ── Bulk: non-overlapping masters ───────────────────────────── */

type VV = Record<string, number>;
const vvOf = (m: unknown): VV => (isObj(m) && isObj(m.vv) ? (m.vv as VV) : {});

/**
 * The remote version follows on from a version this device knew: apart from the remote device's own counter, its
 * vector is covered by the local one (so only the remote device changed the row since the two last agreed).
 */
export function remoteFollowsKnown(local: { meta: unknown }, remote: { meta: unknown }): boolean {
  const l = vvOf(local.meta);
  const r = vvOf(remote.meta);
  const dev = isObj(remote.meta) ? String(remote.meta.d ?? '') : '';
  if (!dev) return false;
  return Object.entries(r).every(([k, v]) => k === dev || v <= (l[k] ?? 0));
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/** Picks for a master where each difference is one-sided (a value vs empty), or null when any field overlaps. */
export function nonOverlappingPicks(local: unknown, remote: unknown): FieldPicks | null {
  const picks: FieldPicks = {};
  for (const d of fieldDiffs(local, remote)) {
    if (empty(d.theirs) && !empty(d.mine)) picks[d.key] = 'mine';
    else if (empty(d.mine) && !empty(d.theirs)) picks[d.key] = 'theirs';
    else return null;
  }
  return picks;
}
