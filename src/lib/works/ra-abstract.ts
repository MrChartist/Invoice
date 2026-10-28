/**
 * R5-B4: the RA abstract — per BOQ line: item no., description, unit, BOQ qty, rate, up to previous qty / amount, this
 * bill qty / amount, cumulative qty / amount, % of BOQ; footer totals, the deductions table (B5) and "Net payable".
 * The this-bill column sums to the RA bill's line value (before any invoice-level discount). Printed as a
 * self-contained HTML page (the R3-B4 annexure component is timesheet-shaped). Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import { num, round2 } from '../invoice-calc';
import { esc } from '../voucher-print';
import { lineValue, roundQty, stageInvoices } from '../progress-billing';
import { boqLines } from './boq';

export interface AbstractRow {
  lineId: string;
  ref: string;
  description: string;
  unit: string;
  boqQty: number;
  rate: number;
  prevQty: number;
  prevAmount: number;
  thisQty: number;
  thisAmount: number;
  cumQty: number;
  cumAmount: number;
  pct: number;
}

/** Pure: abstract rows of RA bill `bill` against its BOQ (earlier = live stages before it). */
export function abstractRows(boq: InvoiceRecord, bill: InvoiceRecord, invoices: readonly InvoiceRecord[]): AbstractRow[] {
  const stages = stageInvoices(boq.id, invoices);
  const myStage = num(bill.progress_of?.stage);
  const before = stages.filter((s) => s.id !== bill.id && num(s.progress_of?.stage) < myStage);
  const acc = (docs: readonly InvoiceRecord[], id: string) => {
    let qty = 0;
    let amount = 0;
    for (const d of docs) for (const it of d.items ?? []) if (it.progress_line_of === id) {
      qty = roundQty(qty + num(it.quantity));
      amount = round2(amount + lineValue(it));
    }
    return { qty, amount };
  };
  return boqLines(boq).map((l) => {
    const p = acc(before, l.id);
    const t = acc([bill], l.id);
    const cumQty = roundQty(p.qty + t.qty);
    return {
      lineId: l.id, ref: l.boq_ref ?? '', description: l.name, unit: l.unit ?? '', boqQty: num(l.quantity), rate: num(l.rate),
      prevQty: p.qty, prevAmount: p.amount, thisQty: t.qty, thisAmount: t.amount, cumQty, cumAmount: round2(p.amount + t.amount),
      pct: num(l.quantity) > 0 ? round2((cumQty / num(l.quantity)) * 100) : 0,
    };
  });
}

export function abstractTotals(rows: readonly AbstractRow[]): { prev: number; this: number; cum: number } {
  return rows.reduce((s, r) => ({ prev: round2(s.prev + r.prevAmount), this: round2(s.this + r.thisAmount), cum: round2(s.cum + r.cumAmount) }), { prev: 0, this: 0, cum: 0 });
}

export const abstractCsvRows = (rows: readonly AbstractRow[]): (string | number)[][] => [
  ['Item no.', 'Description', 'Unit', 'BOQ qty', 'Rate', 'Up to previous qty', 'Up to previous amount', 'This bill qty', 'This bill amount', 'Cumulative qty', 'Cumulative amount', '% of BOQ'],
  ...rows.map((r) => [r.ref, r.description, r.unit, r.boqQty, r.rate, r.prevQty, r.prevAmount, r.thisQty, r.thisAmount, r.cumQty, r.cumAmount, r.pct]),
];

const m = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The printable abstract (one page per RA bill). */
export function abstractHtml(boq: InvoiceRecord, bill: InvoiceRecord, rows: readonly AbstractRow[], company: string): string {
  const t = abstractTotals(rows);
  // R11 (CN-A4): the M-book refs of this bill's lines (from its snapshot; '' for R5 bills).
  const mbOf = (lineId: string) => [...new Set(bill.items.filter((i) => i.progress_line_of === lineId).map((i) => bill.boq_terms?.cn?.lines?.[i.id]?.mb).filter(Boolean))].join(', ');
  const body = rows.map((r) => `<tr><td>${esc(r.ref)}</td><td>${esc(r.description)}</td><td>${esc(r.unit)}</td><td class="n">${r.boqQty}</td><td class="n">${m(r.rate)}</td><td class="n">${r.prevQty}</td><td class="n">${m(r.prevAmount)}</td><td class="n">${r.thisQty}</td><td class="n">${m(r.thisAmount)}</td><td class="n">${r.cumQty}</td><td class="n">${m(r.cumAmount)}</td><td class="n">${r.pct}%</td><td>${esc(mbOf(r.lineId))}</td></tr>`).join('');
  const deds = (bill.ra_deductions ?? []).map((d) => `<tr><td>Less: ${esc(d.label)}</td><td class="n">${m(d.amount)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(`RA ${bill.ra_no ?? ''} abstract`)}</title><style>
body{font-family:system-ui,sans-serif;color:#111;margin:0;padding:20px;font-size:12px}h1{font-size:16px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin-top:10px}
th,td{border:1px solid #999;padding:4px 6px;text-align:left}td.n,th.n{text-align:right}.sum{max-width:420px;margin-left:auto}.note{color:#777;font-size:10px}@media print{body{padding:0}}</style></head><body>
<h1>${esc(company)} — RA bill no. ${esc(bill.ra_no ?? '')}${bill.ra_final ? ' (final)' : ''}: abstract</h1>
<div>Invoice ${esc(bill.invoice_number)} dated ${esc(bill.issue_date)} · BOQ ${esc(boq.invoice_number)} · ${esc(bill.client?.name ?? '')}</div>
<table><thead><tr><th>Item no.</th><th>Description</th><th>Unit</th><th class="n">BOQ qty</th><th class="n">Rate</th><th class="n">Prev qty</th><th class="n">Prev ₹</th><th class="n">This qty</th><th class="n">This ₹</th><th class="n">Cum qty</th><th class="n">Cum ₹</th><th class="n">% BOQ</th><th>MB</th></tr></thead>
<tbody>${body}<tr><th colspan="6">Total</th><th class="n">${m(t.prev)}</th><th></th><th class="n">${m(t.this)}</th><th></th><th class="n">${m(t.cum)}</th><th></th><th></th></tr></tbody></table>
<table class="sum"><tbody><tr><td>Gross this bill (incl. GST)</td><td class="n">${m(num(bill.total))}</td></tr>${deds}<tr><th>Net payable</th><th class="n">${m(num(bill.ra_net_payable ?? bill.total))}</th></tr></tbody></table>
<p class="note">GST is charged on the full bill value; deductions do not change it. Working paper — verify with your CA.</p></body></html>`;
}
