/**
 * MF-B1 inspection reports `FAI/FY…` (table `inspection_reports`, `doc.create`, dated `date`): first-article, lot or
 * final inspection of a drawing revision against its characteristics. Each reading is checked against nominal −
 * tol_minus … nominal + tol_plus; the suggested result is *pass* (all in tolerance), *fail* (a critical characteristic
 * out) or *deviation* (only non-critical ones out) — the inspector may record another. The report prints on A4, and its
 * summary goes into a draft invoice's `mf.drawing.inspection` (the A5 annexure page prints it from the snapshot).
 * The QC release / reject of the order's output stays on the R4-A QC desk. Pure helpers above "Storage"
 * (tests/mf-drawings.test.ts).
 */
import type { Drawing, DrawingChar, InspectionReport } from '../../types/mfg-r13';
import type { InvoiceRecord } from '../../types/invoice';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { num } from '../invoice-calc';
import { localDb } from '../localDb';
import { esc } from '../voucher-print';
import { MF_SERIES, MF_TABLES } from './mf-shared';
import { DAY, drop, mustGet, nowIso, put, r3, rowsOf } from './mf-b-db';

export const FAI = MF_SERIES.inspections;
export const INSPECTIONS_TABLE = MF_TABLES.inspections;

/* ── Pure ─────────────────────────────────────────────────────── */

export const inTol = (c: Pick<DrawingChar, 'nominal' | 'tol_minus' | 'tol_plus'>, v: number): boolean =>
  v >= r3(num(c.nominal) - num(c.tol_minus)) - 1e-9 && v <= r3(num(c.nominal) + num(c.tol_plus)) + 1e-9;

export interface ReadingRow { char: DrawingChar; values: number[]; out: number[]; ok: boolean }
export interface Evaluation { rows: ReadingRow[]; suggested: InspectionReport['result']; outCount: number }

/** Each characteristic's readings with the out-of-tolerance values; the suggested result. */
export function evaluate(readings: InspectionReport['readings'], chars: readonly DrawingChar[]): Evaluation {
  const rows = chars.map((c) => {
    const values = (readings.find((r) => r.char_id === c.id)?.values ?? []).filter((v) => Number.isFinite(v));
    const out = values.filter((v) => !inTol(c, v));
    return { char: c, values, out, ok: out.length === 0 };
  });
  const bad = rows.filter((r) => !r.ok);
  return { rows, outCount: bad.reduce((s, r) => s + r.out.length, 0), suggested: !bad.length ? 'pass' : bad.some((r) => r.char.critical) ? 'fail' : 'deviation' };
}

/** "12.50 ±0.05 mm" / "12.50 +0.10 / −0.00 mm". */
export const tolText = (c: DrawingChar): string =>
  num(c.tol_minus) === num(c.tol_plus) ? `${c.nominal} ±${c.tol_plus} ${c.unit}` : `${c.nominal} +${c.tol_plus} / −${c.tol_minus} ${c.unit}`;

/** The summary rows printed on the invoice annexure (`mf.drawing.inspection`). */
export function inspectionSnap(r: InspectionReport, d: Pick<Drawing, 'number' | 'characteristics'>): { report_no: string; result: string; rows: { label: string; value: string }[] } {
  const ev = evaluate(r.readings, d.characteristics ?? []);
  return {
    report_no: `${r.number} · ${d.number} rev ${r.rev} · sample ${r.sample}`,
    result: r.result,
    rows: ev.rows.map((x) => ({ label: `${x.char.name} (${tolText(x.char)})`, value: x.values.length ? `${Math.min(...x.values)} – ${Math.max(...x.values)}${x.ok ? '' : ` · ${x.out.length} out`}` : '—' })),
  };
}

