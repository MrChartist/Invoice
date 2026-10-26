/**
 * R5-B2: freight bills from consignment notes, and B1's "Collect freight" for paid / to-pay LRs.
 *
 *  - Pickable: to-be-billed LRs and delivered to-pay LRs that are not on a live bill and not cancelled.
 *  - One document per billing party and person liable: `TAX_INVOICE` (or `INVOICE` for an unregistered party), SAC
 *    996791 (date-keyed default), one line per LR (freight + charges), detention / other charges as their own lines.
 *    Liable recipient → `reverse_charge` + `rcm_tax_excluded` at the option's RCM rate; `fcm_5` / `fcm_18` → forward
 *    charge at the option's rate. Mixed selections split into two bills.
 *  - Link: each LR stores `bill_id`, the bill keeps `lr_ids`. An LR cannot be on two live bills; cancelling the bill
 *    frees its LRs (status is derived, `effectiveStatus`).
 *  - The bills are ordinary invoices (GSTR-1, receivables, books, Tally see them unchanged).
 * Working paper — verify with your CA.
 */
import type { Client, DocumentType, InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';
import type { ConsignmentNote, GstLiable, GtaOptionRow } from '../../types/transport-works-r5';
import type { AppSettings } from '../localDb';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { isValidGstin } from '../gstin';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { gtaRate, gtaSac } from '../transport-works-rules';
import { effectiveStatus, freightOf, LR_TABLE, LrError, payerId } from './consignment-notes';
import { optionFor, optionLine } from './gta-option';
import { liableText } from './lr-print';
import { requireAccess } from '../access';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { receivableTotal } from '../rcm';

type InvLite = Pick<InvoiceRecord, 'id' | 'status'>;

/** LRs that can go on a freight bill now. */
export function pickableLrs(lrs: readonly ConsignmentNote[], invoices: readonly InvLite[], range?: { from?: string; to?: string }): ConsignmentNote[] {
  return lrs.filter((lr) => {
    const st = effectiveStatus(lr, invoices);
    if (st === 'billed' || st === 'cancelled') return false;
    if (lr.payment_basis === 'paid') return false;
    if (lr.payment_basis === 'to_pay' && st !== 'delivered') return false;
    if (range?.from && lr.date < range.from) return false;
    if (range?.to && lr.date > range.to) return false;
    return true;
  });
}

export interface FreightGroup {
  key: string;
  partyId: string;
  liable: GstLiable;
  lrs: ConsignmentNote[];
  amount: number;
}

/** Group LRs by billing party, then by the person liable (a mixed selection becomes two bills). */
export function groupForBills(lrs: readonly ConsignmentNote[]): FreightGroup[] {
  const map = new Map<string, FreightGroup>();
  for (const lr of [...lrs].sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number, undefined, { numeric: true }))) {
    const partyId = payerId(lr);
    const key = `${partyId}|${lr.liable}`;
    const g = map.get(key) ?? { key, partyId, liable: lr.liable, lrs: [], amount: 0 };
    g.lrs.push(lr);
    g.amount = round2(g.amount + freightOf(lr).total);
    map.set(key, g);
  }
  return [...map.values()];
}

function totalsOf(rec: InvoiceRecord): InvoiceRecord {
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return {
    ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total,
    balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount,
  };
}

export interface FreightBillContext {
  settings: AppSettings;
  sender: SenderProfile | null;
  party: Client;
  date: string;
  templateId?: string;
  options?: readonly GtaOptionRow[];
}

const sum = (lr: ConsignmentNote, f: (l: ConsignmentNote['lines'][number]) => number) => lr.lines.reduce((s, l) => s + num(f(l)), 0);

/** Pure: the freight bill for one group (all LRs share the party and the person liable). */
export function buildFreightBill(lrs: readonly ConsignmentNote[], ctx: FreightBillContext): InvoiceRecord {
  if (!lrs.length) throw new LrError('Choose at least one LR.');
  const liable = lrs[0].liable;
  if (lrs.some((l) => l.liable !== liable)) throw new LrError('LRs with different persons liable for GST go on separate bills.');
  const party = payerId(lrs[0]);
  if (lrs.some((l) => payerId(l) !== party)) throw new LrError('All LRs on one bill must have the same billing party.');
  const option = optionFor(ctx.date, ctx.options);
  const effective = liable === 'recipient' ? 'rcm' : option === 'rcm' ? 'fcm_5' : option;
  const rate = gtaRate(effective, ctx.date).rate;
  const sac = gtaSac(ctx.date);
  const items: InvoiceItem[] = [];
  for (const lr of lrs) {
    const f = freightOf(lr);
    const line = (name: string, description: string, amount: number): InvoiceItem => ({
      id: generateId(), name, description, type: 'Service', hsn: sac, unit: 'TRIP', quantity: 1, rate: round2(amount), tax_rate: rate, discount_percent: 0, amount: round2(amount),
    });
    const desc = `${lr.number} / ${lr.date}, ${lr.from.place} → ${lr.to.place}, ${sum(lr, (l) => l.packages)} pkgs, ${sum(lr, (l) => l.charged_weight ?? l.actual_weight ?? 0)} kg`;
    items.push(line(`Freight — LR ${lr.number}`, desc, round2(f.freight + f.charges)));
    for (const c of lr.charges.filter((x) => x.kind === 'detention' || x.kind === 'other')) {
      if (num(c.amount) > 0) items.push(line(`${c.kind === 'detention' ? 'Detention' : 'Other charges'} — LR ${lr.number}`, lr.pod?.detention_days ? `${lr.pod.detention_days} day(s)` : '', num(c.amount)));
    }
  }
  const registered = isValidGstin(ctx.party.gstin ?? '');
  const docType: DocumentType = registered ? 'TAX_INVOICE' : 'INVOICE';
  const home = senderStateCode(ctx.sender);
  const pos = (registered ? ctx.party.gstin!.slice(0, 2) : ctx.party.state_code) || lrs[0].from.state || home;
  const draft = makeDraft({ settings: ctx.settings, sender: ctx.sender, docType, templateId: ctx.templateId });
  const rcm = liable === 'recipient';
  return totalsOf({
    ...draft,
    doc_type: docType,
    issue_date: ctx.date,
    due_date: ctx.date > draft.due_date ? ctx.date : draft.due_date,
    status: 'Sent',
    client: { ...ctx.party },
    items,
    place_of_supply: pos,
    gst_mode: deriveGstMode({ senderStateCode: home, placeOfSupply: pos, senderHasGstin: !!ctx.sender?.companyGstin?.trim(), taxEnabled: true }),
    reverse_charge: rcm,
    ...(rcm ? { rcm_tax_excluded: true } : {}),
    lr_ids: lrs.map((l) => l.id),
    notes: [`Freight bill for ${lrs.length} consignment note(s).`, `GST payable by: ${liableText({ liable })}.`, optionLine(option, ctx.date)].join('\n'),
  });
}

