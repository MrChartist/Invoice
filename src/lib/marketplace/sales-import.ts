/**
 * Marketplace sales / returns import (R5-A3): Amazon MTR (B2C / B2B), Flipkart sales report, Meesho GST report or a
 * generic file → ordinary documents with the MARKETPLACE's invoice numbers and dates (like imported opening invoices,
 * never an app series number), tagged with the operator's GSTIN (`eco_gstin`, `eco_section: 'TCS_52'`) so GSTR-1
 * Table 14 and the TCS credit check (A5) see them.
 *
 *  - sale row  → `TAX_INVOICE` (B2B, buyer GSTIN) or `INVOICE` (B2C), place of supply = ship-to state, lines from the
 *    channel SKU map (rate = taxable ÷ units), party "<channel> customer — <state>" (B2C) or the GSTIN party (B2B);
 *  - refund / return row → `CREDIT_NOTE` linked to the original (`doc_links`), `goods_returned` from the return
 *    reason (price adjustment → false), damaged / unsellable → the channel's damaged godown;
 *  - cancellation → skipped and listed.
 * Re-importing a file changes nothing: a document whose (channel, order id, kind, marketplace number) exists is
 * "already imported". Optional summary mode for big B2C months: one document per state × GST rate × day.
 *
 * `planSalesImport` is pure (preview / dry run); `applySalesImport` saves through `localDb.invoices.save` in one
 * all-or-nothing step (period lock, roles, numbering clash checks apply); `undoSalesImport` cancels (never deletes).
 * Working paper — e-invoice applicability for marketplace-generated B2B invoices is a CA question.
 */
import type { Client, DocumentType, InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';
import type { ChannelSku, MarketplaceImport, MarketplaceReturn, SalesChannel } from '../../types/marketplace-r5';
import type { AppSettings } from '../localDb';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { resolveStateText } from '../importers';
import { stateByCode } from '../india-states';
import { isValidGstin } from '../gstin';
import { numberKey } from '../invoice-number';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { cellOf, dayOf, numOf, type ColumnMap, type FileTable, type SynonymTable } from './file-map';
import { lookupSku, unmappedList, type CatalogueRow } from './sku-map';
import { operatorGstinFor, MARKETPLACE_IMPORTS_TABLE, MARKETPLACE_RETURNS_TABLE } from './channels';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { localDb, resettleCreditedInvoices } from '../localDb';
import { cancelDocument } from '../documents';
import { isLocked } from '../period-lock';
import { loadSkuMap } from './sku-map';

/* ── Presets (synonym tables, never hard-coded columns) ─────────── */

export const SALES_FIELDS: SynonymTable = {
  kind: ['transaction type', 'event type', 'txn type', 'transaction'],
  invoice_no: ['invoice number', 'buyer invoice id', 'invoice no', 'invoice id', 'invoice num'],
  invoice_date: ['invoice date', 'buyer invoice date', 'order date', 'shipment date', 'date'],
  order_id: ['order id', 'sub order num', 'suborder number', 'order item id', 'order number'],
  sku: ['sku', 'seller sku', 'sku id', 'sku code'],
  listing_id: ['asin', 'fsn', 'listing id', 'product id'],
  title: ['item description', 'product title description', 'product name', 'product title'],
  hsn: ['hsn sac', 'hsn code', 'hsn'],
  qty: ['quantity', 'item quantity', 'qty'],
  taxable: ['tax exclusive gross', 'taxable value', 'total taxable sale value', 'taxable amount'],
  tax_rate: ['gst rate', 'tax rate', 'total tax rate'],
  igst: ['igst tax', 'igst amount', 'igst'],
  cgst: ['cgst tax', 'cgst amount', 'cgst'],
  sgst: ['sgst tax', 'sgst amount', 'sgst amount or utgst as applicable', 'utgst tax', 'sgst'],
  tax: ['total tax amount', 'tax amount'],
  cess: ['compensatory cess tax', 'cess amount', 'cess'],
  total: ['invoice amount', 'final invoice amount', 'buyer invoice amount', 'total invoice value'],
  ship_to: ['ship to state', 'customer s delivery state', 'end customer state new', 'delivery state', 'customer state'],
  ship_from: ['ship from state', 'order shipped from state', 'bill from state', 'shipped from state'],
  buyer_gstin: ['customer bill to gstid', 'buyer gstin', 'customer gstin', 'bill to gstin'],
  buyer_name: ['buyer name', 'customer name', 'bill to name'],
  cn_no: ['credit note no', 'credit note number'],
  cn_date: ['credit note date'],
  reason: ['return reason', 'detailed disposition', 'disposition', 'event sub type', 'reason'],
};

export type SalesPresetId = 'amazon_mtr_b2c' | 'amazon_mtr_b2b' | 'flipkart_sales' | 'meesho_gst' | 'meesho_gst_returns' | 'generic';

export interface SalesPreset {
  id: SalesPresetId;
  /** Kind of a row without a transaction-type column. */
  defaultKind: 'sale' | 'return';
  /** Number used when the file carries no invoice number: `<prefix>/<order id>` (Meesho GST report). */
  prefix: string;
}

export const SALES_PRESETS: readonly SalesPreset[] = [
  { id: 'amazon_mtr_b2c', defaultKind: 'sale', prefix: 'AMZ' },
  { id: 'amazon_mtr_b2b', defaultKind: 'sale', prefix: 'AMZ' },
  { id: 'flipkart_sales', defaultKind: 'sale', prefix: 'FK' },
  { id: 'meesho_gst', defaultKind: 'sale', prefix: 'MSH' },
  { id: 'meesho_gst_returns', defaultKind: 'return', prefix: 'MSH' },
  { id: 'generic', defaultKind: 'sale', prefix: 'MKT' },
];

export const salesPreset = (id: string): SalesPreset => SALES_PRESETS.find((p) => p.id === id) ?? SALES_PRESETS[SALES_PRESETS.length - 1];

export const SALES_REQUIRED = ['order_id', 'taxable'] as const;

/** Above this many rows the dialog recommends summary mode. */
export const SUMMARY_SUGGEST_ROWS = 3000;

const SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];

