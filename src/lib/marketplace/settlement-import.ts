/**
 * Settlement import (R5-A4): what the marketplace paid, per order and per amount type.
 *
 *  - Long format (Amazon settlement V2: `amount-type`, `amount-description`, `amount`) is read line by line, the
 *    settlement header row giving the id, period, deposit date and total.
 *  - Wide format (Flipkart settlement workbook — the Orders, Non-order SPF, Storage & recall and Ads sheets are read
 *    together — Meesho payments, generic): one row per order, one column per amount; every non-zero cell is a line.
 * Every amount gets a BUCKET (`SettlementBucket`): the channel's own rules first ("description contains → bucket",
 * taught once for unknown descriptions), then the preset table, else `other`. Signs: positive = paid to the seller,
 * negative = kept by the marketplace (wide files are normalised by bucket).
 *
 * The import is refused unless Σ lines = payout to the paisa (the difference is shown). Re-importing the same
 * settlement id for the channel is refused. Pure planning + one guarded save.
 */
import type { BucketRule, MarketplaceImport, Settlement, SettlementBucket, SettlementLine, SalesChannel } from '../../types/marketplace-r5';
import type { InvoiceRecord } from '../../types/invoice';
import { round2 } from '../invoice-calc';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { isLocked } from '../period-lock';
import { cellOf, dayOf, guessColumns, numOf, type ColumnMap, type FileTable, type SynonymTable } from './file-map';
import { MARKETPLACE_IMPORTS_TABLE, MARKETPLACE_RETURNS_TABLE, SETTLEMENTS_TABLE } from './channels';

export const BUCKETS: readonly SettlementBucket[] = [
  'sale', 'refund', 'shipping_recovered', 'commission', 'fixed_fee', 'closing_fee', 'collection_fee', 'shipping_fee',
  'reverse_shipping', 'storage', 'ads', 'gst_on_fees', 'tcs', 'tds_194o', 'reimbursement', 'claim', 'other',
];

/** Fee buckets (net of GST) — posted to "Marketplace fees". */
export const FEE_BUCKETS: readonly SettlementBucket[] = ['commission', 'fixed_fee', 'closing_fee', 'collection_fee', 'shipping_fee', 'reverse_shipping', 'storage', 'ads'];
/** Money the marketplace keeps: a positive file value in a wide file is turned negative. */
const DEDUCTIONS = new Set<SettlementBucket>([...FEE_BUCKETS, 'gst_on_fees', 'tcs', 'tds_194o', 'refund']);
/** Money paid to the seller: a negative file value in a wide file is turned positive. */
const CREDITS = new Set<SettlementBucket>(['sale', 'shipping_recovered', 'reimbursement', 'claim']);

export const isBucket = (v: unknown): v is SettlementBucket => typeof v === 'string' && (BUCKETS as readonly string[]).includes(v);

