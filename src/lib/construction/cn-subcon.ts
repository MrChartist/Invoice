/**
 * CN-D1 sub-contract work orders (table `sub_work_orders`, `SWO/FY…`, `doc.create`, dated `date`, audited): the
 * sub-contractor (a vendor), the site (a `site` godown and its cost centre), lines copied "back-to-back" from the BOQ
 * at a rate % of ours or typed, and the deduction rules of his bills (retention, advance / material / plant-hire
 * recovery, other). Also the CN-D table names and the small row helpers every CN-D writer shares. Deletes go through
 * `setTable` (recycle bin). Working paper — verify with your CA (CN14).
 */
import './cn-registry';
import type { SubDeductionRule, SubWoLine, SubWorkOrder } from '../../types/construction-r11';
import type { InvoiceRecord } from '../../types/invoice';
import type { Godown } from '../../types/stock';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { boqLines } from '../works/boq';

export const SD = {
  wo: 'sub_work_orders',
  bills: 'sub_measurements',
  compliance: 'labour_compliance',
  labour: 'site_labour',
  muster: 'muster_days',
  hired: 'hired_equipment',
  logs: 'plant_logs',
} as const;
export const SWO = 'SWO';

export const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** QA11 C9: a cost centre of a builder's project on the 1% / 5% scheme (N 03/2019) takes no ITC on its bills. */
export const noItcCentre = (costCentreId: string | undefined): boolean =>
  !!costCentreId && getTable<{ cost_centre_id?: string; gst_scheme?: string }>('realty_projects').some((p) => p?.cost_centre_id === costCentreId && p.gst_scheme !== 'old_option');
export const rowsOf = <T>(t: string): T[] => getTable<T>(t).filter((r) => !!r && typeof (r as { id?: unknown }).id === 'string');
/** Insert or replace a row by id (one table write: the edit observer audits it). */
export function put<T extends { id: string }>(t: string, row: T): T {
  const all = rowsOf<T>(t);
  setTable(t, all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  return row;
}
/** Data-layer delete (the row goes to the recycle bin). */
export const drop = (t: string, id: string) => setTable(t, rowsOf<{ id: string }>(t).filter((r) => r.id !== id));
export const sitesOf = (godowns: readonly Godown[]) => godowns.filter((g) => g.kind === 'site');

export const loadWorkOrders = () => rowsOf<SubWorkOrder>(SD.wo);

/** Pure: back-to-back lines from chosen BOQ lines at `pct`% of our rate (or the typed rate per line). */
export function fromBoq(boq: Pick<InvoiceRecord, 'items'>, lineIds: readonly string[], pct: number, typed: Readonly<Record<string, number>> = {}, gstRate = 18): SubWoLine[] {
  return boqLines(boq).filter((l) => lineIds.includes(l.id)).map((l) => ({
    id: generateId(), boq_line_id: l.id, ref: String((l as { boq_ref?: string }).boq_ref ?? ''), description: l.name, unit: l.unit || 'NOS',
    qty: num(l.quantity), rate: typed[l.id] !== undefined ? round2(num(typed[l.id])) : round2((num(l.rate) * num(pct)) / 100), sac: '9954', gst_rate: gstRate,
  }));
}

/** Pure (D1 → D5): margin per BOQ item = (our RA rate − sub-contract rate) × quantity billed by the sub-contractor. */
export function boqMargins(boq: Pick<InvoiceRecord, 'id' | 'items'>, wos: readonly SubWorkOrder[], bills: readonly { wo_id: string; status: string; lines: { line_id: string; this_qty: number }[] }[]) {
  const ours = new Map(boqLines(boq).map((l) => [l.id, num(l.rate)]));
  const out: { ref: string; description: string; ours: number; sub: number; qty: number; margin: number }[] = [];
  for (const wo of wos) {
    if (wo.boq_id !== boq.id || wo.status === 'cancelled') continue;
    for (const l of wo.lines) {
      if (!l.boq_line_id || !ours.has(l.boq_line_id)) continue;
      const qty = round2(bills.filter((b) => b.wo_id === wo.id && b.status !== 'cancelled').reduce((s, b) => s + b.lines.filter((x) => x.line_id === l.id).reduce((a, x) => a + num(x.this_qty), 0), 0));
      const our = ours.get(l.boq_line_id)!;
      out.push({ ref: l.ref, description: l.description, ours: our, sub: num(l.rate), qty, margin: round2((our - num(l.rate)) * qty) });
    }
  }
  return out;
}

export const woValue =(wo: Pick<SubWorkOrder, 'lines'>) => round2(wo.lines.reduce((s, l) => s + num(l.qty) * num(l.rate), 0));

export interface WoInput {
  id?: string;
  date: string;
  vendor_id: string;
  vendor_name: string;
  boq_id?: string;
  contract_id?: string;
  site_id?: string;
  cost_centre_id?: string;
  lines: SubWoLine[];
  deductions: SubDeductionRule[];
  tds_section?: string;
}

export function saveWorkOrder(i: WoInput): SubWorkOrder {
  requireAccess('doc.create');
  if (!DAY.test(i.date)) throw new Error('Enter the work order date.');
  if (!i.vendor_id || !i.vendor_name.trim()) throw new Error('Choose the sub-contractor.');
  const lines = i.lines.filter((l) => l.description.trim() && num(l.qty) > 0);
  if (!lines.length) throw new Error('Add at least one line with a quantity.');
  const all = loadWorkOrders();
  const prev = i.id ? all.find((w) => w.id === i.id) : undefined;
  const number = prev?.number ?? nextSeriesNumberFor(SWO, i.date, all.map((w) => w.number));
  assertUnlocked({ issue_date: i.date, invoice_number: number }, prev ? 'edit' : 'create');
  const deductions = i.deductions.filter((d) => num(d.rate) > 0 || num(d.amount) > 0).map((d) => ({ ...d, ...(d.rate !== undefined ? { rate: num(d.rate) } : {}), ...(d.amount !== undefined ? { amount: num(d.amount) } : {}) }));
  const row: SubWorkOrder = {
    ...prev, ...i, id: prev?.id ?? generateId(), number, lines, deductions, status: prev?.status ?? 'open',
    created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}),
  };
  return withTablesRollback([SD.wo, 'series_counters'], () => {
    put(SD.wo, row);
    if (!prev) recordSeries(number);
    return row;
  });
}

export function setWoStatus(id: string, status: SubWorkOrder['status']): void {
  requireAccess('doc.create');
  const wo = loadWorkOrders().find((w) => w.id === id);
  if (wo) put(SD.wo, { ...wo, status, updated_at: new Date().toISOString() });
}

/** Delete a work order with no live bill (its SWO number stays used). */
export function deleteWorkOrder(id: string): void {
  requireAccess('doc.create');
  if (rowsOf<{ wo_id: string; status: string }>(SD.bills).some((m) => m.wo_id === id && m.status !== 'cancelled')) throw new Error('Cancel this work order\'s bills first.');
  drop(SD.wo, id);
}
