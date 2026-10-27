/**
 * MF-B3 scrap register and scrap sales (every factory). The register reads only: scrap made — manufacturing-journal
 * scrap lines (BOM scrap outputs and the job-card scrap MF-A3 posts with the order's output, `mf_jc`) and stock-journal
 * scrap destinations (QC rejects, write-offs) — job-card scrap kg not yet posted ("on job cards"), scrap sold (sales,
 * net of credit notes), in stock (the stock engine), value at the item's scrap rate and the average realisation, by
 * scrap item and month. Quantities in the item's base unit (`lineFactor`).
 *
 * A scrap sale is an ordinary draft invoice: the class rate and HSN where the item has none, the TCS preset "206C(1)
 * scrap" unless the buyer's declaration is on record (switch, printed), the GST TDS note for a registered buyer of metal
 * scrap above ₹2.5 lakh, and the weighment (gross / tare / net, the R8 `wt` shape) in `mf.scrap.rows` for the annexure.
 * Working papers — verify with your CA (MF7–MF10).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { JobCard } from '../../types/mfg-r13';
import type { ManufacturingVoucher, StockJournal } from '../../types/manufacturing';
import type { StockItem } from '../inventory';
import { buildItemIndex, invoiceEffect } from '../inventory';
import { lineFactor } from '../units';
import { num } from '../invoice-calc';
import { requireAccess } from '../access';
import { mfSnapshot } from './mf-snapshot';
import { DAY, r2, r3 } from './mf-b-db';
export { scrapRate } from './mf-b-db';
import { gstTdsNote, isMetalScrap, scrapClassOf, scrapClassRate, scrapTcsPreset, TCS_SCOPE_NOTE } from './mf-scrap-tax';
import { clientOf, mfDraft, mfLine, saveDraft } from './mf-b-docs';

export interface ScrapRow {
  item_id: string;
  month: string;
  made: number;
  pending: number;
  sold: number;
  sold_value: number;
}

export interface ScrapDocs {
  items: readonly StockItem[];
  mfg: readonly Pick<ManufacturingVoucher, 'date' | 'production_order_id' | 'outputs'>[];
  journals: readonly Pick<StockJournal, 'date' | 'produce'>[];
  cards: readonly Pick<JobCard, 'order_id' | 'entries'>[];
  invoices: readonly Pick<InvoiceRecord, 'doc_type' | 'status' | 'issue_date' | 'items'>[];
  /** MF-A's default scrap item for job-card entries that name none. */
  scrapItemId?: string;
}

/** Scrap items: a scrap class on the item, or the item of a scrap line of any manufacturing journal. */
export function scrapItemIds(d: Pick<ScrapDocs, 'items' | 'mfg' | 'scrapItemId'>): Set<string> {
  const ids = new Set(d.items.filter((i) => i.mf_scrap_class).map((i) => i.id));
  for (const v of d.mfg) for (const o of v.outputs ?? []) if (o.kind === 'scrap' && o.item_id) ids.add(o.item_id);
  if (d.scrapItemId) ids.add(d.scrapItemId);
  return ids;
}

/** The register, by scrap item and month (yyyy-mm), oldest first. */
export function scrapRegister(d: ScrapDocs): ScrapRow[] {
  const ids = scrapItemIds(d);
  const m = new Map<string, ScrapRow>();
  const at = (item_id: string, date: string) => {
    const k = `${item_id}|${date.slice(0, 7)}`;
    let r = m.get(k);
    if (!r) m.set(k, (r = { item_id, month: date.slice(0, 7), made: 0, pending: 0, sold: 0, sold_value: 0 }));
    return r;
  };
  // Posted scrap per order (job-card lines, `mf_jc`) — what is still only on the cards is "pending".
  const posted = new Map<string, number>();
  for (const v of d.mfg) {
    for (const o of v.outputs ?? []) {
      if (!ids.has(o.item_id)) continue;
      const q = num(o.qty) * lineFactor(o);
      at(o.item_id, v.date).made += q;
      if ((o as { mf_jc?: boolean }).mf_jc && v.production_order_id) posted.set(`${v.production_order_id}|${o.item_id}`, (posted.get(`${v.production_order_id}|${o.item_id}`) ?? 0) + q);
    }
  }
  for (const j of d.journals) for (const p of j.produce ?? []) if (ids.has(p.item_id)) at(p.item_id, j.date).made += num(p.qty) * lineFactor(p);
  for (const c of d.cards) {
    for (const e of c.entries ?? []) {
      const item = e.scrap_item_id || d.scrapItemId;
      if (!item || !(num(e.scrap_kg) > 0)) continue;
      const k = `${c.order_id}|${item}`;
      const left = posted.get(k) ?? 0;
      const use = Math.min(left, num(e.scrap_kg));
      posted.set(k, left - use);
      if (num(e.scrap_kg) - use > 0) at(item, e.date).pending += num(e.scrap_kg) - use;
    }
  }
  const index = buildItemIndex(d.items.filter((i) => ids.has(i.id)) as StockItem[]);
  for (const inv of d.invoices) {
    const eff = invoiceEffect(inv.doc_type, inv.status, false);
    if (!eff || !DAY.test(inv.issue_date ?? '')) continue;
    const sign = eff === 'out' ? 1 : -1;
    for (const l of inv.items ?? []) {
      const it = index.find(l.name, l.hsn);
      if (!it) continue;
      const r = at(it.id, inv.issue_date);
      r.sold += sign * num(l.quantity) * lineFactor(l);
      r.sold_value += sign * num(l.amount);
    }
  }
  return [...m.values()].map((r) => ({ ...r, made: r3(r.made), pending: r3(r.pending), sold: r3(r.sold), sold_value: r2(r.sold_value) }))
    .sort((a, b) => a.month.localeCompare(b.month) || a.item_id.localeCompare(b.item_id));
}


