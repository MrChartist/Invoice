/**
 * Export builders for the GST reports: GSTN offline-tool style GSTR-1 JSON,
 * per-section CSV and a printable summary document. All pure (no DOM access).
 *
 * The JSON follows the structure of the GST offline utility (b2b / b2cl /
 * b2cs / cdnr / cdnur / exp / nil / at / txpd / hsn / doc_issue / supeco and the amendment sections). It has NOT been validated
 * against the live portal schema — import it into the offline tool, let it
 * validate, and verify with your CA before filing.
 */

import { round2 } from './invoice-calc';
import { toGstnDate } from './gst-reports';
import { csvCell, toCsv as sharedToCsv } from './csv';
import { CHALLAN_DOC_TYPES } from './gst-reports';
import type {
  AdvanceTableRow,
  AmendCdnRow,
  AmendExpRow,
  EcoRow,
  AmendDocRow,
  B2csaRow,
  CdnRow,
  DocRow,
  Gstr1Report,
  Gstr3bReport,
  GstReport,
  HsnRow,
  RateRow,
} from './gst-reports';
import { escHtml as esc } from './html-esc';

/* ───────────────────────── JSON ───────────────────────── */

/** GSTN item number convention: rate * 100 + 1 (18% -> 1801). */
export const itemNum = (rate: number) => Math.round(rate * 100) + 1;

