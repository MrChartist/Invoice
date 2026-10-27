/**
 * AG-C3 custom milling (CMR) for the State agency and job milling for others.
 *
 *  - Agreement (table `cmr_agreements`, `doc.create`): agency (a client), season, raw / parboiled, outturn % (default
 *    67 raw / 68 parboiled from `OUTTURN_STANDARDS` — agency norm, verify), milling rate, by-product recovery, due date.
 *  - Paddy received is the **principal's material**: each lot is a JWP receipt (`job-work.ts` `principalDb`, register
 *    only), so it never enters our stock valuation or the bank stock statement.
 *  - Rice delivered (`CMR/FY…` per delivery, against the agency's acknowledgement) is a JWP **return** of the paddy it
 *    was milled from (rice ÷ outturn %, marked processed), so the JWP register shows the paddy still to be milled.
 *  - Account: paddy received, rice due (= paddy × outturn %), delivered, balance, % complete, days to the deadline,
 *    by-product recovery due and milling charges earned.
 *  - Milling-charges invoice: Circular 153/09/2021 — exempt (entry 3A) when goods (fortificant, gunny, packing) are
 *    ≤ 25% of the value, else 5% job work (entry 26). The test is shown from typed values; the user decides (AG9).
 *  - Job milling for others: a JWP receipt + `jobChargesLine` (existing), class `job_milling`: 5% suggested for a
 *    registered principal, "verify — AG10" otherwise.
 *
 * `job-work.ts` is used read-only (its `principalDb` save / remove keep their own guards and audit). Pure helpers
 * above the "Storage" divider (tests/ag-cmr.test.ts). Working papers — verify with your CA.
 */
import './ag-registry';
import type { AgCmrSnap, AgSnapshot, CmrAgreement, CmrDelivery, CmrPaddyLot } from '../../types/agri-r12';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { generateId } from '../storage';
import { todayInput } from '../utils'; // QA13 G16: local day, never the UTC date
import { requireAccess } from '../access';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { jobChargesLine, principalDb } from '../job-work';
import { localDb } from '../localDb';
import { makeDraft } from '../../store/invoice-defaults';
import { JOB_MILLING_RULES, MILLING_PDS_RULES, OUTTURN_STANDARDS, agClassAt } from '../agri-rules';
import { AG_SERIES, AG_TABLES } from './ag-shared';
import { agSnapshot } from './ag-snapshot';
import { WBS_TABLE, drop, loadSlips, markUsed, put, releaseSlip, rowsOf } from './ag-weighbridge';

export const CMR = AG_SERIES.cmr;
export const CMR_TABLE = AG_TABLES.cmr;
/** SAC of milling for PDS / job milling (the class rows of `AGRI_CLASS_RULES`). */
const sacOf = (cls: 'milling_pds' | 'job_milling', date?: string) => agClassAt(cls, date)?.hsn ?? '9988';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const r3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000 || 0;

/* ── Pure ─────────────────────────────────────────────────────── */

/** Default rice due per 100 of paddy for an agreement of `kind` on `date` (agency norm — verify). */
export const defaultOutturn = (kind: CmrAgreement['kind'], date?: string): number => ruleAt(OUTTURN_STANDARDS, date)[kind];

/** The paddy line name of an agreement in the JWP register (receipts and returns match on it). */
export const paddyName = (a: Pick<CmrAgreement, 'season' | 'kind'>) => `Paddy — CMR ${a.season.trim()}${a.kind === 'parboiled' ? ' (parboiled)' : ''}`;

export interface CmrAccount {
  paddy: number;
  due: number;
  delivered: number;
  balance: number;
  /** delivered ÷ due, %. */
  pct: number;
  /** Paddy not yet milled and delivered (= paddy − delivered ÷ outturn). */
  paddyPending: number;
  /** Days from `today` to `due_by` (negative = overdue); null without a due date. */
  daysLeft: number | null;
  overdue: boolean;
  byproductDue: number;
  chargesEarned: number;
}

const dayNo = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, dd || 1) / 86_400_000;
};