/* ── Scrap sale ─────────────────────────────────────────────── */

export interface ScrapSaleLine { item_id: string; net_kg: number; rate: number; gross_kg?: number; tare_kg?: number }
export interface ScrapSaleInput {
  date: string;
  client_id?: string;
  client_name?: string;
  lines: ScrapSaleLine[];
  /** The buyer's declaration ref (Form 127 / 27C): no TCS. */
  declaration?: string;
}

/** Build (not save) the scrap invoice draft. */
export function scrapSaleDraft(i: ScrapSaleInput, items: readonly StockItem[]): InvoiceRecord {
  if (!DAY.test(i.date)) throw new Error('Enter the date.');
  const lines = i.lines.filter((l) => l.item_id && num(l.net_kg) > 0);
  if (!lines.length) throw new Error('Add a scrap line with its net weight.');
  const client = clientOf(i.client_id, i.client_name ?? '');
  let metal = false;
  const sale = lines.map((l) => {
    const it = items.find((x) => x.id === l.item_id);
    const cls = scrapClassOf({ hsn: it?.hsn }, it);
    if (isMetalScrap(cls)) metal = true;
    const c = cls ? scrapClassRate(cls, i.date) : undefined;
    return mfLine({ name: it?.name ?? 'Scrap', hsn: it?.hsn || c?.hsn || '', unit: it?.unit || 'KG', quantity: r3(l.net_kg), rate: r2(l.rate), tax_rate: num(it?.tax_rate) || num(c?.rate) });
  });
  const taxable = sale.reduce((s, l) => s + l.amount, 0);
  const declared = !!i.declaration?.trim() || !!client.tcs_declaration;
  const tcs = scrapTcsPreset(i.date, declared);
  const tds = gstTdsNote(i.date, { buyerGstin: client.gstin, metal, taxable });
  const declaration = i.declaration?.trim() || (client.tcs_declaration ? `Form 127 / 27C${client.tcs_declaration.ref ? ` ${client.tcs_declaration.ref}` : ''} of ${client.tcs_declaration.on}` : '');
  const rows = lines.map((l) => ({ item: items.find((x) => x.id === l.item_id)?.name ?? 'Scrap', ...(num(l.gross_kg) > 0 ? { gross_kg: r3(l.gross_kg!) } : {}), ...(num(l.tare_kg) > 0 ? { tare_kg: r3(l.tare_kg!) } : {}), net_kg: r3(l.net_kg) }));
  const notes = [declaration ? `Buyer's declaration of use in manufacturing (${declaration}) received — TCS not collected (MF10).` : TCS_SCOPE_NOTE, tds].filter(Boolean).join('\n');
  return mfDraft('INVOICE', i.date, client, sale, mfSnapshot('scrap', { scrap: { rows, tcs: !!tcs, ...(declaration ? { declaration } : {}), ...(tds ? { gst_tds: true } : {}) } }), {
    notes, ...(tcs ? { tcs_enabled: true, tcs_rate: tcs.rate, tcs_label: tcs.label, tcs_base: 'total' as const } : {}),
  });
}

/** Save the scrap invoice as a draft (open it in the editor to issue). */
export function makeScrapSale(i: ScrapSaleInput, items: readonly StockItem[]): InvoiceRecord {
  requireAccess('doc.create');
  return saveDraft(scrapSaleDraft(i, items));
}
