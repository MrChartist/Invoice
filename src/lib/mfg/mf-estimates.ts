/**
 * MF-B5 print estimates `PES/FY…` (table `print_estimates`, `doc.create`, dated `date`; pack `press`) and job tickets.
 * Per quantity break: ups (`mf-paper.ts`), net + wastage sheets, paper kg and cost (₹ / kg), plates = (front + back
 * colours + a varnish plate) × one set, colour passes on the press (colours ÷ press colours per side, rounded up; one
 * per colour without a press), impressions = sheets × passes, press cost = impressions ÷ 1000 × rate (not below the
 * press's minimum charge) and press hours (impressions ÷ speed + make-ready), finishing (₹ / sq in of sheet, / sheet,
 * / piece or per lot), outside work, margin %; price per piece.
 *
 * "Make quotation" saves one QUOTATION draft per break with the print particulars in `mf.print` (the A5 "Print job"
 * box). A won estimate becomes a job ticket: a BOM "Print job PES/…" (paper as the material for the break) and a
 * production order (R4-A) — the finishing steps print on the ticket; actual sheets issued vs estimated on completion.
 * Printing classes (`PRINT_CLASS_RULES`) are suggestions by date; a typed rate wins (MF3–MF5).
 */
import './mf-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { MfPress, PrintEstimate } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import type { StockItem } from '../inventory';
import { stockDb } from '../inventory';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { ruleAt } from '../tax-rules';
import { PRINT_CLASS_RULES, type MfClassRate, type PrintClass } from '../mfg-rules';
import { num } from '../invoice-calc';
import { bomsDb } from '../manufacturing';
import { loadOrderDocs, orderProgress, productionOrdersDb } from '../production/orders';
import { esc } from '../voucher-print';
import { readMfgSettings, saveMfgSettings } from './mf-settings';
import { mfSnapshot } from './mf-snapshot';
import { MF_SERIES, MF_TABLES } from './mf-shared';
import { DAY, drop, mustGet, nowIso, put, r2, r3, rowsOf } from './mf-b-db';
import { DEFAULT_MARGINS, netSheets, paperKg, reams, sqIn, upsOn, wasteSheets } from './mf-paper';
import { clientOf, mfDraft, mfLine, saveDraft } from './mf-b-docs';

export const PES = MF_SERIES.estimates;
export const ESTIMATES_TABLE = MF_TABLES.estimates;

/** A printing class suggestion on a date (`rate: null` = goods rate of the printed product — type it). */
export const PRINT_CLASSES = Object.keys(PRINT_CLASS_RULES) as PrintClass[];
export const printClassRate = (c: PrintClass, date?: string): MfClassRate => ruleAt(PRINT_CLASS_RULES[c], date);

export interface EstimateBreak {
  qty: number;
  ups: number;
  net_sheets: number;
  waste_sheets: number;
  sheets: number;
  kg: number;
  reams: number;
  plates: number;
  passes: number;
  impressions: number;
  press_hours: number;
  paper: number;
  plates_cost: number;
  press: number;
  finishing: number;
  outside: number;
  cost: number;
  total: number;
  per_piece: number;
}

/** Colour passes on the press: each side's colours ÷ the press's colours (up); one per colour without a press. */
export function colourPasses(front: number, back: number, press?: Pick<MfPress, 'colours'>): number {
  const n = Math.max(Math.round(num(press?.colours)), 1);
  const side = (c: number) => (num(c) > 0 ? Math.ceil(num(c) / n) : 0);
  return side(front) + side(back);
}