/* ── Row normaliser ─────────────────────────────────────────────── */

export type RowKind = 'sale' | 'return' | 'cancel' | 'skip';

export interface SalesRow {
  /** 1-based file line (header = line 1). */
  line: number;
  kind: RowKind;
  order_id: string;
  invoice_no: string;
  date: string;
  sku: string;
  listing_id: string;
  title: string;
  hsn: string;
  qty: number;
  taxable: number;
  tax_rate: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  total: number;
  ship_to: string;
  ship_from: string;
  buyer_gstin: string;
  buyer_name: string;
  /** Return rows: goods came back (false for a price adjustment) and their condition. */
  goods_returned: boolean;
  damaged: boolean;
}

/** Transaction / event type text → row kind (cancellation wins over return). */
export function rowKind(text: string, fallback: 'sale' | 'return'): RowKind {
  const t = text.trim().toLowerCase();
  if (!t) return fallback;
  if (/cancel/.test(t)) return 'cancel';
  if (/refund|return|rto/.test(t)) return 'return';
  if (/free\s*replacement|replacement/.test(t)) return 'skip';
  if (/shipment|sale|ship|order|invoice/.test(t)) return 'sale';
  return fallback;
}

const nearestSlab = (r: number) => SLABS.reduce((best, s) => (Math.abs(s - r) < Math.abs(best - r) ? s : best), SLABS[0]);

