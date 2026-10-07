/** Browser-only helper: save a CSV string as a file (UTF-8 with BOM for Excel). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Signed money class for profit/loss colouring. */
export function tone(n: number): 'pos' | 'neg' | '' {
  return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
}
