/**
 * Invoice calculation engine — pure functions, no React, no storage.
 *
 * Order of operations (this is the GST-correct order):
 *   1. gross            = qty × rate
 *   2. line discount    = gross × line %          (per item)
 *   3. invoice discount = distributed across lines in proportion to (2)
 *   4. taxable value    = gross − line discount − allocated invoice discount
 *   5. GST              = taxable × line slab, split CGST/SGST or charged as IGST
 *   6. shipping / other charges are added after tax (not taxed)
 *   7. optional round-off (nearest / up / down) of the invoice value
 *
 * Extensions (all default off, legacy records are unaffected):
 *   - cess per line (ad valorem + fixed per unit), never split CGST/SGST
 *   - price_includes_tax: line amount is tax-inclusive, taxable is back-calculated
 *   - supply_type: SEZ/export without payment -> zero tax; with payment -> IGST
 *   - TCS: added to the invoice value (before round-off)
 *   - TDS: deducted from what the customer pays; invoice total unchanged
 */

import type {
  DiscountType,
  GstMode,
  InvoiceItem,
  RoundMode,
  SupplyType,
  TcsBase,
} from '../types/invoice';

export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Coerce anything that arrives from an <input> or legacy JSON into a finite number. */
export function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export interface CalcLine {
  id: string;
  name: string;
  hsn: string;
  unit: string;
  quantity: number;
  rate: number;
  tax_rate: number;
  cess_rate: number;
  cess_per_unit: number;
  /** Cess charged on this line. */
  cess: number;
  gross: number;
  line_discount: number;
  invoice_discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
}

export interface TaxSlabRow {
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
}

export interface HsnSummaryRow {
  hsn: string;
  rate: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
}

export interface CalcTotals {
  lines: CalcLine[];
  /** Sum of gross line amounts, before any discount. */
  subtotal: number;
  line_discount_total: number;
  invoice_discount_amount: number;
  /** line_discount_total + invoice_discount_amount */
  discount_amount: number;
  taxable_value: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  tax_amount: number;
  cess_amount: number;
  shipping: number;
  other_charges: number;
  tcs_amount: number;
  round_off: number;
  /** Invoice value (GST invoice total incl. TCS, after rounding). */
  total: number;
  tds_amount: number;
  /** total - tds_amount: what the customer actually owes in cash. */
  payable: number;
  amount_paid: number;
  /** payable - amount_paid. */
  balance_due: number;
  slabs: TaxSlabRow[];
  hsn_rows: HsnSummaryRow[];
}

export interface CalcInput {
  items: InvoiceItem[];
  gst_mode: GstMode;
  discount_type: DiscountType;
  /** Percent when discount_type is PERCENT, otherwise an absolute amount. */
  discount_rate: number;
  /** Fallback GST slab for items that carry no tax_rate of their own. */
  tax_rate: number;
  shipping: number;
  other_charges: number;
  round_off_enabled: boolean;
  amount_paid: number;
  round_mode?: RoundMode;
  price_includes_tax?: boolean;
  supply_type?: SupplyType;
  tcs_enabled?: boolean;
  tcs_rate?: number;
  tcs_base?: TcsBase;
  tds_enabled?: boolean;
  tds_rate?: number;
  tds_on_taxable?: boolean;
}

/** True when any line carries cess — UIs show a cess column only then. */
export function hasAnyCess(items: InvoiceItem[]): boolean {
  return items.some((i) => num(i.cess_rate) > 0 || num(i.cess_per_unit) > 0);
}

/** Supplies charged no tax at all. */
export function isZeroRated(t?: SupplyType): boolean {
  return t === 'SEZ_WITHOUT_PAYMENT' || t === 'EXPORT_LUT';
}
/** Zero-rated supplies where IGST is charged and refunded later. */
export function isIgstZeroRated(t?: SupplyType): boolean {
  return t === 'SEZ_WITH_PAYMENT' || t === 'EXPORT_WITH_PAYMENT';
}

export function resolveRoundMode(mode: RoundMode | undefined, enabled: boolean): RoundMode {
  if (mode === 'nearest' || mode === 'up' || mode === 'down' || mode === 'none') return mode;
  return enabled ? 'nearest' : 'none';
}

export function applyRounding(value: number, mode: RoundMode): number {
  if (mode === 'nearest') return Math.round(value);
  if (mode === 'up') return Math.ceil(round2(value));
  if (mode === 'down') return Math.floor(round2(value));
  return value;
}

export const EMPTY_TOTALS: CalcTotals = {
  lines: [],
  subtotal: 0,
  line_discount_total: 0,
  invoice_discount_amount: 0,
  discount_amount: 0,
  taxable_value: 0,
  cgst_amount: 0,
  sgst_amount: 0,
  igst_amount: 0,
  tax_amount: 0,
  cess_amount: 0,
  shipping: 0,
  other_charges: 0,
  tcs_amount: 0,
  round_off: 0,
  total: 0,
  tds_amount: 0,
  payable: 0,
  amount_paid: 0,
  balance_due: 0,
  slabs: [],
  hsn_rows: [],
};

