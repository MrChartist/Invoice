/**
 * SV-B3 lab tests and orders.
 *  - `lab_tests` (`master.edit`, audited "Lab test"): code, department, sample, TAT, price, parameters with reference
 *    ranges by sex and age band and critical limits, panels (a test listing other tests), outsourcing (vendor, cost).
 *  - `lab_orders` (`doc.create`, audited "Lab order", dated `date`, numbered `LAB/FY…`): patient, referring doctor,
 *    the tests expanded from panels without duplicates and SNAPSHOTTED (a later master edit never changes a report),
 *    sample status, results per parameter with flags H / L / critical from the patient's sex and age on the order date,
 *    report status `pending → partial → final → delivered`; a final report edited again is "amended" and the earlier
 *    results are kept in `history`. The bill is made from the order (exempt health care lines, one per test).
 *  - Outsourced tests: one purchase bill per reference lab and period from the orders' costs (marked, never twice).
 * Working papers — verify with your CA (SV1).
 */
import './sv-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import type { LabOrder, LabOrderTest, LabParam, LabRange, LabTest } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { num, round2 } from '../invoice-calc';
import { localDb } from '../localDb';
import { senderStateCode } from '../../store/invoice-defaults';
import { computePurchaseTotals, purchasesDb } from '../purchases';
import { clinicDraft, clinicLine, liveInvoice, patientClient } from './sv-patients';
import { SV_SERIES, SV_TABLES } from './sv-shared';

export const LAB = SV_SERIES.labOrders;
const rows = <T>(t: string): T[] => getTable<T>(t).filter((r) => !!r && typeof (r as { id?: unknown }).id === 'string');
export const loadTests = (): LabTest[] => rows<LabTest>(SV_TABLES.labTests);
export const loadOrders = (): LabOrder[] => rows<LabOrder>(SV_TABLES.labOrders);

/* ── Pure ── */

/** Expand panels (nested, cycle-safe) into the tests that carry parameters, without duplicates, in order. */
export function expandTests(ids: readonly string[], master: readonly LabTest[]): LabTest[] {
  const out: LabTest[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    const t = master.find((x) => x.id === id);
    if (!t || seen.has(t.id) || depth > 5) return;
    seen.add(t.id);
    if (t.panel?.length) t.panel.forEach((p) => walk(p, depth + 1));
    else out.push(t);
  };
  ids.forEach((id) => walk(id, 0));
  return out;
}

/** The reference range for a sex / age (sex-specific and age-banded rows win over general ones). */
export function rangeFor(p: Pick<LabParam, 'ranges'>, sex?: string, age?: number): LabRange | undefined {
  const fits = (r: LabRange) => (!r.sex || r.sex === sex) && (r.age_from == null || (age != null && age >= r.age_from)) && (r.age_to == null || (age != null && age <= r.age_to));
  const score = (r: LabRange) => (r.sex ? 2 : 0) + (r.age_from != null || r.age_to != null ? 1 : 0);
  return (p.ranges ?? []).filter(fits).sort((a, b) => score(b) - score(a))[0];
}

export type LabFlag = '' | 'H' | 'L' | 'CH' | 'CL';
/** Flag a result: critical limits first, then the range (numeric only). */
export function flagOf(p: LabParam, value: string, sex?: string, age?: number): LabFlag {
  if (p.kind !== 'numeric' || !String(value).trim()) return '';
  const v = Number(value);
  if (!Number.isFinite(v)) return '';
  if (p.crit_high != null && v >= p.crit_high) return 'CH';
  if (p.crit_low != null && v <= p.crit_low) return 'CL';
  const r = rangeFor(p, sex, age);
  if (r?.high != null && v > r.high) return 'H';
  if (r?.low != null && v < r.low) return 'L';
  return '';
}

/** "4.0–11.0" / "< 200" / the text range. */
export const rangeText = (r: LabRange | undefined): string => (!r ? '' : r.text || (r.low != null && r.high != null ? `${r.low}–${r.high}` : r.high != null ? `< ${r.high}` : r.low != null ? `> ${r.low}` : ''));

export const resultKey = (testId: string, code: string) => `${testId}:${code}`;