/** Pure: the CMR account of an agreement on `today`. */
export function cmrAccount(a: Pick<CmrAgreement, 'outturn_pct' | 'paddy_lots' | 'deliveries' | 'due_by' | 'milling_rate' | 'byproduct_recovery'>, today: string): CmrAccount {
  const out = num(a.outturn_pct);
  const paddy = r3((a.paddy_lots ?? []).reduce((s, l) => s + num(l.qty), 0));
  const due = r3((paddy * out) / 100);
  const delivered = r3((a.deliveries ?? []).reduce((s, d) => s + num(d.qty), 0));
  const balance = r3(due - delivered);
  const daysLeft = a.due_by && DAY.test(a.due_by) ? Math.round(dayNo(a.due_by) - dayNo(today)) : null;
  const rec = a.byproduct_recovery;
  return {
    paddy, due, delivered, balance,
    pct: due > 0 ? round2((delivered * 100) / due) : 0,
    paddyPending: out > 0 ? r3(paddy - (delivered * 100) / out) : paddy,
    daysLeft, overdue: daysLeft !== null && daysLeft < 0 && balance > 0,
    byproductDue: rec ? round2(rec.basis === 'lump' ? num(rec.rate) : paddy * num(rec.rate)) : 0,
    chargesEarned: round2(delivered * num(a.milling_rate)),
  };
}

export interface PdsTest {
  goodsPct: number;
  limit: number;
  /** Goods within the limit → exempt (entry 3A), else 5% (entry 26). */
  exempt: boolean;
  rate: number;
  sac: string;
  suggestion: 'exempt' | 'job_work_5';
}

/** Pure: the Circular 153 25% test from typed values (goods = fortificant, gunny, packing; total = the whole value). */
export function pdsTest(goods: number, total: number, date?: string): PdsTest {
  const r = ruleAt(MILLING_PDS_RULES, date);
  const t = num(total);
  const goodsPct = t > 0 ? round2((Math.max(num(goods), 0) * 100) / t) : 0;
  const exempt = goodsPct <= r.goodsPct;
  return { goodsPct, limit: r.goodsPct, exempt, rate: exempt ? 0 : r.elseRate, sac: sacOf('milling_pds', date), suggestion: exempt ? 'exempt' : 'job_work_5' };
}

/** Job milling suggestion: 5% for a registered principal; null (user's rate, "verify — AG10") otherwise. */
export function jobMillingRate(registered: boolean, date?: string): { rate: number | null; sac: string } {
  const r = ruleAt(JOB_MILLING_RULES, date);
  return { rate: registered ? r.registered : r.unregistered, sac: sacOf('job_milling', date) };
}

/** The `ag.cmr` snapshot a milling-charges invoice prints (AG-A5 "Custom milling" block; field names are AG-A's `AgCmrSnap`). */
export function cmrSnapshot(a: CmrAgreement, today: string, goodsPct?: number, lot?: Pick<CmrDelivery, 'lot_no' | 'ack_no'>): AgCmrSnap {
  const acc = cmrAccount(a, today);
  return {
    agency: a.agency_name, season: a.season, ...(lot ? { lot_ack: [lot.lot_no, lot.ack_no].filter(Boolean).join(' / ') } : {}),
    paddy_qtl: acc.paddy, outturn_pct: num(a.outturn_pct), rice_due_qtl: acc.due, rice_delivered_qtl: acc.delivered,
    ...(goodsPct !== undefined ? { goods_pct: goodsPct } : {}),
  };
}

/** What live milling-charges bills already cover for an agreement: rice billed and the delivery ids. */
export interface CmrBilling {
  billed: number;
  /** Delivered rice not yet on a live bill (qtl). */
  unbilled: number;
  /** Delivery id → the number of the live bill that covers it. */
  billedBy: Map<string, string>;
}

/**
 * Pure: the bills of `a` among `invoices` (`ag.cmr.agreement_id`, not cancelled — a cancelled or deleted bill frees
 * its deliveries, like `liveBill`), the rice they bill and the deliveries they cover.
 */
