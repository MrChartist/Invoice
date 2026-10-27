/**
 * AG-D2 storage rent (table `cold_rent_plans`, `master.edit`): rent per bag or quintal, per season or month, or flat,
 * with handling charges at receipt ('in') or release ('out'), a minimum and part-month rule, a late fee after the
 * season, and the storage class:
 *  - `storage_agri` — storage / warehousing of agricultural produce: nil (N 12/2017 entry 54(e)), a bill of supply;
 *  - `storage_other` — processed / non-agricultural goods, or a whole chamber let out as space: 18% (AG8).
 * Handling charges follow the storage class (composite supply) unless the charge has its own rate (AG8 (c)).
 * A rent bill is an ordinary DRAFT invoice carrying the `ag.rent` snapshot (lot, bags, period, basis, rate — printed by
 * the agri paper, never recomputed). It is raised at the gate pass (default), at receipt (in advance), monthly or at
 * season end; bags already billed for the season are never billed again, and a gate pass is billed once.
 * Unbilled rent is a memo only (no accrual, AG30). State-notified rent: typed rate + order reference, printed.
 * Working paper — verify with your CA (AG8, AG30). Pure above "Storage".
 */
import './ag-registry';
import type { ColdGateOut, ColdLot, ColdRentPlan, RentBasis, StorageClass, AgRentSnap } from '../../types/agri-r12d';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { localDb } from '../localDb';
import { isValidGstin } from '../gstin';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { AGRI_PRODUCE_WORDS, NON_AGRI_WORDS, STORAGE_CLASS_RULES } from '../agri-rules';
import { AG_TABLES } from './ag-shared';
import { lotBalance, q3 } from './ag-cold-lots';

export const PLANS_TABLE = AG_TABLES.coldRentPlans;
export const EXEMPT_NOTE = 'Exempt — storage of agricultural produce (N 12/2017 entry 54(e); verify AG8).';
const SEASONAL = new Set<RentBasis>(['bag_season', 'qtl_season', 'flat']);

/* ── Pure ── */

