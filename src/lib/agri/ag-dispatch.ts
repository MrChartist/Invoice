/**
 * AG-B4 dispatch to the union / plant (table `milk_dispatches`, `MDS/FY…`, `doc.create`, audited). Saving takes the milk
 * out of the centre godown (a consume-only stock journal, `books.edit`); the union's acknowledgement adds its own
 * quantity, fat and SNF. "Bill" raises a sale invoice to the buyer at the buyer's chart (a B1 chart with `buyer_id`),
 * on the received figures by default (setting `invoice_from`), class `milk_fresh` (nil): a bill of supply carrying the
 * `ag` snapshot (kg fat / kg SNF per line) — the snapshot never changes when a later chart comes. Union payments are
 * ordinary receipts against these bills. Working paper — verify with your CA (AG2, AG28).
 */
import './ag-registry';
import type { AgSnapshot, MilkDispatch, MilkKind, MilkRateChart, MilkUnit } from '../../types/agri-r12';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { blankClient, blankItem, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { SJ_TABLE, stockJournalsDb } from '../manufacturing';
import { AG_SERIES, AG_TABLES } from './ag-shared';
import { agSnapshot } from './ag-snapshot';
import { readAgriSettings } from './ag-settings';
import { chartAt, chartRate, clrOf, q3, solids, toL } from './ag-rate-chart';
import { centreGodown, milkItemId, milkJournal } from './ag-shifts';

const T = AG_TABLES.dispatches;
export const MDS = AG_SERIES.dispatches;
export const loadDispatches = (): MilkDispatch[] => getTable<MilkDispatch>(T).filter((d) => d && typeof d.id === 'string');
/** QA13 G9: a bill that still stands (a cancelled or deleted bill frees its dispatch / milk card to be billed again). */
export const liveBill = (id?: string): boolean => { const b = id ? localDb.invoices.getById(id) : undefined; return !!b && b.status !== 'Cancelled'; };
export const MILK_LABEL: Readonly<Record<MilkKind, string>> = { cow: 'Cow milk', buffalo: 'Buffalo milk', mixed: 'Mixed milk' };

/**
 * One issued nil-rated milk bill (bill of supply) to `client`, numbered in the bill-of-supply series, with the `ag`
 * snapshot. Shared by dispatches and milk cards.
 */
export function milkSaleBill(client: Client, items: InvoiceItem[], date: string, ag: AgSnapshot, notes = ''): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = { ...makeDraft({ settings, sender, docType: 'BILL_OF_SUPPLY', templateId: localDb.template.get() }), id: generateId(), issue_date: date, due_date: date };
  const rec = buildBillDraft(base, client, items, sender);
  return localDb.invoices.save({ ...rec, doc_type: 'BILL_OF_SUPPLY', gst_mode: 'NONE', exempt_kind: 'NIL', status: 'Sent', notes, ag, invoice_number: localDb.invoices.nextNumber(date, 'BILL_OF_SUPPLY', sender?.invoicePrefix || undefined) });
}

/** A milk line (HSN 0401, nil, class `milk_fresh`). */
export const milkLine = (milk: MilkKind, qty: number, unit: MilkUnit, rate: number, description = ''): InvoiceItem =>
  ({ ...blankItem(0), name: MILK_LABEL[milk], description, type: 'Goods', hsn: '0401', unit: unit === 'KG' ? 'KGS' : 'LTR', quantity: q3(qty), rate: round2(rate), amount: round2(q3(qty) * rate), tax_rate: 0, ag_class: 'milk_fresh' });

export type DispatchInput = Omit<MilkDispatch, 'id' | 'number' | 'sj_id' | 'invoice_id' | 'created_at' | 'updated_at'> & { id?: string };

/** Save a dispatch: stock leaves the centre godown on save (the journal is remade when the sent quantity changes). */
export function saveDispatch(input: DispatchInput): MilkDispatch {
  requireAccess('doc.create');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.centre_id || !input.buyer_id) throw new Error('Pick the date, centre and buyer.');
  if (!(num(input.sent.qty) > 0)) throw new Error('Type the quantity sent.');
  const all = loadDispatches();
  const prev = input.id ? all.find((d) => d.id === input.id) : undefined;
  const sentChanged = !prev || prev.date !== input.date || prev.milk !== input.milk || prev.centre_id !== input.centre_id || JSON.stringify(prev.sent) !== JSON.stringify(input.sent);
  if (sentChanged && liveBill(prev?.invoice_id)) throw new Error(`${prev?.number} is billed: only the union's acknowledgement can change.`);
  return withTablesRollback([T, SJ_TABLE, 'stock_items', 'series_counters'], () => {
    const number = prev?.number && numberFitsFy(prev.number, input.date) ? prev.number : nextSeriesNumberFor(MDS, input.date, all.map((d) => d.number));
    const id = prev?.id ?? generateId();
    let sj_id = prev?.sj_id;
    if (sentChanged) {
      if (sj_id && stockJournalsDb.all().some((j) => j.id === sj_id)) stockJournalsDb.remove(sj_id);
      const litres = toL(input.sent.qty, input.sent.unit, clrOf(input.milk, readAgriSettings().milk, input.date));
      sj_id = milkJournal(input.date, [{ item_id: milkItemId(input.milk), qty: litres, godown_id: centreGodown(input.centre_id) }], 'out', `Milk dispatch ${number}${input.tanker ? ` · tanker ${input.tanker}` : ''}`, id).id;
    }
    const buyer = localDb.clients.getById(input.buyer_id);
    const row: MilkDispatch = { ...prev, ...input, id, number, buyer_name: buyer?.company || buyer?.name || input.buyer_name, ...(sj_id ? { sj_id } : {}), created_at: prev?.created_at ?? new Date().toISOString(), updated_at: new Date().toISOString() };
    setTable(T, prev ? all.map((d) => (d.id === row.id ? row : d)) : [...all, row]);
    recordSeries(number);
    return row;
  });
}