export function cmrBilling(a: Pick<CmrAgreement, 'id' | 'deliveries'>, invoices: readonly InvoiceRecord[]): CmrBilling {
  const billedBy = new Map<string, string>();
  let billed = 0;
  for (const inv of invoices) {
    const c = inv.ag?.cmr;
    if (c?.agreement_id !== a.id || inv.status === 'Cancelled') continue;
    billed += num(c.billed_qtl);
    for (const id of c.delivery_ids ?? []) billedBy.set(id, inv.invoice_number || '—');
  }
  const delivered = (a.deliveries ?? []).reduce((s, d) => s + num(d.qty), 0);
  return { billed: r3(billed), unbilled: r3(Math.max(delivered - billed, 0)), billedBy };
}

/* ================================================================
   Storage
   ================================================================ */

export const loadAgreements = (): CmrAgreement[] => rowsOf<CmrAgreement>(CMR_TABLE);
const mustGet = (id: string): CmrAgreement => {
  const a = loadAgreements().find((x) => x.id === id);
  if (!a) throw new Error('This custom-milling agreement no longer exists.');
  return a;
};
const stamp = () => new Date().toISOString();

export type AgreementInput = Pick<CmrAgreement, 'agency_id' | 'season' | 'kind'> & Partial<Pick<CmrAgreement, 'id' | 'outturn_pct' | 'milling_rate' | 'byproduct_recovery' | 'due_by' | 'bg_id' | 'status'>>;

/** Create or edit an agreement (lots and deliveries are kept; the outturn cannot drop below what is delivered). */
export function saveAgreement(i: AgreementInput, today = todayInput()): CmrAgreement {
  requireAccess('doc.create');
  const agency = localDb.clients.getById(i.agency_id);
  if (!agency) throw new Error('Choose the agency (a client).');
  if (!i.season?.trim()) throw new Error('Enter the season (e.g. Kharif 2026-27).');
  const outturn = i.outturn_pct === undefined || String(i.outturn_pct) === '' ? defaultOutturn(i.kind, today) : num(i.outturn_pct);
  if (!(outturn > 0 && outturn < 100)) throw new Error('The outturn must be between 0 and 100 %.');
  if (i.due_by && !DAY.test(i.due_by)) throw new Error('Enter a valid delivery deadline.');
  if (num(i.milling_rate) < 0 || num(i.byproduct_recovery?.rate) < 0) throw new Error('Rates cannot be negative.');
  const prev = i.id ? loadAgreements().find((a) => a.id === i.id) : undefined;
  const row: CmrAgreement = {
    ...(prev ?? { paddy_lots: [], deliveries: [], created_at: stamp() }),
    id: prev?.id ?? generateId(), agency_id: agency.id ?? i.agency_id, agency_name: agency.name, season: i.season.trim(), kind: i.kind, outturn_pct: round2(outturn),
    ...(num(i.milling_rate) > 0 ? { milling_rate: round2(num(i.milling_rate)) } : {}),
    ...(i.byproduct_recovery && num(i.byproduct_recovery.rate) > 0 ? { byproduct_recovery: { basis: i.byproduct_recovery.basis, rate: round2(num(i.byproduct_recovery.rate)) } } : {}),
    ...(i.due_by ? { due_by: i.due_by } : {}), ...(i.bg_id ? { bg_id: i.bg_id } : {}),
    status: i.status ?? prev?.status ?? 'open', updated_at: stamp(),
  } as CmrAgreement;
  if (prev && !i.milling_rate) delete row.milling_rate;
  if (prev && !i.byproduct_recovery) delete row.byproduct_recovery;
  if (prev && !i.due_by) delete row.due_by;
  if (prev && cmrAccount(row, today).balance < -0.0005) throw new Error('More rice is already delivered than this outturn allows.');
  if (prev && (prev.season !== row.season || prev.kind !== row.kind) && (prev.paddy_lots.length || prev.deliveries.length)) throw new Error('The season and kind are fixed once paddy is received.');
  return put(CMR_TABLE, row);
}

