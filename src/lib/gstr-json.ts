/**
 * Export builders for the GST reports: GSTN offline-tool style GSTR-1 JSON,
 * per-section CSV and a printable summary document. All pure (no DOM access).
 *
 * The JSON follows the structure of the GST offline utility (b2b / b2cl /
 * b2cs / cdnr / cdnur / exp / nil / hsn / doc_issue). It has NOT been validated
 * against the live portal schema — import it into the offline tool, let it
 * validate, and verify with your CA before filing.
 */

import { round2 } from './invoice-calc';
import { toGstnDate } from './gst-reports';
import type {
  CdnRow,
  DocRow,
  Gstr1Report,
  Gstr3bReport,
  GstReport,
  RateRow,
} from './gst-reports';

/* ───────────────────────── JSON ───────────────────────── */

/** GSTN item number convention: rate * 100 + 1 (18% -> 1801). */
export const itemNum = (rate: number) => Math.round(rate * 100) + 1;

function itemDet(r: RateRow) {
  const det: Record<string, number> = { rt: r.rate, txval: round2(r.txval) };
  if (r.igst) det.iamt = round2(r.igst);
  if (r.cgst) det.camt = round2(r.cgst);
  if (r.sgst) det.samt = round2(r.sgst);
  det.csamt = 0;
  return det;
}

const itms = (rows: RateRow[]) => rows.map((r) => ({ num: itemNum(r.rate), itm_det: itemDet(r) }));

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

export function buildGstr1Json(r: Gstr1Report): Record<string, unknown> {
  const out: Record<string, unknown> = {
    gstin: r.gstin,
    fp: r.fp,
    version: 'GST3.0.4',
    hash: 'hash',
    // Aggregate turnover is not tracked by this app — fill in on the portal / offline tool.
    gt: 0,
    cur_gt: 0,
  };

  if (r.b2b.length) {
    out.b2b = [...groupBy(r.b2b, (x) => x.ctin)].map(([ctin, invs]) => ({
      ctin,
      inv: invs.map((i) => ({
        inum: i.number,
        idt: toGstnDate(i.date),
        val: round2(i.value),
        pos: i.pos,
        rchrg: i.rchrg,
        inv_typ: 'R',
        itms: itms(i.items),
      })),
    }));
  }

  if (r.b2cl.length) {
    out.b2cl = [...groupBy(r.b2cl, (x) => x.pos)].map(([pos, invs]) => ({
      pos,
      inv: invs.map((i) => ({
        inum: i.number,
        idt: toGstnDate(i.date),
        val: round2(i.value),
        itms: itms(i.items),
      })),
    }));
  }

  if (r.b2cs.length) {
    out.b2cs = r.b2cs.map((x) => {
      const row: Record<string, unknown> = {
        sply_ty: x.supply,
        rt: x.rate,
        typ: 'OE',
        pos: x.pos,
        txval: round2(x.txval),
      };
      if (x.igst) row.iamt = round2(x.igst);
      if (x.cgst) row.camt = round2(x.cgst);
      if (x.sgst) row.samt = round2(x.sgst);
      row.csamt = 0;
      return row;
    });
  }

  if (r.cdnr.length) {
    out.cdnr = [...groupBy(r.cdnr, (x) => x.ctin)].map(([ctin, notes]) => ({
      ctin,
      nt: notes.map((n) => ({
        ntty: 'C',
        nt_num: n.number,
        nt_dt: toGstnDate(n.date),
        val: round2(n.value),
        pos: n.pos,
        rchrg: n.rchrg,
        inv_typ: 'R',
        itms: itms(n.items),
      })),
    }));
  }

  if (r.cdnur.length) {
    out.cdnur = r.cdnur.map((n: CdnRow) => ({
      typ: n.unregType ?? 'B2CL',
      ntty: 'C',
      nt_num: n.number,
      nt_dt: toGstnDate(n.date),
      val: round2(n.value),
      pos: n.pos,
      itms: itms(n.items),
    }));
  }

  if (r.exp.length) {
    out.exp = [...groupBy(r.exp, (x) => x.expType)].map(([expType, invs]) => ({
      exp_typ: expType,
      inv: invs.map((i) => ({
        inum: i.number,
        idt: toGstnDate(i.date),
        val: round2(i.value),
        itms: i.items.map((it) => {
          const row: Record<string, number> = { txval: round2(it.txval), rt: it.rate };
          if (it.igst) row.iamt = round2(it.igst);
          row.csamt = 0;
          return row;
        }),
      })),
    }));
  }

  if (r.nil.length) {
    out.nil = {
      inv: r.nil.map((n) => ({
        sply_ty: n.type,
        expt_amt: round2(n.exempt),
        nil_amt: round2(n.nil),
        ngsup_amt: round2(n.nonGst),
      })),
    };
  }

  if (r.hsn.length) {
    out.hsn = {
      data: r.hsn.map((h, idx) => ({
        num: idx + 1,
        hsn_sc: h.hsn,
        desc: h.description.slice(0, 30),
        uqc: h.uqc,
        qty: round2(h.qty),
        val: round2(h.value),
        txval: round2(h.taxable),
        iamt: round2(h.igst),
        camt: round2(h.cgst),
        samt: round2(h.sgst),
        csamt: 0,
        rt: h.rate,
      })),
    };
  }

  if (r.docIssue.length) {
    const codes: Record<string, number> = { 'Invoices for outward supply': 1, 'Credit Note': 5 };
    const byType = groupBy(r.docIssue, (x) => x.docType);
    out.doc_issue = {
      doc_det: [...byType].sort((a, b) => (codes[a[0]] ?? 1) - (codes[b[0]] ?? 1)).map(([docType, rows]) => ({
        doc_num: codes[docType] ?? 1,
        doc_typ: docType,
        docs: rows.map((d, i) => ({
          num: i + 1,
          from: d.from,
          to: d.to,
          totnum: d.total,
          cancel: d.cancelled,
          net_issue: d.netIssued,
        })),
      })),
    };
  }

  return out;
}