/**
 * Intra-state supply (same state code) is CGST + SGST; anything else is IGST.
 * With no GSTIN on the sender there is no GST to charge at all.
 */
export function deriveGstMode(opts: {
  senderStateCode?: string;
  placeOfSupply?: string;
  senderHasGstin: boolean;
  taxEnabled: boolean;
}): GstMode {
  if (!opts.taxEnabled) return 'NONE';
  if (!opts.senderHasGstin) return 'NONE';
  const from = (opts.senderStateCode ?? '').trim();
  const to = (opts.placeOfSupply ?? '').trim();
  if (!from || !to) return 'CGST_SGST';
  return from === to ? 'CGST_SGST' : 'IGST';
}

/**
 * Split an amount of tax into the CGST/SGST/IGST buckets for the given mode.
 * SINGLE (legacy one-line "Tax") rides in the IGST bucket; only the label the
 * renderer prints differs.
 */
function splitTax(tax: number, mode: GstMode): { cgst: number; sgst: number; igst: number } {
  if (mode === 'IGST' || mode === 'SINGLE') return { cgst: 0, sgst: 0, igst: round2(tax) };
  if (mode === 'CGST_SGST') {
    const half = round2(tax / 2);
    // Give any odd paisa to CGST so the two halves always re-sum to `tax`.
    return { cgst: round2(tax - half), sgst: half, igst: 0 };
  }
  return { cgst: 0, sgst: 0, igst: 0 };
}

export function calculateInvoice(input: CalcInput): CalcTotals {
  const items = input.items ?? [];
  const fallbackRate = num(input.tax_rate);
  const baseMode: GstMode = input.gst_mode ?? 'NONE';
  const zeroRated = isZeroRated(input.supply_type);
  const taxMode: GstMode = zeroRated
    ? 'NONE'
    : isIgstZeroRated(input.supply_type) && baseMode !== 'NONE' && baseMode !== 'SINGLE'
      ? 'IGST'
      : baseMode;
  const inclusive = Boolean(input.price_includes_tax);

  // ── Steps 1–2: gross and per-line discount ────────────────────
  const staged = items.map((item) => {
    const quantity = num(item.quantity);
    const rate = num(item.rate);
    const gross = round2(quantity * rate);
    const linePct = Math.min(Math.max(num(item.discount_percent), 0), 100);
    const line_discount = round2(gross * (linePct / 100));
    const taxRate =
      typeof item.tax_rate === 'number' && Number.isFinite(item.tax_rate)
        ? item.tax_rate
        : fallbackRate;
    return {
      item,
      quantity,
      rate,
      gross,
      line_discount,
      net: round2(gross - line_discount),
      tax_rate: zeroRated || taxMode === 'NONE' ? 0 : Math.max(num(taxRate), 0),
      cess_rate: taxMode === 'NONE' ? 0 : Math.max(num(item.cess_rate), 0),
      cess_per_unit: taxMode === 'NONE' ? 0 : Math.max(num(item.cess_per_unit), 0),
    };
  });

  const subtotal = round2(staged.reduce((s, l) => s + l.gross, 0));
  const line_discount_total = round2(staged.reduce((s, l) => s + l.line_discount, 0));
  const netBase = round2(staged.reduce((s, l) => s + l.net, 0));

  // ── Step 3: invoice-level discount, capped at the net base ────
  const rawInvoiceDiscount =
    input.discount_type === 'AMOUNT'
      ? num(input.discount_rate)
      : netBase * (Math.min(Math.max(num(input.discount_rate), 0), 100) / 100);
  const invoice_discount_amount = round2(Math.min(Math.max(rawInvoiceDiscount, 0), netBase));

  const allocations = allocateProportionally(
    staged.map((l) => l.net),
    invoice_discount_amount,
  );

  // ── Steps 4–5: taxable value and GST per line ─────────────────
  const lines: CalcLine[] = staged.map((l, i) => {
    const net = round2(l.net - allocations[i]);
    const fixedCess = round2(l.quantity * l.cess_per_unit);
    let taxable: number;
    let cess: number;
    let tax: number;
    if (inclusive && (l.tax_rate > 0 || l.cess_rate > 0 || fixedCess > 0)) {
      // `net` already contains GST + cess: back-calculate, then let GST absorb
      // the paise drift so taxable + gst + cess == net exactly.
      taxable = round2(Math.max(net - fixedCess, 0) / (1 + (l.tax_rate + l.cess_rate) / 100));
      cess = round2(taxable * (l.cess_rate / 100) + fixedCess);
      tax = round2(net - taxable - cess);
    } else {
      taxable = net;
      cess = round2(taxable * (l.cess_rate / 100) + fixedCess);
      tax = round2(taxable * (l.tax_rate / 100));
    }
    const parts = splitTax(tax, taxMode);
    return {
      id: l.item.id,
      name: l.item.name ?? '',
      hsn: (l.item.hsn ?? '').trim(),
      unit: (l.item.unit ?? '').trim(),
      quantity: l.quantity,
      rate: l.rate,
      tax_rate: l.tax_rate,
      cess_rate: l.cess_rate,
      cess_per_unit: l.cess_per_unit,
      cess,
      gross: l.gross,
      line_discount: l.line_discount,
      invoice_discount: allocations[i],
      taxable,
      cgst: parts.cgst,
      sgst: parts.sgst,
      igst: parts.igst,
      tax: round2(parts.cgst + parts.sgst + parts.igst),
      total: round2(taxable + parts.cgst + parts.sgst + parts.igst + cess),
    };
  });

  const taxable_value = round2(lines.reduce((s, l) => s + l.taxable, 0));
  const cgst_amount = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgst_amount = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const igst_amount = round2(lines.reduce((s, l) => s + l.igst, 0));
  const tax_amount = round2(cgst_amount + sgst_amount + igst_amount);
  const cess_amount = round2(lines.reduce((s, l) => s + l.cess, 0));

  // ── Steps 6–7: extra charges and round-off ────────────────────
  const shipping = round2(Math.max(num(input.shipping), 0));
  const other_charges = round2(num(input.other_charges));
  const beforeTcs = round2(taxable_value + tax_amount + cess_amount + shipping + other_charges);
  const tcsRate = input.tcs_enabled ? Math.max(num(input.tcs_rate), 0) : 0;
  const tcsBase = input.tcs_base === 'taxable' ? taxable_value : beforeTcs;
  const tcs_amount = round2(tcsBase * (tcsRate / 100));
  const beforeRounding = round2(beforeTcs + tcs_amount);
  const total = applyRounding(beforeRounding, resolveRoundMode(input.round_mode, input.round_off_enabled));
  const round_off = round2(total - beforeRounding);

  // TDS is a deduction from what the customer pays; it never changes `total`.
  const tdsRate = input.tds_enabled ? Math.max(num(input.tds_rate), 0) : 0;
  const tdsBase = input.tds_on_taxable === false ? total : taxable_value;
  const tds_amount = round2(tdsBase * (tdsRate / 100));
  const payable = round2(total - tds_amount);

  const amount_paid = round2(Math.max(num(input.amount_paid), 0));

  return {
    lines,
    subtotal,
    line_discount_total,
    invoice_discount_amount,
    discount_amount: round2(line_discount_total + invoice_discount_amount),
    taxable_value,
    cgst_amount,
    sgst_amount,
    igst_amount,
    tax_amount,
    cess_amount,
    shipping,
    other_charges,
    tcs_amount,
    round_off,
    total,
    tds_amount,
    payable,
    amount_paid,
    balance_due: round2(payable - amount_paid),
    slabs: buildSlabs(lines),
    hsn_rows: buildHsnRows(lines),
  };
}