/** Delete an agreement with no paddy and no deliveries (recycle bin). */
export function deleteAgreement(id: string): void {
  requireAccess('doc.create');
  const a = loadAgreements().find((x) => x.id === id);
  if (!a) return;
  if (a.paddy_lots.length || a.deliveries.length) throw new Error('Remove its deliveries and paddy lots first, or close the agreement.');
  drop(CMR_TABLE, id);
}

/** Receive paddy for CMR: a JWP receipt (principal's material) and a lot on the agreement; a slip is marked used. */
export function addPaddyLot(agreementId: string, x: { date: string; qty?: number; wbs_id?: string; challan_no?: string }): CmrPaddyLot {
  requireAccess('doc.create');
  const a = mustGet(agreementId);
  if (a.status === 'closed') throw new Error('This agreement is closed.');
  if (!DAY.test(x.date)) throw new Error('Enter the date.');
  const slip = x.wbs_id ? loadSlips().find((s) => s.id === x.wbs_id) : undefined;
  if (x.wbs_id && !slip) throw new Error('This weighbridge slip no longer exists.');
  if (slip && slip.ref_id) throw new Error(`Slip ${slip.number} is already used.`);
  const qty = r3(x.qty !== undefined && num(x.qty) > 0 ? num(x.qty) : num(slip?.net_kg) / 100);
  if (!(qty > 0)) throw new Error('Enter the paddy received (quintals).');
  return withTablesRollback([CMR_TABLE, WBS_TABLE, 'job_work_principal', 'series_counters'], () => {
    const r = principalDb.save({
      date: x.date, kind: 'receipt', party_name: a.agency_name, client_id: a.agency_id, challan_no: x.challan_no || slip?.number || '', challan_date: x.date,
      lines: [{ id: generateId(), name: paddyName(a), qty, unit: 'QTL' }], narration: `Custom milling ${a.season} — paddy received${slip ? ` (weighbridge slip ${slip.number})` : ''}`,
    });
    const lot: CmrPaddyLot = { id: generateId(), ...(slip ? { wbs_id: slip.id } : {}), jwp_id: r.id, date: x.date, qty };
    put(CMR_TABLE, { ...mustGet(agreementId), paddy_lots: [...a.paddy_lots, lot], updated_at: stamp() });
    if (slip) markUsed(slip.id, 'cmr', a.id);
    return lot;
  });
}

/** Remove a paddy lot (its JWP receipt through the register's own guards; the slip is freed). */
export function removePaddyLot(agreementId: string, lotId: string, today = todayInput()): void {
  requireAccess('doc.create');
  const a = mustGet(agreementId);
  const lot = a.paddy_lots.find((l) => l.id === lotId);
  if (!lot) return;
  const next = { ...a, paddy_lots: a.paddy_lots.filter((l) => l.id !== lotId) };
  if (cmrAccount(next, today).balance < -0.0005) throw new Error('Rice already delivered needs this paddy; remove the deliveries first.');
  withTablesRollback([CMR_TABLE, WBS_TABLE, 'job_work_principal'], () => {
    principalDb.remove(lot.jwp_id);
    put(CMR_TABLE, { ...next, updated_at: stamp() });
    if (lot.wbs_id) releaseSlip(lot.wbs_id);
  });
}

