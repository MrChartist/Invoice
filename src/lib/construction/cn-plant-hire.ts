/**
 * CN-D3 plant hire. **Hire in:** a month-end proposal of the hirer's purchase bill from the equipment's log sheets
 * (hours / days worked / one month × rate), TDS by the operator flag — with operator 194C (by the hirer's PAN), without
 * 194-I(a) 2% (plant), labelled by date through `ita2025.ts`; SAC / GST from `PLANT_HIRE_SAC_RULES` (CN17, verify).
 * Booked once per machine and month (`cn_sub.kind 'hire'`). **Hire out:** logs charged to a sub-contractor are
 * recovered on his bill (D1) or invoiced here as a DRAFT tax invoice at the hire-out rate (the user checks and
 * issues it). Also the shared draft-invoice helper of the manpower supply bill (D2). Verify with your CA.
 */
import './cn-registry';
import type { HiredEquipment, PlantLog } from '../../types/construction-r11';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { sectionText } from '../ita2025';
import { localDb } from '../localDb';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { computePurchaseTotals, purchasesDb } from '../purchases';
import { billTdsInputFor, priorCreditsFor, resolveBillTds } from '../tds-payables';
import { withTablesRollback } from '../table-txn';
import { PLANT_HIRE_SAC_RULES } from '../construction-rules';
import { SD, noItcCentre } from './cn-subcon';
import { subTdsCode } from './cn-subcon-bill';
import { isRecovered, loadHired, loadLogs, machines } from './cn-plant';

export interface HireProposal {
  equipment: HiredEquipment;
  month: string;
  qty: number;
  amount: number;
  sac: string;
  gst: number;
  /** TDS code and its label on the bill date. */
  tds: string;
  tdsLabel: string;
  /** Hours per site (cost split for the site P&L). */
  bySite: Record<string, number>;
  booked?: string;
}

const monthEnd = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
};

/** Pure: the hire-in proposal of one machine for `month` (YYYY-MM). */
export function hireProposal(e: HiredEquipment, month: string, logs: readonly PlantLog[], v?: Pick<Vendor, 'pan' | 'tds_section'>, bills: readonly Pick<PurchaseRecord, 'bill_number' | 'cn_sub'>[] = []): HireProposal {
  const mine = logs.filter((l) => l.equipment_ref === `hire:${e.id}` && l.date.slice(0, 7) === month);
  const hours = round2(mine.reduce((s, l) => s + num(l.hours_worked), 0));
  const qty = e.basis === 'hour' ? hours : e.basis === 'day' ? new Set(mine.filter((l) => num(l.hours_worked) > 0).map((l) => l.date)).size : mine.length ? 1 : 0;
  const date = monthEnd(month);
  const r = ruleAt(PLANT_HIRE_SAC_RULES, date);
  const side = e.with_operator ? r.withOperator : r.withoutOperator;
  const tds = e.with_operator ? subTdsCode({}, v) : side.tds;
  const bySite: Record<string, number> = {};
  for (const l of mine) bySite[l.site_id] = round2((bySite[l.site_id] ?? 0) + num(l.hours_worked));
  const booked = bills.find((b) => b.cn_sub?.kind === 'hire' && b.cn_sub.equipment_id === e.id && b.cn_sub.month === month)?.bill_number;
  return { equipment: e, month, qty, amount: round2(qty * num(e.rate)), sac: side.sac, gst: r.rate, tds, tdsLabel: sectionText(tds, date), bySite, ...(booked !== undefined ? { booked } : {}) };
}