export function estimateBreak(e: Omit<PrintEstimate, 'id' | 'number' | 'status'>, qty: number, press?: MfPress): EstimateBreak {
  const q = Math.max(Math.round(num(qty)), 0);
  const u = upsOn(e.sheet, e.size, e.margins ?? DEFAULT_MARGINS).ups;
  const passes = colourPasses(e.colours_front, e.colours_back, press);
  const net = netSheets(q, u);
  const waste = net ? wasteSheets(net, passes, num(press?.make_ready_sheets), e.running_waste_pct) : 0;
  const sheets = net + waste;
  const kg = paperKg(sheets, e.sheet, e.gsm);
  const plates = Math.round(num(e.colours_front) + num(e.colours_back) + (e.varnish_plate ? 1 : 0));
  const impressions = sheets * passes;
  const pressCost = press ? Math.max((impressions / 1000) * num(press.rate_per_1000_imp), num(press.min_charge)) : 0;
  const hours = press && num(press.impressions_per_hour) > 0 ? impressions / num(press.impressions_per_hour) + (passes * num(press.make_ready_min)) / 60 : 0;
  const area = sqIn(e.sheet);
  const finishing = e.finishing.reduce((s, f) => s + num(f.rate) * (f.basis === 'sqin' ? area * sheets : f.basis === 'sheet' ? sheets : f.basis === 'piece' ? q : 1), 0);
  const paper = kg * num(e.paper_rate);
  const platesCost = plates * num(e.plate_rate);
  const cost = paper + platesCost + pressCost + finishing + num(e.outside);
  const total = r2(cost * (1 + num(e.margin_pct) / 100));
  return {
    qty: q, ups: u, net_sheets: net, waste_sheets: waste, sheets, kg, reams: reams(sheets), plates, passes, impressions, press_hours: r2(hours),
    paper: r2(paper), plates_cost: r2(platesCost), press: r2(pressCost), finishing: r2(finishing), outside: r2(num(e.outside)), cost: r2(cost), total,
    per_piece: q > 0 ? r3(total / q) : 0,
  };
}

const pressOf = (id?: string) => (id ? (readMfgSettings().presses ?? []).find((p) => p.id === id) : undefined);

export const estimateBreaks = (e: Omit<PrintEstimate, 'id' | 'number' | 'status'>, press: MfPress | undefined = pressOf(e.press_id)): EstimateBreak[] =>
  [...new Set(e.breaks.map((b) => Math.round(num(b))).filter((b) => b > 0))].sort((a, b) => a - b).map((b) => estimateBreak(e, b, press));

export function validateEstimate(e: Partial<PrintEstimate>): string {
  if (!DAY.test(e.date ?? '')) return 'Enter the date.';
  if (!e.job?.trim()) return 'Describe the job.';
  if (!(num(e.size?.w) > 0 && num(e.size?.h) > 0)) return 'Enter the finished size.';
  if (!(num(e.sheet?.w) > 0 && num(e.sheet?.h) > 0)) return 'Enter the sheet size.';
  if (!(num(e.gsm) > 0)) return 'Enter the GSM.';
  if (upsOn(e.sheet!, e.size!, e.margins ?? DEFAULT_MARGINS).ups < 1) return 'The job does not fit on this sheet.';
  const b = e.breaks?.filter((x) => num(x) > 0) ?? [];
  if (b.length < 1 || b.length > 4) return 'Give 1 to 4 quantity breaks.';
  if (num(e.colours_front) < 0 || num(e.colours_back) < 0 || num(e.colours_front) + num(e.colours_back) < 1) return 'Enter the colours.';
  return '';
}

/** The `mf.print` particulars of a break (printed in the "Print job" box). */
export const printSnap = (e: PrintEstimate, b: EstimateBreak) => ({
  size: `${e.size.w} × ${e.size.h} mm`, colours: `${e.colours_front} + ${e.colours_back}${e.varnish_plate ? ' + varnish' : ''}`, quantity: String(b.qty),
  ups: b.ups, sheets: b.sheets, impressions: b.impressions, paper: `${e.gsm} GSM ${e.sheet.w} × ${e.sheet.h} mm · ${b.kg} kg`,
});

/** The job ticket (A4): specification, paper, plates, press, finishing; actual sheets when known. */
export function ticketHtml(e: PrintEstimate, b: EstimateBreak, order?: Pick<ProductionOrder, 'number'>, actualSheets?: number): string {
  const row = (k: string, v: string | number) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(order?.number ?? e.number)}</title>
