/**
 * CN-D2 site muster. Workers (table `site_labour`, `master.edit`: name, trade, daily / OT rate, typed minimum wage,
 * phone, ID ref, site) and attendance (table `muster_days`: ONE row per site per day, entries present 0 / ½ / 1 and OT
 * hours). Weekly settlement `MUS/FY…`: the wage sheet (gross = days × rate + OT hours × OT rate − advances) and one
 * PAYMENT voucher Dr "Site labour wages" (site cost centre) | Cr "Advances to site labour" (advances recovered) | Cr
 * cash / bank. Warnings, never blocks: cash above ₹10,000 to one person in a day (Sec 40A(3), CN16;
 * `CASH_PAYMENT_LIMIT_RULES`) and a daily rate below the typed minimum wage. Separate from payroll. Verify with your CA.
 */
import './cn-registry';
import type { MusterDay, SiteLabour } from '../../types/construction-r11';
import type { Godown } from '../../types/stock';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { deleteVoucher, saveVoucher, VOUCHERS_TABLE } from '../ledger/vouchers';
import { cashPaymentLimit } from '../retail/rt-cash-guard'; // Sec 40A(3) limit (`CASH_PAYMENT_LIMIT_RULES`)
import { DAY, SD, put, rowsOf } from './cn-subcon';
import { ledgerId } from './cn-subcon-bill';

export const MUS = 'MUS';
export const loadLabour = () => rowsOf<SiteLabour>(SD.labour);
export const loadMuster = () => rowsOf<MusterDay>(SD.muster);

export function saveLabour(i: Omit<SiteLabour, 'id' | 'active'> & { id?: string; active?: boolean }): SiteLabour {
  requireAccess('master.edit');
  if (!i.name.trim() || !i.site_id) throw new Error('Enter the worker\'s name and site.');
  if (!(num(i.daily_rate) > 0)) throw new Error('Enter the daily rate.');
  return put(SD.labour, { ...i, id: i.id || generateId(), name: i.name.trim(), trade: i.trade.trim(), daily_rate: num(i.daily_rate), ot_rate: num(i.ot_rate), active: i.active ?? true });
}

/** Mark a site's day (one row per site per day; a settled day cannot change). */
export function markDay(siteId: string, date: string, entries: MusterDay['entries']): MusterDay {
  requireAccess('doc.create');
  if (!siteId || !DAY.test(date)) throw new Error('Choose the site and the day.');
  const prev = loadMuster().find((m) => m.site_id === siteId && m.date === date);
  if (prev?.mus_no) throw new Error(`This day is settled in ${prev.mus_no}.`);
  assertUnlocked({ issue_date: date }, prev ? 'edit' : 'create');
  const clean = entries.filter((e) => e.labour_id && (num(e.present) > 0 || num(e.ot_hours) > 0)).map((e) => ({ labour_id: e.labour_id, present: ([0, 0.5, 1].includes(num(e.present)) ? num(e.present) : 0) as 0 | 0.5 | 1, ...(num(e.ot_hours) > 0 ? { ot_hours: num(e.ot_hours) } : {}) }));
  return put(SD.muster, { id: prev?.id ?? generateId(), site_id: siteId, date, entries: clean });
}

export interface WageRow {
  labour: SiteLabour;
  days: number;
  ot: number;
  gross: number;
  advance: number;
  net: number;
  /** Largest cash in one day to this person would exceed the Sec 40A(3) limit. */
  cashWarn: boolean;
  minWageWarn: boolean;
}