/** Description → bucket, in order (first match wins). Shared by every preset; channel rules come first. */
const DESCRIPTION_RULES: readonly [RegExp, SettlementBucket][] = [
  [/\btcs\b|tcs[-_\s]?(igst|cgst|sgst|utgst)|tax collected at source/i, 'tcs'],
  [/\btds\b|194[-\s]?o|tax deducted at source/i, 'tds_194o'],
  [/((igst|cgst|sgst|utgst|gst|tax).*(fee|commission|charge|chargeback))|((fee|commission|charge).*(igst|cgst|sgst|utgst|gst|tax))|^taxes?\b.*\(rs/i, 'gst_on_fees'],
  [/reverse shipping|return shipping|return.?fee/i, 'reverse_shipping'],
  [/shipping ?fee|shipping charge|shippingchargeback|shippinghb|fba.*fee|fulfil+ment ?fee|pick.?(and.?)?pack|weight.?(based|handling)|delivery charge/i, 'shipping_fee'],
  [/commission/i, 'commission'],
  [/closing.?fee|fixedclosingfee/i, 'closing_fee'],
  [/fixed.?fee/i, 'fixed_fee'],
  [/collection.?fee|payment gateway/i, 'collection_fee'],
  [/storage|recall|removal|disposal/i, 'storage'],
  [/\bads?\b|advertis|sponsored/i, 'ads'],
  [/reimburse|compensation|safe-?t|\bspf\b|warehouse.?(damage|lost)|reversal_reimbursement/i, 'reimbursement'],
  [/claim/i, 'claim'],
  [/refund|sale return|return amount/i, 'refund'],
  [/shipping|gift.?wrap/i, 'shipping_recovered'],
  [/principal|sale amount|selling price|item.?price|order value|invoice value|^tax$|producttax|\bsale\b/i, 'sale'],
];

/** The bucket for an amount description (channel rules, then the table, else `other`). */
export function classify(description: string, rules: readonly BucketRule[] = []): SettlementBucket {
  const d = description.trim();
  const low = d.toLowerCase();
  for (const r of rules) if (r.match.trim() && isBucket(r.bucket) && low.includes(r.match.trim().toLowerCase())) return r.bucket;
  for (const [re, b] of DESCRIPTION_RULES) if (re.test(d)) return b;
  return 'other';
}

/* ── Presets ────────────────────────────────────────────────────── */

export type SettlementPresetId = 'amazon_v2' | 'flipkart_settlement' | 'meesho_payments' | 'generic';

export const LONG_FIELDS: SynonymTable = {
  settlement_id: ['settlement id'],
  start: ['settlement start date'],
  end: ['settlement end date'],
  deposit: ['deposit date'],
  total: ['total amount'],
  txn: ['transaction type'],
  order_id: ['order id', 'merchant order id'],
  amount_type: ['amount type'],
  description: ['amount description'],
  amount: ['amount'],
  sku: ['sku'],
  posted: ['posted date', 'posted date time'],
};

export const WIDE_FIELDS: SynonymTable = {
  order_id: ['order item id', 'order id', 'sub order no', 'sub order number', 'suborder no'],
  settlement_id: ['settlement ref no', 'settlement id', 'neft id', 'payment reference', 'utr'],
  deposit: ['payment date', 'settlement date', 'deposit date', 'neft date'],
  net: ['bank settlement value', 'final settlement amount', 'net settlement', 'settlement amount', 'net amount'],
  sku: ['sku', 'seller sku'],
};

/** Wide-format amount columns per bucket. */
export const WIDE_BUCKET_COLUMNS: SynonymTable = {
  sale: ['sale amount', 'total sale amount incl shipping and gst', 'selling price', 'order value', 'invoice value'],
  refund: ['refund', 'sale return amount', 'refund amount', 'return amount'],
  shipping_recovered: ['shipping recovered', 'shipping charges collected'],
  commission: ['commission', 'meesho commission incl gst', 'marketplace fee'],
  fixed_fee: ['fixed fee', 'fixed fee incl gst'],
  closing_fee: ['closing fee'],
  collection_fee: ['collection fee', 'payment gateway fee'],
  shipping_fee: ['shipping fee', 'shipping charge incl gst', 'pick and pack fee', 'weight handling fee'],
  reverse_shipping: ['reverse shipping fee', 'return shipping charge'],
  storage: ['storage fee', 'recall fee'],
  ads: ['ads fee', 'advertising fee', 'ads'],
  gst_on_fees: ['taxes', 'gst on fees', 'tax on fees'],
  tcs: ['tcs', 'tcs amount'],
  tds_194o: ['tds', 'tds amount'],
  reimbursement: ['reimbursement', 'compensation', 'spf payout', 'claims'],
  claim: ['claim amount'],
  other: ['recovery', 'other charges', 'adjustments'],
};

export const SETTLEMENT_PRESETS: readonly { id: SettlementPresetId; long: boolean }[] = [
  { id: 'amazon_v2', long: true },
  { id: 'flipkart_settlement', long: false },
  { id: 'meesho_payments', long: false },
  { id: 'generic', long: false },
];

/** A long-format file is recognised by its amount-type / amount-description columns. */
export function isLongFormat(headers: readonly string[]): boolean {
  const cols = guessColumns(headers, LONG_FIELDS);
  return cols.has('amount_type') && cols.has('description') && cols.has('amount');
}

/* ── Parse ──────────────────────────────────────────────────────── */

export interface ParsedSettlement {
  settlement_id: string;
  period_from?: string;
  period_to?: string;
  deposit_date: string;
  /** The deposit amount (file header or typed). */
  payout: number;
  lines: SettlementLine[];
  /** Σ lines − payout (0 when the import may proceed). */
  difference: number;
  /** Descriptions that fell to `other` (for the user to map once). */
  unknown: string[];
  problems: string[];
}

export interface SettlementSheet {
  name: string;
  table: FileTable;
}

export interface ParseOptions {
  rules?: readonly BucketRule[];
  /** Typed when the file has none (wide formats). */
  payout?: number;
  deposit_date?: string;
  settlement_id?: string;
}

function longLines(t: FileTable, cols: ColumnMap, rules: readonly BucketRule[]): { header: Partial<ParsedSettlement>; lines: SettlementLine[] } {
  const header: Partial<ParsedSettlement> = {};
  const lines: SettlementLine[] = [];
  for (const row of t.rows) {
    const total = numOf(row, cols, 'total');
    const desc = cellOf(row, cols, 'description');
    if (!header.settlement_id && cellOf(row, cols, 'settlement_id')) header.settlement_id = cellOf(row, cols, 'settlement_id');
    if (total !== null && !desc) {
      // The settlement header row: id, period, deposit date, total.
      header.payout = round2(total);
      header.deposit_date = dayOf(row, cols, 'deposit') || header.deposit_date;
      header.period_from = dayOf(row, cols, 'start') || header.period_from;
      header.period_to = dayOf(row, cols, 'end') || header.period_to;
      continue;
    }
    const amount = numOf(row, cols, 'amount');
    if (amount === null || amount === 0) continue;
    const type = cellOf(row, cols, 'amount_type');
    const txn = cellOf(row, cols, 'txn');
    let bucket = classify(desc || type, rules);
    // A refund transaction gives back the principal / shipping the buyer paid.
    if (/refund/i.test(txn) && (bucket === 'sale' || bucket === 'shipping_recovered')) bucket = 'refund';
    lines.push({ order_id: cellOf(row, cols, 'order_id'), bucket, amount: round2(amount), description: [type, desc].filter(Boolean).join(' / ') || 'Amount', ...(cellOf(row, cols, 'sku') ? { sku: cellOf(row, cols, 'sku') } : {}) });
  }
  return { header, lines };
}

function wideLines(t: FileTable, rules: readonly BucketRule[]): { header: Partial<ParsedSettlement>; lines: SettlementLine[]; netTotal: number | null } {
  const cols = guessColumns(t.headers, WIDE_FIELDS);
  const used = new Set(cols.values());
  const amountCols: { idx: number; bucket: SettlementBucket; header: string }[] = [];
  const known = guessColumns(t.headers.map((h, i) => (used.has(i) ? '' : h)), WIDE_BUCKET_COLUMNS);
  for (const [bucket, idx] of known) amountCols.push({ idx, bucket: bucket as SettlementBucket, header: t.headers[idx] });
  // Remaining numeric-looking columns are classified by their header (taught rules first).
  const claimed = new Set([...used, ...amountCols.map((c) => c.idx)]);
  t.headers.forEach((h, idx) => {
    if (claimed.has(idx) || !h.trim()) return;
    const numeric = t.rows.some((r) => numOf(r, new Map([['x', idx]]), 'x') !== null && /\d/.test(r[idx] ?? ''));
    const textual = t.rows.some((r) => (r[idx] ?? '').trim() && numOf(r, new Map([['x', idx]]), 'x') === null);
    if (numeric && !textual && /fee|charge|commission|tax|tcs|tds|amount|refund|claim|reimburs|ads|storage|recall|shipping|\(rs/i.test(h)) {
      const b = classify(h, rules);
      if (b !== 'other' || rules.length) amountCols.push({ idx, bucket: b, header: h });
    }
  });
  const header: Partial<ParsedSettlement> = {};
  const lines: SettlementLine[] = [];
  let netTotal: number | null = null;
  for (const row of t.rows) {
    if (!header.settlement_id && cellOf(row, cols, 'settlement_id')) header.settlement_id = cellOf(row, cols, 'settlement_id');
    const d = dayOf(row, cols, 'deposit');
    if (d && (!header.deposit_date || d > header.deposit_date)) header.deposit_date = d;
    const net = numOf(row, cols, 'net');
    if (net !== null) netTotal = round2((netTotal ?? 0) + net);
    const order = cellOf(row, cols, 'order_id');
    for (const c of amountCols) {
      const raw = numOf(row, new Map([['x', c.idx]]), 'x');
      if (raw === null || raw === 0) continue;
      const amount = DEDUCTIONS.has(c.bucket) ? -Math.abs(raw) : CREDITS.has(c.bucket) ? Math.abs(raw) : raw;
      lines.push({ order_id: order, bucket: c.bucket, amount: round2(amount), description: c.header, ...(cellOf(row, cols, 'sku') ? { sku: cellOf(row, cols, 'sku') } : {}) });
    }
  }
  return { header, lines, netTotal };
}

/** Read one settlement from one or more sheets (Flipkart: Orders + Non-order SPF + Storage & recall + Ads). */
export function parseSettlement(sheets: readonly SettlementSheet[], presetId: SettlementPresetId, opts: ParseOptions = {}): ParsedSettlement {
  const rules = opts.rules ?? [];
  const problems: string[] = [];
  const lines: SettlementLine[] = [];
  const header: Partial<ParsedSettlement> = {};
  let netTotal: number | null = null;
  for (const s of sheets) {
    if (!s.table.headers.length) continue;
    const long = presetId === 'amazon_v2' || isLongFormat(s.table.headers);
    if (long) {
      const cols = guessColumns(s.table.headers, LONG_FIELDS);
      const r = longLines(s.table, cols, rules);
      lines.push(...r.lines);
      Object.assign(header, Object.fromEntries(Object.entries(r.header).filter(([, v]) => v !== undefined && v !== '')));
    } else {
      const r = wideLines(s.table, rules);
      lines.push(...r.lines);
      if (r.netTotal !== null) netTotal = round2((netTotal ?? 0) + r.netTotal);
      if (r.header.settlement_id && !header.settlement_id) header.settlement_id = r.header.settlement_id;
      if (r.header.deposit_date && (!header.deposit_date || r.header.deposit_date > header.deposit_date)) header.deposit_date = r.header.deposit_date;
    }
  }
  const payout = round2(opts.payout ?? header.payout ?? netTotal ?? NaN);
  const settlement_id = (opts.settlement_id || header.settlement_id || '').trim();
  const deposit_date = opts.deposit_date || header.deposit_date || '';
  if (!settlement_id) problems.push('No settlement id in the file: type the settlement reference.');
  if (!deposit_date) problems.push('No deposit date in the file: type the date the money reached the bank.');
  if (!Number.isFinite(payout)) problems.push('No payout amount in the file: type the amount deposited.');
  if (!lines.length) problems.push('No amounts found in the file.');
  const sum = round2(lines.reduce((s, l) => s + l.amount, 0));
  const difference = Number.isFinite(payout) ? round2(sum - payout) : NaN;
  if (Number.isFinite(difference) && Math.abs(difference) >= 0.005) problems.push(`The lines add up to ${sum.toFixed(2)} but the payout is ${payout.toFixed(2)} (difference ${difference.toFixed(2)}). Check the sheets read and the typed payout.`);
  const unknown = [...new Set(lines.filter((l) => l.bucket === 'other').map((l) => l.description))];
  return {
    settlement_id,
    ...(header.period_from ? { period_from: header.period_from } : {}),
    ...(header.period_to ? { period_to: header.period_to } : {}),
    deposit_date,
    payout: Number.isFinite(payout) ? payout : 0,
    lines,
    difference: Number.isFinite(difference) ? difference : 0,
    unknown,
    problems,
  };
}

/** Re-bucket after the user taught rules for unknown descriptions (keeps the sign convention of the line). */
export function rebucket(p: ParsedSettlement, rules: readonly BucketRule[]): ParsedSettlement {
  const lines = p.lines.map((l) => (l.bucket === 'other' ? { ...l, bucket: classify(l.description, rules) } : l));
  return { ...p, lines, unknown: [...new Set(lines.filter((l) => l.bucket === 'other').map((l) => l.description))] };
}

/* ── Save ───────────────────────────────────────────────────────── */

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementError';
  }
}

