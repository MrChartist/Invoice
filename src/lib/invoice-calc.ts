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
  InvoiceRecord,
  RoundMode,
  SupplyType,
  TcsBase,
} from '../types/invoice';

/**
 * Round to paise, half AWAY from zero (so -2.345 and 2.345 round symmetrically,
 * which keeps a credit note's rounding the exact mirror of its invoice's).
 *
 * The scaled-exponent trick (`1.005e2` -> 100.5 exactly) avoids the classic
 * `1.005 * 100 = 100.49999999999999` binary-float error, which `+ EPSILON`
 * cannot fix once the magnitude is above ~1.
 */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const abs = Math.abs(n);
  const s = String(abs);
  // Exponent-form strings (1e-7, 1.5e+21) cannot take the "e2" suffix.
  const scaled = s.includes('e') ? abs * 100 : Number(`${s}e2`);
  const r = Number(`${Math.round(scaled)}e-2`);
  return n < 0 && r !== 0 ? -r : r;
}

/** Coerce anything that arrives from an <input> or legacy JSON into a finite number. */
export function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

/* ── Exact decimal arithmetic ─────────────────────────────────────────────
 * `round2(a * b)` is NOT enough for money: 11 x 0.015 is 0.16499999999999998 in
 * binary floating point, so a tax of exactly 16.5 paise rounds DOWN to 0.16 where
 * every accountant (and GSTN) rounds half up to 0.17. About one tax computation
 * in a thousand lands on such an exact half-paisa. These helpers multiply the
 * DECIMAL values the user typed (their shortest string form) as BigInt integers
 * and round half away from zero exactly. */

type Scaled = { n: bigint; s: number };

/** x as an exact decimal `n / 10^s`, or null for non-finite / exponent-form numbers. */
function scaled(x: number): Scaled | null {
  if (!Number.isFinite(x)) return null;
  const str = String(x);
  if (str.includes('e') || str.includes('E')) return null;
  const neg = str.startsWith('-');
  const body = neg ? str.slice(1) : str;
  const dot = body.indexOf('.');
  const digits = dot < 0 ? body : body.slice(0, dot) + body.slice(dot + 1);
  const n = BigInt(digits);
  return { n: neg ? -n : n, s: dot < 0 ? 0 : body.length - dot - 1 };
}

/** n / d (d > 0) rounded half away from zero. */
function divHalfAway(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return neg ? -q : q;
}

/** round2(a * b / divisor), computed exactly. `divisor` must be a positive integer (1 or 100). */
export function mulRound2(a: number, b: number, divisor = 1): number {
  const A = scaled(a);
  const B = scaled(b);
  if (!A || !B) return round2((a * b) / divisor);
  const numerator = A.n * B.n * 100n;
  const denominator = 10n ** BigInt(A.s + B.s) * BigInt(divisor);
  return Number(divHalfAway(numerator, denominator)) / 100;
}

/** round2(amount x pct / 100) — "pct percent of amount", exactly. */
export function pctOf(amount: number, pct: number): number {
  return mulRound2(amount, pct, 100);
}

/** round2(amount / (1 + ratePct / 100)) — backs a tax-inclusive amount out to its base, exactly. */
export function backOutPct(amount: number, ratePct: number): number {
  const A = scaled(amount);
  const R = scaled(Number(ratePct.toFixed(6)));
  if (!A || !R) return round2(amount / (1 + ratePct / 100));
  const scale = 10n ** BigInt(R.s);
  const numerator = A.n * 100n * 100n * scale;
  const denominator = 10n ** BigInt(A.s) * (100n * scale + R.n);
  return Number(divHalfAway(numerator, denominator)) / 100;
}