export function normalizeSalesRows(table: FileTable, cols: ColumnMap, preset: SalesPreset): SalesRow[] {
  return table.rows.map((row, i) => {
    const n = (f: string) => Math.abs(numOf(row, cols, f) ?? 0);
    const kind = rowKind(cellOf(row, cols, 'kind'), preset.defaultKind);
    const taxable = round2(n('taxable'));
    const igst = round2(n('igst'));
    const cgst = round2(n('cgst'));
    const sgst = round2(n('sgst'));
    const cess = round2(n('cess'));
    const tax = igst + cgst + sgst > 0 ? round2(igst + cgst + sgst) : round2(n('tax'));
    const rateCell = numOf(row, cols, 'tax_rate');
    // A rate typed as a fraction (0.18) is read as 18 %.
    const typed = rateCell === null ? null : Math.abs(rateCell) > 0 && Math.abs(rateCell) < 1 ? Math.abs(rateCell) * 100 : Math.abs(rateCell);
    // The amounts decide when present (a per-head rate column such as "Cgst Rate" must not be read as the GST rate).
    const tax_rate = taxable > 0 && tax > 0 ? nearestSlab((tax / taxable) * 100) : typed !== null ? nearestSlab(typed) : 0;
    const reason = cellOf(row, cols, 'reason').toLowerCase();
    const qty = n('qty') || 1;
    const date = kind === 'return' ? dayOf(row, cols, 'cn_date') || dayOf(row, cols, 'invoice_date') : dayOf(row, cols, 'invoice_date');
    const invoice_no = kind === 'return' ? cellOf(row, cols, 'cn_no') || cellOf(row, cols, 'invoice_no') : cellOf(row, cols, 'invoice_no');
    const totalCell = numOf(row, cols, 'total');
    return {
      line: i + 2,
      kind,
      order_id: cellOf(row, cols, 'order_id'),
      invoice_no,
      date,
      sku: cellOf(row, cols, 'sku'),
      listing_id: cellOf(row, cols, 'listing_id'),
      title: cellOf(row, cols, 'title'),
      hsn: cellOf(row, cols, 'hsn').replace(/\s/g, ''),
      qty,
      taxable,
      tax_rate,
      igst,
      cgst,
      sgst,
      cess,
      total: totalCell !== null && totalCell !== 0 ? round2(Math.abs(totalCell)) : round2(taxable + tax + cess),
      ship_to: cellOf(row, cols, 'ship_to'),
      ship_from: cellOf(row, cols, 'ship_from'),
      buyer_gstin: cellOf(row, cols, 'buyer_gstin').toUpperCase(),
      buyer_name: cellOf(row, cols, 'buyer_name'),
      goods_returned: !/price|adjust|goodwill|concession|discount/.test(reason),
      damaged: /damag|unsellable|defect|broken/.test(reason),
    };
  });
}

/* ── Plan (preview / dry run) ───────────────────────────────────── */

export interface SalesContext {
  channel: SalesChannel;
  settings: AppSettings;
  templateId: string;
  catalogue: readonly CatalogueRow[];
  skuMap: readonly ChannelSku[];
  /** Existing documents (read-only). */
  invoices: readonly Pick<InvoiceRecord, 'id' | 'invoice_number' | 'doc_type' | 'status' | 'channel_id' | 'channel_order_id' | 'issue_date' | 'channel_order_ids' | 'notes'>[];
  /** True when a document dated `day` is inside the period lock. */
  isLocked: (day: string) => boolean;
  fileName?: string;
}

export interface PlannedDoc {
  key: string;
  record: InvoiceRecord;
  lines: number[];
  orderIds: string[];
  /** Credit notes: the original invoice (stored id, or the key of a document planned in this import). */
  originalId?: string;
  originalKey?: string;
  damaged?: boolean;
}

export interface RowNote {
  line: number;
  message: string;
}

export interface SalesPlan {
  rows: SalesRow[];
  docs: PlannedDoc[];
  /** Rows not imported, with the reason (cancellation, already imported, free replacement…). */
  skipped: RowNote[];
  /** Blocking per row (its document is left out): unmapped SKU, locked period, bad date, number used elsewhere. */
  errors: RowNote[];
  warnings: RowNote[];
  unmapped: ReturnType<typeof unmappedList>;
  counts: { invoices: number; creditNotes: number; already: number; cancelled: number; errors: number };
  totals: { taxable: number; igst: number; cgst: number; sgst: number; cess: number; total: number };
  /** Σ file total of the rows that become documents vs Σ document totals (to the paisa). */
  fileTotal: number;
  docsTotal: number;
  reconciled: boolean;
  period: { from: string; to: string };
}

const PLACEHOLDER_STATE = '';

function stateOf(text: string): { code: string; name: string } | undefined {
  return resolveStateText(text);
}

/** The profile issuing a ship-from state's invoices: one registered in that state, else the active profile. */
export function profileFor(settings: AppSettings, shipFromCode: string): SenderProfile | null {
  const profiles = settings.profiles ?? [];
  const active = profiles.find((p) => p.id === settings.activeProfileId) ?? profiles[0] ?? null;
  if (!shipFromCode) return active;
  return profiles.find((p) => senderStateCode(p) === shipFromCode) ?? active;
}

const docTypeFor = (r: SalesRow): DocumentType => (r.kind === 'return' ? 'CREDIT_NOTE' : isValidGstin(r.buyer_gstin) ? 'TAX_INVOICE' : 'INVOICE');

