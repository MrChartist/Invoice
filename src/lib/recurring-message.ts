import type { InvoiceRecord } from '../types/invoice';

/** Toast text after the background run (kept apart from recurring.ts so the app shell stays small). */
export function recurringToastMessage(generated: InvoiceRecord[]): string {
  const n = generated.length;
  if (n === 0) return '';
  const drafts = generated.filter((g) => g.status === 'Draft').length;
  const base = `${n} recurring invoice${n === 1 ? '' : 's'} created`;
  return drafts === n ? `${base} as draft${n === 1 ? '' : 's'} for review` : base;
}
