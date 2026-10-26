/** R4-C2 export desk helpers shared by its tabs. */
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';

export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

export const money = (n: number, currency = 'INR') => formatCurrency(n, currency);

export const downloadCsv = (name: string, rows: (string | number)[][]) => downloadText(name, '﻿' + toCsv(rows), 'text/csv');

export async function downloadSheet(name: string, sheet: string, rows: (string | number)[][]): Promise<void> {
  const { downloadXlsx } = await import('../../lib/xlsx');
  await downloadXlsx(name, [{ name: sheet, rows }]);
}
