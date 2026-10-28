/** R5-B: small helpers shared by the transport and works tabs (lazy chunks only). */
import { MAX_IMPORT_BYTES, parseTable, toCsv } from '../../lib/csv';
import controls from '../../styles/controls.module.css';
import { downloadText } from '../../lib/download';
import { downloadTextFile } from '../receivables/exportUtils';
import { printHtmlDocument } from '../../lib/voucher-print';

export type Notify = (message: string, tone?: 'success' | 'error') => void;

export interface PanelProps {
  notify: Notify;
  refresh: () => void;
  tick: number;
}

export const fmtMoney = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const numIn = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** First sheet / the CSV of a file (XLSX through our own reader, imported on demand). */
export async function readFirstTable(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('The file is larger than 25 MB.');
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    const x = await import('../../lib/xlsx');
    const wb = await x.readXlsx(new Uint8Array(await file.arrayBuffer()));
    const t = wb.sheets.map((s) => x.sheetToTable(s)).find((s) => s.headers.length);
    if (!t) throw new Error('The workbook has no rows.');
    return t;
  }
  const t = parseTable(await file.text());
  return { headers: t.headers, rows: t.rows };
}

export const csvDownload = (name: string, rows: unknown[][]) => downloadTextFile(name, toCsv(rows));

export const printHtml = (html: string, name: string) => printHtmlDocument(html, (h) => downloadText(`${name.replace(/[\\/]/g, '-')}.html`, h, 'text/html'));

/** Button classes (primary / outline / ghost, and small). */
export const B = {
  p: `${controls.btn} ${controls.btnPrimary}`,
  o: `${controls.btn} ${controls.btnOutline}`,
  g: `${controls.btn} ${controls.btnGhost}`,
  ps: `${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`,
  os: `${controls.btn} ${controls.btnOutline} ${controls.btnSm}`,
  gs: `${controls.btn} ${controls.btnGhost} ${controls.btnSm}`,
};
