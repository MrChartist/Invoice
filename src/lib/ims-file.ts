/**
 * IMS working file (R2-C3): the period's IMS decisions — Accept / Reject / Pending, ITC reduction on
 * credit notes, declared (partial) ITC on invoices, remarks — as JSON and as XLSX rows, so the portal
 * action and GSTR-3B can be matched with the books.
 *
 * The JSON borrows the portal's short keys (ctin, inum, idt, rtnprd) but its layout is UNVERIFIED: it is
 * a working paper to read and key in, not a file the GST portal accepts. Verify with your CA.
 * Pure (no storage, no browser APIs).
 */

import {
  actionId,
  effectiveDeclaredItc,
  effectiveReduction,
  headsTotal,
  imsIssues,
  imsSummary,
  reductionApplies,
  type Gstr2bAction,
  type MatchResult,
  type TaxHeads,
} from './gstr2b';

export const IMS_FILE_FORMAT = 'mrchartist-ims-working-v1';
export const IMS_LAYOUT_NOTE = 'Layout unverified — working paper, not a portal upload file — verify with your CA.';

const ACTION_CODE = { ACCEPT: 'A', REJECT: 'R', PENDING: 'P' } as const;

export interface ImsFileDoc {
  section: string;
  ctin: string;
  trdnm: string;
  /** Document number as printed and its date (YYYY-MM-DD, '' when unknown). */
  inum: string;
  idt: string;
  typ: string;
  /** Signed like the 2B: credit notes negative. */
  txval: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  action: 'A' | 'R' | 'P';
  /** True when no decision was recorded (deemed accepted, as on the portal). */
  deemed: boolean;
  itc_reduction?: TaxHeads;
  declared_itc?: TaxHeads;
  remark?: string;
}

export interface ImsFile {
  format: typeof IMS_FILE_FORMAT;
  note: string;
  gstin: string;
  rtnprd: string;
  generated_on: string;
  docs: ImsFileDoc[];
  summary: {
    accepted: number;
    rejected: number;
    pending: number;
    itc_reduction: TaxHeads;
    itc_not_claimed: TaxHeads;
  };
  issues: string[];
}

export function buildImsFile(
  match: Pick<MatchResult, 'rows'>,
  actions: ReadonlyMap<string, Gstr2bAction>,
  period: string,
  opts: { gstin?: string; generatedOn?: string; remarksOn?: boolean } = {},
): ImsFile {
  const docs: ImsFileDoc[] = [];
  for (const r of match.rows) {
    const l = r.line;
    if (!l) continue;
    const a = actions.get(actionId(period, l));
    const act = a?.action ?? 'ACCEPT';
    const red = effectiveReduction(l, a);
    const doc: ImsFileDoc = {
      section: l.section,
      ctin: l.ctin,
      trdnm: l.tradeName,
      inum: l.number,
      idt: l.date,
      typ: l.docType,
      txval: l.sign * l.taxable || 0,
      igst: l.sign * l.igst || 0,
      cgst: l.sign * l.cgst || 0,
      sgst: l.sign * l.sgst || 0,
      cess: l.sign * l.cess || 0,
      action: ACTION_CODE[act],
      deemed: !a,
      ...(reductionApplies(l) && act !== 'REJECT' ? { itc_reduction: red } : {}),
      ...(a?.declared_itc ? { declared_itc: effectiveDeclaredItc(l, a) } : {}),
      ...(a?.remark ? { remark: a.remark } : {}),
    };
    docs.push(doc);
  }
  const s = imsSummary(match, actions, period);
  return {
    format: IMS_FILE_FORMAT,
    note: IMS_LAYOUT_NOTE,
    gstin: (opts.gstin ?? '').toUpperCase(),
    rtnprd: period,
    generated_on: opts.generatedOn ?? new Date().toISOString(),
    docs,
    summary: { accepted: s.accepted, rejected: s.rejected, pending: s.pending, itc_reduction: s.reduction, itc_not_claimed: s.notClaimed },
    issues: imsIssues(match, actions, period, opts.remarksOn !== false).map((i) => i.message),
  };
}

const heads = (h?: TaxHeads): (number | string)[] => (h ? [h.igst, h.cgst, h.sgst, h.cess] : ['', '', '', '']);

/** XLSX sheets of the working file: decisions, then the summary with the layout note. */
export function imsFileSheets(file: ImsFile): { name: string; rows: (string | number)[][] }[] {
  const decisions: (string | number)[][] = [[
    'Section', 'Supplier GSTIN', 'Supplier name', 'Document no', 'Document date', 'Type', 'Taxable value', 'IGST', 'CGST', 'SGST', 'Cess',
    'IMS action', 'Deemed', 'ITC reduction IGST', 'ITC reduction CGST', 'ITC reduction SGST', 'ITC reduction cess',
    'Declared ITC IGST', 'Declared ITC CGST', 'Declared ITC SGST', 'Declared ITC cess', 'Remark',
  ]];
  for (const d of file.docs) {
    decisions.push([
      d.section, d.ctin, d.trdnm, d.inum, d.idt, d.typ, d.txval, d.igst, d.cgst, d.sgst, d.cess,
      d.action, d.deemed ? 'Y' : 'N', ...heads(d.itc_reduction), ...heads(d.declared_itc), d.remark ?? '',
    ]);
  }
  const s = file.summary;
  const summary: (string | number)[][] = [
    ['IMS working file', file.note],
    ['GSTIN', file.gstin || '—'],
    ['Return period', file.rtnprd],
    ['Generated on', file.generated_on],
    ['Accepted', s.accepted],
    ['Rejected', s.rejected],
    ['Pending', s.pending],
    ['', 'IGST', 'CGST', 'SGST', 'Cess', 'Total'],
    ['ITC reduction (credit notes)', ...heads(s.itc_reduction), headsTotal(s.itc_reduction)],
    ['ITC not claimed (partial invoices)', ...heads(s.itc_not_claimed), headsTotal(s.itc_not_claimed)],
    ...file.issues.map((i) => ['Check', i]),
  ];
  return [
    { name: 'IMS decisions', rows: decisions },
    { name: 'Summary', rows: summary },
  ];
}
