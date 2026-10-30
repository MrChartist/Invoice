/**
 * PENDING 49 (8.111): the month-end pack as ONE PDF, next to the ZIP. Same files as `buildPackFiles` (so the PDF and the
 * ZIP agree): every CSV becomes an escaped HTML table on an A4 paper (P&L, balance sheet, ageing, GSTR-1 sections with
 * rows, GSTR-3B), captured with the existing `html-to-image` + `jspdf` stack (`PdfBuilder`, Critical Rule 6). Lazy:
 * loaded only by the pack's "PDF" button. Working papers — verify with your CA.
 */

import { parseCsv } from './csv';
import { escHtml } from './html-esc';
import { paperSize } from './design-prefs';
import { localDb } from './localDb';
import type { PackFile } from './report-pack';
import { PRINT_FONT } from './print-fonts';

export interface PackPdfPaper {
  title: string;
  html: string;
}

const TABLE = 'width:100%;border-collapse:collapse;font-size:12px;margin:0 0 14px';
const CELL = 'border:1px solid #c8c8c8;padding:3px 5px;text-align:left;vertical-align:top';

/** One CSV as an HTML table (first row = header); every value escaped. Empty when the CSV has no data row. */
export function csvTableHtml(csv: string): string {
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length < 2) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const cells = (r: string[], tag: 'th' | 'td') => Array.from({ length: width }, (_, i) => {
    const v = r[i] ?? '';
    const num = tag === 'td' && /^-?\d+(\.\d+)?$/.test(v.trim());
    return `<${tag} style="${CELL}${num ? ';text-align:right' : ''}">${escHtml(v)}</${tag}>`;
  }).join('');
  const [head, ...body] = rows;
  return `<table style="${TABLE}"><thead><tr>${cells(head, 'th')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`;
}

const page = (title: string, sub: string, body: string): string =>
  `<div style="padding:28px 32px;font-family:${PRINT_FONT};color:#111;background:#fff"><h2 style="margin:0 0 4px;font-size:16px">${escHtml(title)}</h2><p style="margin:0 0 12px;font-size:12px;color:#555">${escHtml(sub)}</p>${body}</div>`;

/**
 * The papers of the PDF, in pack order: P&L, balance sheet, ageing, one GSTR-1 paper (only sections with rows), GSTR-3B.
 * The HTML GST summary and README of the ZIP are left out (the 3B table and the footer line carry them). Pure.
 */
export function packPdfPapers(month: string, files: readonly PackFile[], company = ''): PackPdfPaper[] {
  const sub = `${company ? `${company} · ` : ''}${month} · working paper, not portal-validated: verify with your CA`;
  const out: PackPdfPaper[] = [];
  const one = (title: string, f: PackFile | undefined) => {
    if (!f) return;
    const t = csvTableHtml(f.text);
    out.push({ title, html: page(title, sub, t || '<p style="font-size:12px">No rows.</p>') });
  };
  one('Profit & loss', files.find((f) => f.name.startsWith('PnL_')));
  one('Balance sheet', files.find((f) => f.name.startsWith('BalanceSheet_')));
  one('Receivables ageing', files.find((f) => f.name.startsWith('Ageing_')));
  const gstr1 = files.filter((f) => f.name.startsWith('GSTR1_'))
    .map((f) => ({ id: f.name.replace(/^GSTR1_[^_]+_|\.csv$/g, ''), t: csvTableHtml(f.text) }))
    .filter((x) => x.t);
  out.push({ title: 'GSTR-1', html: page('GSTR-1', sub, gstr1.length ? gstr1.map((x) => `<h3 style="font-size:12px;margin:8px 0 4px">${escHtml(x.id.toUpperCase())}</h3>${x.t}`).join('') : '<p style="font-size:12px">No rows.</p>') });
  one('GSTR-3B', files.find((f) => f.name.startsWith('GSTR3B_')));
  return out;
}

/** Builds the pack PDF in the browser (an off-screen A4 host per paper, removed afterwards). */
export async function buildPackPdf(month: string): Promise<{ name: string; blob: Blob }> {
  const company = localDb.settings.activeProfile()?.companyName ?? '';
  const [{ buildPackFiles }, { PdfBuilder }] = await Promise.all([import('./report-pack'), import('./pdf-batch')]);
  const papers = packPdfPapers(month, buildPackFiles(month), company);
  const pdf = await PdfBuilder.create();
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${paperSize({ paper: 'A4' }).width}px;background:#fff`;
  document.body.appendChild(host);
  try {
    for (const p of papers) {
      host.innerHTML = p.html; // our own escaped markup (escHtml on every value; no scripts)
      await pdf.addPaper(host.firstElementChild as HTMLElement, { paper: 'A4' });
    }
  } finally {
    host.remove();
  }
  return { name: `MonthEndPack_${month}.pdf`, blob: pdf.blob() };
}
