/**
 * AG-D4 subsidised fertiliser (items flagged `ag_subsidised`: urea, DAP, MOP, NPK — typed by the dealer):
 *  - an issued sale of a flagged item needs the government PoS transaction no. and the farmer ID (Aadhaar last 4 or
 *    KCC no.) in `ag.inputs` — the app records them; it never talks to the PoS (iFMS);
 *  - a per-farmer monthly bag counter warns above the cap (`FERT_SUBSIDY_DEFAULTS`, 50 bags reported — verify AG22);
 *  - the PoS stock check: per flagged item and month, book stock at month end (the stock engine's ledger, alternate
 *    units already converted) against the PoS stock typed from the device's report, with the sales missing a PoS no.
 * The full Aadhaar number is never stored (4 digits only). Pure.
 */
import type { AgInputsSnap, PosStock } from '../../types/agri-r12d';
import type { InvoiceRecord } from '../../types/invoice';
import type { StockPosition } from '../inventory';
import { num } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { lineFactor } from '../units';
import { FERT_SUBSIDY_DEFAULTS } from '../agri-rules';

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);
const live = (i: InvoiceRecord) => SALES.has(i.doc_type) && i.status !== 'Draft' && i.status !== 'Cancelled';
const q3 = (n: number) => Math.round(n * 1000) / 1000;

/** Farmer ID: Aadhaar last four digits, or a KCC number (letters / digits, 6 to 20). */
export const validFarmerId = (id: string | undefined): boolean => /^\d{4}$/.test(String(id ?? '').trim()) || /^[A-Z0-9/-]{6,20}$/i.test(String(id ?? '').trim());

/** Bags of flagged items on a document (alternate units converted to the base unit). */
export const subsidisedBags = (doc: Pick<InvoiceRecord, 'items'>, isSub: (name: string) => boolean): number => q3((doc.items ?? []).filter((l) => l?.name && isSub(l.name)).reduce((s, l) => s + num(l.quantity) * lineFactor(l), 0));

/** Errors for an issued sale with flagged items and no PoS transaction no. / farmer ID. */
export function subsidyErrors(doc: Pick<InvoiceRecord, 'doc_type' | 'status' | 'items'> & { ag?: { inputs?: AgInputsSnap } }, isSub: (name: string) => boolean): string[] {
  if (!SALES.has(doc.doc_type) || doc.status === 'Draft' || doc.status === 'Cancelled' || !(subsidisedBags(doc, isSub) > 0)) return [];
  const i = doc.ag?.inputs;
  const out: string[] = [];
  if (!i?.pos_txn?.trim()) out.push('Subsidised fertiliser: enter the PoS transaction no. from the fertiliser PoS device.');
  if (!validFarmerId(i?.farmer_id)) out.push('Subsidised fertiliser: enter the farmer ID — Aadhaar last 4 digits or the KCC no. (never the full Aadhaar).');
  return out;
}

const farmerKey = (i: Pick<InvoiceRecord, 'client'> & { ag?: { inputs?: AgInputsSnap } }) => `${i.client?.id || i.client?.name || ''}|${String(i.ag?.inputs?.farmer_id ?? '').trim().toUpperCase()}`;

/** Bags this farmer bought in the month of `date` on other live sales, plus this document, against the cap. */
export function capWarning(doc: Pick<InvoiceRecord, 'id' | 'issue_date' | 'client' | 'items'> & { ag?: { inputs?: AgInputsSnap } }, invoices: readonly InvoiceRecord[], isSub: (name: string) => boolean, cap?: number): string | undefined {
  const limit = num(cap) > 0 ? num(cap) : ruleAt(FERT_SUBSIDY_DEFAULTS, doc.issue_date).capBagsPerMonth;
  const month = doc.issue_date.slice(0, 7);
  const key = farmerKey(doc);
  const before = invoices.filter((i) => i.id !== doc.id && live(i) && i.issue_date.slice(0, 7) === month && farmerKey(i) === key).reduce((s, i) => s + subsidisedBags(i, isSub), 0);
  const total = q3(before + subsidisedBags(doc, isSub));
  return total > limit ? `This farmer has ${total} subsidised bags this month — above ${limit} a month (reported cap — verify AG22).` : undefined;
}

export interface PosCheckRow { item_id: string; item: string; book: number; pos: number | undefined; diff: number | undefined }

/** Book stock at the end of `month` from an engine position (its ledger balance on or before the last day). */
export function bookAt(p: StockPosition, day: string): number {
  let bal = 0;
  for (const r of p.ledger) if ((r.date || '') <= day) bal = r.balance;
  return q3(bal);
}

const monthEnd = (m: string) => { const [y, mm] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mm, 0)).getUTCDate()).padStart(2, '0')}`; };

/** PoS vs book per flagged item for `month` (`YYYY-MM`), and the month's flagged sales with no PoS no. */
export function posCheck(month: string, positions: readonly StockPosition[], pos: PosStock | undefined, invoices: readonly InvoiceRecord[], isSub: (name: string) => boolean): { rows: PosCheckRow[]; missing: InvoiceRecord[] } {
  const end = monthEnd(month);
  const typed = pos?.[month] ?? {};
  const rows = positions.filter((p) => p.item.ag_subsidised || isSub(p.item.name)).map((p) => {
    const book = bookAt(p, end);
    const t = typed[p.item.id];
    return { item_id: p.item.id, item: p.item.name, book, pos: t, diff: t === undefined ? undefined : q3(book - num(t)) };
  });
  const missing = invoices.filter((i) => live(i) && i.issue_date.slice(0, 7) === month && subsidisedBags(i, isSub) > 0 && !i.ag?.inputs?.pos_txn?.trim());
  return { rows, missing };
}
