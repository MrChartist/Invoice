/**
 * Input Service Distributor (7R, 7.122) — table `isd_documents`.
 *
 * Two roles, one table (`kind`):
 *  - We ARE the ISD (a separate registration of the company): `INWARD` rows are input-service invoices (and supplier
 *    credit notes, `credit_note`) received by the ISD; `DISTRIBUTION` rows are the ISD invoices / credit notes it
 *    issues to the units (distinct persons with the same PAN), numbered `ISD/FY<yy-yy>/<seq>` (Rule 54(1), never
 *    re-issued — series-counters). `planIsdDistribution` works out the shares under Rule 39: the month's credit
 *    is distributed in the same month, among the recipient units in the ratio of their turnover of the previous FY
 *    (`turnover` typed per unit), ineligible credit separately; IGST credit is distributed as IGST; CGST + SGST
 *    credit as CGST + SGST to a unit in the ISD's State and as IGST to a unit in another State; cess as cess.
 *    `buildGstr6` is the GSTR-6 working paper (Tables 3, 4, 5 and 8) with the 13th-of-next-month due date
 *    (`gstr6DueDate`, gst-penalties.ts).
 *  - We are a UNIT receiving ISD credit: `RECEIVED` rows (the distributor's ISD invoice). GSTR-3B 4A(4) and GSTR-9 6G
 *    read them through `isdInwardRows` (`BuildOptions.isdInward`, additive).
 *
 * Nothing here posts to the ledger (the units' books record the credit through their own journals — verify with
 * your CA how inter-unit ISD credit is accounted). From 1 Apr 2025 ISD is mandatory for common input services
 * (`ISD_MANDATORY_RULES`). Working paper — not validated against the GST portal; verify with your CA.
 * Pure above the "Storage" divider.
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { gstr6DueDate } from './gst-penalties';
import { checkGstin } from './gstin';
import { num, round2 } from './invoice-calc';
import { assertUnlocked } from './period-lock';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';
import { generateId, getTable, setTable } from './storage';
import { toCsv } from './csv';

export const ISD_TABLE = 'isd_documents';
export const ISD_PREFIX = 'ISD';
export const ISD_DISCLAIMER = 'Working paper: Input Service Distributor credit and GSTR-6 prepared offline; not validated against the GST portal. Verify the distribution ratio, the heads and the dates with your CA.';

export type IsdKind = 'INWARD' | 'DISTRIBUTION' | 'RECEIVED';
export const ISD_KINDS: readonly IsdKind[] = ['INWARD', 'DISTRIBUTION', 'RECEIVED'];

export interface IsdHeads {
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface IsdDoc {
  id: string;
  kind: IsdKind;
  /** Document date (local day). */
  date: string;
  /** Supplier's invoice no. (INWARD), our ISD document no. (DISTRIBUTION), the distributor's ISD invoice no. (RECEIVED). */
  number: string;
  /** The ISD registration (ours for INWARD / DISTRIBUTION; the distributor's for RECEIVED). */
  isd_gstin: string;
  /** Supplier (INWARD), recipient unit (DISTRIBUTION), our unit (RECEIVED). */
  party_gstin: string;
  party_name: string;
  taxable?: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  /** False = ineligible credit (Sec 17(5) etc.) — distributed / received separately. */
  eligible: boolean;
  /** A supplier credit note (INWARD) or an ISD credit note (DISTRIBUTION / RECEIVED): reduces credit. */
  credit_note?: boolean;
  /** DISTRIBUTION: the month (`YYYY-MM`) whose credit it distributes. */
  month?: string;
  notes?: string;
  created_at?: string;
}

export type IsdInput = Omit<IsdDoc, 'id' | 'created_at'> & { id?: string };

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const sign = (d: Pick<IsdDoc, 'credit_note'>) => (d.credit_note ? -1 : 1);
const zero = (): IsdHeads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
export const isdTotal = (h: IsdHeads) => round2(h.igst + h.cgst + h.sgst + h.cess);
const addH = (t: IsdHeads, h: Partial<IsdHeads>, f = 1) => {
  t.igst = round2(t.igst + f * num(h.igst));
  t.cgst = round2(t.cgst + f * num(h.cgst));
  t.sgst = round2(t.sgst + f * num(h.sgst));
  t.cess = round2(t.cess + f * num(h.cess));
};