/** Annexure rows: the LRs on a bill with POD dates and shortages (CSV / print). */
export function annexureRows(lrs: readonly ConsignmentNote[]): (string | number)[][] {
  return [
    ['LR no.', 'Date', 'From', 'To', 'Packages', 'Charged kg', 'POD date', 'Received by', 'Shortage', 'Damage', 'Amount (₹)'],
    ...lrs.map((lr) => [lr.number, lr.date, lr.from.place, lr.to.place, sum(lr, (l) => l.packages), sum(lr, (l) => l.charged_weight ?? l.actual_weight ?? 0), lr.pod?.delivered_on ?? '', lr.pod?.received_by ?? '', lr.pod?.shortage_qty ?? '', lr.pod?.damage_qty ?? '', freightOf(lr).total]),
  ];
}

function liveContext(date: string, partyId: string): FreightBillContext {
  const settings = localDb.settings.get();
  const party = localDb.clients.getById(partyId);
  if (!party) throw new LrError('The billing party is not in Clients.');
  return { settings, sender: localDb.settings.activeProfile(), party, date, templateId: localDb.template.get(), options: getTable<GtaOptionRow>('gta_options') };
}

/**
 * Create the freight bills for the chosen LRs (one per party × person liable). All or nothing: role, period lock,
 * numbering (invoice series), and "an LR cannot be on two live bills".
 */
export function createFreightBills(lrIds: readonly string[], date: string): InvoiceRecord[] {
  requireAccess('doc.create');
  const all = getTable<ConsignmentNote>(LR_TABLE);
  const invoices = localDb.invoices.getAll();
  const chosen = all.filter((l) => lrIds.includes(l.id));
  for (const lr of chosen) {
    const st = effectiveStatus(lr, invoices);
    if (st === 'billed') throw new LrError(`LR ${lr.number} is already on a live bill.`);
    if (st === 'cancelled') throw new LrError(`LR ${lr.number} is cancelled.`);
  }
  return withTablesRollback(['invoices', LR_TABLE, 'clients', 'items_catalog', 'series_counters'], () => {
    const saved: InvoiceRecord[] = [];
    for (const g of groupForBills(chosen)) {
      const bill = localDb.invoices.save(buildFreightBill(g.lrs, liveContext(date, g.partyId)));
      saved.push(bill);
      const ids = new Set(g.lrs.map((l) => l.id));
      setTable(LR_TABLE, getTable<ConsignmentNote>(LR_TABLE).map((l) => (ids.has(l.id) ? { ...l, bill_id: bill.id, status: 'billed' as const, updated_at: new Date().toISOString() } : l)));
    }
    return saved;
  });
}

/**
 * B1.4 "Collect freight" (paid / to-pay LRs): the GTA's tax document for that one LR and the cash receipt of what the
 * party owes (under reverse charge the GST is not collected).
 */
export function collectFreight(lrId: string, opts: { date: string; method: string; bankAccountId?: string; reference?: string }): { bill: InvoiceRecord } {
  requireAccess('payment.record');
  const lr = getTable<ConsignmentNote>(LR_TABLE).find((l) => l.id === lrId);
  if (!lr) throw new LrError('LR not found.');
  if (lr.payment_basis === 'tbb') throw new LrError('A to-be-billed LR goes on a freight bill.');
  if (effectiveStatus(lr, localDb.invoices.getAll()) === 'billed') throw new LrError(`Freight on LR ${lr.number} is already collected.`);
  return withTablesRollback(['invoices', LR_TABLE, 'transactions', 'clients', 'items_catalog', 'series_counters'], () => {
    const bill = localDb.invoices.save(buildFreightBill([lr], liveContext(opts.date, payerId(lr))));
    setTable(LR_TABLE, getTable<ConsignmentNote>(LR_TABLE).map((l) => (l.id === lrId ? { ...l, bill_id: bill.id, status: 'billed' as const } : l)));
    const due = round2(receivableTotal(bill));
    if (due > 0) localDb.payments.record({ invoiceId: bill.id, amount: due, method: opts.method, date: opts.date, reference: opts.reference || lr.number, bankAccountId: opts.bankAccountId });
    return { bill: localDb.invoices.getById(bill.id) ?? bill };
  });
}
