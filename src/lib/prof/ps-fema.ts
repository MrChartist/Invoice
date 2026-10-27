/**
 * R14 PS-C2: FEMA (Export and Import of Goods and Services) Regulations 2026 for services exports. The R4-C2 register
 * (`trade/export-register.ts`) already starts a services-only export's clock on the invoice date (`isServicesExport`) and
 * reads the dated rows appended to `trade/trade-rules.ts` (9 months from 2026-10-01, 15 before; INR 12). This module adds
 * the services view: the INR rule for a foreign-currency invoice the user marks as settled in INR (PS15 (c)), and the
 * reminders the compliance calendar lists. Pure over the register rows. Working paper — verify with your CA (PS15).
 */
import type { InvoiceRecord } from '../../types/invoice';
import { addMonths, daysBetween, type RealisationRow } from '../trade/export-register';
import { EXPORT_REALISATION_INR_MONTHS_RULES, exportRealisationInrMonths, exportRealisationMonths } from '../trade/trade-rules';

/** Months and which rule applies for a clock starting on `date` (`inr`: invoiced or settled in INR). */
export function realisationRule(date: string, inr: boolean): { months: number; rule: 'fx' | 'inr' } {
  const useInr = inr && date >= EXPORT_REALISATION_INR_MONTHS_RULES[0].from;
  return { months: useInr ? exportRealisationInrMonths(date) : exportRealisationMonths(date), rule: useInr ? 'inr' : 'fx' };
}

/** Services rows of the register, with the INR rule applied to documents marked "settled in INR". */
export function servicesRows(rows: readonly RealisationRow[], invoices: readonly Partial<InvoiceRecord>[], today: string): RealisationRow[] {
  const settled = new Set(invoices.filter((i) => i.ps?.export?.inr_settled).map((i) => i.id));
  return rows.filter((r) => r.services).map((r) => {
    if (r.inrRule || !settled.has(r.invoiceId)) return r;
    const { months, rule } = realisationRule(r.shipDate, true);
    if (rule !== 'inr') return r;
    const dueDate = addMonths(r.shipDate, months);
    const daysLeft = daysBetween(today, dueDate);
    const status = r.status === 'overdue' && daysLeft >= 0 ? (r.realisedFcy > 0 ? 'part' : 'open') : r.status;
    return { ...r, months, dueDate, daysLeft, status, inrRule: true };
  });
}

/** Calendar reminders: realisation due within 30 days, or past due (ask the AD bank to extend — Reg 5(1) 2nd proviso). */
export function realisationReminders(rows: readonly RealisationRow[]): { kind: 'soon' | 'past'; row: RealisationRow }[] {
  return rows
    .filter((r) => r.outstandingFcy > 0.005 && r.daysLeft <= 30)
    .map((row) => ({ kind: row.daysLeft < 0 ? ('past' as const) : ('soon' as const), row }));
}