/** Report status from the results: none → pending, some → partial, all → final (delivered stays delivered). */
export function reportStatus(o: Pick<LabOrder, 'tests' | 'results' | 'report'>): LabOrder['report'] {
  const keys = o.tests.flatMap((t) => t.params.map((p) => resultKey(t.id, p.code)));
  const filled = keys.filter((k) => String(o.results[k] ?? '').trim()).length;
  if (!filled) return 'pending';
  if (filled < keys.length) return 'partial';
  return o.report === 'delivered' ? 'delivered' : 'final';
}

/**
 * Analyser CSV paste: `parameter code, value` per line (header / blank lines skipped). Codes match the order's
 * parameters (first test that has it); unknown codes are returned.
 */
export function parseResultsCsv(text: string, tests: readonly LabOrderTest[]): { results: Record<string, string>; unknown: string[] } {
  const results: Record<string, string> = {};
  const unknown: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const [code, ...rest] = raw.split(/[,\t;]/).map((s) => s.trim());
    const value = rest.join(',').trim();
    if (!code || !value || /^(parameter|code)$/i.test(code)) continue;
    const t = tests.find((x) => x.params.some((p) => p.code.toLowerCase() === code.toLowerCase()));
    if (!t) unknown.push(code);
    else results[resultKey(t.id, t.params.find((p) => p.code.toLowerCase() === code.toLowerCase())!.code)] = value;
  }
  return { results, unknown };
}

/** Is a sample past its TAT (hours from the order's creation) and not done? */
export const tatBreached = (o: Pick<LabOrder, 'created_at' | 'tests' | 'report'>, now: Date): boolean => {
  const tat = Math.max(0, ...o.tests.map((t) => num(t.tat)));
  return tat > 0 && (o.report === 'pending' || o.report === 'partial') && now.getTime() - Date.parse(o.created_at) > tat * 3600000;
};

/* ── Storage ── */

export type TestInput = Omit<LabTest, 'id' | 'created_at'> & { id?: string };

export function saveTest(i: TestInput): LabTest {
  requireAccess('master.edit');
  const code = i.code.trim().toUpperCase();
  if (!code || !i.name.trim()) throw new Error('Give the test a code and a name.');
  const all = loadTests();
  if (all.some((t) => t.id !== i.id && t.code.toUpperCase() === code)) throw new Error(`Test code ${code} is already used.`);
  if (i.panel?.includes(i.id ?? '-')) throw new Error('A panel cannot list itself.');
  const prev = i.id ? all.find((t) => t.id === i.id) : undefined;
  const params = (i.params ?? []).filter((p) => p.code.trim() && p.name.trim()).map((p) => ({ ...p, code: p.code.trim() }));
  const row: LabTest = { ...prev, ...i, code, name: i.name.trim(), price: Math.max(0, num(i.price)), params, id: prev?.id ?? generateId(), created_at: prev?.created_at ?? new Date().toISOString(), ...(prev ? { updated_at: new Date().toISOString() } : {}) };
  setTable(SV_TABLES.labTests, prev ? all.map((t) => (t.id === row.id ? row : t)) : [...all, row]);
  return row;
}

export function deleteTest(id: string): void {
  requireAccess('master.edit');
  if (loadTests().some((t) => t.panel?.includes(id))) throw new Error('A panel lists this test. Remove it from the panel first.');
  setTable(SV_TABLES.labTests, loadTests().filter((t) => t.id !== id));
}

const snap = (t: LabTest): LabOrderTest => ({ id: t.id, code: t.code, name: t.name, dept: t.dept, sample: t.sample, tat: t.tat, price: t.price, method: t.method, params: t.params, note: t.note, outsourced: t.outsourced });

export interface OrderInput { date: string; patient_id?: string; patient_name: string; sex?: LabOrder['sex']; age?: number; referrer?: LabOrder['referrer']; test_ids: string[] }