const SUMMARY_PREFIX = 'SUMMARY:';
const summaryKey = (day: string, pos: string, rate: number) => `${SUMMARY_PREFIX}${day}:${pos}:${rate}`;
const summaryNote = (channelName: string, ids: readonly string[]) => `Marketplace summary (${channelName}): ${ids.length} orders — ${ids.join(', ')}`;

/**
 * The order ids a stored summary document covers (QA6 F2): `channel_order_ids`, else read back from the summary note
 * of a document saved before that field existed. `null` when neither can be read (the note was edited).
 */
export function summaryOrderIds(doc: Pick<InvoiceRecord, 'channel_order_ids' | 'notes'>): string[] | null {
  if (Array.isArray(doc.channel_order_ids) && doc.channel_order_ids.length) return doc.channel_order_ids;
  const m = /^Marketplace summary \(.*\): (\d+) orders — (.+)$/.exec(doc.notes ?? '');
  if (!m) return null;
  const ids = m[2].split(', ').map((x) => x.trim()).filter(Boolean);
  return ids.length === Number(m[1]) ? ids : null;
}

/** Idempotency key: channel × order × kind × marketplace number. */
export const docKey = (channelId: string, orderId: string, docType: string, number: string) =>
  `${channelId}|${orderId.trim().toLowerCase()}|${docType === 'CREDIT_NOTE' ? 'cn' : 'inv'}|${numberKey(number)}`;

function totalsOf(rec: InvoiceRecord): InvoiceRecord {
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return {
    ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total,
    balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount,
  };
}