/** Credit received by the ISD in a month (`YYYY-MM`), eligible and ineligible, net of supplier credit notes. */
export function isdCreditPool(docs: readonly IsdDoc[], month: string, isdGstin = ''): { eligible: IsdHeads; ineligible: IsdHeads; count: number } {
  const eligible = zero();
  const ineligible = zero();
  let count = 0;
  for (const d of docs) {
    if (d.kind !== 'INWARD' || d.date.slice(0, 7) !== month || (isdGstin && d.isd_gstin !== isdGstin)) continue;
    addH(d.eligible ? eligible : ineligible, d, sign(d));
    count++;
  }
  return { eligible, ineligible, count };
}

/** Credit already distributed for a month (DISTRIBUTION rows tagged with that month). */
export function isdDistributed(docs: readonly IsdDoc[], month: string, isdGstin = ''): { eligible: IsdHeads; ineligible: IsdHeads } {
  const eligible = zero();
  const ineligible = zero();
  for (const d of docs) {
    if (d.kind !== 'DISTRIBUTION' || (d.month ?? d.date.slice(0, 7)) !== month || (isdGstin && d.isd_gstin !== isdGstin)) continue;
    addH(d.eligible ? eligible : ineligible, d, sign(d));
  }
  return { eligible, ineligible };
}

export interface IsdUnit {
  gstin: string;
  name: string;
  /** Turnover in the relevant period (previous FY; last quarter when a unit had none) — Rule 39(1)(d). */
  turnover: number;
}

export interface IsdShare {
  gstin: string;
  name: string;
  stateCode: string;
  ratio: number;
  eligible: IsdHeads;
  ineligible: IsdHeads;
}

/**
 * Rule 39 shares of a credit pool among `units` (by turnover), from an ISD in `isdState`. IGST → IGST; CGST and
 * SGST → CGST / SGST in the ISD's State, IGST elsewhere; cess → cess. Rounding goes to the last unit so the shares
 * add up to the pool. Units with no turnover get nothing (warning in `warnings`).
 */
export function planIsdDistribution(pool: { eligible: IsdHeads; ineligible: IsdHeads }, units: readonly IsdUnit[], isdState: string): { shares: IsdShare[]; warnings: string[] } {
  const warnings: string[] = [];
  const live = units.filter((u) => num(u.turnover) > 0);
  for (const u of units) if (!(num(u.turnover) > 0)) warnings.push(`${u.name || u.gstin}: no turnover entered, nothing distributed to it.`);
  for (const u of units) if (!checkGstin(u.gstin).valid) warnings.push(`${u.name || u.gstin}: recipient GSTIN is not valid.`);
  const total = live.reduce((t, u) => t + num(u.turnover), 0);
  if (!(total > 0)) return { shares: [], warnings: [...warnings, 'Enter the turnover of at least one recipient unit.'] };
  const split = (src: IsdHeads): IsdHeads[] => {
    const out = live.map(() => zero());
    for (const head of ['igst', 'cgst', 'sgst', 'cess'] as const) {
      let left = round2(src[head]);
      live.forEach((u, i) => {
        const part = i === live.length - 1 ? left : round2((src[head] * num(u.turnover)) / total);
        left = round2(left - part);
        const same = u.gstin.slice(0, 2) === isdState;
        if (head === 'igst' || head === 'cess') out[i][head] = round2(out[i][head] + part);
        else if (same) out[i][head] = round2(out[i][head] + part);
        else out[i].igst = round2(out[i].igst + part);
      });
    }
    return out;
  };
  const el = split(pool.eligible);
  const inel = split(pool.ineligible);
  return {
    shares: live.map((u, i) => ({ gstin: u.gstin.toUpperCase(), name: u.name, stateCode: u.gstin.slice(0, 2), ratio: round2((num(u.turnover) / total) * 10000) / 10000, eligible: el[i], ineligible: inel[i] })),
    warnings,
  };
}

export interface Gstr6Paper {
  month: string;
  isdGstin: string;
  due: string;
  /** Table 3: ITC received (inward invoices; credit notes listed with a minus sign — Table 6B/8 on the portal). */
  table3: { gstin: string; name: string; number: string; date: string; taxable: number; heads: IsdHeads; eligible: boolean; creditNote: boolean }[];
  /** Table 4: total ITC / eligible / ineligible. */
  table4: { total: IsdHeads; eligible: IsdHeads; ineligible: IsdHeads };
  /** Table 5: distribution by recipient (ISD invoices); Table 8: ISD credit notes. */
  table5: { gstin: string; name: string; number: string; date: string; heads: IsdHeads; eligible: boolean }[];
  table8: { gstin: string; name: string; number: string; date: string; heads: IsdHeads; eligible: boolean }[];
  undistributed: { eligible: IsdHeads; ineligible: IsdHeads };
  warnings: string[];
}