/** Book an order: the tests picked (panels priced as panels, their tests expanded for results). */
export function saveOrder(i: OrderInput): LabOrder {
  requireAccess('doc.create');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new Error('Choose the order date.');
  if (!i.patient_name.trim()) throw new Error('Choose the patient.');
  const master = loadTests();
  const picked = [...new Set(i.test_ids)].map((id) => master.find((t) => t.id === id)).filter((t): t is LabTest => !!t);
  if (!picked.length) throw new Error('Pick at least one test.');
  // Priced rows: what was picked; result rows: the expansion. A panel's member tests carry price 0 on the order.
  const expanded = expandTests(picked.map((t) => t.id), master);
  const inPanel = new Set(expandTests(picked.filter((t) => t.panel?.length).map((t) => t.id), master).map((t) => t.id));
  const pricedIds = new Set(picked.filter((t) => !inPanel.has(t.id)).map((t) => t.id));
  const tests = [...picked.filter((t) => t.panel?.length).map((t) => ({ ...snap(t), params: [] })), ...expanded.map((t) => ({ ...snap(t), price: pricedIds.has(t.id) ? t.price : 0 }))];
  const samples = [...new Set(expanded.map((t) => t.sample || 'Sample'))].map((type) => ({ type, status: 'to_collect' as const }));
  const all = loadOrders();
  const number = nextSeriesNumberFor(LAB, i.date, all.map((o) => o.number));
  const client = i.patient_id ? patientClient(i.patient_id, i.patient_name) : undefined;
  const row: LabOrder = {
    id: generateId(), number, date: i.date, patient_id: i.patient_id, patient_name: i.patient_name.trim(), ...(client?.patient?.uhid ? { uhid: client.patient.uhid } : {}),
    ...(i.sex ? { sex: i.sex } : {}), ...(i.age != null && Number.isFinite(i.age) ? { age: i.age } : {}), ...(i.referrer?.name ? { referrer: i.referrer } : {}),
    tests, samples, results: {}, report: 'pending', created_at: new Date().toISOString(),
  };
  return withTablesRollback([SV_TABLES.labOrders, 'series_counters'], () => {
    setTable(SV_TABLES.labOrders, [...all, row]);
    recordSeries(number);
    return row;
  });
}

const editOrder = (id: string, fn: (o: LabOrder) => LabOrder): LabOrder => {
  requireAccess('doc.create');
  const all = loadOrders();
  const o = all.find((x) => x.id === id);
  if (!o) throw new Error('Order not found.');
  const row = { ...fn(o), updated_at: new Date().toISOString() };
  setTable(SV_TABLES.labOrders, all.map((x) => (x.id === id ? row : x)));
  return row;
};

const FLOW: readonly LabOrder['samples'][number]['status'][] = ['to_collect', 'collected', 'received', 'in_process', 'done'];
/** Move a sample one step along `to collect → collected → received → in process → done` (time and by recorded). */
export function advanceSample(id: string, index: number, by?: string, at = new Date().toISOString()): LabOrder {
  return editOrder(id, (o) => ({ ...o, samples: o.samples.map((s, i) => (i === index && s.status !== 'done' ? { ...s, status: FLOW[FLOW.indexOf(s.status) + 1], at, ...(by ? { by } : {}) } : s)) }));
}

/** Enter results (merged); a final / delivered report edited again becomes "amended" with the earlier results kept. */
export function enterResults(id: string, results: Record<string, string>, verifiedBy?: string[], at = new Date().toISOString()): LabOrder {
  return editOrder(id, (o) => {
    const merged = { ...o.results, ...Object.fromEntries(Object.entries(results).map(([k, v]) => [k, String(v).trim()])) };
    const changed = Object.keys(merged).some((k) => (merged[k] ?? '') !== (o.results[k] ?? ''));
    const wasFinal = o.report === 'final' || o.report === 'delivered';
    const next: LabOrder = { ...o, results: merged, ...(verifiedBy ? { verified_by: verifiedBy.filter(Boolean).slice(0, 2) } : {}) };
    if (wasFinal && changed) return { ...next, history: [...(o.history ?? []), { at, results: o.results }], amended_at: at, report: 'final' };
    return { ...next, report: reportStatus(next) };
  });
}

/** Log a delivery (print / WhatsApp / e-mail); a final report becomes delivered. */
export const logDelivery = (id: string, via: 'print' | 'whatsapp' | 'email', at = new Date().toISOString()): LabOrder =>
  editOrder(id, (o) => ({ ...o, delivery: [...(o.delivery ?? []), { via, at }], report: o.report === 'final' ? 'delivered' : o.report }));

