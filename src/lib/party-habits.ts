/**
 * Repeat last bill and "usual items" (R3-B6). Right after a party is picked on a new sales document the
 * editor offers the lines of the party's latest issued document of the same type (at today's prices,
 * quantities kept) and up to 8 chips for the items the party buys most (frequency × recency over the
 * last 180 days). Computed from the invoices already loaded; no new storage.
 *
 * "Repeat" copies lines only and strips everything tied to the old document: billing refs, batch /
 * serial / bin picks, scheme free lines (recomputed for today), stage / order links and price bases.
 *
 * Pure (tests/party-habits.test.ts).
 */
import type { Client, DocumentType, InvoiceItem, InvoiceRecord } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { syncSchemeLines, type Scheme } from './pricing';

export type PartyRef = Pick<Client, 'id' | 'name'>;

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** Same party: the CRM id when both have one, else the name. */
export function samePartyAs(party: PartyRef, doc: Pick<InvoiceRecord, 'client'>): boolean {
  const c = doc.client;
  if (!c) return false;
  if (party.id && c.id) return party.id === c.id;
  return !!norm(party.name) && norm(party.name) === norm(c.name);
}

/** A party key for caches: id, else `name:<lower-cased>`. */
export const habitKey = (p: PartyRef): string => (p.id ? p.id : `name:${norm(p.name)}`);

const issued = (i: Pick<InvoiceRecord, 'status'>) => i.status !== 'Draft' && i.status !== 'Cancelled';

/** Sales document types the strip works on (notes re-state an earlier price; never repeated). */
export const HABIT_DOC_TYPES: readonly DocumentType[] = ['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'QUOTATION', 'SALES_ORDER', 'DELIVERY_CHALLAN', 'PROFORMA'];

/** The party's latest issued document of `docType` (by issue date, then creation). */
export function lastBill(invoices: readonly InvoiceRecord[], party: PartyRef, docType: DocumentType, excludeId?: string): InvoiceRecord | undefined {
  return invoices
    .filter((i) => i.id !== excludeId && (i.doc_type ?? 'INVOICE') === docType && issued(i) && samePartyAs(party, i) && (i.items ?? []).some((l) => !l.free_of && l.name?.trim()))
    .sort((a, b) => b.issue_date.localeCompare(a.issue_date) || (b.created_at ?? '').localeCompare(a.created_at ?? ''))[0];
}

/** Line fields that belong to the old document and are never copied. */
const STRIP: readonly (keyof InvoiceItem)[] = [
  'bill_refs', 'batch_no', 'batch_expiry', 'batch_mfg', 'serials', 'scheme_id', 'free_of', 'price_basis', 'order_line_id', 'bin', 'created_at',
];

export interface RepeatOptions {
  catalog: readonly InvoiceItem[];
  schemes?: readonly Scheme[];
  /** Document date (schemes run by date). */
  day: string;
  newId: () => string;
}

/**
 * Lines ready for a new document: forbidden fields stripped, the catalogue's rate of today applied over
 * the old rate (× the line's unit factor for an alternate unit), quantities kept, free lines recomputed.
 */
export function repeatLines(lines: readonly InvoiceItem[], opts: RepeatOptions): InvoiceItem[] {
  const out: InvoiceItem[] = [];
  for (const src of lines) {
    if (src.free_of || !src.name?.trim()) continue;
    const line = { ...src, id: opts.newId() } as InvoiceItem & Record<string, unknown>;
    for (const k of STRIP) delete line[k];
    delete line.progress_line_of;
    const cat = opts.catalog.find((c) => norm(c.name) === norm(src.name));
    if (cat) {
      const factor = num(src.unit_factor) > 0 ? num(src.unit_factor) : 1;
      line.rate = round2(num(cat.rate) * factor);
      if (typeof cat.tax_rate === 'number') line.tax_rate = cat.tax_rate;
    }
    line.amount = round2(num(line.quantity) * num(line.rate));
    out.push(line);
  }
  return syncSchemeLines(out, opts.schemes ?? [], opts.day, opts.newId, [...opts.catalog]);
}

export interface UsualItem {
  name: string;
  /** Times bought in the window (documents, not lines). */
  count: number;
  last_date: string;
  last_qty: number;
  unit?: string;
  unit_factor?: number;
  score: number;
  /** The most recent line, as a template. */
  line: InvoiceItem;
}

const dayNo = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, dd) / 86400000;
};

/**
 * Up to `limit` items the party buys, over issued sales documents of the last `days` days, ranked by
 * frequency × recency: score = count × (1 − days since last purchase / window).
 */
export function usualItems(invoices: readonly InvoiceRecord[], party: PartyRef, today: string, opts: { limit?: number; days?: number; docTypes?: readonly DocumentType[] } = {}): UsualItem[] {
  const days = opts.days ?? 180;
  const types = opts.docTypes ?? ['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY'];
  const from = dayNo(today) - days;
  const map = new Map<string, UsualItem>();
  const docs = invoices
    .filter((i) => types.includes(i.doc_type ?? 'INVOICE') && issued(i) && samePartyAs(party, i) && dayNo(i.issue_date) >= from && i.issue_date <= today)
    .sort((a, b) => a.issue_date.localeCompare(b.issue_date) || (a.created_at ?? '').localeCompare(b.created_at ?? ''));
  for (const doc of docs) {
    const seen = new Set<string>();
    for (const l of doc.items ?? []) {
      const k = norm(l.name);
      if (!k || l.free_of || seen.has(k)) continue;
      seen.add(k);
      const prev = map.get(k);
      map.set(k, {
        name: l.name.trim(),
        count: (prev?.count ?? 0) + 1,
        last_date: doc.issue_date,
        last_qty: num(l.quantity) || 1,
        ...(l.unit ? { unit: l.unit } : {}),
        ...(num(l.unit_factor) > 0 && num(l.unit_factor) !== 1 ? { unit_factor: num(l.unit_factor) } : {}),
        score: 0,
        line: l,
      });
    }
  }
  const t = dayNo(today);
  return [...map.values()]
    .map((u) => ({ ...u, score: round2(u.count * Math.max(1 - (t - dayNo(u.last_date)) / days, 0.01)) }))
    .sort((a, b) => b.score - a.score || b.last_date.localeCompare(a.last_date) || a.name.localeCompare(b.name))
    .slice(0, opts.limit ?? 8);
}

/** A usual item as a new line: the last line's quantity / unit, at today's catalogue rate when known. */
export function usualLine(u: UsualItem, opts: Omit<RepeatOptions, 'schemes'>): InvoiceItem {
  return repeatLines([{ ...u.line, quantity: u.last_qty }], { ...opts, schemes: [] })[0];
}