<style>@page{size:A4}body{font-family:system-ui,sans-serif;margin:0;padding:20px;font-size:13px}h1{font-size:16px}table{width:100%;border-collapse:collapse}th,td{border:1px solid;padding:4px 6px;text-align:left}th{width:35%}</style></head><body>
<h1>JOB TICKET ${esc(order?.number ?? '')} · ${esc(e.number)}</h1><table><tbody>
${row('Job', e.job)}${row('Quantity', b.qty)}${row('Finished size', `${e.size.w} × ${e.size.h} mm`)}${row('Colours', `${e.colours_front} front + ${e.colours_back} back${e.varnish_plate ? ' + varnish' : ''}`)}
${row('Sheet', `${e.sheet.w} × ${e.sheet.h} mm · ${e.gsm} GSM · ${b.ups} ups`)}${row('Sheets', `${b.net_sheets} + ${b.waste_sheets} wastage = ${b.sheets} (${b.kg} kg, ${b.reams} reams)`)}
${row('Plates', b.plates)}${row('Impressions', `${b.impressions} (${b.passes} pass${b.passes === 1 ? '' : 'es'})`)}${row('Finishing', e.finishing.map((f) => f.name).join(', ') || '—')}
${actualSheets !== undefined ? row('Actual sheets issued', `${actualSheets} (estimate ${b.sheets})`) : ''}</tbody></table>
<p>Press ______________ &nbsp; Operator ______________ &nbsp; Checked ______________</p></body></html>`;
}

/* ================================================================
   Storage
   ================================================================ */

export const loadEstimates = (): PrintEstimate[] => rowsOf<PrintEstimate>(ESTIMATES_TABLE).filter((e) => Array.isArray(e.breaks));
export const loadPresses = (): MfPress[] => readMfgSettings().presses ?? [];
const lockOf = (e: Pick<PrintEstimate, 'id' | 'date' | 'number'>) => ({ id: e.id, issue_date: e.date, invoice_number: e.number });

/** Owner: add or edit a press (`mfg_settings.presses`). */
export function savePress(p: Omit<MfPress, 'id'> & { id?: string }): MfPress {
  if (!p.name?.trim()) throw new Error('Name the press.');
  if (!(num(p.max_sheet?.w) > 0 && num(p.max_sheet?.h) > 0) || !(num(p.colours) >= 1)) throw new Error('Enter the largest sheet and the colours.');
  const row: MfPress = { ...p, id: p.id ?? generateId(), name: p.name.trim(), colours: Math.round(num(p.colours)) };
  const all = loadPresses();
  saveMfgSettings({ presses: all.some((x) => x.id === row.id) ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row] });
  return row;
}

export function saveEstimate(i: Omit<PrintEstimate, 'id' | 'number' | 'status'> & { id?: string; status?: PrintEstimate['status'] }): PrintEstimate {
  requireAccess('doc.create');
  const err = validateEstimate(i);
  if (err) throw new Error(err);
  const press = pressOf(i.press_id);
  if (press && (num(i.sheet.w) > num(press.max_sheet.w) || num(i.sheet.h) > num(press.max_sheet.h)) && (num(i.sheet.w) > num(press.max_sheet.h) || num(i.sheet.h) > num(press.max_sheet.w))) throw new Error(`The sheet is larger than ${press.name} takes.`);
  const prev = i.id ? loadEstimates().find((x) => x.id === i.id) : undefined;
  const id = prev?.id ?? generateId();
  const number = prev?.number ?? nextSeriesNumberFor(PES, i.date, loadEstimates().map((x) => x.number));
  assertUnlocked(lockOf({ id, date: i.date, number }), prev ? 'edit' : 'create');
  const row: PrintEstimate = { ...prev, ...i, id, number, job: i.job.trim(), status: i.status ?? prev?.status ?? 'draft', breaks: i.breaks.filter((b) => num(b) > 0).map((b) => Math.round(num(b))), created_at: prev?.created_at ?? nowIso(), updated_at: nowIso() };
  return withTablesRollback([ESTIMATES_TABLE, 'series_counters'], () => {
    put(ESTIMATES_TABLE, row);
    recordSeries(number);
    return row;
  });
}

/** Delete (recycle bin; the PES number stays reserved). Refused once a job ticket was made. */
export function removeEstimate(id: string): void {
  requireAccess('doc.create');
  const e = mustGet<PrintEstimate>(ESTIMATES_TABLE, id, 'estimate');
  if (e.order_id) throw new Error(`${e.number} has a job ticket; cancel the production order instead.`);
  assertUnlocked(lockOf(e), 'delete');
  drop(ESTIMATES_TABLE, id);
}

/** One QUOTATION draft per break (`mf.kind = 'print'`); the estimate becomes "quoted". */
export function makePrintQuotations(id: string, items: readonly Pick<StockItem, 'id' | 'name' | 'hsn' | 'unit' | 'tax_rate'>[] = stockDb.items()): InvoiceRecord[] {
  requireAccess('doc.create');
  const e = mustGet<PrintEstimate>(ESTIMATES_TABLE, id, 'estimate');
  const it = e.item_id ? items.find((x) => x.id === e.item_id) : undefined;
  return withTablesRollback(['invoices', 'series_counters', ESTIMATES_TABLE], () => {
    const out = estimateBreaks(e).map((b) => saveDraft(mfDraft('QUOTATION', e.date, clientOf(e.client_id), [
      mfLine({ name: it?.name ?? e.job, description: `${e.number}`, hsn: it?.hsn ?? '', unit: it?.unit || 'NOS', quantity: b.qty, rate: b.per_piece, tax_rate: num(it?.tax_rate) }),
    ], mfSnapshot('print', { print: printSnap(e, b) }))));
    put(ESTIMATES_TABLE, { ...e, status: 'quoted', quote_ids: [...(e.quote_ids ?? []), ...out.map((r) => r.id)], updated_at: nowIso() });
    return out;
  });
}

/** Won: a BOM "Print job PES/…" (the break's paper) and a planned production order of the printed item (books.edit). */
export function makeJobTicket(id: string, qty: number, items: readonly StockItem[] = stockDb.items()): ProductionOrder {
  requireAccess('books.edit');
  const e = mustGet<PrintEstimate>(ESTIMATES_TABLE, id, 'estimate');
  if (e.order_id) throw new Error(`${e.number} already has a job ticket.`);
  if (!e.item_id || !e.stock_item_id) throw new Error('Pick the printed item and the paper / board item on the estimate first.');
  const b = estimateBreaks(e).find((x) => x.qty === Math.round(num(qty)));
  if (!b) throw new Error('Pick one of the estimate\'s quantities.');
  const paper = items.find((i) => i.id === e.stock_item_id);
  const paperQty = String(paper?.unit ?? '').toUpperCase() === 'KG' ? b.kg : b.sheets;
  return withTablesRollback([ESTIMATES_TABLE, 'boms', 'production_orders', 'series_counters'], () => {
    const bom = bomsDb.save({ item_id: e.item_id!, name: `Print job ${e.number} × ${b.qty}`, batch_qty: b.qty, is_default: false, components: [{ id: generateId(), item_id: e.stock_item_id!, qty: paperQty }], outputs: [] }, items);
    const order = productionOrdersDb.save({ date: e.date, item_id: e.item_id!, bom_id: bom.id, planned_qty: b.qty, narration: `Job ticket ${e.number}: ${e.job}` }, items, bomsDb.all());
    put(ESTIMATES_TABLE, { ...e, status: 'won', order_id: order.id, updated_at: nowIso() });
    return order;
  });
}

/** Sheets of the paper item issued to the order (net of returns), base units — for "actual vs estimate". */
export function actualPaper(e: Pick<PrintEstimate, 'order_id' | 'stock_item_id'>): number | undefined {
  const o = e.order_id ? productionOrdersDb.get(e.order_id) : undefined;
  if (!o || !e.stock_item_id) return undefined;
  const p = orderProgress(o, loadOrderDocs());
  return r3((p.issued.get(e.stock_item_id) ?? 0) - (p.returned.get(e.stock_item_id) ?? 0));
}