/** Data-layer delete (recycle bin); a billed order is kept. Its number stays used. */
export function deleteOrder(id: string): void {
  requireAccess('doc.create');
  const o = loadOrders().find((x) => x.id === id);
  if (o && liveInvoice(o.invoice_id)) throw new Error(`Order ${o.number} has a bill. Cancel the bill instead.`);
  setTable(SV_TABLES.labOrders, loadOrders().filter((x) => x.id !== id));
}

/** Bill an order: a line per priced test / panel (exempt health care). */
export function billOrder(id: string, date?: string): InvoiceRecord {
  requireAccess('doc.create');
  const o = loadOrders().find((x) => x.id === id);
  if (!o) throw new Error('Order not found.');
  if (liveInvoice(o.invoice_id)) throw new Error(`Order ${o.number} is already billed.`);
  const day = date || o.date;
  const lines = o.tests.filter((t) => num(t.price) > 0).map((t) => clinicLine(t.name, num(t.price), { date: day }));
  if (!lines.length) throw new Error('No priced tests on this order.');
  return withTablesRollback([SV_TABLES.labOrders, 'invoices', 'series_counters'], () => {
    const inv = clinicDraft(patientClient(o.patient_id, o.patient_name), lines, day, { lab_order: { id: o.id, number: o.number }, ...(o.uhid ? { visit: { id: o.id, uhid: o.uhid } } : {}), ...(o.referrer?.name ? { referrer: o.referrer } : {}) });
    setTable(SV_TABLES.labOrders, loadOrders().map((x) => (x.id === o.id ? { ...x, invoice_id: inv.id, updated_at: new Date().toISOString() } : x)));
    return inv;
  });
}

/** Outsourced costs not yet billed, by reference lab, for orders dated in [from, to]. */
export function outsourcedDue(orders: readonly LabOrder[], from: string, to: string): { vendor: string; vendor_id?: string; cost: number; orders: string[] }[] {
  const by = new Map<string, { vendor: string; vendor_id?: string; cost: number; orders: string[] }>();
  for (const o of orders) {
    if (o.outsourced_bill_id || o.date < from || o.date > to) continue;
    for (const t of o.tests) {
      if (!t.outsourced || !(num(t.outsourced.cost) > 0)) continue;
      const vendor = t.outsourced.vendor_name || 'Reference lab';
      const key = t.outsourced.vendor_id || vendor;
      const row = by.get(key) ?? { vendor, vendor_id: t.outsourced.vendor_id, cost: 0, orders: [] };
      row.cost = round2(row.cost + num(t.outsourced.cost));
      if (!row.orders.includes(o.id)) row.orders.push(o.id);
      by.set(key, row);
    }
  }
  return [...by.values()];
}

/** One click: the reference lab's purchase bill for the period (lab services, no GST); the orders are marked. */
export function bookOutsourcedBill(vendorKey: string, from: string, to: string, billNo: string): PurchaseRecord {
  requireAccess('doc.create');
  const due = outsourcedDue(loadOrders(), from, to).find((d) => (d.vendor_id || d.vendor) === vendorKey);
  if (!due) throw new Error('Nothing outsourced to bill for this lab and period.');
  if (!billNo.trim()) throw new Error('Type the reference lab\'s bill number.');
  const home = senderStateCode(localDb.settings.activeProfile());
  const line = { id: generateId(), name: `Outsourced lab tests ${from} to ${to} (${due.orders.length} order(s))`, hsn: '999316', unit: 'NOS', quantity: 1, rate: due.cost, tax_rate: 0 };
  const t = computePurchaseTotals([line], { placeOfSupply: home, businessState: home, gstApplies: false });
  return withTablesRollback([SV_TABLES.labOrders, 'purchases'], () => {
    const bill = purchasesDb.save({ kind: 'PURCHASE', vendor_id: due.vendor_id, vendor_name: due.vendor, bill_number: billNo.trim(), date: to, place_of_supply: home, category: 'Outsourced lab tests', lines: [line], taxable: t.taxable, cgst: 0, sgst: 0, igst: 0, total: t.total, itc_eligible: false, amount_paid: 0 } as Omit<PurchaseRecord, 'id'>);
    setTable(SV_TABLES.labOrders, loadOrders().map((o) => (due.orders.includes(o.id) ? { ...o, outsourced_bill_id: bill.id } : o)));
    return bill;
  });
}
