import type { KeyboardEvent } from 'react';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { formatMoney } from '../../lib/utils';

export const inr = (n: number) => `₹${formatMoney(n)}`;

/**
 * Tally-style grid keys: Enter moves to the same column in the next row (Shift+Enter: previous).
 * Inputs carry `data-row` (number) and `data-col` (string) inside one table.
 */
export function gridKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>): void {
  if (e.key !== 'Enter') return;
  const el = e.currentTarget;
  const table = el.closest('table');
  const row = Number(el.dataset.row);
  const col = el.dataset.col;
  if (!table || !col || !Number.isFinite(row)) return;
  e.preventDefault();
  const next = table.querySelector<HTMLInputElement>(`[data-col="${CSS.escape(col)}"][data-row="${row + (e.shiftKey ? -1 : 1)}"]`);
  if (next) {
    next.focus();
    if (next instanceof HTMLInputElement) next.select();
  } else {
    el.blur();
  }
}

export type Rows = (string | number)[][];

export async function exportRows(fileBase: string, rows: Rows, format: 'csv' | 'xlsx', sheet = 'Sheet1'): Promise<void> {
  if (format === 'csv') {
    downloadText(`${fileBase}.csv`, toCsv(rows), 'text/csv');
    return;
  }
  const { downloadXlsx } = await import('../../lib/xlsx');
  await downloadXlsx(`${fileBase}.xlsx`, [{ name: sheet, rows }]);
}

/** Current local month `YYYY-MM`. */
export function thisMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** `<input type=number>` text → number, '' → null. */
export function parseAmount(v: string): number | null {
  const t = v.replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