/** Book the hirer's bill for the month (once per machine and month). */
export function bookHireIn(equipmentId: string, month: string, billNo: string): PurchaseRecord {
  requireAccess('doc.create');
  const e = loadHired().find((x) => x.id === equipmentId);
  if (!e) throw new Error('Choose the hired equipment.');
  const vendor = getTable<Vendor>('vendors').find((v) => v.id === e.vendor_id);
  const purchases = purchasesDb.all();
  const p = hireProposal(e, month, loadLogs(), vendor, purchases);
  if (p.booked !== undefined) throw new Error(`Already booked (${p.booked || 'bill'}).`);
  if (!(p.amount > 0)) throw new Error('No log sheets for this month.');
  const date = monthEnd(month);
  const home = senderStateCode(localDb.settings.activeProfile());
  const pos = vendor?.state_code || home;
  const line = { id: generateId(), name: `Hire of ${e.description} (${month}, ${p.qty} ${e.basis}${e.with_operator ? ', with operator' : ''})`, hsn: p.sac, unit: e.basis.toUpperCase(), quantity: p.qty, rate: num(e.rate), tax_rate: vendor?.gstin ? p.gst : 0 };
  const t = computePurchaseTotals([line], { placeOfSupply: pos, businessState: home, gstApplies: !!vendor?.gstin });
  const tds = resolveBillTds({ ...billTdsInputFor(null, vendor), section: p.tds }, { date, taxable: t.taxable, prior: priorCreditsFor(purchases, { id: vendor?.id, name: e.vendor_name, pan: vendor?.pan }) }).fields;
  const main = Object.entries(p.bySite).sort((a, b) => b[1] - a[1])[0]?.[0];
  const cc = main ? getTable<{ id: string; cost_centre_id?: string }>('godowns').find((g) => g.id === main)?.cost_centre_id : undefined;
  return purchasesDb.save({
    kind: 'PURCHASE', vendor_id: e.vendor_id, vendor_name: e.vendor_name, ...(vendor?.gstin ? { vendor_gstin: vendor.gstin } : {}), bill_number: billNo.trim(), date, place_of_supply: pos,
    category: 'Plant hire', lines: [line], taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, itc_eligible: !!vendor?.gstin && !noItcCentre(cc), amount_paid: 0, ...tds,
    ...(cc ? { cost_centre_id: cc } : {}), cn_sub: { kind: 'hire', equipment_id: e.id, month, with_operator: e.with_operator, ...(main ? { site_id: main } : {}) },
  } as Omit<PurchaseRecord, 'id'>);
}

/** A DRAFT tax invoice to a client with these lines (the user checks and issues it in the editor). */
export function draftInvoice(clientId: string, items: Omit<InvoiceItem, 'id' | 'type' | 'amount'>[], notes: string, date: string): InvoiceRecord {
  requireAccess('doc.create');
  const client = localDb.clients.getById(clientId);
  if (!client) throw new Error('Choose the client.');
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile();
  const d = makeDraft({ settings, sender, docType: 'TAX_INVOICE' });
  const rec: InvoiceRecord = { ...d, issue_date: date, client: { ...client }, notes, items: items.map((i) => ({ ...i, id: generateId(), type: 'service', discount_percent: 0, amount: round2(num(i.quantity) * num(i.rate)) })) };
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return localDb.invoices.save({ ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount });
}

/** Hire out by invoice: open logs charged to `vendorId` → a draft invoice to `clientId` (the logs are marked). */
export function hireOutInvoice(vendorId: string, clientId: string, date: string): InvoiceRecord {
  const list = machines();
  const open = loadLogs().filter((l) => l.sub_contractor_id === vendorId && !isRecovered(l, localDb.invoices.getAll()) && l.date <= date);
  if (!open.length) throw new Error('No open log sheets charged to this party.');
  const r = ruleAt(PLANT_HIRE_SAC_RULES, date);
  const by = new Map<string, number>();
  for (const l of open) by.set(l.equipment_ref, (by.get(l.equipment_ref) ?? 0) + num(l.hours_worked));
  const items = [...by].map(([ref, h]) => {
    const m = list.find((x) => x.ref === ref);
    return { name: `Hire of ${m?.name ?? 'equipment'} with operator`, hsn: r.withOperator.sac, unit: 'HRS', quantity: round2(h), rate: m?.hireOut ?? 0, tax_rate: r.rate };
  });
  return withTablesRollback(['invoices', SD.logs, 'series_counters'], () => {
    const inv = draftInvoice(clientId, items, 'Hire of plant with operator (SAC per PLANT_HIRE_SAC_RULES — verify with your CA, CN17).', date);
    setTable(SD.logs, loadLogs().map((l) => (open.some((o) => o.id === l.id) ? { ...l, recovered_in: inv.invoice_number || 'invoice', recovered_invoice_id: inv.id } : l)));
    return inv;
  });
}
