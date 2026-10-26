/**
 * Read a marketplace report file into tables (R5-A). CSV through `parseTable`; XLSX through our own reader, imported
 * dynamically so it never reaches the shell. Every sheet with a header row is returned (the Flipkart settlement
 * workbook is read as several sheets). The content is untrusted: it is only ever rendered as React text.
 */
import { MAX_IMPORT_BYTES, parseTable } from '../../lib/csv';
import type { FileTable } from '../../lib/marketplace/file-map';
import type { SalesChannel } from '../../types/marketplace-r5';

export interface NamedTable {
  name: string;
  table: FileTable;
}

export async function readFileTables(file: File): Promise<NamedTable[]> {
  if (file.size > MAX_IMPORT_BYTES) throw new Error('The file is larger than 25 MB.');
  if (/\.(xlsx|xlsm)$/i.test(file.name)) {
    const x = await import('../../lib/xlsx');
    const wb = await x.readXlsx(new Uint8Array(await file.arrayBuffer()));
    return wb.sheets.map((s) => ({ name: s.name, table: x.sheetToTable(s) })).filter((t) => t.table.headers.length > 0);
  }
  const t = parseTable(await file.text());
  return t.headers.length ? [{ name: file.name, table: { headers: t.headers, rows: t.rows } }] : [];
}

export const fmtMoney = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export type Notify = (message: string, tone?: 'success' | 'error') => void;

/** Props every marketplace sub-view receives from the tab. */
export interface PanelProps {
  channels: SalesChannel[];
  channel?: SalesChannel;
  setChannelId: (id: string) => void;
  notify: Notify;
  refresh: () => void;
  tick: number;
}
