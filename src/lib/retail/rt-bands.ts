/**
 * RT-C1 price-band GST (garments, made-ups, footwear): the rate depends on the taxable value per piece / pair — from
 * 22 Sep 2025 ≤ ₹2,500 → 5%, above → 18% (earlier date-keyed rows in `retail-rules.ts` `PRICE_BAND_RULES`). The value
 * per piece is the line's value after its own discount and its pro-rata share of an invoice discount (offer, loyalty,
 * voucher), divided by the pieces (quantity × the line unit's factor, so a "3 for ₹1,999" pack counts 3). With
 * tax-inclusive (MRP) prices the band is solved without a loop: the lower band if MRP ÷ (1 + low rate) ≤ the limit,
 * else the higher one. The line keeps the snapshot `band_rate` and its `tax_rate` (so every calc reader is unchanged);
 * a rate the user types makes the line `manual`; credit / debit notes keep the original line's rate. Pure, except the
 * live lookup at the end (`setBands`, the write, is in `rt-matrix.ts`). Working paper — verify with your CA (RT1, RT2).
 */
import { PRICE_BAND_RULES, type PriceBand, type PriceBandKind } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { calcInputFromRecord, calculateInvoice, num, round2, type CalcLine } from '../invoice-calc';
import { lineFactor } from '../units';
import { peekTable } from '../storage';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { BandRate } from '../../types/retail-r9';

export const BAND_KINDS: readonly PriceBandKind[] = ['apparel', 'footwear', 'made_ups'];
/** "Near the limit" for the exceptions view (₹ per piece). */
export const BAND_EDGE = 50;

export const bandAt = (kind: PriceBandKind, date?: string): PriceBand => ruleAt(PRICE_BAND_RULES[kind], date);

/** The band rate for a value per piece: `inclusive` = the value still contains GST (MRP pricing). */
export function bandRate(kind: PriceBandKind, perPiece: number, date: string, inclusive = false): { rate: number; value_per_piece: number } {
  const b = bandAt(kind, date);
  const low = round2(inclusive ? perPiece / (1 + b.rate / 100) : perPiece);
  if (low <= b.upTo) return { rate: b.rate, value_per_piece: low };
  return { rate: b.above, value_per_piece: round2(inclusive ? perPiece / (1 + b.above / 100) : perPiece) };
}

/** Bulk default by HSN chapter: 61 / 62 garments, 63 made-ups, 64 footwear. */
export function bandForHsn(hsn: unknown): PriceBandKind | undefined {
  const ch = String(hsn ?? '').trim().slice(0, 2);
  return ch === '61' || ch === '62' ? 'apparel' : ch === '63' ? 'made_ups' : ch === '64' ? 'footwear' : undefined;
}

export type BandLookup = (line: Pick<InvoiceItem, 'name'>) => PriceBandKind | undefined;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

/** Item name → band from stock items / catalogue rows that carry `gst_band`. */
export function bandLookup(rows: readonly { name?: string; gst_band?: PriceBandKind }[]): BandLookup {
  const m = new Map<string, PriceBandKind>();
  for (const r of rows) if (r?.gst_band && r.name && !m.has(norm(r.name))) m.set(norm(r.name), r.gst_band);
  return (l) => (m.size ? m.get(norm(l.name)) : undefined);
}

type BandDoc = Partial<InvoiceRecord> & Pick<InvoiceRecord, 'items'>;
const noBands = (rec: BandDoc) => rec.doc_type === 'CREDIT_NOTE' || rec.doc_type === 'DEBIT_NOTE' || rec.doc_type === 'BILL_OF_SUPPLY' || rec.gst_mode === 'NONE';

/** Value per piece after discounts (incl. the invoice discount share) of each calc line, by line id. */
function perPieceOf(rec: BandDoc): Map<string, { line: CalcLine; perPiece: number; grossPerPiece: number }> {
  const calc = calculateInvoice(calcInputFromRecord(rec));
  const out = new Map<string, { line: CalcLine; perPiece: number; grossPerPiece: number }>();
  for (const l of calc.lines) {
    const it = rec.items.find((i) => i.id === l.id);
    const pieces = num(l.quantity) * lineFactor(it);
    if (pieces > 0) out.set(l.id, { line: l, perPiece: (l.gross - l.line_discount - l.invoice_discount) / pieces, grossPerPiece: l.gross / pieces });
  }
  return out;
}

