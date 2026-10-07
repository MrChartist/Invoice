/** Quick lock dates for Settings → Defaults (kept out of the entry chunk with the rest of that screen). */

import { shiftDay } from './dates';

export interface LockPreset {
  id: 'month' | 'quarter' | 'fy';
  label: string;
  /** YYYY-MM-DD */
  date: string;
  hint: string;
}

/** Day before `YYYY-MM-01`. */
function dayBeforeMonth(year: number, month1: number): string {
  return shiftDay(`${year}-${String(month1).padStart(2, '0')}-01`, -1);
}

/** Quick lock dates relative to `today` (YYYY-MM-DD): end of last month / quarter / financial year. */
export function lockPresets(today: string): LockPreset[] {
  const m = /^(\d{4})-(\d{2})/.exec(today);
  if (!m) return [];
  const year = Number(m[1]);
  const month = Number(m[2]);
  const quarterStart = Math.floor((month - 1) / 3) * 3 + 1;
  const fyEndYear = month >= 4 ? year : year - 1; // last FY ended on 31 Mar of this calendar year (or last)
  return [
    { id: 'month', label: 'End of last month', date: dayBeforeMonth(year, month), hint: 'Month already filed (GSTR-1 / 3B)' },
    { id: 'quarter', label: 'End of last quarter', date: dayBeforeMonth(year, quarterStart), hint: 'QRMP quarter closed' },
    { id: 'fy', label: 'End of last FY', date: `${fyEndYear}-03-31`, hint: 'Financial year closed' },
  ];
}