const pad = (n: number) => String(n).padStart(2, '0');
function addMonths(d: string, k: number): string {
  const y = +d.slice(0, 4), m = +d.slice(5, 7) - 1 + k, day = +d.slice(8, 10);
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${pad(mm + 1)}-${pad(Math.min(day, last))}`;
}
const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5;

/** Months from `from` to `to`: whole months, then the part month as a full month or by days (÷ 30). */
export function monthsBetween(from: string, to: string, part: ColdRentPlan['part_month']): number {
  if (to <= from) return 0;
  let m = (+to.slice(0, 4) - +from.slice(0, 4)) * 12 + (+to.slice(5, 7) - +from.slice(5, 7));
  while (m > 0 && addMonths(from, m) > to) m--;
  const rest = dayNo(to) - dayNo(addMonths(from, m));
  return part === 'days' ? Math.round((m + rest / 30) * 1000) / 1000 : m + (rest > 0 ? 1 : 0);
}

/** The first `MM-DD` (or a full date as is) on / after `day`. */
export function nextOn(mmdd: string, day: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(mmdd)) return mmdd;
  const y = +day.slice(0, 4);
  const d = `${y}-${mmdd}`;
  return d >= day ? d : `${y + 1}-${mmdd}`;
}

/** Suggested class for a commodity (undefined = ask). A plan letting out space defaults to taxable (AG8 (b)). */
export function suggestClass(commodity: string, space = false): StorageClass | undefined {
  if (space) return 'storage_other';
  const c = commodity.trim().toLowerCase();
  if (!c) return undefined;
  if (NON_AGRI_WORDS.some((w) => c.includes(w))) return 'storage_other';
  return AGRI_PRODUCE_WORDS.some((w) => c.includes(w)) ? 'storage_agri' : undefined;
}

export const classRule = (cls: StorageClass, date?: string) => ruleAt(STORAGE_CLASS_RULES[cls], date);

/** Weight (kg) of `bags` of a lot: bag weight, else the lot's weight pro rata. */
export const bagsKg = (lot: Pick<ColdLot, 'bags' | 'bag_kg' | 'weight_kg'>, bags: number): number => (num(lot.bag_kg) > 0 ? q3(bags * num(lot.bag_kg)) : num(lot.weight_kg) > 0 ? q3((num(lot.weight_kg) * bags) / num(lot.bags)) : 0);

export interface RentLine { name: string; qty: number; unit: string; rate: number; amount: number; tax_rate?: number }
export interface RentWork { lines: RentLine[]; months?: number; total: number }

/**
 * Rent for `bags` of the lot from `from` to `to` (pure). Season / flat bases charge once per bag (the caller passes the
 * bags not billed yet); month bases charge per month with the minimum; a late fee runs after `late.after`.
 * `inCharges` adds the 'in' handling charges; `outBags` the 'out' charges for released bags.
 */
export function rentFor(plan: ColdRentPlan, lot: Pick<ColdLot, 'bags' | 'bag_kg' | 'weight_kg' | 'date_in'>, o: { bags: number; from: string; to: string; inCharges?: boolean; outBags?: number }): RentWork {
  const lines: RentLine[] = [];
  const add = (name: string, qty: number, unit: string, rate: number, tax?: number) => {
    const amount = round2(qty * rate);
    if (qty > 0 && amount > 0) lines.push({ name, qty: q3(qty), unit, rate: round2(rate), amount, ...(tax !== undefined ? { tax_rate: tax } : {}) });
  };
  const bags = q3(o.bags);
  const qtl = q3(bagsKg(lot, bags) / 100);
  let months: number | undefined;
  if (plan.basis === 'bag_month' || plan.basis === 'qtl_month') months = Math.max(monthsBetween(o.from, o.to, plan.part_month), num(plan.min_months), plan.part_month === 'full' ? 1 : 0);
  const rate = num(plan.notified?.rate) > 0 ? num(plan.notified!.rate) : num(plan.rate);
  if (plan.basis === 'bag_season') add('Storage rent (per bag, season)', bags, 'BAG', rate);
  else if (plan.basis === 'qtl_season') add('Storage rent (per quintal, season)', qtl, 'QTL', rate);
  else if (plan.basis === 'bag_month') add(`Storage rent (per bag, ${months} month${months === 1 ? '' : 's'})`, bags, 'BAG', rate * months!);
  else if (plan.basis === 'qtl_month') add(`Storage rent (per quintal, ${months} month${months === 1 ? '' : 's'})`, qtl, 'QTL', rate * months!);
  else if (bags > 0) add('Storage rent (lump sum)', 1, 'NOS', rate);
  if (plan.late && num(plan.late.rate_per_bag_month) > 0 && bags > 0) {
    const after = nextOn(plan.late.after, lot.date_in);
    const late = o.to > after ? monthsBetween(after, o.to, 'full') : 0;
    if (late > 0) add(`Late rent after ${after} (${late} month${late === 1 ? '' : 's'})`, bags, 'BAG', num(plan.late.rate_per_bag_month) * late);
  }
  for (const c of plan.charges ?? []) {
    const n = c.when === 'in' ? (o.inCharges ? num(lot.bags) : 0) : num(o.outBags);
    if (!(n > 0)) continue;
    if (c.basis === 'bag') add(c.name, n, 'BAG', num(c.rate), c.own_rate);
    else if (c.basis === 'qtl') add(c.name, q3(bagsKg(lot, n) / 100), 'QTL', num(c.rate), c.own_rate);
    else add(c.name, 1, 'NOS', num(c.rate), c.own_rate);
  }
  return { lines, ...(months !== undefined ? { months } : {}), total: round2(lines.reduce((s, l) => s + l.amount, 0)) };
}

const liveRent = (invoices: readonly InvoiceRecord[], lotId: string) => invoices.filter((i) => i?.ag?.rent?.lot_id === lotId && i.status !== 'Cancelled');

/** What the lot's live rent bills already cover: season bags, 'in' charges, gate passes, the last month billed to. */
export function billedOn(invoices: readonly InvoiceRecord[], lotId: string) {
  const bills = liveRent(invoices, lotId).map((i) => i.ag!.rent!);
  return {
    seasonBags: q3(bills.filter((r) => SEASONAL.has(r.basis)).reduce((s, r) => s + num(r.bags), 0)),
    inCharges: bills.some((r) => r.in_charges),
    outs: new Set(bills.map((r) => r.out_id).filter(Boolean) as string[]),
    monthTo: bills.filter((r) => !SEASONAL.has(r.basis) && !r.out_id).reduce((m, r) => (r.period_to > m ? r.period_to : m), ''),
  };
}

export type RentOccasion = { kind: 'out'; out: ColdGateOut } | { kind: 'in' } | { kind: 'month'; from: string; to: string } | { kind: 'season_end'; date: string };

/** The bags, period and charges a rent bill for this occasion covers (throws when it would bill twice). */
export function rentOccasion(lot: ColdLot, plan: ColdRentPlan, occ: RentOccasion, invoices: readonly InvoiceRecord[]): { bags: number; from: string; to: string; inCharges: boolean; outBags: number; date: string; out?: ColdGateOut } {
  const b = billedOn(invoices, lot.id);
  const seasonal = SEASONAL.has(plan.basis);
  const seasonEnd = plan.season?.to ? nextOn(plan.season.to, lot.date_in) : lot.date_in;
  const inCharges = !b.inCharges && (plan.charges ?? []).some((c) => c.when === 'in');
  if (occ.kind === 'out') {
    if (b.outs.has(occ.out.id)) throw new Error(`Gate pass ${occ.out.number} is already billed.`);
    const rentBags = seasonal ? Math.max(Math.min(num(occ.out.bags), num(lot.bags) - b.seasonBags), 0) : plan.bill_at === 'monthly' ? 0 : num(occ.out.bags);
    return { bags: q3(rentBags), from: lot.date_in, to: occ.out.date, inCharges, outBags: num(occ.out.bags), date: occ.out.date, out: occ.out };
  }
  if (occ.kind === 'in') {
    if (!seasonal) throw new Error('Bill in advance needs a season or lump-sum plan.');
    const bags = q3(num(lot.bags) - b.seasonBags);
    if (!(bags > 0) && !inCharges) throw new Error('This lot is already billed for the season.');
    return { bags, from: lot.date_in, to: seasonEnd, inCharges, outBags: 0, date: lot.date_in };
  }
  if (occ.kind === 'month') {
    if (seasonal) throw new Error('Monthly bills need a per-month plan.');
    if (b.monthTo && occ.from <= b.monthTo) throw new Error(`Rent is billed up to ${b.monthTo}.`);
    return { bags: lotBalance(lot), from: occ.from, to: occ.to, inCharges, outBags: 0, date: occ.to };
  }
  if (!seasonal) throw new Error('Season-end bills need a season or lump-sum plan.');
  const bags = q3(num(lot.bags) - b.seasonBags);
  if (!(bags > 0)) throw new Error('This lot is already billed for the season.');
  return { bags, from: lot.date_in, to: occ.date, inCharges, outBags: 0, date: occ.date };
}

/** Pure: the draft rent bill (bill of supply for exempt storage, else a tax invoice / invoice) with the `ag.rent` snapshot. */
export function buildRentBill(lot: ColdLot, plan: ColdRentPlan, occ: ReturnType<typeof rentOccasion>, ctx: { client: Client; settings: ReturnType<typeof localDb.settings.get>; sender: InvoiceRecord['sender']; chamber?: string }): InvoiceRecord {
  const work = rentFor(plan, lot, occ);
  if (!work.lines.length) throw new Error('Nothing to bill for these bags.');
  const rule = classRule(plan.class, occ.date);
  const taxed = work.lines.map((l) => ({ ...l, tax: l.tax_rate ?? rule.rate }));
  const anyTax = taxed.some((l) => l.tax > 0);
  const gstin = isValidGstin(ctx.client.gstin ?? '');
  const draft = makeDraft({ settings: ctx.settings, sender: ctx.sender, docType: anyTax ? (gstin ? 'TAX_INVOICE' : 'INVOICE') : 'BILL_OF_SUPPLY' });
  const home = senderStateCode(ctx.sender);
  const pos = (gstin ? ctx.client.gstin!.slice(0, 2) : ctx.client.state_code) || home;
  const items: InvoiceItem[] = taxed.map((l) => ({ id: generateId(), name: l.name, description: `${lot.number} · ${lot.commodity}`, type: 'service', hsn: plan.space ? rule.spaceSac : rule.sac, unit: l.unit, quantity: l.qty, rate: l.rate, tax_rate: anyTax ? l.tax : 0, discount_percent: 0, amount: l.amount }));
  const rent: AgRentSnap = {
    lot_id: lot.id, lot_no: lot.number, depositor: lot.depositor_name, commodity: lot.commodity, ...(lot.variety ? { variety: lot.variety } : {}), ...(ctx.chamber ? { chamber: ctx.chamber } : {}),
    date_in: lot.date_in, season: lot.season, bags: occ.bags, bags_in: num(lot.bags), balance: lotBalance(lot), basis: plan.basis, rate: num(plan.notified?.rate) > 0 ? num(plan.notified!.rate) : num(plan.rate),
    period_from: occ.from, period_to: occ.to, ...(work.months !== undefined ? { months: work.months } : {}), ...(occ.out ? { out_id: occ.out.id, gate_pass_no: occ.out.number } : {}),
    class: plan.class, plan: plan.name, ...(plan.notified?.order_ref ? { notified: plan.notified } : {}), ...(occ.inCharges && (plan.charges ?? []).some((c) => c.when === 'in') ? { in_charges: true } : {}),
  };
  const rec: InvoiceRecord = {
    ...draft, issue_date: occ.date, due_date: occ.date > draft.due_date ? occ.date : draft.due_date, status: 'Draft', client: { ...ctx.client }, items, place_of_supply: pos,
    ...(anyTax ? { gst_mode: deriveGstMode({ senderStateCode: home, placeOfSupply: pos, senderHasGstin: !!ctx.sender?.companyGstin?.trim(), taxEnabled: true }) } : {}),
    notes: [plan.class === 'storage_agri' ? EXEMPT_NOTE : 'Storage of goods other than agricultural produce — taxable (verify AG8).', plan.space ? 'Renting space may be a separate taxable supply (Gujarat AAR) — verify AG8.' : '', plan.notified?.order_ref ? `Rent as notified: ${plan.notified.order_ref}.` : ''].filter(Boolean).join(' '),
    ag: { kind: 'rent', rent },
  };
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return { ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount };
}

/** Memo of rent earned but not billed on lots still in store (AG30: shown, never accrued). */
export function unbilledRent(lots: readonly ColdLot[], plans: readonly ColdRentPlan[], invoices: readonly InvoiceRecord[], asOf: string): { lot: ColdLot; amount: number }[] {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const out: { lot: ColdLot; amount: number }[] = [];
  for (const lot of lots) {
    const plan = byId.get(lot.rent_plan_id);
    if (!plan || lot.date_in > asOf) continue;
    const b = billedOn(invoices, lot.id);
    const seasonal = SEASONAL.has(plan.basis);
    const bags = seasonal ? q3(num(lot.bags) - b.seasonBags) : lotBalance(lot);
    if (!(bags > 0)) continue;
    const amount = rentFor({ ...plan, charges: [] }, lot, { bags, from: seasonal ? lot.date_in : b.monthTo || lot.date_in, to: asOf }).total;
    if (amount > 0) out.push({ lot, amount });
  }
  return out;
}

/** Rent bills by depositor and season with what is still due (issued bills), flagging closed lots with rent unpaid. */
export function rentDue(invoices: readonly InvoiceRecord[], lots: readonly ColdLot[]): { depositor: string; season: string; billed: number; due: number; closedUnpaid: boolean }[] {
  const closed = new Set(lots.filter((l) => lotBalance(l) <= 0).map((l) => l.id));
  const m = new Map<string, { depositor: string; season: string; billed: number; due: number; closedUnpaid: boolean }>();
  for (const i of invoices) {
    const r = i?.ag?.rent;
    if (!r || i.status === 'Draft' || i.status === 'Cancelled') continue;
    const k = `${r.depositor}|${r.season}`;
    const row = m.get(k) ?? { depositor: r.depositor, season: r.season, billed: 0, due: 0, closedUnpaid: false };
    row.billed = round2(row.billed + num(i.total));
    row.due = round2(row.due + Math.max(num(i.balance_due), 0));
    if (num(i.balance_due) > 0.005 && closed.has(r.lot_id)) row.closedUnpaid = true;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.due - a.due);
}

/* ── Storage ── */

export const loadPlans = (): ColdRentPlan[] => getTable<ColdRentPlan>(PLANS_TABLE).filter((r) => r && typeof r.id === 'string').map((r) => ({ ...r, charges: Array.isArray(r.charges) ? r.charges : [] }));

/** Create or edit a plan (`master.edit`). Bills already raised keep their snapshot. */
export function savePlan(p: Omit<ColdRentPlan, 'id'> & { id?: string }): ColdRentPlan {
  requireAccess('master.edit');
  if (!p.name.trim()) throw new Error('Name the rent plan.');
  if (!(num(p.rate) >= 0)) throw new Error('Enter the rent rate.');
  const all = loadPlans();
  const row: ColdRentPlan = { ...p, id: p.id ?? generateId(), name: p.name.trim(), rate: round2(num(p.rate)), charges: (p.charges ?? []).filter((c) => c.name.trim() && num(c.rate) > 0) };
  setTable(PLANS_TABLE, p.id && all.some((x) => x.id === p.id) ? all.map((x) => (x.id === p.id ? row : x)) : [...all, row]);
  return row;
}

/** Delete a plan no lot uses (to the recycle bin). */
export function deletePlan(id: string, lots: readonly ColdLot[]): void {
  requireAccess('master.edit');
  if (lots.some((l) => l.rent_plan_id === id)) throw new Error('Lots use this plan.');
  setTable(PLANS_TABLE, loadPlans().filter((p) => p.id !== id));
}

/** Raise the draft rent bill for the occasion (`doc.create`); the depositor must be in Clients. */
export function raiseRentBill(lot: ColdLot, occ: RentOccasion, chamber?: string): InvoiceRecord {
  requireAccess('doc.create');
  const plan = loadPlans().find((p) => p.id === lot.rent_plan_id);
  if (!plan) throw new Error('The lot\'s rent plan is missing.');
  const client = localDb.clients.getById(lot.depositor_id);
  if (!client) throw new Error(`${lot.depositor_name} is not in Clients.`);
  const invoices = localDb.invoices.getAll();
  const o = rentOccasion(lot, plan, occ, invoices);
  return localDb.invoices.save(buildRentBill(lot, plan, o, { client, settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), chamber }));
}
