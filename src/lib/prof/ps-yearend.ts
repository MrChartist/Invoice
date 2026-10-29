/**
 * PS-A4 year-end unbilled work (working paper): time and re-billable costs unbilled on the closing date at standard
 * value, less the expected write-down (the client's billing realisation over the last 12 months, editable), by matter.
 * Method per AS 9 / ICDS IV: percentage of completion; an engagement of ≤ 90 days may use the completed-service method
 * (no revenue until done — its row is shown at nil) — PS23. Optional accrual from a dated setting
 * (`prof_settings.wip.accrue_from`, off by default): a journal Dr "Unbilled revenue (WIP)" Cr "Professional fees —
 * unbilled" on the closing date, reversed the next day; GST is never touched (no invoice, no time of supply).
 * Pure above "Storage".
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import type { Engagement } from '../../types/prof-r14';
import type { TimeEntry, TimePrefs } from '../../types/time';
import type { CostCentre } from '../cost-centres';
import { round2 } from '../invoice-calc';
import { daysIn } from './ps-utilisation';
import { requireAccess } from '../access';
import { shiftDay } from '../dates';
import { rebillCost } from '../timesheets';
import { entryStandard } from './ps-staff';
import { engagementOf } from './ps-engagements';

export interface YearEndRow { key: string; label: string; client: string; standard: number; realisation: number; net: number; method: 'poc' | 'completed' }
export const ACCRUAL_CLASS = 'Year-end WIP accrual';

/** The day each row was first billed by a live note (bill_refs, else the legacy pointer). */
export function billedOnMap(invoices: readonly InvoiceRecord[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const inv of invoices) for (const it of inv.items ?? []) for (const r of it.bill_refs ?? []) if (!m.has(r) || inv.issue_date < m.get(r)!) m.set(r, inv.issue_date);
  return m;
}

export function yearEndPaper(i: {
  closing: string; prefs: TimePrefs; entries: readonly TimeEntry[]; costs: readonly PurchaseRecord[]; invoices: readonly InvoiceRecord[];
  centres: readonly CostCentre[]; engagements?: readonly Engagement[];
  /** Expected billing realisation of a client (0–1), else 1. */
  realisationOf?: (clientKey: string) => number | null;
  overrides?: Readonly<Record<string, number>>;
}): { rows: YearEndRow[]; standard: number; net: number } {
  const billedOn = billedOnMap(i.invoices);
  const unbilled = (id: string, day: string, wo?: { date: string }) => day <= i.closing && !(wo && wo.date <= i.closing) && !((billedOn.get(id) ?? '9999') <= i.closing);
  const centre = new Map(i.centres.map((c) => [c.id, c]));
  const map = new Map<string, YearEndRow>();
  const add = (cc: string | undefined, client: string, amt: number) => {
    const c = cc ? centre.get(cc) : undefined;
    const key = c?.id ?? `client:${client}`;
    const eng = engagementOf(c?.id, i.engagements ?? []);
    const short = !!eng?.end && daysIn(eng.start, eng.end) <= 90;
    const r = map.get(key) ?? { key, label: c ? (c.ps?.code ? `${c.ps.code}: ${c.name}` : c.name) : client, client, standard: 0, realisation: 1, net: 0, method: short ? 'completed' as const : 'poc' as const };
    r.standard = round2(r.standard + amt);
    map.set(key, r);
  };
  for (const e of i.entries) if (e.billable && unbilled(e.id, e.date, e.ps?.wo)) add(e.cost_centre_id, e.client_id || e.client_name, entryStandard(e, i.prefs));
  for (const p of i.costs) if (p.billable_to_client_id && unbilled(p.id, p.date, p.ps?.wo)) add(p.cost_centre_id, p.billable_to_client_id, rebillCost(p));
  const rows = [...map.values()].map((r) => {
    const real = i.overrides?.[r.key] ?? i.realisationOf?.(r.client) ?? 1;
    const realisation = Math.min(Math.max(real, 0), 1.5);
    return { ...r, realisation: round2(realisation * 100) / 100, net: r.method === 'completed' ? 0 : round2(r.standard * realisation) };
  }).sort((a, b) => b.standard - a.standard);
  return { rows, standard: round2(rows.reduce((s, r) => s + r.standard, 0)), net: round2(rows.reduce((s, r) => s + r.net, 0)) };
}

/** Is the dated accrual switch on for this closing date? */
export const accrualOn = (accrueFrom: string | undefined, closing: string): boolean => !!accrueFrom && closing >= accrueFrom;

/** Post the accrual (`books.edit`): one journal on the closing date reversing the next day; once per closing date. */
export async function postAccrual(net: number, closing: string): Promise<string> {
  requireAccess('books.edit');
  if (!(net > 0)) throw new Error('Nothing to accrue.');
  const [{ chartOf, loadUserAccounts, saveUserAccount }, { loadVouchers, saveVoucher }] = await Promise.all([import('../ledger/accounts'), import('../ledger/vouchers')]);
  if (loadVouchers().some((v) => v.voucher_class === ACCRUAL_CLASS && v.date === closing)) throw new Error(`The WIP accrual for ${closing} is already posted.`);
  const ensure = (name: string, group: string, start: number) => {
    const chart = chartOf(loadUserAccounts());
    const hit = chart.find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
    if (hit) return hit.id;
    const codes = new Set(chart.map((a) => a.code));
    let n = start;
    while (codes.has(String(n))) n++;
    return saveUserAccount({ code: String(n), name, group }).id;
  };
  const dr = ensure('Unbilled revenue (WIP)', 'OTHER_CA', 1480);
  const cr = ensure('Professional fees — unbilled', 'SALES', 4090);
  const paise = Math.round(net * 100);
  return saveVoucher({ type: 'JOURNAL', date: closing, narration: 'Unbilled professional work at the year end (AS 9 / ICDS IV), reversed the next day: working paper, verify with your CA (PS23)', lines: [{ account_id: dr, dr: paise, cr: 0 }, { account_id: cr, dr: 0, cr: paise }], reverse_on: shiftDay(closing, 1), voucher_class: ACCRUAL_CLASS }).number;
}
