/**
 * ITC-04 working paper (job work, CGST Rule 45(3); P1-9, Phase 7M).
 *
 *  - Table 4: inputs / capital goods sent to a job worker (our Material Out challans dated in the period).
 *  - Table 5A: goods received back from the job worker they were sent to (consumed for processed goods, returned
 *    unprocessed, losses and wastes) — from Material In entries, against the original challan they settled.
 *  - Table 5B: received back from a job worker other than the one they were sent to (Material In with "via").
 *  - Table 5C: supplied directly from the job worker's premises (Sec 143(1)(b)).
 *  - Frequency (`ITC04_RULES` in tax-rules.ts, date-keyed, append-only): quarterly until FY 2020-21; from FY 2021-22
 *    half-yearly when aggregate turnover exceeds ₹5 crore, annual otherwise (Notification 35/2021-CT), due on the
 *    25th of the month after the period.
 *
 * A working paper, not portal-validated JSON: verify with your CA before filing. Pure (node:test).
 */

import type { MaterialIn, MaterialOut } from '../types/job-work';
import type { StockItem } from './inventory';
import { num, round2 } from './invoice-calc';
import { ITC04_RULES, ruleAt } from './tax-rules';
import { lineFactor, uqcFor, type UnitMaster } from './units';
import { challanBalances, type Settlement } from './job-work';
import { toCsv } from './csv';

export type Itc04Frequency = 'Q' | 'H' | 'A';