/** Pure: the wage sheet of a site for `from`…`to` (unsettled days only). */
export function wageSheet(days: readonly MusterDay[], labour: readonly SiteLabour[], siteId: string, from: string, to: string, advances: Readonly<Record<string, number>> = {}, cash = true, limit = cashPaymentLimit(to)): WageRow[] {
  const acc = new Map<string, { days: number; ot: number }>();
  for (const d of days) {
    if (d.site_id !== siteId || d.date < from || d.date > to || d.mus_no) continue;
    for (const e of d.entries) {
      const a = acc.get(e.labour_id) ?? { days: 0, ot: 0 };
      acc.set(e.labour_id, { days: a.days + num(e.present), ot: a.ot + num(e.ot_hours) });
    }
  }
  return [...acc].map(([id, a]) => {
    const l = labour.find((x) => x.id === id);
    if (!l) return null;
    const gross = round2(a.days * l.daily_rate + a.ot * l.ot_rate);
    const advance = round2(Math.min(num(advances[id]), gross));
    const net = round2(gross - advance);
    return { labour: l, days: a.days, ot: a.ot, gross, advance, net, cashWarn: cash && net > limit, minWageWarn: num(l.min_wage) > 0 && l.daily_rate < num(l.min_wage) };
  }).filter((r): r is WageRow => !!r && r.gross > 0);
}

/** Settle the week: MUS number, one payment voucher, the days marked settled. Returns the sheet and warnings. */
export function settleWeek(site: Pick<Godown, 'id' | 'name' | 'cost_centre_id'>, from: string, to: string, opts: { date: string; method: string; advances?: Record<string, number> }) {
  requireAccess('books.edit');
  const days = loadMuster();
  const cash = opts.method.toLowerCase() === 'cash';
  const rows = wageSheet(days, loadLabour(), site.id, from, to, opts.advances, cash);
  if (!rows.length) throw new Error('No unsettled attendance in this week.');
  const all = days.map((d) => d.mus_no ?? '').filter(Boolean);
  const number = nextSeriesNumberFor(MUS, opts.date, all);
  const p = (n: number) => Math.round(n * 100);
  const gross = round2(rows.reduce((s, r) => s + r.gross, 0)), adv = round2(rows.reduce((s, r) => s + r.advance, 0));
  return withTablesRollback([SD.muster, VOUCHERS_TABLE, 'series_counters', 'accounts'], () => {
    const v = saveVoucher({
      type: 'PAYMENT', date: opts.date, voucher_class: 'Site wages', narration: `Site wages ${number} — ${site.name}, ${from} to ${to} (${rows.length} workers)`,
      lines: [
        { account_id: ledgerId('Site labour wages', 'DIRECT_EXPENSES', 5840), dr: p(gross), cr: 0, ...(site.cost_centre_id ? { cost_centre_id: site.cost_centre_id } : {}) },
        ...(adv > 0 ? [{ account_id: ledgerId('Advances to site labour', 'LOANS_ADV_ST', 3640), dr: 0, cr: p(adv) }] : []),
        ...(gross - adv > 0 ? [{ account_id: cash ? A.cash : A.bank, dr: 0, cr: p(gross - adv) }] : []),
      ],
    });
    setTable(SD.muster, getTable<MusterDay>(SD.muster).map((d) => (d.site_id === site.id && d.date >= from && d.date <= to && !d.mus_no ? { ...d, mus_no: number, voucher_id: v.id } : d)));
    recordSeries(number);
    return { number, voucher: v, rows };
  });
}

/** Undo a settlement: its voucher goes (recycle bin) and the days open again; the MUS number stays used. */
export function undoSettlement(musNo: string): void {
  requireAccess('books.edit');
  const days = loadMuster().filter((d) => d.mus_no === musNo);
  if (!days.length) return;
  withTablesRollback([SD.muster, VOUCHERS_TABLE], () => {
    setTable(SD.muster, getTable<MusterDay>(SD.muster).map((d) => (d.mus_no === musNo ? { id: d.id, site_id: d.site_id, date: d.date, entries: d.entries } : d)));
    if (days[0].voucher_id) deleteVoucher(days[0].voucher_id); // QA11 C4: after the days let go of it
  });
}

/** Settled weeks (number, site, voucher). */
export const settlements = (days: readonly MusterDay[] = loadMuster()) => [...new Map(days.filter((d) => d.mus_no).map((d) => [d.mus_no!, { number: d.mus_no!, site_id: d.site_id, voucher_id: d.voucher_id, from: d.date }])).values()];