/** GSTR-6 working paper for an ISD registration and month. */
export function buildGstr6(docs: readonly IsdDoc[], month: string, isdGstin: string): Gstr6Paper {
  const warnings: string[] = [];
  const mine = docs.filter((d) => !isdGstin || d.isd_gstin === isdGstin);
  const inward = mine.filter((d) => d.kind === 'INWARD' && d.date.slice(0, 7) === month);
  const dist = mine.filter((d) => d.kind === 'DISTRIBUTION' && (d.month ?? d.date.slice(0, 7)) === month);
  const pool = isdCreditPool(mine, month);
  const done = isdDistributed(mine, month);
  const total = zero();
  addH(total, pool.eligible);
  addH(total, pool.ineligible);
  const undistributed = { eligible: zero(), ineligible: zero() };
  addH(undistributed.eligible, pool.eligible);
  addH(undistributed.eligible, done.eligible, -1);
  addH(undistributed.ineligible, pool.ineligible);
  addH(undistributed.ineligible, done.ineligible, -1);
  // Distribution may move CGST / SGST into IGST: compare totals, not heads.
  const left = round2(isdTotal(undistributed.eligible) + isdTotal(undistributed.ineligible));
  if (left > 0.5) warnings.push(`₹${left.toFixed(2)} of this month's credit is not distributed yet, Rule 39(1)(a): distribute it in the same month.`);
  if (left < -0.5) warnings.push(`Distributed ₹${(-left).toFixed(2)} more than the credit received this month.`);
  for (const d of dist) {
    if (d.date.slice(0, 7) !== month) warnings.push(`ISD document ${d.number} is dated ${d.date}, outside ${month} whose credit it distributes (Rule 39(1)(a)).`);
    if (!checkGstin(d.party_gstin).valid) warnings.push(`ISD document ${d.number}: recipient GSTIN ${d.party_gstin || '-'} is not valid.`);
  }
  for (const d of inward) if (!checkGstin(d.party_gstin).valid) warnings.push(`Invoice ${d.number}: supplier GSTIN ${d.party_gstin || '-'} is not valid.`);
  const heads = (d: IsdDoc): IsdHeads => ({ igst: d.igst, cgst: d.cgst, sgst: d.sgst, cess: d.cess });
  return {
    month,
    isdGstin,
    due: gstr6DueDate(`${month}-01`),
    table3: inward.map((d) => ({ gstin: d.party_gstin, name: d.party_name, number: d.number, date: d.date, taxable: round2(num(d.taxable)), heads: heads(d), eligible: d.eligible, creditNote: !!d.credit_note })),
    table4: { total, eligible: pool.eligible, ineligible: pool.ineligible },
    table5: dist.filter((d) => !d.credit_note).map((d) => ({ gstin: d.party_gstin, name: d.party_name, number: d.number, date: d.date, heads: heads(d), eligible: d.eligible })),
    table8: dist.filter((d) => d.credit_note).map((d) => ({ gstin: d.party_gstin, name: d.party_name, number: d.number, date: d.date, heads: heads(d), eligible: d.eligible })),
    undistributed,
    warnings,
  };
}