export function planSalesImport(table: FileTable, cols: ColumnMap, presetId: string, ctx: SalesContext, opts: { summary?: boolean } = {}): SalesPlan {
  const preset = salesPreset(presetId);
  const rows = normalizeSalesRows(table, cols, preset);
  const { channel } = ctx;
  const skipped: RowNote[] = [];
  const errors: RowNote[] = [];
  const warnings: RowNote[] = [];
  const unmappedRefs: { sku?: string; listingId?: string; title?: string }[] = [];
  const catalogueById = new Map(ctx.catalogue.filter((c) => c.id).map((c) => [c.id, c]));
  const existing = new Map<string, string>();
  const numbers = new Map<string, (typeof ctx.invoices)[number]>();
  for (const inv of ctx.invoices) {
    if (!inv?.invoice_number) continue;
    numbers.set(numberKey(inv.invoice_number), inv);
    if (inv.channel_id && inv.channel_order_id && inv.status !== 'Cancelled') existing.set(docKey(inv.channel_id, inv.channel_order_id, inv.doc_type, inv.invoice_number), inv.id);
  }
  // QA6 F2: orders a live summary document of this channel already covers (a per-order import must not book them
  // again, and vice versa), and the day × state × rate range of a summary whose order list cannot be read.
  const summaryOrders = new Map<string, string>();
  const summaryRanges = new Map<string, string>();
  for (const inv of ctx.invoices) {
    if (inv?.channel_id !== channel.id || !inv.channel_order_id?.startsWith(SUMMARY_PREFIX) || inv.status === 'Cancelled' || inv.doc_type === 'CREDIT_NOTE') continue;
    const ids = summaryOrderIds(inv);
    if (ids) for (const id of ids) summaryOrders.set(id.trim().toLowerCase(), inv.invoice_number);
    else summaryRanges.set(inv.channel_order_id, inv.invoice_number);
  }

  interface Group { key: string; type: DocumentType; number: string; rows: SalesRow[]; bad: boolean; summary: boolean }
  const groups = new Map<string, Group>();
  let already = 0;
  let cancelled = 0;
  let from = '';
  let to = '';

  for (const r of rows) {
    if (r.kind === 'cancel') {
      cancelled++;
      skipped.push({ line: r.line, message: `Order ${r.order_id || '?'} cancelled before invoicing — skipped.` });
      continue;
    }
    if (r.kind === 'skip' || (r.taxable === 0 && r.total === 0)) {
      skipped.push({ line: r.line, message: `Order ${r.order_id || '?'}: no value (free replacement / zero row) — skipped.` });
      continue;
    }
    if (!r.order_id) {
      errors.push({ line: r.line, message: 'No order id.' });
      continue;
    }
    if (!r.date) {
      errors.push({ line: r.line, message: `Order ${r.order_id}: no readable date.` });
      continue;
    }
    if (!from || r.date < from) from = r.date;
    if (!to || r.date > to) to = r.date;
    const type = docTypeFor(r);
    const number = r.invoice_no || `${preset.prefix}${r.kind === 'return' ? '-CN' : ''}/${r.order_id}`;
    if (!r.invoice_no) warnings.push({ line: r.line, message: `Order ${r.order_id}: the file has no ${r.kind === 'return' ? 'credit note' : 'invoice'} number — recorded as ${number} (verify with your CA).` });
    const k = docKey(channel.id, r.order_id, type, number);
    if (existing.has(k)) {
      already++;
      skipped.push({ line: r.line, message: `Order ${r.order_id} (${number}) already imported.` });
      continue;
    }
    if (type !== 'CREDIT_NOTE') {
      const inSummary = summaryOrders.get(r.order_id.trim().toLowerCase());
      if (inSummary) {
        already++;
        skipped.push({ line: r.line, message: `Order ${r.order_id} already imported in summary document ${inSummary}.` });
        continue;
      }
      if (type === 'INVOICE' && summaryRanges.size) {
        const pos = stateOf(r.ship_to)?.code ?? senderStateCode(profileFor(ctx.settings, stateOf(r.ship_from)?.code ?? ''));
        const covering = summaryRanges.get(summaryKey(r.date, pos, r.tax_rate));
        if (covering) {
          errors.push({ line: r.line, message: `Order ${r.order_id}: summary document ${covering} already covers ${r.date} · state ${pos || '?'} · GST ${r.tax_rate}% and its order list cannot be read — refused so the sale is not booked twice. Undo that import to re-import per order.` });
          continue;
        }
      }
    }
    const clash = numbers.get(numberKey(number));
    if (clash && !(clash.channel_id === channel.id && clash.status === 'Cancelled')) {
      errors.push({ line: r.line, message: `Number ${number} is already used by another document.` });
      continue;
    }
    const summary = !!opts.summary && type === 'INVOICE';
    const st = stateOf(r.ship_to)?.code ?? (isValidGstin(r.buyer_gstin) ? r.buyer_gstin.slice(0, 2) : PLACEHOLDER_STATE);
    const gk = summary ? `S|${type}|${st}|${r.tax_rate}|${r.date}` : `D|${k}`;
    let g = groups.get(gk);
    if (!g) {
      g = { key: gk, type, number: summary ? `${preset.prefix}/SUM/${r.date.replace(/-/g, '')}/${st || 'NA'}/${r.tax_rate}` : number, rows: [], bad: false, summary };
      groups.set(gk, g);
    }
    g.rows.push(r);
    if (ctx.isLocked(r.date)) {
      g.bad = true;
      errors.push({ line: r.line, message: `Order ${r.order_id}: ${r.date} is inside the period lock — refused.` });
    }
    const hit = lookupSku(ctx.skuMap, channel.id, { sku: r.sku, listingId: r.listing_id }, ctx.catalogue);
    if (!hit || !catalogueById.has(hit.item_id)) {
      g.bad = true;
      unmappedRefs.push({ sku: r.sku, listingId: r.listing_id, title: r.title });
      errors.push({ line: r.line, message: `SKU ${r.sku || r.listing_id || '?'} is not mapped to an item.` });
    } else {
      const item = catalogueById.get(hit.item_id)!;
      if (item.tax_rate !== undefined && item.tax_rate !== null && Number(item.tax_rate) !== r.tax_rate) {
        warnings.push({ line: r.line, message: `${item.name}: file GST ${r.tax_rate}% vs item ${Number(item.tax_rate)}% — check the HSN rate.` });
      }
    }
  }

  // Original invoices for credit notes: stored, or planned in this import.
  const plannedSaleByOrder = new Map<string, string>();
  for (const g of groups.values()) if (g.type !== 'CREDIT_NOTE' && !g.summary && !g.bad) plannedSaleByOrder.set(g.rows[0].order_id.toLowerCase(), g.key);
  const storedSaleByOrder = new Map<string, string>();
  for (const inv of ctx.invoices) {
    if (inv.channel_id === channel.id && inv.channel_order_id && inv.doc_type !== 'CREDIT_NOTE' && inv.status !== 'Cancelled') storedSaleByOrder.set(inv.channel_order_id.toLowerCase(), inv.id);
  }

  const docs: PlannedDoc[] = [];
  for (const g of groups.values()) {
    if (g.bad) continue;
    const first = g.rows[0];
    const shipFrom = stateOf(first.ship_from)?.code ?? '';
    const sender = profileFor(ctx.settings, shipFrom);
    const homeState = senderStateCode(sender);
    const pos = stateOf(first.ship_to)?.code ?? (isValidGstin(first.buyer_gstin) ? first.buyer_gstin.slice(0, 2) : homeState);
    const isB2B = isValidGstin(first.buyer_gstin);
    const stateName = stateByCode(pos)?.name ?? pos;
    const client: Client = isB2B
      ? { name: first.buyer_name || first.buyer_gstin, email: '', address: '', city: '', zip: '', gstin: first.buyer_gstin, state_code: first.buyer_gstin.slice(0, 2), state: stateByCode(first.buyer_gstin.slice(0, 2))?.name ?? '' }
      : { name: `${channel.name} customer — ${stateName}`, email: '', address: '', city: '', zip: '', state_code: pos, state: stateName };
    const damaged = g.type === 'CREDIT_NOTE' && g.rows.some((r) => r.damaged);
    const godown = g.type === 'CREDIT_NOTE' && damaged ? channel.damaged_godown_id || channel.godown_id : channel.godown_id;
    const items: InvoiceItem[] = g.rows.map((r, idx) => {
      const hit = lookupSku(ctx.skuMap, channel.id, { sku: r.sku, listingId: r.listing_id }, ctx.catalogue)!;
      const item = catalogueById.get(hit.item_id)!;
      const units = round2(r.qty * hit.qty_per_unit) || 1;
      return {
        id: `${idx}-${generateId()}`,
        name: item.name,
        description: g.summary ? '' : [r.sku && `SKU ${r.sku}`, r.listing_id].filter(Boolean).join(' · '),
        type: 'Product',
        hsn: r.hsn || item.hsn || '',
        unit: item.unit || 'NOS',
        quantity: units,
        rate: Math.round((r.taxable / units) * 1e6) / 1e6,
        tax_rate: r.tax_rate,
        discount_percent: 0,
        amount: r.taxable,
        ...(godown ? { godown_id: godown } : {}),
      };
    });
    const draft = makeDraft({ settings: ctx.settings, sender, docType: g.type, templateId: ctx.templateId });
    const gst_mode = deriveGstMode({ senderStateCode: homeState, placeOfSupply: pos, senderHasGstin: !!sender?.companyGstin?.trim(), taxEnabled: true });
    const orderIds = [...new Set(g.rows.map((r) => r.order_id))];
    const rec: InvoiceRecord = totalsOf({
      ...draft,
      invoice_number: g.number,
      doc_type: g.type,
      issue_date: first.date,
      due_date: first.date,
      status: 'Sent',
      client,
      items,
      gst_mode,
      place_of_supply: pos,
      round_off_enabled: false,
      round_mode: 'none',
      notes: g.summary
        ? summaryNote(channel.name, orderIds)
        : `Imported from the ${channel.name} report${ctx.fileName ? ` (${ctx.fileName})` : ''}. Order ${first.order_id}.`,
      terms: '',
      eco_gstin: operatorGstinFor(channel, shipFrom || homeState) || undefined,
      eco_section: channel.eco_section ?? 'TCS_52',
      channel_id: channel.id,
      channel_order_id: g.summary ? summaryKey(first.date, pos, first.tax_rate) : first.order_id,
      ...(g.summary ? { channel_order_ids: orderIds } : {}),
      ...(g.type === 'CREDIT_NOTE' ? { goods_returned: g.rows.some((r) => r.goods_returned) } : {}),
    });
    if (!rec.eco_gstin) delete rec.eco_gstin;
    const doc: PlannedDoc = { key: g.key, record: rec, lines: g.rows.map((r) => r.line), orderIds, ...(damaged ? { damaged } : {}) };
    if (g.type === 'CREDIT_NOTE') {
      const o = first.order_id.toLowerCase();
      const stored = storedSaleByOrder.get(o);
      const planned = plannedSaleByOrder.get(o);
      if (stored) doc.originalId = stored;
      else if (planned) doc.originalKey = planned;
      else warnings.push({ line: first.line, message: `Order ${first.order_id}: the original invoice is not in the books — the credit note is saved on its own.` });
    }
    docs.push(doc);
  }

  const inDocs = new Set(docs.flatMap((d) => d.lines));
  const fileTotal = round2(rows.filter((r) => inDocs.has(r.line)).reduce((s, r) => s + r.total, 0));
  const sum = (f: (r: InvoiceRecord) => number) => round2(docs.reduce((s, d) => s + num(f(d.record)), 0));
  const docsTotal = sum((r) => r.total);
  return {
    rows,
    docs,
    skipped,
    errors,
    warnings,
    unmapped: unmappedList(unmappedRefs),
    counts: {
      invoices: docs.filter((d) => d.record.doc_type !== 'CREDIT_NOTE').length,
      creditNotes: docs.filter((d) => d.record.doc_type === 'CREDIT_NOTE').length,
      already,
      cancelled,
      errors: errors.length,
    },
    totals: { taxable: sum((r) => r.taxable_value), igst: sum((r) => r.igst_amount), cgst: sum((r) => r.cgst_amount), sgst: sum((r) => r.sgst_amount), cess: sum((r) => r.cess_amount ?? 0), total: docsTotal },
    fileTotal,
    docsTotal,
    reconciled: Math.abs(fileTotal - docsTotal) < 0.005,
    period: { from, to },
  };
}

