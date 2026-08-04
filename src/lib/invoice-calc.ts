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
 *   7. optional round-off to the nearest whole unit
 */

import type { DiscountType, GstMode, InvoiceItem } from '../types/invoice';

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
  shipping: number;
  other_charges: number;
  round_off: number;
  total: number;
  amount_paid: number;
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
  shipping: 0,
  other_charges: 0,
  round_off: 0,
  total: 0,
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
  const taxMode: GstMode = input.gst_mode ?? 'NONE';

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
      tax_rate: Math.max(num(taxRate), 0),
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
    const taxable = round2(l.net - allocations[i]);
    const tax = round2(taxable * (l.tax_rate / 100));
    const parts = splitTax(tax, taxMode);
    return {
      id: l.item.id,
      name: l.item.name ?? '',
      hsn: (l.item.hsn ?? '').trim(),
      unit: (l.item.unit ?? '').trim(),
      quantity: l.quantity,
      rate: l.rate,
      tax_rate: l.tax_rate,
      gross: l.gross,
      line_discount: l.line_discount,
      invoice_discount: allocations[i],
      taxable,
      cgst: parts.cgst,
      sgst: parts.sgst,
      igst: parts.igst,
      tax: round2(parts.cgst + parts.sgst + parts.igst),
      total: round2(taxable + parts.cgst + parts.sgst + parts.igst),
    };
  });

  const taxable_value = round2(lines.reduce((s, l) => s + l.taxable, 0));
  const cgst_amount = round2(lines.reduce((s, l) => s + l.cgst, 0));
  const sgst_amount = round2(lines.reduce((s, l) => s + l.sgst, 0));
  const igst_amount = round2(lines.reduce((s, l) => s + l.igst, 0));
  const tax_amount = round2(cgst_amount + sgst_amount + igst_amount);

  // ── Steps 6–7: extra charges and round-off ────────────────────
  const shipping = round2(Math.max(num(input.shipping), 0));
  const other_charges = round2(num(input.other_charges));
  const beforeRounding = round2(taxable_value + tax_amount + shipping + other_charges);
  const total = input.round_off_enabled ? Math.round(beforeRounding) : beforeRounding;
  const round_off = round2(total - beforeRounding);

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
    shipping,
    other_charges,
    round_off,
    total,
    amount_paid,
    balance_due: round2(total - amount_paid),
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