/** Deliver rice against an acknowledgement: `CMR/FY…`, and a JWP return of the paddy it was milled from. */
export function addDelivery(agreementId: string, x: { date: string; qty: number; lot_no: string; ack_no?: string; fortified?: boolean }, today = x.date): CmrDelivery {
  requireAccess('doc.create');
  const a = mustGet(agreementId);
  if (!DAY.test(x.date)) throw new Error('Enter the delivery date.');
  if (!x.lot_no?.trim()) throw new Error('Enter the lot number.');
  const qty = r3(num(x.qty));
  if (!(qty > 0)) throw new Error('Enter the rice delivered (quintals).');
  const acc = cmrAccount(a, today);
  if (qty - acc.balance > 0.0005) throw new Error(`Only ${acc.balance} qtl of rice is due on the paddy received.`);
  const number = nextSeriesNumberFor(CMR, x.date, loadAgreements().flatMap((g) => g.deliveries.map((d) => d.number)));
  const id = generateId();
  assertUnlocked({ id, issue_date: x.date, invoice_number: number }, 'create');
  return withTablesRollback([CMR_TABLE, 'job_work_principal', 'series_counters'], () => {
    const paddy = r3((qty * 100) / num(a.outturn_pct));
    const r = principalDb.save({
      date: x.date, kind: 'return', party_name: a.agency_name, client_id: a.agency_id, challan_no: number, challan_date: x.date,
      lines: [{ id: generateId(), name: paddyName(a), qty: paddy, unit: 'QTL', processed: true }],
      narration: `Custom-milled rice ${qty} qtl delivered (lot ${x.lot_no.trim()}${x.ack_no ? `, ACK ${x.ack_no}` : ''}) = paddy ${paddy} qtl at ${a.outturn_pct}%`,
    });
    const d: CmrDelivery = { id, number, date: x.date, qty, lot_no: x.lot_no.trim(), ...(x.ack_no?.trim() ? { ack_no: x.ack_no.trim() } : {}), ...(x.fortified ? { fortified: true } : {}), jwp_id: r.id };
    put(CMR_TABLE, { ...mustGet(agreementId), deliveries: [...a.deliveries, d], updated_at: stamp() });
    recordSeries(number);
    return d;
  });
}

/** Remove a delivery (its JWP return; the CMR number stays used). */
export function removeDelivery(agreementId: string, deliveryId: string): void {
  requireAccess('doc.create');
  const a = mustGet(agreementId);
  const d = a.deliveries.find((x) => x.id === deliveryId);
  if (!d) return;
  const bill = cmrBilling(a, localDb.invoices.getAll()).billedBy.get(d.id);
  if (bill) throw new Error(`Delivery ${d.number} is on milling-charges bill ${bill}; cancel the bill first.`);
  assertUnlocked({ id: d.id, issue_date: d.date, invoice_number: d.number }, 'delete');
  withTablesRollback([CMR_TABLE, 'job_work_principal'], () => {
    if (d.jwp_id) principalDb.remove(d.jwp_id);
    put(CMR_TABLE, { ...a, deliveries: a.deliveries.filter((x) => x.id !== deliveryId), updated_at: stamp() });
  });
}

/** A draft sales document (bill of supply when exempt) to a client, with the `ag` snapshot. */
function draftDoc(clientId: string, date: string, items: Omit<InvoiceItem, 'id' | 'type' | 'amount'>[], exempt: boolean, notes: string, ag: AgSnapshot): InvoiceRecord {
  requireAccess('doc.create');
  const client = localDb.clients.getById(clientId);
  if (!client) throw new Error('Choose the client.');
  const d = makeDraft({ settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), docType: exempt ? 'BILL_OF_SUPPLY' : 'TAX_INVOICE' });
  const rec = {
    ...d, issue_date: date, client: { ...client }, notes, ag,
    items: items.map((i) => ({ ...i, id: generateId(), type: 'service', discount_percent: 0, amount: round2(num(i.quantity) * num(i.rate)), ...(exempt ? { tax_rate: 0 } : {}) })),
  } as InvoiceRecord;
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return localDb.invoices.save({ ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount });
}

/**
 * Milling-charges draft: rice `qty` × the agreement's milling rate, plus the typed goods value (fortificant, gunny,
 * packing) as a second line; the Circular 153 test on goods ÷ total picks exempt (bill of supply) or 5%.
 * QA13: the bill is tied to the deliveries it covers (`ag.cmr.agreement_id` / `delivery_ids` / `billed_qtl`) — by
 * default every delivery not yet on a live bill — and rice already billed is refused (no double bill).
 */