export interface Itc04Period {
  key: string;
  label: string;
  from: string;
  to: string;
  due: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const fyLabel = (y: number) => `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;

/** Filing frequency for a period starting `periodStart`, by aggregate turnover of the preceding FY (₹). */
export function itc04Frequency(turnover: number, periodStart: string): Itc04Frequency {
  const r = ruleAt(ITC04_RULES, periodStart);
  return num(turnover) > r.limit ? r.above : r.upTo;
}

/** The return periods of the Indian FY starting 1 April `fyStart`, for a frequency. */
export function itc04Periods(fyStart: number, freq: Itc04Frequency): Itc04Period[] {
  const dueDay = ruleAt(ITC04_RULES, iso(fyStart, 4, 1)).dueDay;
  const span = freq === 'A' ? 12 : freq === 'H' ? 6 : 3;
  const out: Itc04Period[] = [];
  for (let i = 0; i < 12; i += span) {
    const sm = ((3 + i) % 12) + 1; // 4, 7, 10, 1 …
    const sy = fyStart + (3 + i >= 12 ? 1 : 0);
    const endIdx = 3 + i + span - 1;
    const em = (endIdx % 12) + 1;
    const ey = fyStart + (endIdx >= 12 ? 1 : 0);
    const dm = (em % 12) + 1;
    const dy = em === 12 ? ey + 1 : ey;
    const n = i / span + 1;
    const key = `${fyLabel(fyStart)}-${freq === 'A' ? 'Y' : freq === 'H' ? `H${n}` : `Q${n}`}`;
    const label = freq === 'A' ? `${fyLabel(fyStart)} (annual)` : `${freq === 'H' ? 'H' : 'Q'}${n} ${fyLabel(fyStart)}`;
    out.push({ key, label, from: iso(sy, sm, 1), to: iso(ey, em, lastDay(ey, em)), due: iso(dy, dm, dueDay) });
  }
  return out;
}

export interface Itc04Table4Row {
  challan_no: string;
  challan_date: string;
  jw_gstin: string;
  jw_state: string;
  item: string;
  hsn: string;
  uqc: string;
  qty: number;
  taxable_value: number;
  goods_type: 'Inputs' | 'Capital goods';
  rate: number;
  igst: number;
  cgst: number;
  sgst: number;
}

export interface Itc04Table5Row {
  table: '5A' | '5B' | '5C';
  jw_gstin: string;
  jw_state: string;
  /** Job worker's challan / invoice (5A, 5B) or our invoice (5C). */
  jw_challan_no: string;
  jw_challan_date: string;
  /** Our original Material Out challan. */
  original_challan_no: string;
  original_challan_date: string;
  item: string;
  uqc: string;
  qty: number;
  nature: string;
  loss_qty: number;
  /** For 5B: the other job worker. */
  via?: string;
}

export interface Itc04Report {
  period: { from: string; to: string };
  table4: Itc04Table4Row[];
  table5: Itc04Table5Row[];
  /** Quantities received with no challan behind them (cannot be reported). */
  unmatched: number;
  notes: string[];
}

export interface Itc04Options {
  items: readonly StockItem[];
  units?: readonly UnitMaster[];
  /** Our GST state code (place of business), to split IGST vs CGST + SGST on Table 4. */
  ourStateCode?: string;
  /** Process per order id (nature of job work). */
  orderProcess?: Record<string, string>;
}

const BUILT_IN_UQC: Record<string, string> = { NOS: 'NOS', PCS: 'PCS', KG: 'KGS', KGS: 'KGS', LTR: 'LTR', MTR: 'MTR', SQF: 'SQF', SET: 'SET', BOX: 'BOX' };
const fallbackUqc = (u?: string) => BUILT_IN_UQC[(u ?? '').trim().toUpperCase()] ?? 'OTH';
const inRange = (d: string, from: string, to: string) => d.slice(0, 10) >= from && d.slice(0, 10) <= to;
const stateOf = (gstin?: string, code?: string) => (code || (gstin ?? '').slice(0, 2) || '').trim();

/** Build the ITC-04 working paper for [from, to] (inclusive local days). */
export function buildItc04(outs: readonly MaterialOut[], ins: readonly MaterialIn[], from: string, to: string, opts: Itc04Options): Itc04Report {
  const byId = new Map(opts.items.map((i) => [i.id, i]));
  const units = opts.units ?? [];
  const uqc = (itemId: string) => uqcFor(byId.get(itemId)?.unit, units, fallbackUqc);
  const name = (itemId: string) => byId.get(itemId)?.name ?? 'Deleted item';
  const table4: Itc04Table4Row[] = [];
  for (const o of outs) {
    if (!o?.date || !inRange(o.date, from, to)) continue;
    const st = stateOf(o.party_gstin, o.party_state_code);
    const inter = !!st && !!opts.ourStateCode && st !== opts.ourStateCode;
    for (const l of o.lines ?? []) {
      const qty = num(l.qty) * lineFactor(l);
      if (!l.item_id || !(qty > 0)) continue;
      const value = round2(num(l.qty) * num(l.rate));
      const rate = num(l.tax_rate ?? byId.get(l.item_id)?.tax_rate);
      const tax = round2((value * rate) / 100);
      table4.push({
        challan_no: o.number, challan_date: o.date, jw_gstin: o.party_gstin ?? '', jw_state: st, item: name(l.item_id),
        hsn: l.hsn ?? byId.get(l.item_id)?.hsn ?? '', uqc: uqc(l.item_id), qty: round2(qty), taxable_value: value,
        goods_type: l.goods_kind && l.goods_kind !== 'input' ? 'Capital goods' : 'Inputs', rate,
        igst: inter ? tax : 0, cgst: inter ? 0 : round2(tax / 2), sgst: inter ? 0 : round2(tax - round2(tax / 2)),
      });
    }
  }
  // Settlements are allocated over every challan ever issued, so an old challan settled now is still matched.
  const bal = challanBalances(outs, ins, to);
  const outById = new Map(outs.map((o) => [o.id, o]));
  const inById = new Map(ins.map((v) => [v.id, v]));
  const groups = new Map<string, { s: Settlement; qty: number; loss: number }>();
  for (const s of bal.settlements) {
    const v = inById.get(s.inId);
    if (!v || !inRange(v.date, from, to)) continue;
    const k = `${s.inId}|${s.outLineId}|${s.what === 'supplied' ? 'C' : 'AB'}`;
    const g = groups.get(k) ?? { s, qty: 0, loss: 0 };
    if (s.what === 'lost') g.loss += s.qty;
    else g.qty += s.qty;
    groups.set(k, g);
  }
  const table5: Itc04Table5Row[] = [];
  for (const { s, qty, loss } of groups.values()) {
    const v = inById.get(s.inId) as MaterialIn;
    const o = outById.get(s.outId);
    const via = v.via_party_name?.trim();
    const table: Itc04Table5Row['table'] = s.what === 'supplied' ? '5C' : via ? '5B' : '5A';
    const processed = (v.received ?? []).filter((l) => l.kind === 'processed').map((l) => name(l.item_id));
    const nature = opts.orderProcess?.[v.order_id ?? ''] || (processed.length ? `Processed into ${processed.join(', ')}` : s.what === 'returned' ? 'Returned unprocessed' : 'Job work');
    table5.push({
      table, jw_gstin: (table === '5B' ? v.via_party_gstin : v.party_gstin) ?? '', jw_state: stateOf(table === '5B' ? v.via_party_gstin : v.party_gstin),
      jw_challan_no: table === '5C' ? (v.supply_invoice_no ?? '') : (v.jw_challan_no ?? v.number), jw_challan_date: table === '5C' ? v.date : (v.jw_challan_date ?? v.date),
      original_challan_no: o?.number ?? '', original_challan_date: o?.date ?? '', item: name(s.item_id), uqc: uqc(s.item_id),
      qty: round2(qty), nature, loss_qty: round2(loss), ...(table === '5B' ? { via } : {}),
    });
  }
  table5.sort((a, b) => a.table.localeCompare(b.table) || a.jw_challan_date.localeCompare(b.jw_challan_date) || a.original_challan_no.localeCompare(b.original_challan_no));
  table4.sort((a, b) => a.challan_date.localeCompare(b.challan_date) || a.challan_no.localeCompare(b.challan_no, undefined, { numeric: true }));
  const unmatched = bal.unmatched.filter((u) => {
    const v = inById.get(u.inId);
    return v && inRange(v.date, from, to);
  }).length;
  const notes = [
    'Working paper, not portal-validated: verify with your CA before filing ITC-04.',
    'Quantities are in each item\'s base unit; Table 5 reports the original goods settled against our challans.',
  ];
  if (!opts.ourStateCode) notes.push('Your GST state is not set: Table 4 tax is split as CGST + SGST.');
  return { period: { from, to }, table4, table5, unmatched, notes };
}

/** Table 4 and Table 5 as CSV (one file, a header row per table). */
export function itc04Csv(r: Itc04Report): string {
  const t4 = [
    ['Table 4: goods sent to job worker'],
    ['Challan no', 'Challan date', 'Job worker GSTIN', 'State', 'Description', 'HSN', 'UQC', 'Quantity', 'Taxable value', 'Type of goods', 'Rate %', 'IGST', 'CGST', 'SGST'],
    ...r.table4.map((x) => [x.challan_no, x.challan_date, x.jw_gstin, x.jw_state, x.item, x.hsn, x.uqc, x.qty, x.taxable_value, x.goods_type, x.rate, x.igst, x.cgst, x.sgst]),
  ];
  const t5 = [
    [],
    ['Table 5: goods received back / supplied from job worker'],
    ['Table', 'Job worker GSTIN', 'State', 'Job worker challan / invoice', 'Date', 'Original challan', 'Original date', 'Description', 'UQC', 'Quantity', 'Nature of job work', 'Losses / wastes qty', 'Via job worker'],
    ...r.table5.map((x) => [x.table, x.jw_gstin, x.jw_state, x.jw_challan_no, x.jw_challan_date, x.original_challan_no, x.original_challan_date, x.item, x.uqc, x.qty, x.nature, x.loss_qty, x.via ?? '']),
    [],
    ...r.notes.map((n) => [n]),
  ];
  return toCsv([...t4, ...t5] as (string | number)[][]);
}
