/**
 * R21-D1 credit slips (`fuel_slips`, `doc.create`, dated by `date`, audited): the slip book of credit customers (slip
 * no. typed, unique per company), vehicle-wise monthly limits on `Client.fu.vehicles` (a warning, never a block — the
 * party credit limit is the shared `credit-limit.ts` check), and the plan of the month-end bills: one Bill of Supply per
 * customer for the fuel slips (non-GST lines, FU1) plus a tax invoice for any other item on slips, each with the
 * vehicle-wise annexure. Billed state is derived from `fu.slip_ids` on live documents (undo = cancel the bills), never
 * stored. The stock register is meter-based, so unbilled slips are already counted as sold litres (FU7).
 * Working papers — verify with your CA.
 */
import './fu-registry';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { round2 } from '../invoice-calc';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { AnnexureRow } from '../../types/service-r3';
import type { FuelPrice, FuelSlip, FuLine, FuProduct } from '../../types/fuel-r21';
import { FU_TABLES } from './fu-shared';
import { isNonGst, priceAt } from './fu-line';

export const readSlips = (): FuelSlip[] => getTable<FuelSlip>(FU_TABLES.slips);
const k = (s: unknown) => String(s ?? '').trim().toUpperCase();
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Slip ids on live (not cancelled) documents. */
export function billedSlipIds(docs: readonly InvoiceRecord[]): Set<string> {
  const s = new Set<string>();
  for (const d of docs) if (d.status !== 'Cancelled') for (const id of d.fu?.slip_ids ?? []) s.add(id);
  return s;
}

/** Slips not on a live document, dated on or before `through` (all when absent). */
export function unbilledSlips(slips: readonly FuelSlip[], docs: readonly InvoiceRecord[], through?: string): FuelSlip[] {
  const b = billedSlipIds(docs);
  return slips.filter((s) => !b.has(s.id) && (!through || s.date <= through));
}

/** Why a slip cannot be saved ('' = it can): the fields, and a slip no. already in the book. */
export function slipIssue(s: Partial<FuelSlip>, all: readonly FuelSlip[]): string {
  if (!k(s.slip_no)) return 'Type the slip no.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date ?? '')) return 'Choose the date.';
  if (!s.client_id) return 'Pick the customer.';
  if (!k(s.vehicle_no)) return 'Type the vehicle no.';
  if (!s.item_id) return 'Pick the product.';
  if (!(Number(s.litres) > 0) || !(Number(s.amount) > 0)) return 'Type the litres and the amount.';
  const dup = all.find((x) => x.id !== s.id && k(x.slip_no) === k(s.slip_no));
  return dup ? `Slip no. ${dup.slip_no} is already in the slip book (${dup.date}).` : '';
}

/** A vehicle over its monthly limit (litres or ₹) with this slip: a warning ('' = within). */
export function vehicleWarning(s: Pick<FuelSlip, 'client_id' | 'vehicle_no' | 'date' | 'litres' | 'amount'> & { id?: string }, client: Pick<Client, 'fu'> | undefined, all: readonly FuelSlip[]): string {
  const v = client?.fu?.vehicles?.find((x) => k(x.no) === k(s.vehicle_no));
  if (!v) return '';
  const m = all.filter((x) => x.id !== s.id && x.client_id === s.client_id && k(x.vehicle_no) === k(s.vehicle_no) && x.date.slice(0, 7) === s.date.slice(0, 7));
  const l = r3(m.reduce((n, x) => n + x.litres, 0) + Number(s.litres));
  const a = round2(m.reduce((n, x) => n + x.amount, 0) + Number(s.amount));
  if (v.limit_l && l > v.limit_l) return `${v.no}: ${l} L this month, over its limit of ${v.limit_l} L.`;
  if (v.limit_amount && a > v.limit_amount) return `${v.no}: ₹${a} this month, over its limit of ₹${v.limit_amount}.`;
  return '';
}