export function millingChargesInvoice(agreementId: string, x: { date: string; qty?: number; goods_value?: number; rate?: number; delivery_ids?: string[] }): { invoice: InvoiceRecord; test: PdsTest } {
  const a = mustGet(agreementId);
  const b = cmrBilling(a, localDb.invoices.getAll());
  const open = a.deliveries.filter((d) => !b.billedBy.has(d.id));
  const picked = x.delivery_ids ? a.deliveries.filter((d) => x.delivery_ids!.includes(d.id)) : open;
  if (x.delivery_ids && picked.length !== new Set(x.delivery_ids).size) throw new Error('A chosen delivery no longer exists.');
  const twice = picked.find((d) => b.billedBy.has(d.id));
  if (twice) throw new Error(`Delivery ${twice.number} is already billed on ${b.billedBy.get(twice.id)}.`);
  if (!picked.length || !(b.unbilled > 0)) throw new Error('All rice delivered on this agreement is already billed.');
  const rate = num(x.rate ?? a.milling_rate);
  const qty = r3(x.qty !== undefined && num(x.qty) > 0 ? num(x.qty) : Math.min(picked.reduce((s, d) => s + num(d.qty), 0), b.unbilled));
  if (!(qty > 0) || !(rate > 0)) throw new Error('Enter the rice quantity and the milling rate.');
  if (qty - b.unbilled > 0.0005) throw new Error(`Only ${b.unbilled} qtl of delivered rice is not billed yet (${b.billed} qtl already billed).`);
  const service = round2(qty * rate);
  const goods = round2(Math.max(num(x.goods_value), 0));
  const test = pdsTest(goods, service + goods, x.date);
  const items = [
    { name: `Milling charges — CMR ${a.season} (${qty} qtl rice; ${picked.map((d) => d.number).join(', ')})`, hsn: test.sac, unit: 'QTL', quantity: qty, rate, tax_rate: test.rate, ag_class: 'milling_pds' as const },
    ...(goods > 0 ? [{ name: 'Goods used in milling (fortificant, gunny, packing)', hsn: test.sac, unit: 'NOS', quantity: 1, rate: goods, tax_rate: test.rate, ag_class: 'milling_pds' as const }] : []),
  ];
  const note = test.exempt
    ? `Milling of paddy for PDS — goods ${test.goodsPct}% of value (≤ ${test.limit}%): exempt, N 12/2017 entry 3A (Circular 153/09/2021-GST). Working paper — verify with your CA (AG9).`
    : `Milling of paddy for PDS — goods ${test.goodsPct}% of value (> ${test.limit}%): 5% job work, N 11/2017 entry 26 (Circular 153/09/2021-GST). Working paper — verify with your CA (AG9).`;
  const cmr = { ...cmrSnapshot(a, x.date, test.goodsPct), agreement_id: a.id, delivery_ids: picked.map((d) => d.id), billed_qtl: qty };
  const invoice = draftDoc(a.agency_id, x.date, items, test.exempt, note, agSnapshot('cmr', { cmr }));
  return { invoice, test };
}

/** Job milling charges for a principal (atta chakki, oil expeller, dal mill): a JWP receipt is already on the register. */
export function jobMillingInvoice(x: { client_id: string; date: string; qty: number; rate: number; process?: string; registered: boolean; tax_rate?: number; jwp_number?: string }): InvoiceRecord {
  const s = jobMillingRate(x.registered, x.date);
  const taxRate = x.tax_rate !== undefined && String(x.tax_rate) !== '' ? num(x.tax_rate) : s.rate;
  if (taxRate === null) throw new Error('Unregistered principal: type the GST rate (verify with your CA — AG10).');
  const line = jobChargesLine({ process: x.process || 'milling', rate: x.rate, number: x.jwp_number ?? '' }, x.qty, taxRate);
  const note = `Job milling (class job_milling, SAC ${s.sac}) — ${x.registered ? '5% suggested for a registered principal, N 11/2017 entry 26' : 'unregistered principal: rate typed'}. Working paper — verify with your CA (AG10).`;
  const { id: _i, type: _t, amount: _a, ...rest } = line;
  void _i; void _t; void _a;
  return draftDoc(x.client_id, x.date, [{ ...rest, hsn: s.sac, ag_class: 'job_milling' }], taxRate === 0, note, agSnapshot('job_milling', { header: x.jwp_number ? { jwp: x.jwp_number } : undefined }));
}
