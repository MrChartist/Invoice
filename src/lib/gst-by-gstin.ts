/**
 * GSTR-1 / GSTR-3B side by side per GSTIN (7R, 7.130) — for a business with several registrations (branches in
 * other States, multi-profile). One column per GSTIN (named after its branches / sender profile), the same
 * `buildGstReport` the GST page runs, with:
 *  - invoices: the filer-GSTIN filter of the builder (sender snapshot);
 *  - purchase bills (and supplier notes against them): the receiving branch's GSTIN (`branch_id` → branch
 *    `gstin`), else the one registration in the bill's place-of-supply State, else "Not assigned" (listed — fix the
 *    bill's branch);
 *  - ISD credit received: by the unit GSTIN on the row.
 * Invoices without a sender GSTIN are counted by the builder under every GSTIN; they are reported as a warning.
 * Working paper — each registration files its own returns; verify with your CA. Pure.
 */

import type { InvoiceRecord } from '../types/invoice';
import type { PurchaseReturn } from '../types/purchases';
import { buildGstReport, inPeriod, type BuildOptions, type GstReport, type ReportPeriod } from './gst-reports';
import { checkGstin } from './gstin';
import { round2 } from './invoice-calc';
import { isVoidStatus, readPurchase } from './purchase-normalize';

export interface GstinColumn {
  gstin: string;
  label: string;
}

export interface ByGstinRow {
  id: string;
  label: string;
  values: number[];
  total: number;
  /** Section heading rows carry no figures. */
  heading?: boolean;
}

export interface ByGstinResult {
  columns: GstinColumn[];
  /** Index of the "Not assigned" column (purchases only), or -1. */
  unassignedIndex: number;
  rows: ByGstinRow[];
  unassignedBills: string[];
  warnings: string[];
}

const up = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** GSTINs in use: sender profiles, branches and invoice snapshots (valid ones), labelled by branch / company. */
export function gstinColumns(
  profiles: readonly { companyGstin?: string; companyName?: string }[],
  branches: readonly { gstin?: string; name?: string; inactive?: boolean }[],
  invoices: readonly { sender?: { companyGstin?: string } | null }[] = [],
): GstinColumn[] {
  const names = new Map<string, string[]>();
  const push = (g: string, n?: string) => {
    if (!checkGstin(g).valid) return;
    const list = names.get(g) ?? [];
    if (n && !list.includes(n)) list.push(n);
    names.set(g, list);
  };
  for (const b of branches) push(up(b.gstin), b.name?.trim());
  for (const p of profiles) push(up(p.companyGstin), p.companyName?.trim());
  for (const i of invoices) push(up(i.sender?.companyGstin));
  return [...names].map(([gstin, n]) => ({ gstin, label: n.slice(0, 2).join(' / ') || gstin })).sort((a, b) => a.gstin.localeCompare(b.gstin));
}

export interface ByGstinOptions extends Omit<BuildOptions, 'gstin' | 'filerStateCode' | 'purchaseNotes'> {
  period: ReportPeriod;
  columns: readonly GstinColumn[];
  branches: readonly { id: string; gstin?: string }[];
  purchaseNotes?: readonly PurchaseReturn[];
}