function itemDet(r: RateRow) {
  const det: Record<string, number> = { rt: r.rate, txval: round2(r.txval) };
  if (r.igst) det.iamt = round2(r.igst);
  if (r.cgst) det.camt = round2(r.cgst);
  if (r.sgst) det.samt = round2(r.sgst);
  det.csamt = round2(r.cess ?? 0);
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

/**
 * Table 12 layout in the JSON — ASSUMPTION, change here only.
 *
 * From the return period where Table 12 is split (`hsnTableSplit` in tax-rules, Jan 2025), the
 * split rows are written under `hsn.hsn_b2b` / `hsn.hsn_b2c` (believed to be the offline tool's
 * keys, not verified against the live schema). `legacy: true` also keeps the combined `hsn.data`
 * array alongside so an older reader still finds it; set it to false once the offline tool is
 * confirmed to reject or double-count it. Earlier periods always get `hsn.data` only.
 */
export const HSN_JSON_LAYOUT = { b2bKey: 'hsn_b2b', b2cKey: 'hsn_b2c', legacy: true } as const;

const hsnRows = (rows: HsnRow[]) =>
  rows.map((h, idx) => ({
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
    csamt: round2(h.cess ?? 0),
    rt: h.rate,
  }));

/**
 * Amendment sections — ASSUMPTION, change here only. Key names follow the GST offline tool as best known
 * (b2ba / b2cla / cdnra / cdnura / b2csa with `oinum`/`oidt`, `ont_num`/`ont_dt`, `omon`); they are NOT
 * verified against the current tool's schema. Import into the offline tool, let it validate, and verify
 * with your CA before filing.
 */
export const AMEND_JSON_LAYOUT = {
  b2ba: 'b2ba', b2cla: 'b2cla', cdnra: 'cdnra', cdnura: 'cdnura', b2csa: 'b2csa', expa: 'expa',
  origInvNum: 'oinum', origInvDate: 'oidt', origNoteNum: 'ont_num', origNoteDate: 'ont_dt', origMonth: 'omon',
} as const;

/**
 * E-commerce layout — ASSUMPTION, change here only; NOT verified against the current offline tool:
 *  - `etin` (operator GSTIN) on B2B / B2CL invoices and B2CS rows, B2CS `typ` "E" with an operator, "OE" without;
 *  - Table 14 under `supeco`: `clttx` = 14(a) TCS u/s 52, `paytx` = 14(b) tax paid by the operator u/s 9(5),
 *    each `[{ etin, suppval, igst, cgst, sgst, cess }]` (14(b) tax columns 0 — the supplier pays none).
 * Import into the offline tool, let it validate, and verify with your CA before filing.
 */
export const ECO_JSON_LAYOUT = { etin: 'etin', section: 'supeco', tcs: 'clttx', pay95: 'paytx', verified: false } as const;

const ecoJson = (rows: EcoRow[]) =>
  rows.map((r) => ({ etin: r.etin, suppval: round2(r.value), igst: round2(r.igst), cgst: round2(r.cgst), sgst: round2(r.sgst), cess: round2(r.cess) }));

/**
 * Table 11 (advances) JSON layout: `at` (11A, advances received) and `txpd` (11B, advances
 * adjusted), each `[{ pos, sply_ty, itms: [{ rt, ad_amt, iamt | camt + samt, csamt }] }]`, where
 * `ad_amt` is the advance EXCLUDING tax. Believed to match the offline tool, but NOT verified
 * against the live schema (same caveat as `HSN_JSON_LAYOUT`) — verify with your CA.
 */
export const ADVANCE_JSON_LAYOUT = { receivedKey: 'at', adjustedKey: 'txpd', verified: false } as const;

function advanceJson(rows: AdvanceTableRow[]) {
  const byPos = groupBy(rows, (r) => `${r.pos}|${r.supply}`);
  return [...byPos].map(([, list]) => ({
    pos: list[0].pos,
    sply_ty: list[0].supply,
    itms: list.map((r) => {
      const it: Record<string, number> = { rt: r.rate, ad_amt: round2(r.taxable) };
      if (r.supply === 'INTER') it.iamt = round2(r.igst);
      else {
        it.camt = round2(r.cgst);
        it.samt = round2(r.sgst);
      }
      it.csamt = round2(r.cess ?? 0);
      return it;
    }),
  }));
}

export interface Gstr1JsonOptions {
  /** Preceding-FY aggregate turnover (GSTN `gt`). Not derivable from this app alone — enter it yourself. */
  gt?: number;
  /** Current-FY turnover up to the previous month (GSTN `cur_gt`). Needs verification before filing. */
  curGt?: number;
}

export function buildGstr1Json(r: Gstr1Report, opts: Gstr1JsonOptions = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    gstin: r.gstin,
    fp: r.fp,
    version: 'GST3.0.4',
    hash: 'hash',
    // Aggregate turnover is not reliably derivable here — defaults to 0; pass opts or fill on the portal.
    gt: round2(opts.gt ?? 0),
    cur_gt: round2(opts.curGt ?? 0),
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
        ...(i.etin ? { [ECO_JSON_LAYOUT.etin]: i.etin } : {}),
        inv_typ: i.invTyp ?? 'R',
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
        ...(i.etin ? { [ECO_JSON_LAYOUT.etin]: i.etin } : {}),
        itms: itms(i.items),
      })),
    }));
  }

  if (r.b2cs.length) {
    out.b2cs = r.b2cs.map((x) => {
      const row: Record<string, unknown> = {
        sply_ty: x.supply,
        rt: x.rate,
        typ: x.etin ? 'E' : 'OE',
        ...(x.etin ? { [ECO_JSON_LAYOUT.etin]: x.etin } : {}),
        pos: x.pos,
        txval: round2(x.txval),
      };
      if (x.igst) row.iamt = round2(x.igst);
      if (x.cgst) row.camt = round2(x.cgst);
      if (x.sgst) row.samt = round2(x.sgst);
      row.csamt = round2(x.cess ?? 0);
      return row;
    });
  }

  if (r.cdnr.length) {
    out.cdnr = [...groupBy(r.cdnr, (x) => x.ctin)].map(([ctin, notes]) => ({
      ctin,
      nt: notes.map((n) => ({
        ntty: n.noteType,
        nt_num: n.number,
        nt_dt: toGstnDate(n.date),
        val: round2(n.value),
        pos: n.pos,
        rchrg: n.rchrg,
        // The note carries its invoice's type (SEZ with / without payment, deemed export).
        inv_typ: n.invTyp ?? 'R',
        itms: itms(n.items),
      })),
    }));
  }

  if (r.cdnur.length) {
    out.cdnur = r.cdnur.map((n: CdnRow) => ({
      typ: n.unregType ?? 'B2CL',
      ntty: n.noteType,
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
        // Shipping bill details are optional at filing time; sent only when the invoice has them.
        ...(i.sbpcode ? { sbpcode: i.sbpcode } : {}),
        ...(i.sbnum ? { sbnum: i.sbnum } : {}),
        ...(i.sbdt ? { sbdt: toGstnDate(i.sbdt) } : {}),
        itms: i.items.map((it) => {
          const row: Record<string, number> = { txval: round2(it.txval), rt: it.rate };
          if (it.igst) row.iamt = round2(it.igst);
          row.csamt = round2(it.cess ?? 0);
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

  if (r.eco && (r.eco.tcs.length || r.eco.pay95.length)) {
    out[ECO_JSON_LAYOUT.section] = {
      ...(r.eco.tcs.length ? { [ECO_JSON_LAYOUT.tcs]: ecoJson(r.eco.tcs) } : {}),
      ...(r.eco.pay95.length ? { [ECO_JSON_LAYOUT.pay95]: ecoJson(r.eco.pay95) } : {}),
    };
  }

  if (r.at?.length) out[ADVANCE_JSON_LAYOUT.receivedKey] = advanceJson(r.at);
  if (r.txpd?.length) out[ADVANCE_JSON_LAYOUT.adjustedKey] = advanceJson(r.txpd);

  if (r.hsn.length) {
    const block: Record<string, unknown> = {};
    if (HSN_JSON_LAYOUT.legacy || !r.hsnSplit) block.data = hsnRows(r.hsn);
    if (r.hsnSplit) {
      block[HSN_JSON_LAYOUT.b2bKey] = hsnRows(r.hsnB2b ?? []);
      block[HSN_JSON_LAYOUT.b2cKey] = hsnRows(r.hsnB2c ?? []);
    }
    out.hsn = block;
  }

  const am = r.amendments;
  if (am) {
    const L = AMEND_JSON_LAYOUT;
    const orig = (x: AmendDocRow) => ({ [L.origInvNum]: x.origNumber, [L.origInvDate]: toGstnDate(x.origDate) });
    const origNote = (x: AmendDocRow) => ({ [L.origNoteNum]: x.origNumber, [L.origNoteDate]: toGstnDate(x.origDate) });
    if (am.expa?.length) {
      out[L.expa] = [...groupBy(am.expa, (x: AmendExpRow) => x.expType)].map(([expType, invs]) => ({
        exp_typ: expType,
        inv: invs.map((i) => ({
          ...orig(i),
          inum: i.number,
          idt: toGstnDate(i.date),
          val: round2(i.value),
          ...(i.sbpcode ? { sbpcode: i.sbpcode } : {}),
          ...(i.sbnum ? { sbnum: i.sbnum } : {}),
          ...(i.sbdt ? { sbdt: toGstnDate(i.sbdt) } : {}),
          itms: i.items.map((it) => {
            const row: Record<string, number> = { txval: round2(it.txval), rt: it.rate };
            if (it.igst) row.iamt = round2(it.igst);
            row.csamt = round2(it.cess ?? 0);
            return row;
          }),
        })),
      }));
    }
    if (am.b2ba.length) {
      out[L.b2ba] = [...groupBy(am.b2ba, (x) => x.ctin)].map(([ctin, invs]) => ({
        ctin,
        inv: invs.map((i) => ({
          ...orig(i),
          inum: i.number,
          idt: toGstnDate(i.date),
          val: round2(i.value),
          pos: i.pos,
          rchrg: i.rchrg,
          ...(i.etin ? { [ECO_JSON_LAYOUT.etin]: i.etin } : {}),
          inv_typ: i.invTyp ?? 'R',
          itms: itms(i.items),
        })),
      }));
    }
    if (am.b2cla.length) {
      out[L.b2cla] = [...groupBy(am.b2cla, (x) => x.pos)].map(([pos, invs]) => ({
        pos,
        inv: invs.map((i) => ({ ...orig(i), inum: i.number, idt: toGstnDate(i.date), val: round2(i.value), itms: itms(i.items) })),
      }));
    }
    if (am.cdnra.length) {
      out[L.cdnra] = [...groupBy(am.cdnra, (x) => x.ctin)].map(([ctin, notes]) => ({
        ctin,
        nt: notes.map((n: AmendCdnRow) => ({
          ...origNote(n),
          ntty: n.noteType,
          nt_num: n.number,
          nt_dt: toGstnDate(n.date),
          val: round2(n.value),
          pos: n.pos,
          rchrg: n.rchrg,
          inv_typ: n.invTyp ?? 'R',
          itms: itms(n.items),
        })),
      }));
    }
    if (am.cdnura.length) {
      out[L.cdnura] = am.cdnura.map((n) => ({
        ...origNote(n),
        typ: n.unregType ?? 'B2CL',
        ntty: n.noteType,
        nt_num: n.number,
        nt_dt: toGstnDate(n.date),
        val: round2(n.value),
        pos: n.pos,
        itms: itms(n.items),
      }));
    }
    if (am.b2csa.length) {
      out[L.b2csa] = [...groupBy(am.b2csa, (x: B2csaRow) => `${x.omon}|${x.pos}|${x.supply}|${x.etin ?? ''}`)].map(([, rows]) => ({
        [L.origMonth]: rows[0].omon,
        sply_ty: rows[0].supply,
        pos: rows[0].pos,
        typ: rows[0].etin ? 'E' : 'OE',
        ...(rows[0].etin ? { [ECO_JSON_LAYOUT.etin]: rows[0].etin } : {}),
        itms: rows.map((x) => {
          const it: Record<string, number> = { rt: x.rate, txval: round2(x.txval) };
          if (x.igst) it.iamt = round2(x.igst);
          if (x.cgst) it.camt = round2(x.cgst);
          if (x.sgst) it.samt = round2(x.sgst);
          it.csamt = round2(x.cess ?? 0);
          return it;
        }),
      }));
    }
  }

  if (r.docIssue.length) {
    const codes: Record<string, number> = { 'Invoices for outward supply': 1, 'Debit Note': 4, 'Credit Note': 5, 'Receipt Voucher': 6, 'Refund Voucher': 8 };
    for (const c of Object.values(CHALLAN_DOC_TYPES)) codes[c.name] = c.num;
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

export { csvCell };

/** GST CSV files end with a trailing CRLF (the portal's offline tool expects it). */
export function toCsv(rows: CsvCell[][]): string {
  return sharedToCsv(rows) + '\r\n';
}

export type SectionId = 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'nil' | 'at' | 'txpd' | 'hsn' | 'docs' | 'amend' | 'eco';

export const SECTION_LABELS: Record<SectionId, string> = {
  b2b: 'B2B',
  b2cl: 'B2CL',
  b2cs: 'B2CS',
  cdnr: 'CDNR',
  cdnur: 'CDNUR',
  exp: 'Exports',
  nil: 'Nil / Exempt',
  at: 'Advances received (11A)',
  txpd: 'Advances adjusted (11B)',
  hsn: 'HSN summary',
  docs: 'Documents issued',
  amend: 'Amendments',
  eco: 'E-commerce (Table 14)',
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
      return toCsv(withEtin(docRows(r.b2b, ['GSTIN/UIN', 'Receiver', 'Invoice no', 'Invoice date', 'Invoice value', 'Place of supply', 'Reverse charge', ...tail]), r.b2b));
    case 'b2cl':
      return toCsv(withEtin(docRows(r.b2cl, ['GSTIN/UIN', 'Receiver', 'Invoice no', 'Invoice date', 'Invoice value', 'Place of supply', 'Reverse charge', ...tail]), r.b2cl));
    case 'eco': {
      const out: CsvCell[][] = [['Table', 'Nature of supply', 'E-commerce operator GSTIN', 'Documents', 'Net value of supplies', 'IGST', 'CGST', 'SGST', 'Cess']];
      for (const x of r.eco?.tcs ?? []) out.push(['14(a)', 'Operator collects TCS u/s 52', x.etin, x.count, x.value, x.igst, x.cgst, x.sgst, x.cess]);
      for (const x of r.eco?.pay95 ?? []) out.push(['14(b)', 'Operator pays tax u/s 9(5)', x.etin, x.count, x.value, x.igst, x.cgst, x.sgst, x.cess]);
      return toCsv(out);
    }
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
        docRows(r.exp, ['GSTIN/UIN', 'Receiver', 'Invoice no', 'Invoice date', 'Invoice value', 'Place of supply', 'Reverse charge', 'Export type', 'Port code', 'Shipping bill no', 'Shipping bill date', ...tail], (d) => {
          const x = d as typeof r.exp[number];
          return [x.expType, x.sbpcode ?? '', x.sbnum ?? '', x.sbdt ?? ''];
        }),
      );
    case 'b2cs':
      return toCsv([
        ['Supply type', 'Place of supply', 'Rate %', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess', 'E-commerce GSTIN'],
        ...r.b2cs.map((x) => [x.supply, x.pos, x.rate, x.txval, x.igst, x.cgst, x.sgst, x.cess, x.etin ?? '']),
      ]);
    case 'nil':
      return toCsv([
        ['Description', 'Nil rated', 'Exempted', 'Non-GST'],
        ...r.nil.map((n) => [nilLabel(n.type), n.nil, n.exempt, n.nonGst]),
      ]);
    case 'at':
    case 'txpd':
      return toCsv([
        ['Place of supply', 'Supply type', 'Rate %', 'Gross advance (incl. tax)', id === 'at' ? 'Advance received (excl. tax)' : 'Advance adjusted (excl. tax)', 'IGST', 'CGST', 'SGST', 'Cess'],
        ...((id === 'at' ? r.at : r.txpd) ?? []).map((x) => [x.pos, x.supply, x.rate, x.gross, x.taxable, x.igst, x.cgst, x.sgst, x.cess]),
      ]);
    case 'hsn': {
      const head = ['HSN/SAC', 'Description', 'UQC', 'Total quantity', 'Total value', 'Taxable value', 'Rate %', 'IGST', 'CGST', 'SGST', 'Cess'];
      const cells = (h: HsnRow) => [h.hsn, h.description, h.uqc, h.qty, h.value, h.taxable, h.rate, h.igst, h.cgst, h.sgst, h.cess];
      if (!r.hsnSplit) return toCsv([head, ...r.hsn.map(cells)]);
      // Split periods: one file, a leading Table column (B2B / B2C) as on the portal's two tabs.
      return toCsv([
        ['Table', ...head],
        ...(r.hsnB2b ?? []).map((h) => ['B2B', ...cells(h)]),
        ...(r.hsnB2c ?? []).map((h) => ['B2C', ...cells(h)]),
      ]);
    }
    case 'amend': {
      const am = r.amendments;
      const out: CsvCell[][] = [['Table', 'GSTIN/UIN', 'Receiver', 'Original no', 'Original date', 'Original period', 'Revised no', 'Revised date', 'Value', 'Place of supply', 'Note type', ...tail]];
      const push = (table: string, rows: AmendDocRow[]) => {
        for (const d of rows) {
          for (const it of d.items) {
            out.push([table, d.ctin, d.partyName, d.origNumber, d.origDate, d.origPeriod, d.number, d.date, d.value, d.pos, (d as AmendCdnRow).noteType ?? '', it.rate, it.txval, it.igst, it.cgst, it.sgst, it.cess]);
          }
        }
      };
      if (am) {
        push('EXPA', am.expa ?? []);
        push('B2BA', am.b2ba);
        push('B2CLA', am.b2cla);
        push('CDNRA', am.cdnra);
        push('CDNURA', am.cdnura);
        for (const x of am.b2csa) out.push(['B2CSA', '', `${x.supply === 'INTRA' ? 'Intra' : 'Inter'}-state, original month ${x.omon}`, '', '', x.omon, '', '', '', x.pos, '', x.rate, x.txval, x.igst, x.cgst, x.sgst, x.cess]);
      }
      return toCsv(out);
    }
    case 'docs':
      return toCsv([
        ['Document type', 'Series', 'From', 'To', 'Total issued', 'Cancelled', 'Net issued'],
        ...r.docIssue.map((d) => [d.docType, d.series, d.from, d.to, d.total, d.cancelled, d.netIssued]),
      ]);
  }
}

/** Appends the e-commerce operator GSTIN column (one row per rate row of each document). */
function withEtin(rows: CsvCell[][], docs: DocRow[]): CsvCell[][] {
  const etins = docs.flatMap((d) => d.items.map(() => d.etin ?? ''));
  return rows.map((row, i) => [...row, i === 0 ? 'E-commerce GSTIN' : etins[i - 1] ?? '']);
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
    ...(b.advances
      ? [
          rowT('3.1(a)', 'of which: tax on advances received (GSTR-1 Table 11A)', b.advances.received),
          rowT('3.1(a)', 'of which: advances adjusted / refunded (GSTR-1 Table 11B), deducted', b.advances.adjusted),
        ]
      : []),
    rowT('3.1(b)', 'Outward taxable supplies (zero rated)', b.outward.zeroRated),
    ['3.1(c)', 'Other outward supplies (nil rated, exempted) - inter-state', b.outward.nilExempt.inter, '', '', ''],
    ['3.1(c)', 'Other outward supplies (nil rated, exempted) - intra-state', b.outward.nilExempt.intra, '', '', ''],
    rowT('3.1(d)', 'Inward supplies (liable to reverse charge)', b.outward.inwardRcm),
    ['3.1(e)', 'Non-GST outward supplies', b.outward.nonGst, '', '', ''],
    ...(b.ecoSupplies95 !== undefined
      ? [['3.1.1(ii)', 'Taxable supplies made through an e-commerce operator that pays tax u/s 9(5) (value only)', b.ecoSupplies95, '', '', ''] as CsvCell[]]
      : []),
    ...b.interStateUnreg.map((u): CsvCell[] => ['3.2', `Inter-state supplies to unregistered persons, POS ${u.pos}`, u.taxable, u.igst, '', '']),
    itc('4A(1)', 'ITC available: import of goods', b.itc.importGoods),
    itc('4A(2)', 'ITC available: import of services', b.itc.importServices),
    itc('4A(3)', 'ITC available: inward supplies liable to reverse charge', b.itc.availableRcm),
    itc('4A(5)', 'ITC available: all other ITC', b.itc.availableOther),
    itc('4B(1)', 'ITC reversed: rules 38, 42, 43 and section 17(5)', b.itc.reversedRules),
    itc('4B(2)', 'ITC reversed: others', b.itc.reversedOther),
    ...(b.itc.isd ? [itc('4A(4)', 'ITC available: inward supplies from ISD', b.itc.isd)] : []),
    itc('4C', 'Net ITC available', b.itc.netSigned ?? b.itc.net),
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
    // Cess has its own column on the portal; here the amount sits in the value column.
    ...(p.cess ? [['6.1', 'Cess payable in cash (value column = cess amount)', p.cess, '', '', ''] as CsvCell[]] : []),
  ];
}

/**
 * GSTR-3B in the portal's JSON section layout (3.1 sup_details, 3.2 inter_sup, 4 itc_elg,
 * 5 inward_sup). Table 6.1 (payment) is computed by the portal and left out. A working paper:
 * the key names follow the GSTN JSON and must be checked against the current offline tool —
 * verify with your CA before uploading.
 */
/** 7R: GSTR-3B JSON choices that are not verified against the offline tool (flip here once confirmed). */
export const GSTR3B_JSON_LAYOUT = { signedNetItc: true } as const;

export function buildGstr3bJson(b: Gstr3bReport, gstin: string, retPeriod: string): Record<string, unknown> {
  const r = (n: number) => round2(n ?? 0);
  const tax = (t: { taxable?: number; igst: number; cgst: number; sgst: number; cess: number }, withTxval = true) => ({
    ...(withTxval ? { txval: r(t.taxable ?? 0) } : {}),
    iamt: r(t.igst),
    camt: r(t.cgst),
    samt: r(t.sgst),
    csamt: r(t.cess),
  });
  const itc = (ty: string, h: { igst: number; cgst: number; sgst: number; cess: number }) => ({ ty, ...tax(h, false) });
  const zero = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
  return {
    gstin,
    ret_period: retPeriod,
    sup_details: {
      osup_det: tax(b.outward.taxable),
      osup_zero: { txval: r(b.outward.zeroRated.taxable), iamt: r(b.outward.zeroRated.igst), csamt: r(b.outward.zeroRated.cess) },
      osup_nil_exmp: { txval: r(b.outward.nilExempt.inter + b.outward.nilExempt.intra) },
      isup_rev: tax(b.outward.inwardRcm),
      osup_nongst: { txval: r(b.outward.nonGst) },
    },
    inter_sup: {
      unreg_details: b.interStateUnreg.map((u) => ({ pos: u.pos, txval: r(u.taxable), iamt: r(u.igst) })),
      comp_details: [],
      uin_details: [],
    },
    itc_elg: {
      itc_avl: [
        itc('IMPG', b.itc.importGoods),
        itc('IMPS', b.itc.importServices),
        itc('ISRC', b.itc.availableRcm),
        itc('ISD', b.itc.isd ?? zero),
        itc('OTH', b.itc.availableOther),
      ],
      itc_rev: [itc('RUL', b.itc.reversedRules), itc('OTH', b.itc.reversedOther)],
      // 7R (7.124): Table 4(C) = 4(A) − 4(B) as the portal computes it, SIGNED. When reversals / supplier notes exceed
      // the period's ITC the portal shows a negative 4(C) (and adds it to the liability in 6.1 — Circular
      // 170/02/2022-GST as understood), so the JSON no longer floors it at zero. `GSTR3B_JSON_LAYOUT.signedNetItc`
      // switches back to the floored figure if the offline tool rejects a negative value. Verify with your CA.
      itc_net: tax(GSTR3B_JSON_LAYOUT.signedNetItc ? b.itc.netSigned ?? b.itc.net : b.itc.net, false),
      itc_inelg: [itc('RUL', zero), itc('OTH', b.itc.ineligible)],
    },
    inward_sup: {
      isup_details: [
        { ty: 'GST', inter: r(b.inwardExempt.inter), intra: r(b.inwardExempt.intra) },
        { ty: 'NONGST', inter: 0, intra: 0 },
      ],
    },
    // Table 3.1.1 — key names (`eco_dtls`, `eco_sup` = (i) the operator's own, `eco_reg_sup` = (ii) the supplier's)
    // believed to match the GSTN JSON, NOT verified. Only written when the period has such supplies.
    ...(b.ecoSupplies95 !== undefined
      ? { eco_dtls: { eco_sup: { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }, eco_reg_sup: { txval: r(b.ecoSupplies95) } } }
      : {}),
  };
}

export function gstr3bCsv(b: Gstr3bReport): string {
  return toCsv(gstr3bRows(b));
}

/* ───────────────────────── Printable summary ───────────────────────── */


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
  const at = g1.at ?? [];
  const txpd = g1.txpd ?? [];
  if (at.length) sections.push(['Advances received (11A)', at.length, sum(at, 'taxable'), sum(at, 'igst'), sum(at, 'cgst'), sum(at, 'sgst')]);
  if (txpd.length) sections.push(['Advances adjusted (11B, deducted)', txpd.length, sum(txpd, 'taxable'), sum(txpd, 'igst'), sum(txpd, 'cgst'), sum(txpd, 'sgst')]);
  const ecoT = g1.eco?.tcs ?? [];
  const eco95 = g1.eco?.pay95 ?? [];
  if (ecoT.length) sections.push(['Table 14(a) through e-commerce (TCS u/s 52, included above)', ecoT.length, sum(ecoT, 'value'), sum(ecoT, 'igst'), sum(ecoT, 'cgst'), sum(ecoT, 'sgst')]);
  if (eco95.length) sections.push(['Table 14(b) e-commerce operator pays tax u/s 9(5) (value only)', eco95.length, sum(eco95, 'value'), 0, 0, 0]);
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
${tr(['Net total of documents (incl. nil lines; advances excluded)', '', t.taxable, t.igst, t.cgst, t.sgst], true).replace('<td class="n"></td>', '<td class="n"></td>')}
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
<div class="w"><strong>Verify with your CA before filing.</strong> This is a working paper generated offline from your invoices; it is not a filed return, does not compute interest or late fee, and does not cover composition returns (see CMP-08 / GSTR-4), ISD or imports. Amendment tables (B2BA, B2CLA, CDNRA, CDNURA, B2CSA, EXPA) and e-commerce Table 14 follow the offline-tool layout as best known.</div>
</body></html>`;
}

function sum<T>(rows: T[], key: string): number {
  return round2(rows.reduce((s, r) => s + ((r as Record<string, number>)[key] ?? 0), 0));
}
