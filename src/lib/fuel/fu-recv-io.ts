/**
 * R21-D bridge (receivables): the month-end credit-slip bills through ONE `localDb.invoices.saveMany` (numbered like
 * `save`, period lock and sender snapshot intact, every document validated before the one write). The only Round 21
 * module of D that imports shared lazy code. (The OMC account and LPG were cut at the R21-D cap, PRD §3 cuts 1–2.)
 * Working papers — verify with your CA.
 */
import './fu-registry';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { FuelNozzle, FuelPrice } from '../../types/fuel-r21';
import { generateId, getTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num } from '../invoice-calc';
import { addDaysInput } from '../utils';
import { blankClient, makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { stockDb } from '../inventory';
import { FU_TABLES } from './fu-shared';
import { planSlipBills, readSlips, unbilledSlips, type SlipDoc } from './fu-slips';
import { tankOf } from './fu-line';

/** A document from lines, for `client`, dated `day` (amounts worked out by the shared engine). */
function record(client: Client, day: string, docType: 'BILL_OF_SUPPLY' | 'TAX_INVOICE', items: InvoiceRecord['items'], extra: Partial<InvoiceRecord>, incl = false): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const home = senderStateCode(sender);
  const pos = client.state_code || (/^\d{2}/.test(client.gstin ?? '') ? client.gstin!.slice(0, 2) : home);
  const rec: InvoiceRecord = {
    ...makeDraft({ settings, sender, docType, templateId: localDb.template.get() }),
    id: generateId(), issue_date: day, due_date: addDaysInput(num(client.credit_days) || num(settings.defaultDueDays) || 15, day), status: 'Sent', client: { ...blankClient(), ...client }, items,
    place_of_supply: pos, round_off_enabled: false, price_includes_tax: incl, supply_type: client.gstin?.trim() ? 'B2B' : 'B2C',
    gst_mode: docType === 'BILL_OF_SUPPLY' ? 'NONE' : deriveGstMode({ senderStateCode: home, placeOfSupply: pos, senderHasGstin: !!sender?.companyGstin?.trim(), taxEnabled: true }),
    ...(docType === 'BILL_OF_SUPPLY' ? { exempt_kind: 'NON_GST' as const } : {}), ...extra,
  };
  const t = calculateInvoice(calcInputFromRecord(rec));
  return { ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, cess_amount: t.cess_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount };
}

const slipDoc = (d: SlipDoc, c: Client, day: string) => record(c, day, d.fuel ? 'BILL_OF_SUPPLY' : 'TAX_INVOICE', d.items, { fu: { lines: d.lines, slip_ids: d.slip_ids }, annexure: { kind: 'timesheet', rows: d.annexure, taken_at: new Date().toISOString() }, notes: 'Credit slips: vehicle-wise annexure attached.' }, !d.fuel);

/** Month-end (or daily) billing: every unbilled slip dated on or before `day`, one document per customer × kind, in one write. */
export function billSlips(day: string): InvoiceRecord[] {
  requireAccess('doc.create');
  const docs = localDb.invoices.getAll();
  const clients = new Map(localDb.clients.getAll().map((c) => [c.id ?? '', c]));
  const nozzles = getTable<FuelNozzle>(FU_TABLES.nozzles);
  const tanks = getTable<{ id: string; fu?: { product_item_id: string } }>('godowns').filter((g) => g.fu);
  const recs = planSlipBills(unbilledSlips(readSlips(), docs, day), stockDb.items(), getTable<FuelPrice>(FU_TABLES.prices), day, (s) => tankOf(s.item_id, s.nozzle_id, nozzles, tanks)).flatMap((d) => (clients.has(d.client_id) ? [slipDoc(d, clients.get(d.client_id)!, day)] : []));
  return recs.length ? localDb.invoices.saveMany(recs) : []; // validates and numbers every document before its one write
}