/* ───────────────────────── CSV ───────────────────────── */

export type CsvCell = string | number;

/** RFC-4180 escaping plus a guard against spreadsheet formula injection. */
export function csvCell(v: CsvCell): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export type SectionId = 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'nil' | 'hsn' | 'docs';

export const SECTION_LABELS: Record<SectionId, string> = {
  b2b: 'B2B',
  b2cl: 'B2CL',
  b2cs: 'B2CS',
  cdnr: 'CDNR',
  cdnur: 'CDNUR',
  exp: 'Exports',
  nil: 'Nil / Exempt',
  hsn: 'HSN summary',
  docs: 'Documents issued',
};

const docRows = (rows: DocRow[], head: CsvCell[], extra: (r: DocRow) => CsvCell[] = () => []): CsvCell[][] => {
  const out: CsvCell[][] = [head];
  for (const d of rows) {
    for (const it of d.items) {
      out.push([
        d.ctin, d.partyName, d.number, d.date, d.value, d.pos, d.rchrg, ...extra(d),
        it.rate, it.txval, it.igst, it.cgst, it.sgst, it.cess,
      ]);
    }
  }
  return out;
};

export function sectionCsv(r: Gstr1Report, id: SectionId): string {
  const tail = ['Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'];
  switch (id) {
    case 'b2b':
      return toCsv(docRows(r.b2b, ['GSTIN/UIN', 'Receiver', 'Invoice no', 'Invoice date', 'Invoice value', 'Place of supply', 'Reverse charge', ...tail]));
    case 'b2cl':
      return toCsv(docRows(r.b2cl, ['GSTIN/UIN', 'Receiver', 'Invoice no', 'Invoice date', 'Invoice value', 'Place of supply', 'Reverse charge', ...tail]));
    case 'cdnr':
      return toCsv(docRows(r.cdnr, ['GSTIN/UIN', 'Receiver', 'Note no', 'Note date', 'Note value', 'Place of supply', 'Reverse charge', ...tail]));
    case 'cdnur':
      return toCsv(
        docRows(r.cdnur, ['GSTIN/UIN', 'Receiver', 'Note no', 'Note date', 'Note value', 'Place of supply', 'Reverse charge', 'UR type', ...tail], (d) => [
          (d as CdnRow).unregType ?? '',
        ]),
      );
    case 'exp':
      return toCsv(
        docRows(r.exp, ['GSTIN/UIN', 'Receiver', 'Invoice no', 'Invoice date', 'Invoice value', 'Place of supply', 'Reverse charge', 'Export type', ...tail], (d) => [
          (d as typeof r.exp[number]).expType,
        ]),
      );
    case 'b2cs':
      return toCsv([
        ['Supply type', 'Place of supply', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...r.b2cs.map((x) => [x.supply, x.pos, x.rate, x.txval, x.igst, x.cgst, x.sgst, x.cess]),
      ]);
    case 'nil':
      return toCsv([
        ['Description', 'Nil rated', 'Exempted', 'Non-GST'],
        ...r.nil.map((n) => [nilLabel(n.type), n.nil, n.exempt, n.nonGst]),
      ]);
    case 'hsn':
      return toCsv([
        ['HSN/SAC', 'Description', 'UQC', 'Total quantity', 'Total value', 'Taxable value', 'Rate %', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...r.hsn.map((h) => [h.hsn, h.description, h.uqc, h.qty, h.value, h.taxable, h.rate, h.igst, h.cgst, h.sgst, h.cess]),
      ]);
    case 'docs':
      return toCsv([
        ['Document type', 'Series', 'From', 'To', 'Total issued', 'Cancelled', 'Net issued'],
        ...r.docIssue.map((d) => [d.docType, d.series, d.from, d.to, d.total, d.cancelled, d.netIssued]),
      ]);
  }
}

export function nilLabel(t: string): string {
  switch (t) {
    case 'INTRB2B': return 'Inter-state supplies to registered persons';
    case 'INTRAB2B': return 'Intra-state supplies to registered persons';
    case 'INTRB2C': return 'Inter-state supplies to unregistered persons';
    default: return 'Intra-state supplies to unregistered persons';
  }
}

/** GSTR-3B summary as flat rows (table, description, taxable, igst, cgst, sgst). */
export function gstr3bRows(b: Gstr3bReport): CsvCell[][] {
  const rowT = (t: string, d: string, r: { taxable: number; igst: number; cgst: number; sgst: number }): CsvCell[] => [t, d, r.taxable, r.igst, r.cgst, r.sgst];
  const itc = (t: string, d: string, h: { igst: number; cgst: number; sgst: number }): CsvCell[] => [t, d, '', h.igst, h.cgst, h.sgst];
  const p = b.payment;
  return [
    ['Table', 'Description', 'Taxable value', 'IGST', 'CGST', 'SGST'],
    rowT('3.1(a)', 'Outward taxable supplies (other than zero rated, nil rated, exempted)', b.outward.taxable),
    rowT('3.1(b)', 'Outward taxable supplies (zero rated)', b.outward.zeroRated),
    ['3.1(c)', 'Other outward supplies (nil rated, exempted) - inter-state', b.outward.nilExempt.inter, '', '', ''],
    ['3.1(c)', 'Other outward supplies (nil rated, exempted) - intra-state', b.outward.nilExempt.intra, '', '', ''],
    rowT('3.1(d)', 'Inward supplies (liable to reverse charge)', b.outward.inwardRcm),
    ['3.1(e)', 'Non-GST outward supplies', b.outward.nonGst, '', '', ''],
    ...b.interStateUnreg.map((u): CsvCell[] => ['3.2', `Inter-state supplies to unregistered persons, POS ${u.pos}`, u.taxable, u.igst, '', '']),
    itc('4A(3)', 'ITC available: inward supplies liable to reverse charge', b.itc.availableRcm),
    itc('4A(5)', 'ITC available: all other ITC', b.itc.availableOther),
    itc('4B(2)', 'ITC reversed: others', b.itc.reversedOther),
    itc('4C', 'Net ITC available', b.itc.net),
    itc('4D(2)', 'Ineligible ITC: others', b.itc.ineligible),
    ['5', 'Inward supplies from composition / exempt / nil - inter-state', b.inwardExempt.inter, '', '', ''],
    ['5', 'Inward supplies from composition / exempt / nil - intra-state', b.inwardExempt.intra, '', '', ''],
    itc('6.1', 'Tax payable (before ITC)', p.liability),
    itc('6.1', 'Tax payable on reverse charge (cash only)', p.rcLiability),
    ['6.1', 'ITC IGST used against IGST / CGST / SGST', '', p.itcUsed.igst.igst, p.itcUsed.igst.cgst, p.itcUsed.igst.sgst],
    ['6.1', 'ITC CGST used against IGST / CGST', '', p.itcUsed.cgst.igst, p.itcUsed.cgst.cgst, ''],
    ['6.1', 'ITC SGST used against IGST / SGST', '', p.itcUsed.sgst.igst, '', p.itcUsed.sgst.sgst],
    itc('6.1', 'Tax payable in cash', p.cash),
    itc('6.1', 'ITC carried forward', p.itcCarry),
  ];
}

export function gstr3bCsv(b: Gstr3bReport): string {
  return toCsv(gstr3bRows(b));
}

/* ───────────────────────── Printable summary ───────────────────────── */

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Standalone HTML document (own print stylesheet) for the browser's Print / Save-as-PDF. */
export function buildSummaryHtml(rep: GstReport, periodTitle: string, filerName = ''): string {
  const g1 = rep.gstr1;
  const b = rep.gstr3b;
  const t = g1.totals;
  const tr = (cells: (string | number)[], bold = false) =>
    `<tr${bold ? ' class="b"' : ''}>${cells
      .map((c, i) => (i === 0 ? `<td>${esc(c)}</td>` : `<td class="n">${typeof c === 'number' ? inr(c) : esc(c)}</td>`))
      .join('')}</tr>`;
  const sections: [string, number, number, number, number, number][] = [
    ['B2B', g1.b2b.length, sum(g1.b2b, 'taxable'), sum(g1.b2b, 'igst'), sum(g1.b2b, 'cgst'), sum(g1.b2b, 'sgst')],
    ['B2CL', g1.b2cl.length, sum(g1.b2cl, 'taxable'), sum(g1.b2cl, 'igst'), sum(g1.b2cl, 'cgst'), sum(g1.b2cl, 'sgst')],
    ['B2CS (net)', g1.b2cs.length, sum(g1.b2cs, 'txval'), sum(g1.b2cs, 'igst'), sum(g1.b2cs, 'cgst'), sum(g1.b2cs, 'sgst')],
    ['Credit notes (CDNR + CDNUR)', g1.cdnr.length + g1.cdnur.length, sum(g1.cdnr, 'taxable') + sum(g1.cdnur, 'taxable'), sum(g1.cdnr, 'igst') + sum(g1.cdnur, 'igst'), sum(g1.cdnr, 'cgst') + sum(g1.cdnur, 'cgst'), sum(g1.cdnr, 'sgst') + sum(g1.cdnur, 'sgst')],
    ['Exports', g1.exp.length, sum(g1.exp, 'taxable'), sum(g1.exp, 'igst'), 0, 0],
  ];
  const p = b.payment;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GST summary - ${esc(periodTitle)}</title>
<style>
body{font:13px/1.45 system-ui,sans-serif;color:black;margin:24px;max-width:900px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;margin:22px 0 6px;border-bottom:2px solid black;padding-bottom:3px}
p.m{color:dimgray;margin:2px 0}table{width:100%;border-collapse:collapse}
td,th{border-bottom:1px solid lightgray;padding:4px 6px;text-align:left}th{font-size:11px;text-transform:uppercase;color:dimgray}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}tr.b td{font-weight:700;border-top:1px solid black}
.w{margin-top:24px;padding:8px 10px;border:1px solid gray;font-size:12px}
@media print{body{margin:0}}
</style></head><body>
<h1>GST summary - ${esc(periodTitle)}</h1>
<p class="m">${esc(filerName)} ${g1.gstin ? 'GSTIN ' + esc(g1.gstin) : ''} · Return period ${esc(g1.fp)} · ${g1.counts.included} documents included</p>
<h2>GSTR-1 outward supplies</h2>
<table><thead><tr><th>Section</th><th class="n">Docs / rows</th><th class="n">Taxable value</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>
${sections.map((s) => `<tr><td>${esc(s[0])}</td><td class="n">${s[1]}</td><td class="n">${inr(s[2])}</td><td class="n">${inr(s[3])}</td><td class="n">${inr(s[4])}</td><td class="n">${inr(s[5])}</td></tr>`).join('')}
${tr(['Net total (all sections incl. nil lines)', '', t.taxable, t.igst, t.cgst, t.sgst], true).replace('<td class="n"></td>', '<td class="n"></td>')}
</tbody></table>
<h2>GSTR-3B</h2>
<table><thead><tr><th>Table</th><th class="n">Taxable</th><th class="n">IGST</th><th class="n">CGST</th><th class="n">SGST</th></tr></thead><tbody>
${tr(['3.1(a) Outward taxable', b.outward.taxable.taxable, b.outward.taxable.igst, b.outward.taxable.cgst, b.outward.taxable.sgst])}
${tr(['3.1(b) Zero rated', b.outward.zeroRated.taxable, b.outward.zeroRated.igst, b.outward.zeroRated.cgst, b.outward.zeroRated.sgst])}
${tr(['3.1(c) Nil / exempt (value)', b.outward.nilExempt.inter + b.outward.nilExempt.intra, '', '', ''])}
${tr(['3.1(d) Inward reverse charge', b.outward.inwardRcm.taxable, b.outward.inwardRcm.igst, b.outward.inwardRcm.cgst, b.outward.inwardRcm.sgst])}
${tr(['4C Net ITC', '', b.itc.net.igst, b.itc.net.cgst, b.itc.net.sgst])}
${tr(['6.1 Tax payable before ITC', '', p.liability.igst, p.liability.cgst, p.liability.sgst])}
${tr(['6.1 Payable in cash', '', p.cash.igst, p.cash.cgst, p.cash.sgst], true)}
${tr(['ITC carried forward', '', p.itcCarry.igst, p.itcCarry.cgst, p.itcCarry.sgst])}
</tbody></table>
<div class="w"><strong>Verify with your CA before filing.</strong> This is a working paper generated offline from your invoices; it is not a filed return, does not compute interest or late fee, and does not support cess, composition, ISD, imports or amendments.</div>
</body></html>`;
}

function sum<T>(rows: T[], key: string): number {
  return round2(rows.reduce((s, r) => s + ((r as Record<string, number>)[key] ?? 0), 0));
}