export function loadSettlements(channelId?: string): readonly Settlement[] {
  const rows = peekTable<Settlement>(SETTLEMENTS_TABLE).filter((s) => s && typeof s.id === 'string' && Array.isArray(s.lines));
  return channelId ? rows.filter((s) => s.channel_id === channelId) : rows;
}

/** Order id → the channel's live document of each kind (A3), for linking settlement lines. */
export function docsByOrder(channelId: string, invoices: readonly Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'channel_id' | 'channel_order_id'>[]): Map<string, { sale?: string; credit?: string }> {
  const out = new Map<string, { sale?: string; credit?: string }>();
  for (const inv of invoices) {
    if (inv.channel_id !== channelId || !inv.channel_order_id || inv.status === 'Cancelled' || inv.status === 'Draft') continue;
    const k = inv.channel_order_id.trim().toLowerCase();
    const e = out.get(k) ?? {};
    if (inv.doc_type === 'CREDIT_NOTE') e.credit ??= inv.id;
    else e.sale ??= inv.id;
    out.set(k, e);
  }
  return out;
}

/**
 * Save a parsed settlement (refused while it does not add up, when its id was imported before for the channel, or
 * when its deposit date is locked). Claim / reimbursement lines mark matching open claims on the returns desk.
 */
export function importSettlement(channel: SalesChannel, parsed: ParsedSettlement, fileName: string, by?: string): Settlement {
  requireAccess('doc.create');
  if (parsed.problems.length) throw new SettlementError(parsed.problems[0]);
  if (loadSettlements(channel.id).some((s) => s.settlement_id.toLowerCase() === parsed.settlement_id.toLowerCase())) {
    throw new SettlementError(`Settlement ${parsed.settlement_id} is already imported for ${channel.name}.`);
  }
  if (isLocked({ issue_date: parsed.deposit_date })) throw new SettlementError(`${parsed.deposit_date} is inside the period lock.`);
  const byOrder = docsByOrder(channel.id, peekTable<InvoiceRecord>('invoices'));
  const importId = generateId();
  const lines = parsed.lines.map((l) => {
    const d = byOrder.get(l.order_id.trim().toLowerCase());
    const doc_id = l.bucket === 'refund' ? d?.credit ?? d?.sale : d?.sale;
    return doc_id ? { ...l, doc_id } : l;
  });
  const row: Settlement = {
    id: generateId(),
    channel_id: channel.id,
    settlement_id: parsed.settlement_id,
    ...(parsed.period_from ? { period_from: parsed.period_from } : {}),
    ...(parsed.period_to ? { period_to: parsed.period_to } : {}),
    deposit_date: parsed.deposit_date,
    payout: parsed.payout,
    lines,
    import_id: importId,
  };
  const imp: MarketplaceImport = {
    id: importId, channel_id: channel.id, kind: 'settlement', file_name: fileName, imported_at: new Date().toISOString(),
    ...(parsed.period_from ? { period_from: parsed.period_from, period_to: parsed.period_to ?? parsed.period_from } : {}),
    ...(by ? { by } : {}),
    counts: { lines: lines.length, orders: new Set(lines.map((l) => l.order_id).filter(Boolean)).size },
  };
  return withTablesRollback([SETTLEMENTS_TABLE, MARKETPLACE_IMPORTS_TABLE, MARKETPLACE_RETURNS_TABLE], () => {
    setTable(SETTLEMENTS_TABLE, [...getTable<Settlement>(SETTLEMENTS_TABLE), row]);
    setTable(MARKETPLACE_IMPORTS_TABLE, [...getTable<MarketplaceImport>(MARKETPLACE_IMPORTS_TABLE), imp]);
    matchClaimsFrom(row);
    return row;
  });
}