/**
 * Lines with their band decided. Lines carry a band through `band_rate` (set when a banded item is picked / scanned,
 * `value_per_piece` 0 and no `rate` until decided) or, with `kindOf`, by their item (the POS). Returns the same array
 * when nothing changes.
 */
export function syncBands(rec: BandDoc, kindOf?: BandLookup): InvoiceItem[] {
  const items = rec.items ?? [];
  if (noBands(rec) || !items.some((i) => i.band_rate || kindOf?.(i))) return items;
  const per = perPieceOf(rec);
  const date = String(rec.issue_date ?? '').slice(0, 10);
  let changed = false;
  const out = items.map((it) => {
    const snap = it.band_rate;
    if (snap?.manual || it.free_of) return it;
    // A rate typed on the line wins: the band no longer sets it.
    if (snap && snap.rate !== undefined && num(it.tax_rate) !== snap.rate) {
      changed = true;
      return { ...it, band_rate: { ...snap, manual: true as const } };
    }
    const kind = snap?.kind ?? kindOf?.(it);
    const p = kind ? per.get(it.id) : undefined;
    if (!kind || !p) return it;
    const b = bandRate(kind, p.perPiece, date, !!rec.price_includes_tax);
    if (it.tax_rate === b.rate && snap?.rate === b.rate && snap.value_per_piece === b.value_per_piece && snap.kind === kind) return it;
    changed = true;
    const next: BandRate = { kind, value_per_piece: b.value_per_piece, rate: b.rate };
    return { ...it, tax_rate: b.rate, band_rate: next };
  });
  return changed ? out : items;
}

/** A band line of a saved document, for the chip and the exceptions view. */
export interface BandFinding {
  code: 'BAND_RATE' | 'BAND_EDGE' | 'BAND_DISCOUNT';
  vars: Record<string, string | number>;
}

/**
 * Exceptions of one document: a stored rate that differs from the band (edited / typed), a value within ₹50 of the
 * limit, and a band decided by a discount (the price before discounts falls in the other band).
 */
export function bandExceptions(rec: BandDoc, kindOf?: BandLookup): BandFinding[] {
  if (noBands(rec)) return [];
  const lines = (rec.items ?? []).filter((i) => i.band_rate || kindOf?.(i));
  if (!lines.length) return [];
  const per = perPieceOf(rec);
  const date = String(rec.issue_date ?? '').slice(0, 10);
  const out: BandFinding[] = [];
  for (const it of lines) {
    const kind = it.band_rate?.kind ?? kindOf?.(it);
    const p = kind ? per.get(it.id) : undefined;
    if (!kind || !p) continue;
    const inc = !!rec.price_includes_tax;
    const b = bandRate(kind, p.perPiece, date, inc);
    const lim = bandAt(kind, date).upTo;
    const vars = { name: it.name, value: b.value_per_piece, limit: lim, rate: num(it.tax_rate), band: b.rate };
    if (num(it.tax_rate) !== b.rate) out.push({ code: 'BAND_RATE', vars });
    if (Math.abs(b.value_per_piece - lim) <= BAND_EDGE) out.push({ code: 'BAND_EDGE', vars });
    if (p.grossPerPiece !== p.perPiece && bandRate(kind, p.grossPerPiece, date, inc).rate !== b.rate) out.push({ code: 'BAND_DISCOUNT', vars });
  }
  // One row per code and document (the first line found), like the other exceptions.
  return out.filter((f, i) => out.findIndex((g) => g.code === f.code) === i);
}

/* ── Live (read-only views of the stock items and the catalogue) ── */

let cache: { a: unknown; b: unknown; fn: BandLookup } | null = null;
/** Band lookup over the live stock items + catalogue (re-built only when either table changed). */
export function liveBandLookup(): BandLookup {
  const a = peekTable<{ name?: string; gst_band?: PriceBandKind }>('stock_items');
  const b = peekTable<{ name?: string; gst_band?: PriceBandKind }>('items_catalog');
  if (!cache || cache.a !== a || cache.b !== b) cache = { a, b, fn: bandLookup([...a, ...b]) };
  return cache.fn;
}

/** The exceptions-view hook (`gst-guards.ts` loads this lazily). */
export const liveBandExceptions = (inv: InvoiceRecord): BandFinding[] => bandExceptions(inv, liveBandLookup());