export function gstr6Csv(p: Gstr6Paper): string {
  const h = (x: IsdHeads) => [x.igst, x.cgst, x.sgst, x.cess];
  return toCsv([
    [ISD_DISCLAIMER],
    ['GSTR-6', p.isdGstin, p.month, 'Due', p.due],
    [],
    ['Table 3: ITC received'], ['Supplier GSTIN', 'Name', 'Invoice / note no.', 'Date', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess', 'Eligible', 'Credit note'],
    ...p.table3.map((r) => [r.gstin, r.name, r.number, r.date, r.taxable, ...h(r.heads), r.eligible ? 'Yes' : 'No', r.creditNote ? 'Yes' : 'No']),
    [],
    ['Table 4: total ITC'], ['', 'IGST', 'CGST', 'SGST', 'Cess'], ['Total', ...h(p.table4.total)], ['Eligible', ...h(p.table4.eligible)], ['Ineligible', ...h(p.table4.ineligible)],
    [],
    ['Table 5: distribution (ISD invoices)'], ['Recipient GSTIN', 'Name', 'ISD document no.', 'Date', 'IGST', 'CGST', 'SGST', 'Cess', 'Eligible'],
    ...p.table5.map((r) => [r.gstin, r.name, r.number, r.date, ...h(r.heads), r.eligible ? 'Yes' : 'No']),
    [],
    ['Table 8: ISD credit notes'], ['Recipient GSTIN', 'Name', 'ISD credit note no.', 'Date', 'IGST', 'CGST', 'SGST', 'Cess', 'Eligible'],
    ...p.table8.map((r) => [r.gstin, r.name, r.number, r.date, ...h(r.heads), r.eligible ? 'Yes' : 'No']),
    [],
    ['Warnings'], ...p.warnings.map((w) => [w]),
  ]);
}

/** ISD credit received by our unit(s) — the shape `BuildOptions.isdInward` takes (3B 4A(4), GSTR-9 6G). */
export interface IsdInwardRow {
  date: string;
  gstin: string;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  eligible: boolean;
}

export function isdInwardRows(docs: readonly IsdDoc[]): IsdInwardRow[] {
  return docs
    .filter((d) => d.kind === 'RECEIVED')
    .map((d) => {
      const f = sign(d);
      return { date: d.date, gstin: d.party_gstin, igst: round2(f * d.igst), cgst: round2(f * d.cgst), sgst: round2(f * d.sgst), cess: round2(f * d.cess), eligible: d.eligible };
    });
}

export function validateIsd(i: IsdInput): string {
  if (!ISD_KINDS.includes(i.kind)) return 'Choose the document kind.';
  if (!isoDay(i.date)) return 'Choose the document date.';
  if (i.kind !== 'DISTRIBUTION' && !s(i.number)) return 'Enter the document number.';
  if (!checkGstin(i.isd_gstin).valid) return 'Enter a valid ISD GSTIN.';
  if (i.kind === 'DISTRIBUTION' && !checkGstin(i.party_gstin).valid) return 'Enter a valid recipient GSTIN.';
  if (i.kind === 'RECEIVED' && !checkGstin(i.party_gstin).valid) return 'Enter the GSTIN of our unit that received the credit.';
  const heads = [i.igst, i.cgst, i.sgst, i.cess].map((x) => num(x));
  if (heads.some((x) => x < 0)) return 'Amounts cannot be negative (tick "credit note" instead).';
  if (!(heads.reduce((a, b) => a + b, 0) > 0)) return 'Enter the tax under at least one head.';
  if (num(i.cgst) > 0 !== num(i.sgst) > 0 && i.kind !== 'DISTRIBUTION') return 'CGST and SGST go together.';
  if (i.month && !/^\d{4}-\d{2}$/.test(i.month)) return 'The month must be YYYY-MM.';
  return '';
}

/* ════════════════════════ Storage ════════════════════════ */

export class IsdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IsdError';
  }
}