/** The printed report (A4). */
export function reportHtml(r: InspectionReport, d: Drawing, business: { name?: string }): string {
  const ev = evaluate(r.readings, d.characteristics ?? []);
  const rows = ev.rows.map((x) => `<tr><td>${esc(x.char.name)}${x.char.critical ? ' ★' : ''}</td><td>${esc(tolText(x.char))}</td><td>${x.values.map((v) => (inTol(x.char, v) ? esc(v) : `<b>${esc(v)}✗</b>`)).join(', ')}</td><td>${x.ok ? 'OK' : 'NOT OK'}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(r.number)}</title>
<style>@page{size:A4}body{font-family:system-ui,sans-serif;margin:0;padding:20px;font-size:12px}h1{font-size:16px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:10px}td,th{border:1px solid;padding:4px 6px;text-align:left}.f{margin-top:24px}</style></head><body>
<h1>${esc(business.name || 'Your business')} — ${r.kind === 'first_article' ? 'FIRST ARTICLE' : r.kind === 'lot' ? 'LOT' : 'FINAL'} INSPECTION REPORT</h1>
<div>${esc(r.number)} · ${esc(r.date)} · Drawing ${esc(d.number)} rev ${esc(r.rev)} — ${esc(d.title)}${d.material_grade ? ` · ${esc(d.material_grade)}` : ''} · Sample ${esc(r.sample)}</div>
<table><thead><tr><th>Characteristic</th><th>Specification</th><th>Readings</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
<p><b>Result: ${esc(r.result.toUpperCase())}</b>${r.note ? ` — ${esc(r.note)}` : ''}</p>
<p class="f">Inspector: ${esc(r.inspector)} ______________ &nbsp; Approved ______________</p></body></html>`;
}

/* ================================================================
   Storage
   ================================================================ */

export const loadReports = (): InspectionReport[] => rowsOf<InspectionReport>(INSPECTIONS_TABLE).filter((r) => Array.isArray(r.readings));
const lockOf = (r: Pick<InspectionReport, 'id' | 'date' | 'number'>) => ({ id: r.id, issue_date: r.date, invoice_number: r.number });

export type ReportInput = Omit<InspectionReport, 'id' | 'number' | 'result'> & { id?: string; result?: InspectionReport['result'] };

/** Save a report (new number in the FAI series); the result defaults to the suggested one. */
export function saveReport(i: ReportInput, d: Pick<Drawing, 'id' | 'revisions' | 'characteristics'>): InspectionReport {
  requireAccess('doc.create');
  if (!DAY.test(i.date)) throw new Error('Enter the date.');
  if (i.drawing_id !== d.id) throw new Error('Pick the drawing.');
  if (!d.revisions.some((x) => x.rev === i.rev)) throw new Error('Pick a revision of the drawing.');
  if (!(num(i.sample) > 0)) throw new Error('Enter the sample size.');
  if (!i.inspector?.trim()) throw new Error('Who inspected?');
  const readings = i.readings.map((r) => ({ char_id: r.char_id, values: r.values.map(Number).filter((v) => Number.isFinite(v)) })).filter((r) => r.values.length);
  if (!readings.length) throw new Error('Enter at least one reading.');
  const result = i.result ?? evaluate(readings, d.characteristics ?? []).suggested;
  const prev = i.id ? loadReports().find((x) => x.id === i.id) : undefined;
  const id = prev?.id ?? generateId();
  const number = prev?.number ?? nextSeriesNumberFor(FAI, i.date, loadReports().map((x) => x.number));
  assertUnlocked(lockOf({ id, date: i.date, number }), prev ? 'edit' : 'create');
  const row: InspectionReport = { ...prev, ...i, id, number, readings, result, sample: Math.round(num(i.sample)), inspector: i.inspector.trim(), created_at: prev?.created_at ?? nowIso(), updated_at: nowIso() };
  return withTablesRollback([INSPECTIONS_TABLE, 'series_counters'], () => {
    put(INSPECTIONS_TABLE, row);
    recordSeries(number);
    return row;
  });
}

/** Delete (recycle bin; the FAI number stays reserved). */
export function removeReport(id: string): void {
  requireAccess('doc.create');
  const r = mustGet<InspectionReport>(INSPECTIONS_TABLE, id, 'inspection report');
  assertUnlocked(lockOf(r), 'delete');
  drop(INSPECTIONS_TABLE, id);
}

/** Put the report's summary on a DRAFT invoice (`mf.drawing.inspection`; issued documents keep their snapshot). */
export function attachToInvoice(reportId: string, invoiceId: string, d: Drawing): InvoiceRecord {
  requireAccess('doc.create');
  const r = mustGet<InspectionReport>(INSPECTIONS_TABLE, reportId, 'inspection report');
  const inv = localDb.invoices.getById(invoiceId);
  if (!inv) throw new Error('Invoice not found.');
  if (inv.status !== 'Draft') throw new Error('Attach the report to a draft; an issued document keeps its print.');
  return localDb.invoices.save({ ...inv, mf: { ...inv.mf, kind: inv.mf?.kind ?? 'drawing', drawing: { ...inv.mf?.drawing, inspection: inspectionSnap(r, d) } } });
}