/* ── Apply / undo (storage) ─────────────────────────────────────── */

export class SalesImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SalesImportError';
  }
}

/** The import row (pure over the saved documents). */
export function importRecord(channel: SalesChannel, fileName: string, plan: SalesPlan, savedIds: string[], id: string, at: string, by?: string): MarketplaceImport {
  return {
    id,
    channel_id: channel.id,
    kind: 'sales',
    file_name: fileName,
    ...(plan.period.from ? { period_from: plan.period.from, period_to: plan.period.to } : {}),
    imported_at: at,
    ...(by ? { by } : {}),
    counts: { invoices: plan.counts.invoices, credit_notes: plan.counts.creditNotes, already: plan.counts.already, cancelled: plan.counts.cancelled, errors: plan.counts.errors },
    doc_ids: savedIds,
  };
}

/** A3 refund rows that brought goods back open a returns-desk row (pending receipt / check, A6). */
export function deskRowsFor(channel: SalesChannel, saved: readonly { doc: PlannedDoc; record: InvoiceRecord; originalId?: string }[], newId: () => string, at: string): MarketplaceReturn[] {
  return saved
    .filter((s) => s.record.doc_type === 'CREDIT_NOTE' && s.record.goods_returned)
    .map((s) => ({
      id: newId(),
      channel_id: channel.id,
      order_id: s.doc.orderIds[0] ?? '',
      ...(s.originalId ? { doc_id: s.originalId } : {}),
      credit_note_id: s.record.id,
      type: 'customer_return' as const,
      expected_on: s.record.issue_date,
      ...(s.doc.damaged ? { condition: 'damaged' as const } : {}),
      created_at: at,
    }));
}

