/**
 * MF-A5 print helpers for the lazy paper parts (`MfgBlock`, `MfgAnnexurePage`): the job-particulars rows of each `mf`
 * sub-object (one arm per package: B refines `drawing` / `print` / `scrap`, C `cmt`, D `food` / `export_aa`), and the
 * FSSAI number check. Pure; from the snapshot only (never recomputed).
 */
import type { MfSnapshot } from '../../types/mfg-r13';

export const FSSAI_RE = /^\d{14}$/;

/** '' when empty or 14 digits, else an error message. */
export function validateFssai(s: string | undefined): string {
  const v = (s ?? '').replace(/\s+/g, '');
  return !v || FSSAI_RE.test(v) ? '' : 'The FSSAI licence / registration number has 14 digits.';
}

export interface MfBox { title: string; rows: [string, string | number][] }

const rows = (pairs: [string, string | number | undefined][]): [string, string | number][] => pairs.filter((p): p is [string, string | number] => p[1] !== undefined && p[1] !== '');

/** The boxes printed after the parties ("Job particulars"), in a fixed order; empty boxes are left out. */
export function mfBoxes(mf: MfSnapshot): MfBox[] {
  const out: MfBox[] = [];
  const h = mf.header;
  if (h) out.push({ title: 'Job particulars', rows: [...rows([['Customer PO', h.customer_po], ['Drawings', h.drawings]]), ...(h.rows ?? []).map((r) => [r.label, r.value] as [string, string])] });
  // MF-B: print-job particulars
  if (mf.print) out.push({ title: 'Print job', rows: rows([['Size', mf.print.size], ['Colours', mf.print.colours], ['Quantity', mf.print.quantity], ['Ups', mf.print.ups], ['Sheets', mf.print.sheets], ['Impressions', mf.print.impressions], ['Paper', mf.print.paper]]) });
  // MF-D: food and export under Advance Authorisation
  if (mf.food?.fssai) out.push({ title: 'Food', rows: rows([['FSSAI', mf.food.fssai]]) });
  if (mf.export_aa) out.push({ title: 'Export under authorisation', rows: rows([['AA no.', mf.export_aa.aa_no], ['SION', mf.export_aa.sion]]) });
  return out.filter((b) => b.rows.length);
}