export function normalizeIsd(rows: readonly unknown[]): IsdDoc[] {
  const out: IsdDoc[] = [];
  for (const raw of rows) {
    const o = (raw ?? {}) as Partial<IsdDoc>;
    if (typeof o.id !== 'string' || !ISD_KINDS.includes(o.kind as IsdKind) || !isoDay(o.date)) continue;
    out.push({ ...(o as IsdDoc), igst: round2(num(o.igst)), cgst: round2(num(o.cgst)), sgst: round2(num(o.sgst)), cess: round2(num(o.cess)), eligible: o.eligible !== false, number: s(o.number), isd_gstin: s(o.isd_gstin).toUpperCase(), party_gstin: s(o.party_gstin).toUpperCase(), party_name: s(o.party_name) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

export const loadIsdDocs = (): IsdDoc[] => normalizeIsd(getTable<unknown>(ISD_TABLE));

/** ISD credit received rows for the GST report builders (cheap; empty when the table is unused). */
export function loadIsdInward(): IsdInwardRow[] {
  return isdInwardRows(loadIsdDocs());
}

export function nextIsdNumber(date: string, docs: readonly IsdDoc[]): string {
  return nextSeriesNumberFor(ISD_PREFIX, date, docs.filter((d) => d.kind === 'DISTRIBUTION').map((d) => d.number));
}

/** Save an ISD document (books.edit, period lock, audit; a DISTRIBUTION gets the next `ISD/FY…` number). */
export function saveIsdDoc(input: IsdInput): IsdDoc {
  requireAccess('books.edit');
  const problem = validateIsd(input);
  if (problem) throw new IsdError(problem);
  const all = loadIsdDocs();
  const prev = input.id ? all.find((d) => d.id === input.id) : undefined;
  const id = prev?.id ?? generateId();
  // Review L4: an edit that moves a distribution into another FY takes that FY's next number (as job work / MRP).
  const kept = prev?.kind === 'DISTRIBUTION' ? prev.number : '';
  const number = input.kind === 'DISTRIBUTION' ? (kept && numberFitsFy(kept, isoDay(input.date)) ? kept : nextIsdNumber(input.date, all)) : s(input.number).slice(0, 30);
  if (input.kind === 'INWARD' && all.some((d) => d.id !== id && d.kind === 'INWARD' && d.number.toUpperCase() === number.toUpperCase() && d.party_gstin === s(input.party_gstin).toUpperCase())) {
    throw new IsdError(`Invoice ${number} of this supplier is already recorded.`);
  }
  if (prev) assertUnlocked({ id, issue_date: prev.date, invoice_number: prev.number }, 'edit');
  assertUnlocked({ id, issue_date: isoDay(input.date), invoice_number: number }, prev ? 'edit' : 'create');
  const row: IsdDoc = {
    id,
    kind: input.kind,
    date: isoDay(input.date),
    number,
    isd_gstin: s(input.isd_gstin).toUpperCase(),
    party_gstin: s(input.party_gstin).toUpperCase(),
    party_name: s(input.party_name).slice(0, 120),
    ...(num(input.taxable) > 0 ? { taxable: round2(num(input.taxable)) } : {}),
    igst: round2(num(input.igst)),
    cgst: round2(num(input.cgst)),
    sgst: round2(num(input.sgst)),
    cess: round2(num(input.cess)),
    eligible: input.eligible !== false,
    ...(input.credit_note ? { credit_note: true } : {}),
    ...(input.kind === 'DISTRIBUTION' ? { month: input.month || isoDay(input.date).slice(0, 7) } : {}),
    ...(s(input.notes) ? { notes: s(input.notes).slice(0, 300) } : {}),
    created_at: prev?.created_at ?? new Date().toISOString(),
  };
  setTable(ISD_TABLE, prev ? getTable<IsdDoc>(ISD_TABLE).map((d) => (d?.id === id ? row : d)) : [...getTable<unknown>(ISD_TABLE), row]);
  if (row.kind === 'DISTRIBUTION') recordSeries(row.number);
  const label = row.kind === 'INWARD' ? 'ISD inward invoice' : row.kind === 'DISTRIBUTION' ? 'ISD distribution document' : 'ISD credit received';
  audit.record({ entity: 'gst', entity_id: id, action: prev ? 'update' : 'create', doc_number: row.number, summary: `${prev ? 'Edited' : 'Recorded'} ${label}${row.credit_note ? ' (credit note)' : ''} ${row.number} dated ${row.date}, ${row.party_name || row.party_gstin}: ₹${isdTotal(row).toFixed(2)}${row.eligible ? '' : ' (ineligible)'}` });
  return row;
}

/** Issue the DISTRIBUTION documents of a plan (one per recipient and eligibility with credit). */
export function issueDistribution(shares: readonly IsdShare[], o: { date: string; month: string; isdGstin: string }): IsdDoc[] {
  const out: IsdDoc[] = [];
  for (const sh of shares) {
    for (const eligible of [true, false]) {
      const h = eligible ? sh.eligible : sh.ineligible;
      if (!(isdTotal(h) > 0)) continue;
      out.push(saveIsdDoc({ kind: 'DISTRIBUTION', date: o.date, month: o.month, number: '', isd_gstin: o.isdGstin, party_gstin: sh.gstin, party_name: sh.name, ...h, eligible }));
    }
  }
  return out;
}

export function deleteIsdDoc(id: string): void {
  const row = loadIsdDocs().find((d) => d.id === id);
  if (!row) return;
  requireAccess('books.edit');
  assertUnlocked({ id, issue_date: row.date, invoice_number: row.number }, 'delete');
  setTable(ISD_TABLE, getTable<{ id?: string }>(ISD_TABLE).filter((d) => d?.id !== id));
  audit.record({ entity: 'gst', entity_id: id, action: 'delete', doc_number: row.number, summary: `Deleted ISD document ${row.number} (${row.kind}, ₹${isdTotal(row).toFixed(2)})` });
}
