/**
 * MF-B2 weight-based job quotes (table `job_quotes`, `doc.create`, dated `date`). A quote sheet prices one part:
 * material (gross kg × rate), operations (hours × machine-hour rate, set-up hours amortised over the quantity break),
 * outside processing (₹ / kg of the net part or ₹ / piece), packing, freight, less the scrap credit (scrap kg × scrap
 * rate), plus overhead % and margin %. Price per piece for 2–4 quantity breaks.
 *
 * "Make quotation" saves one QUOTATION draft per break (existing document type), each line carrying the drawing /
 * revision in the `mf` snapshot (conversions keep it). A won quote hands over its material rate to the material item's
 * dated `standard_costs`. Pure maths above the "Storage" divider (tests/mf-quotes.test.ts).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { JobQuote } from '../../types/mfg-r13';
import type { StockItem } from '../inventory';
import { stockDb } from '../inventory';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { num } from '../invoice-calc';
import { mfSnapshot } from './mf-snapshot';
import { MF_TABLES } from './mf-shared';
import { DAY, drop, mustGet, nowIso, put, r2, r3, rowsOf } from './mf-b-db';
import { partWeights } from './mf-weight';
import { clientOf, mfDraft, mfLine, saveDraft } from './mf-b-docs';

export const QUOTES_TABLE = MF_TABLES.quotes;

export interface QuoteBreak {
  qty: number;
  gross_kg: number;
  net_kg: number;
  scrap_kg: number;
  material: number;
  conversion: number;
  setup: number;
  outside: number;
  extras: number;
  scrap_credit: number;
  overhead: number;
  cost: number;
  /** Price per piece (cost + margin), 2 decimals. */
  price: number;
  total: number;
}

/** Per-piece price of one quantity break (set-up hours spread over `qty`). */
export function quoteBreak(q: Omit<JobQuote, 'id' | 'status'>, qty: number): QuoteBreak {
  const n = Math.max(num(qty), 1);
  const w = partWeights(q.blank, q.density, q.finish, q.net_kg);
  const material = w.gross * num(q.material_rate);
  const conversion = q.ops.reduce((s, o) => s + num(o.hours) * num(o.rate), 0);
  const setup = q.ops.reduce((s, o) => s + num(o.setup_h) * num(o.rate), 0) / n;
  const outside = q.outside.reduce((s, o) => s + num(o.rate) * (o.basis === 'kg' ? w.net : 1), 0);
  const extras = num(q.packing) + num(q.freight);
  const scrap_credit = w.scrap * num(q.scrap_rate);
  const base = material + conversion + setup + outside + extras - scrap_credit;
  const overhead = (base * num(q.overhead_pct)) / 100;
  const cost = base + overhead;
  const price = r2(cost * (1 + num(q.margin_pct) / 100));
  return {
    qty: n, gross_kg: w.gross, net_kg: w.net, scrap_kg: w.scrap, material: r2(material), conversion: r2(conversion), setup: r2(setup), outside: r2(outside),
    extras: r2(extras), scrap_credit: r2(scrap_credit), overhead: r2(overhead), cost: r2(cost), price, total: r2(price * n),
  };
}

/** The breaks of a quote (sorted, distinct, positive). */
export const quoteBreaks = (q: Omit<JobQuote, 'id' | 'status'>): QuoteBreak[] =>
  [...new Set(q.breaks.map((b) => Math.round(num(b))).filter((b) => b > 0))].sort((a, b) => a - b).map((b) => quoteBreak(q, b));

export function validateQuote(q: Partial<JobQuote>): string {
  if (!DAY.test(q.date ?? '')) return 'Enter the date.';
  if (!q.part?.trim()) return 'Name the part.';
  if (!(num(q.density) > 0)) return 'Enter the material density.';
  if (!q.blank) return 'Enter the blank size.';
  const b = q.breaks?.filter((x) => num(x) > 0) ?? [];
  if (b.length < 1 || b.length > 4) return 'Give 1 to 4 quantity breaks.';
  if ((q.ops ?? []).some((o) => !o.name?.trim() || num(o.hours) < 0 || num(o.rate) < 0 || num(o.setup_h) < 0)) return 'Each operation needs a name and no negative hours or rates.';
  if (num(q.material_rate) < 0 || num(q.scrap_rate) < 0) return 'Rates cannot be negative.';
  return '';
}