/** Add or edit a slip (refused with the reason; a billed slip is changed only by cancelling its bill). */
export function saveSlip(input: Omit<FuelSlip, 'id'> & { id?: string }, docs: readonly InvoiceRecord[] = getTable<InvoiceRecord>('invoices')): FuelSlip {
  requireAccess('doc.create');
  const all = readSlips();
  const why = slipIssue(input, all);
  if (why) throw new Error(why);
  if (input.id && billedSlipIds(docs).has(input.id)) throw new Error('This slip is on a bill: cancel the bill first.');
  const row: FuelSlip = { ...input, id: input.id || generateId(), slip_no: input.slip_no.trim(), vehicle_no: k(input.vehicle_no), litres: r3(Number(input.litres)), amount: round2(Number(input.amount)) };
  assertUnlocked({ id: row.id, issue_date: row.date }, input.id ? 'edit' : 'create');
  setTable(FU_TABLES.slips, all.some((x) => x.id === row.id) ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row]);
  return row;
}

/** Delete an unbilled slip (to the recycle bin). */
export function removeSlip(id: string, docs: readonly InvoiceRecord[] = getTable<InvoiceRecord>('invoices')): void {
  requireAccess('doc.create');
  const s = readSlips().find((x) => x.id === id);
  if (!s) return;
  if (billedSlipIds(docs).has(id)) throw new Error('This slip is on a bill: cancel the bill first.');
  assertUnlocked({ id, issue_date: s.date }, 'delete');
  setTable(FU_TABLES.slips, readSlips().filter((x) => x.id !== id));
}

export interface SlipItem { id: string; name: string; unit?: string; hsn?: string; tax_rate?: number; fu?: { product: FuProduct; unit: 'L' | 'KG' } }
/** One document of a customer's bill: its lines, the `fu` snapshot (lines + slips) and the vehicle-wise annexure. */
export interface SlipDoc { client_id: string; fuel: boolean; items: InvoiceItem[]; lines: Record<string, FuLine>; slip_ids: string[]; annexure: AnnexureRow[] }

/**
 * The month-end bills (pure): per customer, the fuel slips → one Bill of Supply (one line per product × price in
 * force; amounts kept exact), other items → one tax invoice at the item's slab. `day` decides the non-GST status.
 */
export function planSlipBills(slips: readonly FuelSlip[], items: readonly SlipItem[], prices: readonly FuelPrice[], day: string): SlipDoc[] {
  type Acc = SlipDoc & { acc: Map<string, { it: SlipItem; p: FuelPrice | null; l: number; a: number }> };
  const docs = new Map<string, Acc>();
  for (const s of [...slips].sort((a, b) => (a.date + a.slip_no).localeCompare(b.date + b.slip_no))) {
    const it = items.find((i) => i.id === s.item_id);
    if (!it) continue;
    const fuel = isNonGst(it.fu?.product, day);
    const key = `${s.client_id}|${fuel}`;
    const d: Acc = docs.get(key) ?? { client_id: s.client_id, fuel, items: [], lines: {}, slip_ids: [], annexure: [], acc: new Map() };
    docs.set(key, d);
    const p = it.fu ? priceAt(prices, it.id, s.date, '23:59') : null;
    const g = `${it.id}|${p?.id ?? round2(s.amount / s.litres)}`;
    const a = d.acc.get(g) ?? { it, p, l: 0, a: 0 };
    d.acc.set(g, { ...a, l: a.l + s.litres, a: a.a + s.amount });
    d.slip_ids.push(s.id);
    d.annexure.push({ date: s.date, who: s.vehicle_no, project: `Slip ${s.slip_no}`, description: `${it.name} · ${s.litres.toFixed(3)} ${it.fu?.unit === 'KG' ? 'kg' : 'L'}${s.driver ? ` · ${s.driver}` : ''}`, minutes: 0, billed_minutes: 0, rate: round2(s.amount / s.litres), amount: s.amount, ref: s.id });
  }
  return [...docs.values()].map(({ acc, ...d }) => {
    for (const { it, p, l, a } of acc.values()) {
      const id = generateId();
      const q = r3(l);
      d.items.push({ id, name: it.name, type: 'Goods', hsn: it.hsn, unit: it.unit, quantity: q, rate: Math.round((a / q) * 1e6) / 1e6, amount: round2(a), tax_rate: d.fuel ? 0 : it.tax_rate ?? 0, ...(d.fuel ? { sv: { exempt: 'NON_GST' as const } } : {}) });
      if (it.fu) d.lines[id] = { litres: q, ...(p ? { price_id: p.id, rsp: p.rsp, at: `${p.date} ${p.time}` } : {}), ...(it.fu.unit === 'KG' ? { unit: 'KG' as const } : {}) };
    }
    return d;
  });
}