/** Mark open / approved claims reimbursed by this settlement's claim / reimbursement lines (by order id). */
export function matchClaimsFrom(s: Pick<Settlement, 'id' | 'channel_id' | 'lines'>): number {
  const paid = new Set(s.lines.filter((l) => (l.bucket === 'claim' || l.bucket === 'reimbursement') && l.amount > 0 && l.order_id).map((l) => l.order_id.trim().toLowerCase()));
  if (!paid.size) return 0;
  let n = 0;
  const rows = getTable<{ id: string; channel_id: string; order_id: string; claim?: { status: string; settlement_id?: string } }>(MARKETPLACE_RETURNS_TABLE).map((r) => {
    if (r.channel_id !== s.channel_id || !r.claim || !(r.claim.status === 'open' || r.claim.status === 'approved') || !paid.has(r.order_id.trim().toLowerCase())) return r;
    n++;
    return { ...r, claim: { ...r.claim, status: 'reimbursed', settlement_id: s.id } };
  });
  if (n) setTable(MARKETPLACE_RETURNS_TABLE, rows);
  return n;
}

/** Delete an imported settlement that is not posted (posted ones are unposted first). */
export function deleteSettlement(id: string): void {
  requireAccess('doc.create');
  const s = getTable<Settlement>(SETTLEMENTS_TABLE).find((x) => x.id === id);
  if (!s) return;
  if (s.posted) throw new SettlementError('Unpost the settlement first.');
  setTable(SETTLEMENTS_TABLE, getTable<Settlement>(SETTLEMENTS_TABLE).filter((x) => x.id !== id));
}

/** Σ amounts per bucket (positive = paid to the seller). */
export function bucketTotals(lines: readonly SettlementLine[]): Record<SettlementBucket, number> {
  const out = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<SettlementBucket, number>;
  for (const l of lines) if (isBucket(l.bucket)) out[l.bucket] = round2(out[l.bucket] + l.amount);
  return out;
}