/* ================================================================
   Storage
   ================================================================ */

export const loadQuotes = (): JobQuote[] => rowsOf<JobQuote>(QUOTES_TABLE);
const lockOf = (q: Pick<JobQuote, 'id' | 'date'>) => ({ id: q.id, issue_date: q.date, invoice_number: '' });

export function saveQuote(input: Omit<JobQuote, 'id' | 'status'> & { id?: string; status?: JobQuote['status'] }): JobQuote {
  requireAccess('doc.create');
  const err = validateQuote(input);
  if (err) throw new Error(err);
  const prev = input.id ? loadQuotes().find((x) => x.id === input.id) : undefined;
  const id = prev?.id ?? generateId();
  assertUnlocked(lockOf({ id, date: input.date }), prev ? 'edit' : 'create');
  return put(QUOTES_TABLE, {
    ...prev, ...input, id, part: input.part.trim(), status: input.status ?? prev?.status ?? 'draft', breaks: input.breaks.filter((b) => num(b) > 0).map((b) => Math.round(num(b))),
    created_at: prev?.created_at ?? nowIso(), updated_at: nowIso(),
  });
}

export function removeQuote(id: string): void {
  requireAccess('doc.create');
  const q = mustGet<JobQuote>(QUOTES_TABLE, id, 'quote');
  assertUnlocked(lockOf(q), 'delete');
  drop(QUOTES_TABLE, id);
}

/** One QUOTATION draft per break, lines carrying the drawing / revision; the quote becomes "quoted". */
export function makeQuotations(id: string, items: readonly Pick<StockItem, 'id' | 'name' | 'hsn' | 'unit' | 'tax_rate'>[] = stockDb.items(), drawingNo?: string): InvoiceRecord[] {
  requireAccess('doc.create');
  const q = mustGet<JobQuote>(QUOTES_TABLE, id, 'quote');
  const it = q.item_id ? items.find((i) => i.id === q.item_id) : undefined;
  return withTablesRollback(['invoices', 'series_counters', QUOTES_TABLE], () => {
    const out = quoteBreaks(q).map((b) => {
      const line = mfLine({ name: it?.name ?? q.part, description: `${q.material} · ${r3(b.gross_kg)} kg gross / ${r3(b.net_kg)} kg net`, hsn: it?.hsn ?? '', unit: it?.unit || 'NOS', quantity: b.qty, rate: b.price, tax_rate: num(it?.tax_rate) });
      const lines = drawingNo || q.rev ? { [line.id]: { drawing: drawingNo, rev: q.rev } } : undefined;
      return saveDraft(mfDraft('QUOTATION', q.date, clientOf(q.client_id), [line], mfSnapshot('drawing', { header: { drawings: drawingNo ? `${drawingNo}${q.rev ? ` rev ${q.rev}` : ''}` : undefined }, lines })));
    });
    put(QUOTES_TABLE, { ...q, status: 'quoted', quote_ids: [...(q.quote_ids ?? []), ...out.map((r) => r.id)], updated_at: nowIso() });
    return out;
  });
}

/** Won: the material rate becomes the material item's standard cost from the quote date (dated, append-only). */
export function markWon(id: string, materialItemId?: string): JobQuote {
  requireAccess('doc.create');
  const q = mustGet<JobQuote>(QUOTES_TABLE, id, 'quote');
  return withTablesRollback([QUOTES_TABLE, 'stock_items'], () => {
    const it = materialItemId ? stockDb.items().find((i) => i.id === materialItemId) : undefined;
    if (it && num(q.material_rate) > 0) {
      requireAccess('master.edit');
      const costs = (it.standard_costs ?? []).filter((c) => c.from !== q.date);
      stockDb.saveItem({ ...it, standard_costs: [...costs, { from: q.date, rate: r2(q.material_rate) }].sort((a, b) => a.from.localeCompare(b.from)) });
    }
    return put(QUOTES_TABLE, { ...q, status: 'won', updated_at: nowIso() });
  });
}