export function buildByGstin(invoices: InvoiceRecord[], rawPurchases: readonly unknown[], o: ByGstinOptions): ByGstinResult {
  const warnings: string[] = [];
  const cols = o.columns.filter((c) => checkGstin(c.gstin).valid);
  const branchGstin = new Map(o.branches.map((b) => [b.id, up(b.gstin)]));
  const byState = new Map<string, string[]>();
  for (const c of cols) byState.set(c.gstin.slice(0, 2), [...(byState.get(c.gstin.slice(0, 2)) ?? []), c.gstin]);
  const billsFor = new Map<string, unknown[]>(cols.map((c) => [c.gstin, []]));
  const unassigned: unknown[] = [];
  const unassignedBills: string[] = [];
  const billGstin = new Map<string, string>();
  for (const raw of rawPurchases ?? []) {
    const c = readPurchase(raw);
    if (!c || isVoidStatus(c.status)) continue;
    const r = raw as Record<string, unknown>;
    let g = branchGstin.get(String(r.branch_id ?? '')) ?? '';
    if (!billsFor.has(g)) {
      const st = byState.get(c.placeOfSupply);
      g = st && st.length === 1 ? st[0] : '';
    }
    if (g && billsFor.has(g)) {
      billsFor.get(g)!.push(raw);
      billGstin.set(c.id, g);
    } else {
      unassigned.push(raw);
      if (inPeriod(c.date, o.period)) unassignedBills.push(c.number || c.id);
    }
  }
  const notesFor = (g: string) => (o.purchaseNotes ?? []).filter((n) => (n.purchase_id ? billGstin.get(n.purchase_id) ?? '' : '') === g);
  const reports: GstReport[] = cols.map((c) =>
    buildGstReport(invoices, billsFor.get(c.gstin) ?? [], {
      ...o,
      gstin: c.gstin,
      filerStateCode: c.gstin.slice(0, 2),
      purchaseNotes: notesFor(c.gstin),
      isdInward: (o.isdInward ?? []).filter((x) => !x.gstin || up(x.gstin) === c.gstin),
    }),
  );
  const withUnassigned = unassigned.length > 0 && unassignedBills.length > 0;
  if (withUnassigned) {
    reports.push(buildGstReport([], unassigned, { ...o, gstin: '', purchaseNotes: notesFor(''), isdInward: [] }));
    warnings.push(`${unassignedBills.length} purchase bill(s) of the period have no branch GSTIN and no single registration in their place-of-supply State: ${unassignedBills.slice(0, 8).join(', ')}${unassignedBills.length > 8 ? ' …' : ''}. Set the receiving branch on the bill.`);
  }
  const noSender = invoices.filter((i) => i && inPeriod(String(i.issue_date ?? ''), o.period) && !up(i.sender?.companyGstin) && i.status !== 'Draft' && i.status !== 'Cancelled').length;
  if (noSender && cols.length > 1) warnings.push(`${noSender} document(s) of the period carry no sender GSTIN: the builder counts them under every GSTIN, open them and save with the right profile.`);

  const sum = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0));
  const t = (h: { igst: number; cgst: number; sgst: number; cess?: number }) => round2(h.igst + h.cgst + h.sgst + (h.cess ?? 0));
  const rowsDef: [string, string, ((r: GstReport) => number) | null][] = [
    ['h1', 'GSTR-1', null],
    ['b2b', 'B2B taxable value', (r) => sum(r.gstr1.b2b.map((x) => x.taxable))],
    ['b2cl', 'B2CL taxable value', (r) => sum(r.gstr1.b2cl.map((x) => x.taxable))],
    ['b2cs', 'B2CS taxable value', (r) => sum(r.gstr1.b2cs.map((x) => x.txval))],
    ['cdn', 'Credit / debit notes (CDNR + CDNUR), net', (r) => sum([...r.gstr1.cdnr, ...r.gstr1.cdnur].map((x) => (x.noteType === 'C' ? -1 : 1) * x.taxable))],
    ['exp', 'Exports taxable value', (r) => sum(r.gstr1.exp.map((x) => x.taxable))],
    ['docs', 'Documents included', (r) => r.gstr1.counts.included],
    ['h3', 'GSTR-3B', null],
    ['31a', '3.1(a) taxable value', (r) => r.gstr3b.outward.taxable.taxable],
    ['31atax', '3.1(a) tax (IGST + CGST + SGST + cess)', (r) => t(r.gstr3b.outward.taxable)],
    ['31b', '3.1(b) zero-rated value', (r) => r.gstr3b.outward.zeroRated.taxable],
    ['31d', '3.1(d) reverse-charge tax', (r) => t(r.gstr3b.outward.inwardRcm)],
    ['4a', '4A ITC available', (r) => t(r.gstr3b.itc.importGoods) + t(r.gstr3b.itc.importServices) + t(r.gstr3b.itc.availableRcm) + t(r.gstr3b.itc.isd ?? { igst: 0, cgst: 0, sgst: 0 }) + t(r.gstr3b.itc.availableOther)],
    ['4b', '4B ITC reversed', (r) => t(r.gstr3b.itc.reversedRules) + t(r.gstr3b.itc.reversedOther)],
    ['4c', '4C net ITC', (r) => t(r.gstr3b.itc.netSigned ?? r.gstr3b.itc.net)],
    ['cash', '6.1 tax payable in cash (incl. cess)', (r) => round2(t(r.gstr3b.payment.cash) + (r.gstr3b.payment.cess ?? 0))],
  ];
  const rows: ByGstinRow[] = rowsDef.map(([id, label, f]) => {
    if (!f) return { id, label, values: [], total: 0, heading: true };
    const values = reports.map((r, i) => (withUnassigned && i === reports.length - 1 && !['4a', '4b', '4c', '31d', 'cash'].includes(id) ? 0 : round2(f(r))));
    return { id, label, values, total: sum(values) };
  });
  const columns = [...cols, ...(withUnassigned ? [{ gstin: '', label: 'Not assigned' }] : [])];
  return { columns, unassignedIndex: withUnassigned ? columns.length - 1 : -1, rows, unassignedBills, warnings };
}