/** The live context for a channel (read-only peeks). */
export function liveSalesContext(channel: SalesChannel, fileName?: string): SalesContext {
  return {
    channel,
    settings: localDb.settings.get(),
    templateId: localDb.template.get(),
    catalogue: peekTable<CatalogueRow>('items_catalog'),
    skuMap: loadSkuMap(channel.id),
    invoices: peekTable<InvoiceRecord>('invoices'),
    isLocked: (day) => isLocked({ issue_date: day }),
    ...(fileName ? { fileName } : {}),
  };
}

export const SALES_IMPORT_TABLES = ['invoices', 'transactions', 'doc_links', 'clients', 'items_catalog', MARKETPLACE_IMPORTS_TABLE, MARKETPLACE_RETURNS_TABLE] as const;

export interface SalesApplyResult {
  import: MarketplaceImport;
  saved: InvoiceRecord[];
}

/**
 * Save a plan's documents as ONE batch (all or nothing): invoices first, then credit notes linked to their
 * originals, the `marketplace_imports` row and returns-desk rows for goods returns. Rows with errors were already
 * left out by the plan.
 */
export function applySalesImport(channel: SalesChannel, plan: SalesPlan, fileName: string, by?: string): SalesApplyResult {
  requireAccess('doc.create');
  if (!plan.docs.length) throw new SalesImportError('Nothing to import.');
  const importId = generateId();
  const at = new Date().toISOString();
  return withTablesRollback(SALES_IMPORT_TABLES, () => {
    const byKey = new Map<string, InvoiceRecord>();
    const saved: { doc: PlannedDoc; record: InvoiceRecord; originalId?: string }[] = [];
    const ordered = [...plan.docs.filter((d) => d.record.doc_type !== 'CREDIT_NOTE'), ...plan.docs.filter((d) => d.record.doc_type === 'CREDIT_NOTE')];
    const links: { from_id: string; to_id: string }[] = [];
    for (const d of ordered) {
      const rec = localDb.invoices.save({ ...d.record, id: '', channel_import_id: importId });
      byKey.set(d.key, rec);
      const originalId = d.originalId ?? (d.originalKey ? byKey.get(d.originalKey)?.id : undefined);
      if (rec.doc_type === 'CREDIT_NOTE' && originalId) links.push({ from_id: originalId, to_id: rec.id });
      saved.push({ doc: d, record: rec, ...(originalId ? { originalId } : {}) });
    }
    if (links.length) {
      setTable('doc_links', [
        ...getTable('doc_links'),
        ...links.map((l) => ({ id: generateId(), ...l, relation: 'credit_note', reason: 'Marketplace return / refund', created_at: at })),
      ]);
      for (const l of links) resettleCreditedInvoices(l.to_id);
    }
    const row = importRecord(channel, fileName, plan, saved.map((s) => s.record.id), importId, at, by);
    setTable(MARKETPLACE_IMPORTS_TABLE, [...getTable<MarketplaceImport>(MARKETPLACE_IMPORTS_TABLE), row]);
    const desk = deskRowsFor(channel, saved, generateId, at);
    if (desk.length) setTable(MARKETPLACE_RETURNS_TABLE, [...getTable<MarketplaceReturn>(MARKETPLACE_RETURNS_TABLE), ...desk]);
    return { import: row, saved: saved.map((s) => s.record) };
  });
}

