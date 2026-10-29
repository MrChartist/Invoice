/**
 * GSTR-9 Part V (7R, 7.128) — transactions of the FY declared in the NEXT FY, up to the cut-off (`nextFyCutoff`,
 * gst-penalties.ts: 30 November from FY 2021-22, 20 October before — date-keyed, unverified):
 *  - Table 10: supplies / tax added — debit notes dated in the window against this FY's invoices, and upward
 *    amendments made in the window of documents first reported in this FY;
 *  - Table 11: supplies / tax reduced — credit notes on this FY's invoices and downward amendments, same window;
 *  - Table 12: reversal of this FY's ITC — supplier notes / purchase returns dated in the window against bills of
 *    this FY that claimed ITC (cess included);
 *  - Table 13: ITC of this FY availed in the next FY — not known to the app (bills are claimed in the month of
 *    their date), shown as 0 with a note;
 *  - Table 14: differential tax on 10 & 11 — payable = (10 − 11) per head when positive (paid: enter on the portal).
 * The window's monthly GSTR-1 builds are the same `buildGstReport` the GST page uses (links classify notes;
 * amendments carry their original return period). Credit notes netted into B2CS (no link to an invoice) cannot be
 * attributed and are not counted (note). Working paper — verify with your CA. Pure.
 */

import type { InvoiceRecord } from '../types/invoice';
import type { PurchaseReturn } from '../types/purchases';
import { buildGstReport, type BuildOptions, type ReportPeriod } from './gst-reports';
import { nextFyCutoff } from './gst-penalties';
import { num, round2 } from './invoice-calc';
import { isLiveNote, noteCess, noteItc } from './purchase-returns-gst';
import { readPurchase } from './purchase-normalize';

export interface PartVHeads {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface PartVResult {
  cutoff: string;
  t10: PartVHeads;
  t11: PartVHeads;
  t12: PartVHeads;
  t13: PartVHeads;
  t14: PartVHeads;
  /** Documents behind 10 / 11 / 12 (for the notes). */
  counts: { debitNotes: number; creditNotes: number; amendmentsUp: number; amendmentsDown: number; supplierNotes: number };
  notes: string[];
}

export interface PartVOptions {
  fyStart: number;
  gstin?: string;
  filerStateCode?: string;
  links?: BuildOptions['links'];
  units?: BuildOptions['units'];
  items?: BuildOptions['items'];
  purchaseNotes?: readonly PurchaseReturn[];
  rawPurchases?: readonly unknown[];
  /** Last day considered (defaults to the statutory cut-off; a later "today" never extends it). */
  today?: string;
}

const zero = (): PartVHeads => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 });
const add = (t: PartVHeads, h: Partial<PartVHeads>, f = 1) => {
  t.taxable = round2(t.taxable + f * num(h.taxable));
  t.igst = round2(t.igst + f * num(h.igst));
  t.cgst = round2(t.cgst + f * num(h.cgst));
  t.sgst = round2(t.sgst + f * num(h.sgst));
  t.cess = round2(t.cess + f * num(h.cess));
};
const inFy = (day: string, fyStart: number) => day >= `${fyStart}-04-01` && day <= `${fyStart + 1}-03-31`;
/** MMYYYY return period → is it a month of the FY? */
const periodInFy = (mmyyyy: string, fyStart: number) => {
  const m = Number(mmyyyy.slice(0, 2));
  const y = Number(mmyyyy.slice(2));
  return (y === fyStart && m >= 4) || (y === fyStart + 1 && m <= 3);
};

