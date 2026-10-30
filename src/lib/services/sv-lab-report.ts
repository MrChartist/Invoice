/**
 * SV-B3 lab report print (script-free HTML for `printHtmlDocument`; the PDF goes through the existing stack): A4
 * letterhead from the sender profile (+ NABL no.), the patient block (UHID, age / sex, referred by, sample dates),
 * department-wise tables (parameter, result, unit, reference range, flag — out-of-range values in bold with H / L,
 * critical values marked), interpretation notes, up to two verified-by signatures, "End of report" and page numbers.
 * A partial report says so; an amended report prints "Amended" with the time. No clinical judgment is added.
 */
import type { SenderProfile } from '../../types/invoice';
import type { LabOrder } from '../../types/services-r10';
import { esc } from '../voucher-print';
import { flagOf, rangeFor, rangeText, resultKey, type LabFlag } from './sv-lab';
import { PRINT_FONT, PRINT_FONT_FACE } from '../print-fonts';

const FLAG: Record<LabFlag, string> = { '': '', H: 'H', L: 'L', CH: 'H (critical)', CL: 'L (critical)' };
const when = (iso?: string) => (iso ? iso.slice(0, 16).replace('T', ' ') : '');

/** Report rows of an order (shared by the print and the desk's preview). */
export function reportRows(o: LabOrder): { dept: string; test: string; name: string; value: string; unit: string; range: string; flag: LabFlag; note?: string }[] {
  return o.tests.flatMap((t) => t.params.map((p) => {
    const value = o.results[resultKey(t.id, p.code)] ?? '';
    return { dept: t.dept || 'General', test: t.name, name: p.name, value, unit: p.unit ?? '', range: rangeText(rangeFor(p, o.sex, o.age)), flag: flagOf(p, value, o.sex, o.age), ...(t.note ? { note: t.note } : {}) };
  }));
}

export function labReportHtml(o: LabOrder, sender: Pick<SenderProfile, 'companyName' | 'companyAddress' | 'companyPhone' | 'sv_regs'>, signers: readonly { name: string; qual?: string }[] = []): string {
  const rows = reportRows(o);
  const depts = [...new Set(rows.map((r) => r.dept))];
  const notes = [...new Set(rows.map((r) => r.note).filter(Boolean))] as string[];
  const sampled = o.samples.filter((s) => s.at).map((s) => `${esc(s.type)} ${esc(when(s.at))}`).join(', ');
  const status = o.amended_at ? `Amended ${when(o.amended_at)}` : o.report === 'partial' || o.report === 'pending' ? 'Partial report' : '';
  const tables = depts.map((d) => `<h3>${esc(d)}</h3><table><thead><tr><th>Test / parameter</th><th>Result</th><th>Unit</th><th>Reference range</th><th>Flag</th></tr></thead><tbody>${rows.filter((r) => r.dept === d).map((r) => `<tr${r.flag ? ' class="f"' : ''}><td>${esc(r.test === r.name ? r.name : `${r.test}: ${r.name}`)}</td><td>${esc(r.value || '-')}</td><td>${esc(r.unit)}</td><td>${esc(r.range)}</td><td data-flag>${esc(FLAG[r.flag])}</td></tr>`).join('')}</tbody></table>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Report ${esc(o.number)}</title><style>${PRINT_FONT_FACE}@page{size:A4;margin:14mm;@bottom-right{content:"Page " counter(page) " of " counter(pages)}}body{font:10.5pt ${PRINT_FONT};color:#000}header{border-bottom:2px solid #000;padding-bottom:6px}h1{margin:0;font-size:16pt}h3{margin:12px 0 4px;font-size:11pt}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #bbb;padding:3px 4px;text-align:left}.f td{font-weight: 600}.pt{display:grid;grid-template-columns:1fr 1fr;gap:2px 16px;margin:8px 0}.sig{display:flex;gap:48px;margin-top:36px}.st{font-weight: 600}</style></head><body>`
    + `<header><h1>${esc(sender.companyName)}</h1><div>${esc(sender.companyAddress ?? '')}${sender.companyPhone ? ` · ${esc(sender.companyPhone)}` : ''}${sender.sv_regs?.nabl ? ` · NABL ${esc(sender.sv_regs.nabl)}` : ''}</div></header>`
    + `<div class="pt"><div>Patient: <strong>${esc(o.patient_name)}</strong></div><div>Report: ${esc(o.number)} · ${esc(o.date)}</div><div>${o.uhid ? `UHID ${esc(o.uhid)} · ` : ''}${o.age != null ? `${o.age} y` : ''}${o.sex ? ` / ${esc(o.sex)}` : ''}</div><div>Referred by: ${esc(o.referrer?.name ?? 'Self')}</div><div>Sample: ${sampled || '-'}</div>${status ? `<div class="st">${esc(status)}</div>` : ''}</div>`
    + tables
    + (notes.length ? `<h3>Interpretation</h3>${notes.map((n) => `<p>${esc(n)}</p>`).join('')}` : '')
    + `<div class="sig">${signers.slice(0, 2).map((s) => `<div>${esc(s.name)}${s.qual ? `<br>${esc(s.qual)}` : ''}</div>`).join('')}</div><p style="text-align:center">: End of report, </p></body></html>`;
}