/**
 * Undo an import: every document it created is CANCELLED (never deleted), credit notes first. Refused — nothing
 * changes — when any of them has a payment recorded since.
 */
export function undoSalesImport(importId: string, reason = 'Marketplace import undone'): { cancelled: number } {
  requireAccess('doc.edit');
  const row = getTable<MarketplaceImport>(MARKETPLACE_IMPORTS_TABLE).find((r) => r.id === importId);
  if (!row) throw new SalesImportError('Import not found.');
  if (row.undone_at) throw new SalesImportError('This import was already undone.');
  const docs = (row.doc_ids ?? []).map((id) => localDb.invoices.getById(id)).filter((d): d is InvoiceRecord => !!d && d.status !== 'Cancelled');
  const paid = docs.find((d) => localDb.payments.listFor(d.id).length > 0);
  if (paid) throw new SalesImportError(`${paid.invoice_number} has a payment recorded — unpost the settlement or remove the payment first.`);
  return withTablesRollback(['invoices', 'transactions', 'doc_links', MARKETPLACE_IMPORTS_TABLE, MARKETPLACE_RETURNS_TABLE], () => {
    const order = [...docs.filter((d) => d.doc_type === 'CREDIT_NOTE'), ...docs.filter((d) => d.doc_type !== 'CREDIT_NOTE')];
    for (const d of order) cancelDocument(localDb.invoices.getById(d.id) ?? d, reason, { acknowledgeStock: true });
    const cnIds = new Set(order.filter((d) => d.doc_type === 'CREDIT_NOTE').map((d) => d.id));
    if (cnIds.size) setTable(MARKETPLACE_RETURNS_TABLE, getTable<MarketplaceReturn>(MARKETPLACE_RETURNS_TABLE).filter((r) => !(r.credit_note_id && cnIds.has(r.credit_note_id) && !r.received_on)));
    setTable(MARKETPLACE_IMPORTS_TABLE, getTable<MarketplaceImport>(MARKETPLACE_IMPORTS_TABLE).map((r) => (r.id === importId ? { ...r, undone_at: new Date().toISOString() } : r)));
    return { cancelled: order.length };
  });
}

export function loadImports(channelId?: string): readonly MarketplaceImport[] {
  const rows = peekTable<MarketplaceImport>(MARKETPLACE_IMPORTS_TABLE);
  return channelId ? rows.filter((r) => r.channel_id === channelId) : rows;
}