/**
 * Split `amount` across `weights` so the parts are proportional AND sum back
 * to exactly `amount` (the largest weight absorbs the rounding remainder).
 */
export function allocateProportionally(weights: number[], amount: number): number[] {
  const out = weights.map(() => 0);
  const base = weights.reduce((s, w) => s + Math.max(w, 0), 0);
  if (amount <= 0 || base <= 0) return out;

  let assigned = 0;
  let biggest = 0;
  for (let i = 0; i < weights.length; i++) {
    const part = round2((amount * Math.max(weights[i], 0)) / base);
    out[i] = part;
    assigned = round2(assigned + part);
    if (Math.max(weights[i], 0) > Math.max(weights[biggest], 0)) biggest = i;
  }
  const drift = round2(amount - assigned);
  if (drift !== 0) out[biggest] = round2(out[biggest] + drift);
  return out;
}

function buildSlabs(lines: CalcLine[]): TaxSlabRow[] {
  const map = new Map<number, TaxSlabRow>();
  for (const l of lines) {
    if (l.taxable === 0 && l.tax === 0) continue;
    const row =
      map.get(l.tax_rate) ??
      { rate: l.tax_rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0 };
    row.taxable = round2(row.taxable + l.taxable);
    row.cgst = round2(row.cgst + l.cgst);
    row.sgst = round2(row.sgst + l.sgst);
    row.igst = round2(row.igst + l.igst);
    row.tax = round2(row.tax + l.tax);
    map.set(l.tax_rate, row);
  }
  return [...map.values()].sort((a, b) => a.rate - b.rate);
}

function buildHsnRows(lines: CalcLine[]): HsnSummaryRow[] {
  const map = new Map<string, HsnSummaryRow>();
  for (const l of lines) {
    if (l.taxable === 0 && l.tax === 0) continue;
    const hsn = l.hsn || '—';
    const key = `${hsn}@${l.tax_rate}`;
    const row =
      map.get(key) ??
      { hsn, rate: l.tax_rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0 };
    row.taxable = round2(row.taxable + l.taxable);
    row.cgst = round2(row.cgst + l.cgst);
    row.sgst = round2(row.sgst + l.sgst);
    row.igst = round2(row.igst + l.igst);
    row.tax = round2(row.tax + l.tax);
    row.total = round2(row.total + l.total);
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rate - b.rate);
}