export function buildGstr9PartV(invoices: InvoiceRecord[], o: PartVOptions): PartVResult {
  const statutory = nextFyCutoff(o.fyStart);
  const cutoff = o.today && o.today < statutory ? o.today : statutory;
  const t10 = zero();
  const t11 = zero();
  const t12 = zero();
  const counts = { debitNotes: 0, creditNotes: 0, amendmentsUp: 0, amendmentsDown: 0, supplierNotes: 0 };
  const notes: string[] = [];
  const invoiceDate = new Map<string, string>();
  for (const inv of invoices) if (inv?.id) invoiceDate.set(inv.id, String(inv.issue_date ?? '').slice(0, 10));
  const originalOf = new Map<string, string>();
  for (const l of o.links ?? []) if (l.relation === 'credit_note' || l.relation === 'debit_note') originalOf.set(l.to_id, l.from_id);

  // Months of the next FY up to the cut-off month.
  const months: ReportPeriod[] = [];
  const [cy, cm] = cutoff.split('-').map(Number);
  for (let y = o.fyStart + 1, m = 4; (y < cy || (y === cy && m <= cm)) && months.length < 12; ) {
    months.push({ kind: 'month', month: m, fyStart: o.fyStart + 1 });
    if (m === 12) {
      m = 1;
      y++;
    } else m++;
  }
  let unattributed = 0;
  for (const period of months) {
    const rep = buildGstReport(invoices, [], { period, gstin: o.gstin, filerStateCode: o.filerStateCode, links: o.links, units: o.units, items: o.items });
    const g1 = rep.gstr1;
    for (const n of [...g1.cdnr, ...g1.cdnur]) {
      if (n.date > cutoff) continue;
      const orig = originalOf.get(n.invoiceId);
      const origDate = orig ? invoiceDate.get(orig) ?? '' : '';
      if (!orig) {
        unattributed++;
        continue;
      }
      if (!inFy(origDate, o.fyStart)) continue;
      const h = { taxable: n.taxable, igst: n.igst, cgst: n.cgst, sgst: n.sgst, cess: num(n.cess) };
      if (n.noteType === 'D') {
        add(t10, h);
        counts.debitNotes++;
      } else {
        add(t11, h);
        counts.creditNotes++;
      }
    }
    const am = g1.amendments;
    if (am?.effects?.length) {
      const origPeriodOf = new Map<string, string>();
      for (const r of [...(am.expa ?? []), ...am.b2ba, ...am.b2cla, ...am.cdnra, ...am.cdnura]) origPeriodOf.set(r.number, r.origPeriod);
      for (const e of am.effects) {
        const op = origPeriodOf.get(e.number);
        if (!op || !periodInFy(op, o.fyStart)) continue;
        const d = e.taxPayable;
        const tax = round2(d.igst + d.cgst + d.sgst + d.cess);
        const value = round2(d.taxable + tax);
        if (value > 0) {
          add(t10, d);
          counts.amendmentsUp++;
        } else if (value < 0) {
          add(t11, d, -1);
          counts.amendmentsDown++;
        }
      }
    }
  }
  if (unattributed) notes.push(`${unattributed} credit / debit note(s) in the window are not linked to an invoice, so they cannot be attributed to this FY: check them by hand.`);

  // Table 12: supplier notes in the window on bills of this FY that claimed ITC.
  const billDate = new Map<string, string>();
  for (const raw of o.rawPurchases ?? []) {
    const c = readPurchase(raw);
    if (c) billDate.set(c.id, c.date);
  }
  const winFrom = `${o.fyStart + 1}-04-01`;
  for (const n of o.purchaseNotes ?? []) {
    if (!isLiveNote(n) || n.date < winFrom || n.date > cutoff || !n.itc_eligible) continue;
    const bd = (n.purchase_id && billDate.get(n.purchase_id)) || String(n.bill_date ?? '');
    if (!inFy(bd, o.fyStart)) continue;
    const itc = noteItc(n);
    add(t12, { igst: itc.igst, cgst: itc.cgst, sgst: itc.sgst, cess: noteCess(n) });
    counts.supplierNotes++;
  }

  const t14 = zero();
  for (const k of ['igst', 'cgst', 'sgst', 'cess'] as const) t14[k] = Math.max(round2(t10[k] - t11[k]), 0);
  notes.push(`Part V covers documents dated 1 Apr ${o.fyStart + 1} – ${cutoff} that relate to FY ${o.fyStart}-${String(o.fyStart + 1).slice(2)} (cut-off date-keyed, verify). Table 13 (this FY's ITC availed next FY) is not known to the app: enter it on the portal. Table 14 shows the tax payable on 10 − 11; enter what was paid.`);
  return { cutoff, t10, t11, t12, t13: zero(), t14, counts, notes };
}