/** Delete an unbilled dispatch (its journal and the row go to the recycle bin; the MDS number stays used). */
export function deleteDispatch(id: string): void {
  requireAccess('doc.create');
  const d = loadDispatches().find((x) => x.id === id);
  if (!d) return;
  if (liveBill(d.invoice_id)) throw new Error(`${d.number} is billed: delete or cancel the bill first.`);
  withTablesRollback([T, SJ_TABLE], () => {
    if (d.sj_id && stockJournalsDb.all().some((j) => j.id === d.sj_id)) stockJournalsDb.remove(d.sj_id);
    setTable(T, loadDispatches().filter((x) => x.id !== id));
  });
}

/** The figures a bill uses: received (default, when acknowledged) or sent. */
export function billFigures(d: MilkDispatch, from = readAgriSettings().milk?.invoice_from ?? 'received'): { qty: number; unit: MilkUnit; fat: number; snf: number } {
  return from === 'received' && d.received ? { qty: d.received.qty, unit: d.sent.unit, fat: d.received.fat, snf: d.received.snf } : { qty: d.sent.qty, unit: d.sent.unit, fat: d.sent.fat, snf: d.sent.snf };
}

/** Pure: the bill line and snapshot of a dispatch on the buyer's chart. */
export function dispatchBillParts(d: MilkDispatch, charts: readonly MilkRateChart[], from?: 'received' | 'sent'): { item: InvoiceItem; ag: AgSnapshot } {
  const f = billFigures(d, from);
  const chart = chartAt(charts, d.date, d.milk, { buyerId: d.buyer_id });
  if (!chart) throw new Error(`No rate chart of ${d.buyer_name ?? 'this buyer'} for ${d.milk} milk on ${d.date}: add one in Rate charts (buyer).`);
  const clr = clrOf(d.milk, readAgriSettings().milk, d.date);
  const r = chartRate(chart, { ...f, clr, shift: d.shift, milk: d.milk });
  if (r.rejected) throw new Error('The buyer\'s chart rejects this milk (below its minimum).');
  const qty = chart.unit === 'KG' ? q3(f.unit === 'KG' ? f.qty : f.qty * (1 + clr / 1000)) : toL(f.qty, f.unit, clr);
  const sol = solids(f.qty, f.unit, f.fat, f.snf, clr);
  const item = milkLine(d.milk, qty, chart.unit, r.rate, `${d.number} · ${d.shift === 'M' ? 'morning' : 'evening'}`);
  return { item, ag: agSnapshot('milk_sale', { milk: { tanker: d.tanker, shift: d.shift, kg_fat: sol.kgFat, kg_snf: sol.kgSnf, chart: chart.name }, lines: { [item.id]: { fat: f.fat, snf: f.snf, litres: toL(f.qty, f.unit, clr) } } }) };
}

/** Raise the bill of a dispatch (once). */
export function billDispatch(id: string, date?: string): InvoiceRecord {
  requireAccess('doc.create');
  const d = loadDispatches().find((x) => x.id === id);
  if (!d) throw new Error('Dispatch not found.');
  if (liveBill(d.invoice_id)) throw new Error(`${d.number} is already billed.`);
  const { item, ag } = dispatchBillParts(d, getTable<MilkRateChart>(AG_TABLES.rateCharts));
  const client = localDb.clients.getById(d.buyer_id) ?? { ...blankClient(), name: d.buyer_name ?? 'Union' };
  return withTablesRollback([T, 'invoices', 'clients', 'series_counters'], () => {
    const inv = milkSaleBill(client, [item], date ?? d.received?.date ?? d.date, ag, `Milk dispatch ${d.number}${d.received?.ack_no ? ` · acknowledgement ${d.received.ack_no}` : ''}. Nil-rated fresh milk (N 2/2017-CT(R)) — verify with your CA.`);
    setTable(T, loadDispatches().map((x) => (x.id === id ? { ...x, invoice_id: inv.id, updated_at: new Date().toISOString() } : x)));
    return inv;
  });
}