export interface CalcLine {
  id: string;
  name: string;
  hsn: string;
  unit: string;
  quantity: number;
  rate: number;
  tax_rate: number;
  /**
   * The GST slab the line was priced at, kept even when the supply is
   * zero-rated (SEZ / export under LUT) and `tax_rate` is forced to 0. GSTR-1
   * needs it to report zero-rated taxable value against the right rate.
   */
  nominal_rate: number;
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

/**
 * Build the full calculator input from a stored record. Every module that
 * re-derives money from a record (GST reports, e-Invoice, e-Way, Tally,
 * exports, credit notes, recurring) goes through here so none of them can
 * silently drop supply type, tax-inclusive pricing, TCS/TDS or round mode.
 * `over` wins over the record (e.g. `{ amount_paid: 0, gst_mode }`).
 */
export function calcInputFromRecord(
  rec: Partial<InvoiceRecord>,
  over: Partial<CalcInput> = {},
): CalcInput {
  return {
    items: rec.items ?? [],
    gst_mode: rec.gst_mode ?? 'NONE',
    discount_type: rec.discount_type ?? 'PERCENT',
    discount_rate: num(rec.discount_rate),
    tax_rate: num(rec.tax_rate),
    shipping: num(rec.shipping),
    other_charges: num(rec.other_charges),
    round_off_enabled: !!rec.round_off_enabled,
    amount_paid: num(rec.amount_paid),
    round_mode: rec.round_mode,
    price_includes_tax: !!rec.price_includes_tax,
    supply_type: rec.supply_type,
    tcs_enabled: !!rec.tcs_enabled,
    tcs_rate: num(rec.tcs_rate),
    tcs_base: rec.tcs_base,
    tds_enabled: !!rec.tds_enabled,
    tds_rate: num(rec.tds_rate),
    tds_on_taxable: rec.tds_on_taxable,
    ...over,
  };
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
  // 'nearest' rounds .50 away from zero, consistently for negative documents.
  if (mode === 'nearest') {
    const r = Math.round(Math.abs(round2(value)));
    return value < 0 && r !== 0 ? -r : r;
  }
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
    // The half is rounded UP (away from zero), so a lone odd paisa lands on SGST and
    // the two parts always re-sum to `tax` exactly.
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
    const gross = mulRound2(quantity, rate);
    const linePct = Math.min(Math.max(num(item.discount_percent), 0), 100);
    const line_discount = pctOf(gross, linePct);
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
      nominal_rate: Math.max(num(taxRate), 0),
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
      : pctOf(netBase, Math.min(Math.max(num(input.discount_rate), 0), 100));
  const invoice_discount_amount = round2(Math.min(Math.max(rawInvoiceDiscount, 0), Math.max(netBase, 0)));

  const allocations = allocateProportionally(
    staged.map((l) => l.net),
    invoice_discount_amount,
  );

  // ── Steps 4–5: taxable value and GST per line ─────────────────
  const lines: CalcLine[] = staged.map((l, i) => {
    const net = round2(l.net - allocations[i]);
    const fixedCess = mulRound2(l.quantity, l.cess_per_unit);
    let taxable: number;
    let cess: number;
    let tax: number;
    if (inclusive && (l.tax_rate > 0 || l.cess_rate > 0 || fixedCess > 0)) {
      // `net` already contains GST + cess: back-calculate, then let GST absorb
      // the paise drift so taxable + gst + cess == net exactly.
      taxable = backOutPct(Math.max(net - fixedCess, 0), l.tax_rate + l.cess_rate);
      cess = round2(pctOf(taxable, l.cess_rate) + fixedCess);
      tax = round2(net - taxable - cess);
    } else {
      taxable = net;
      cess = round2(pctOf(taxable, l.cess_rate) + fixedCess);
      tax = pctOf(taxable, l.tax_rate);
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
      nominal_rate: l.nominal_rate,
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
  const tcs_amount = pctOf(tcsBase, tcsRate);
  const beforeRounding = round2(beforeTcs + tcs_amount);
  const total = applyRounding(beforeRounding, resolveRoundMode(input.round_mode, input.round_off_enabled));
  const round_off = round2(total - beforeRounding);

  // TDS is a deduction from what the customer pays; it never changes `total`.
  const tdsRate = input.tds_enabled ? Math.max(num(input.tds_rate), 0) : 0;
  const tdsBase = input.tds_on_taxable === false ? total : taxable_value;
  const tds_amount = pctOf(tdsBase, tdsRate);
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
  const w = weights.map((x) => Math.max(x, 0));
  const base = round2(w.reduce((sum, x) => sum + x, 0));
  if (!(amount > 0) || !(base > 0)) return out;

  // Integer paise + exact rational rounding: shares never drift by a paisa from float error.
  const P = (x: number) => BigInt(Math.round(round2(x) * 100));
  const amountP = P(amount);
  const baseP = P(base);
  let assigned = 0n;
  let biggest = 0;
  const parts: bigint[] = w.map((x, i) => {
    const part = baseP > 0n ? divHalfAway(amountP * P(x), baseP) : 0n;
    assigned += part;
    if (x > w[biggest]) biggest = i;
    return part;
  });
  // the largest weight absorbs the rounding remainder so the shares re-sum EXACTLY
  parts[biggest] += amountP - assigned;
  return parts.map((p) => Number(p) / 100);
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
