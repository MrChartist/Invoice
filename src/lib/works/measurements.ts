/**
 * R5-B4: measured RA bills. Works → RA bills → "New measurement" for a BOQ: per line the cumulative measured quantity
 * to date (or this bill's quantity — the other is derived), with an optional MB page / ref. Previous cumulative = what
 * live RA bills of the BOQ already billed (cancelling a bill gives its quantity back). Cumulative may pass the BOQ
 * quantity only with "excess / variation" ticked and a reason; the excess prints as its own "Extra item" line.
 *
 * Saving creates the stage invoice through R2-B2's builder with basis `measured` (quantity-scaled: HSN, rate and GST
 * stay the BOQ's; `progress_line_of` set; billed-so-far and over-billing checks are R2-B2's), stamps `ra_no` (1, 2, 3 …
 * per BOQ), `ra_final`, `boq_id`, the deductions (`deductions.ts`) and saves the measurement row. A final bill whose
 * lines reach the BOQ exactly is R2-B2's "remaining balance" bill, so the RA bills add up to the BOQ to the paisa.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { MeasurementLine, RaMeasurement } from '../../types/transport-works-r5';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { createBalanceInvoice, createProgressInvoice, lineValue, progressSummary, roundQty, stageInvoices, type LinkLike } from '../progress-billing';
import { boqLines, contractValue } from './boq';
import { computeDeductions, withDeductions } from './deductions';
import { raSnapshotFor, siteOfBoq } from '../construction/cn-snapshot-io'; // R11 (CN-A3 / A4)
import { splitDeviation } from '../construction/cn-abstract';
import { worksPlaceOfSupply } from '../construction/cn-tax';
import { senderStateCode } from '../../store/invoice-defaults';
import type { CnRecoveryInput, WorksContract } from '../../types/construction-r11';
import { contractRules } from '../construction/cn-contracts'; // R11 (CN-B)
import { cnBillDeductions } from '../construction/cn-recoveries';
import { loadSecured } from '../construction/cn-secured';

export const RA_TABLE = 'ra_measurements';
const EPS = 1e-6;

export class RaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RaError';
  }
}

export function loadMeasurements(boqId?: string): readonly RaMeasurement[] {
  const rows = peekTable<RaMeasurement>(RA_TABLE).filter((r) => r && typeof r.id === 'string');
  return boqId ? rows.filter((r) => r.boq_id === boqId) : rows;
}

type Inv = Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'issue_date' | 'progress_of' | 'items' | 'ra_no' | 'boq_id' | 'taxable_value' | 'ra_deductions'>;

/** Live RA bills of a BOQ (stage invoices with an RA number), oldest first. */
export function raBills<T extends Inv>(boqId: string, invoices: readonly T[]): T[] {
  return stageInvoices(boqId, invoices).filter((i) => num(i.ra_no) > 0).sort((a, b) => num(a.ra_no) - num(b.ra_no));
}

/** Quantity billed per BOQ line so far: live stage invoices net of their credit notes (R2-B2's billed-so-far). */
export function billedQty(boq: InvoiceRecord, invoices: readonly InvoiceRecord[], links: readonly LinkLike[]): Map<string, number> {
  return new Map(progressSummary(boq, invoices, links).lines.map((l) => [l.line.id, l.billedQty]));
}

/**
 * Next RA number of a BOQ: one above the highest RA number ever used — live RA bills, cancelled ones (`boq_id` kept)
 * and their measurement rows (PENDING 28: a cancelled RA bill's number is never issued again, like its invoice number).
 */
export const nextRaNo = (boqId: string, invoices: readonly Inv[], measurements: readonly Pick<RaMeasurement, 'boq_id' | 'ra_no'>[] = loadMeasurements(boqId)): number =>
  Math.max(
    raBills(boqId, invoices).reduce((m, b) => Math.max(m, num(b.ra_no)), 0),
    invoices.reduce((m, b) => (b.boq_id === boqId ? Math.max(m, num(b.ra_no)) : m), 0),
    measurements.reduce((m, r) => (r.boq_id === boqId ? Math.max(m, num(r.ra_no)) : m), 0),
  ) + 1;

export interface MeasureInput {
  line_id: string;
  /** Cumulative measured quantity to date … */
  cumulative_qty?: number;
  /** … or this bill's quantity (the other is derived). */
  this_qty?: number;
  mb_ref?: string;
  /** Tick "excess / variation" with a reason to pass the BOQ quantity. */
  extra_reason?: string;
  /** R11 (CN-A4): the measured line is an extra item / a substituted item (approval ref; the BOQ item it replaces). */
  kind?: 'extra' | 'substituted';
  approval?: string;
  substitutes?: string;
}

/** Pure: cumulative ↔ this-bill derivation and the BOQ check. Throws `RaError`. */
export function deriveLines(boq: Pick<InvoiceRecord, 'items'>, previous: ReadonlyMap<string, number>, input: readonly MeasureInput[]): MeasurementLine[] {
  const lines = boqLines(boq);
  const out: MeasurementLine[] = [];
  for (const m of input) {
    const line = lines.find((l) => l.id === m.line_id);
    if (!line) throw new RaError('A measured line is not on the BOQ.');
    const prev = previous.get(line.id) ?? 0;
    const hasCum = m.cumulative_qty !== undefined && String(m.cumulative_qty) !== '';
    const cumulative = roundQty(hasCum ? num(m.cumulative_qty) : prev + num(m.this_qty));
    const thisQty = roundQty(cumulative - prev);
    if (thisQty < -EPS) throw new RaError(`"${line.name}": cumulative ${cumulative} is below the ${prev} already billed.`);
    if (!(thisQty > EPS)) continue;
    const reason = String(m.extra_reason ?? '').trim();
    if (cumulative > num(line.quantity) + EPS && !reason) throw new RaError(`"${line.name}": cumulative ${cumulative} exceeds the BOQ quantity ${num(line.quantity)}. Tick "excess / variation" and give a reason.`);
    out.push({
      line_id: line.id, cumulative_qty: cumulative, this_qty: thisQty, ...(m.mb_ref?.trim() ? { mb_ref: m.mb_ref.trim() } : {}), ...(cumulative > num(line.quantity) + EPS ? { extra: { reason } } : {}),
      // R11 (CN-A4): line class and approval reach the bill's snapshot
      ...(m.kind === 'extra' || m.kind === 'substituted' ? { kind: m.kind } : {}), ...(m.approval?.trim() ? { approval: m.approval.trim().slice(0, 80) } : {}), ...(m.kind === 'substituted' && m.substitutes?.trim() ? { substitutes: m.substitutes.trim().slice(0, 40) } : {}),
    });
  }
  if (!out.length) throw new RaError('Enter a measured quantity above what was already billed for at least one line.');
  return out;
}

/** Pure: split each stage line that passes the BOQ quantity into the within-BOQ part and an "Extra item" line. */
export function splitExtras(items: readonly InvoiceItem[], boq: Pick<InvoiceRecord, 'items'>, previous: ReadonlyMap<string, number>, lines: readonly MeasurementLine[]): InvoiceItem[] {
  const out: InvoiceItem[] = [];
  for (const it of items) {
    const m = lines.find((l) => l.line_id === it.progress_line_of);
    const src = boqLines(boq).find((l) => l.id === it.progress_line_of);
    if (!m?.extra || !src) {
      out.push(it);
      continue;
    }
    const within = roundQty(Math.max(num(src.quantity) - (previous.get(src.id) ?? 0), 0));
    const extra = roundQty(num(it.quantity) - within);
    if (within > EPS) out.push({ ...it, quantity: within, amount: round2(within * num(it.rate)) });
    if (extra > EPS) out.push({ ...it, id: `${it.id}-x`, name: `Extra item — ${it.name}`, description: `${m.extra.reason}`, quantity: extra, amount: round2(extra * num(it.rate)) });
  }
  return out;
}

function recalc(rec: InvoiceRecord): InvoiceRecord {
  const t = calculateInvoice(calcInputFromRecord(rec));
  return { ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount };
}

/**
 * QA11 C6: Sec 51(1) proviso — no GST TDS where the location of the supplier and the place of supply (the site, CN-A2)
 * are in one State and the recipient is registered in another (its GSTIN's State). Verify with your CA (CA_REVIEW QA11-3).
 */
export function gstTdsProvisoApplies(supplierState: string | undefined, pos: string | undefined, recipientGstin: string | undefined): boolean {
  const rec = String(recipientGstin ?? '').trim().slice(0, 2);
  return !!supplierState && !!pos && /^\d\d$/.test(rec) && supplierState === pos && rec !== pos;
}

/** Retention release day: the typed day, else completion (or this final bill's date) + DLP months. */
/** `YYYY-MM-DD` plus whole months (day clamped to the month's last day). */
export function addMonthsDay(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = y * 12 + (m - 1) + Math.round(months);
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function releaseDay(terms: InvoiceRecord['boq_terms'], billDate: string, final: boolean): string | undefined {
  if (terms?.release_on) return terms.release_on;
  const done = terms?.completed_on || (final ? billDate : '');
  return done && num(terms?.dlp_months) > 0 ? addMonthsDay(done, num(terms!.dlp_months)) : undefined;
}

export interface RaRequest {
  date: string;
  lines: readonly MeasureInput[];
  final?: boolean;
  /** Save the RA bill as issued (default) or leave it a draft for review. */
  draft?: boolean;
  /** R11 (CN-A3): work done from – to and the date of measurement (defaults: day after the last bill's period – the bill date). */
  period_from?: string;
  period_to?: string;
  measured_on?: string;
  /** R11 (CN-B2 / B4): recoveries typed on this bill (secured advance used, client material, hire, withheld, LD). */
  recoveries?: CnRecoveryInput[];
}

/**
 * Save a measurement and its RA bill (all or nothing): role, period lock, invoice numbering, R2-B2 checks.
 */
export function saveRaBill(boqId: string, req: RaRequest): { measurement: RaMeasurement; invoice: InvoiceRecord } {
  requireAccess('doc.create');
  const boq = localDb.invoices.getById(boqId);
  if (!boq) throw new RaError('BOQ not found.');
  const invoices = localDb.invoices.getAll();
  const previous = billedQty(boq, invoices, getTable<LinkLike>('doc_links'));
  const lines = deriveLines(boq, previous, req.lines);
  const raNo = nextRaNo(boqId, invoices);
  const extras = lines.filter((l) => l.extra);
  const reachesBoq = boqLines(boq).every((l) => {
    const m = lines.find((x) => x.line_id === l.id);
    return Math.abs((m ? m.cumulative_qty : previous.get(l.id) ?? 0) - num(l.quantity)) < EPS;
  });
  return withTablesRollback(['invoices', 'doc_links', RA_TABLE, 'clients', 'items_catalog', 'series_counters'], () => {
    const stage = req.final && reachesBoq && !extras.length
      ? createBalanceInvoice(boq, req.date)
      : createProgressInvoice(boq, { basis: 'measured', lineQtys: Object.fromEntries(lines.map((l) => [l.line_id, l.this_qty])), allowOver: extras.length > 0, overReason: extras.map((e) => e.extra!.reason).join('; ') }, req.date);
    const terms = boq.boq_terms ?? {};
    // R11 (CN-A2 / A4): quantity beyond the deviation limit as its own line; place of supply = the site State (Sec 12(3)).
    const snap = raSnapshotFor(boq, raNo, req);
    const contract = snap.contract as WorksContract | undefined;
    const rules = contractRules(terms.deductions ?? [], contract); // R11 (CN-B1): the contract's terms win
    const site = siteOfBoq(boq, snap.contract);
    const sender = stage.sender ?? localDb.settings.activeProfile();
    const pos = site ? worksPlaceOfSupply(site, stage.place_of_supply, { state: senderStateCode(sender ?? null), hasGstin: !!sender?.companyGstin?.trim(), taxEnabled: stage.gst_mode !== 'NONE' }) : null;
    let bill = recalc({ ...stage, ...(pos?.fromSite && stage.gst_mode !== 'NONE' && stage.gst_mode !== 'SINGLE' ? { place_of_supply: pos.place_of_supply, gst_mode: pos.gst_mode } : {}), items: splitDeviation(splitExtras(stage.items, boq, previous, lines), boq, previous, lines, snap.deviationPct) });
    const earlier = raBills(boqId, invoices);
    const advance = terms.advance_id ? getTable<{ id: string; amount: number }>('advances').find((a) => a.id === terms.advance_id) : undefined;
    const sumKind = (k: string) => earlier.reduce((s, b) => s + (b.ra_deductions ?? []).filter((d) => d.kind === k).reduce((t, d) => t + d.amount, 0), 0);
    const base = computeDeductions(bill, rules, {
      contractValue: contractValue(boq),
      previousGross: round2(earlier.reduce((s, b) => s + num(b.taxable_value), 0)),
      previousRetention: round2(sumKind('retention')),
      ...(advance ? { advance: { amount: num(advance.amount), recovered: round2(sumKind('advance_recovery')) } } : {}),
      gstTdsDeductor: (!!localDb.clients.getById(boq.client?.id ?? '')?.gst_tds_deductor || !!boq.client?.gst_tds_deductor) && !gstTdsProvisoApplies(senderStateCode(sender ?? null), bill.place_of_supply, bill.client?.gstin || boq.client?.gstin),
      intraState: bill.gst_mode !== 'IGST',
    });
    // R11 (CN-B2 / B4): contract advances (recovery schedule + interest), secured advance and typed recoveries.
    const deds = cnBillDeductions({
      base, contract, taxable: num(bill.taxable_value), date: req.date, earlier, invoices, secured: loadSecured(), recoveries: req.recoveries, boqAdvanceId: terms.advance_id,
      advances: getTable<{ id: string; number?: string; date: string; amount: number }>('advances'), rulePct: rules.find((r) => r.kind === 'advance_recovery')?.rate,
    });
    const final = !!req.final;
    const release = deds.some((d) => d.kind === 'retention') ? releaseDay(terms, req.date, final) : undefined;
    bill = recalc(withDeductions(bill, deds, rules));
    bill = {
      ...bill,
      status: req.draft ? 'Draft' : 'Sent',
      ra_no: raNo,
      ...(final ? { ra_final: true } : {}),
      boq_id: boqId,
      ...(release ? { retention_release_on: release } : {}),
      notes: [`RA bill no. ${raNo}${final ? ' (final)' : ''} — ${boq.invoice_number}${terms.work_order ? ` · work order ${terms.work_order}` : ''}`, (stage.notes ?? '').split('\n').slice(1).join('\n')].filter((s) => s.trim()).join('\n'),
    };
    bill = { ...bill, boq_terms: { ...bill.boq_terms, cn: snap.build(bill, invoices, lines) } }; // R11: the paper's snapshot
    const invoice = localDb.invoices.save(bill);
    const row: RaMeasurement = { id: generateId(), boq_id: boqId, ra_no: raNo, date: req.date, lines, invoice_id: invoice.id, status: 'billed', ...(final ? { final: true } : {}), created_at: new Date().toISOString() };
    setTable(RA_TABLE, [...getTable<RaMeasurement>(RA_TABLE), row]);
    return { measurement: row, invoice };
  });
}

/** Mark a measurement cancelled once its RA bill is cancelled (the bill itself is cancelled from the documents list). */
export function cancelMeasurement(id: string): RaMeasurement {
  requireAccess('doc.create');
  const all = getTable<RaMeasurement>(RA_TABLE);
  const m = all.find((x) => x.id === id);
  if (!m) throw new RaError('Measurement not found.');
  const inv = m.invoice_id ? localDb.invoices.getById(m.invoice_id) : undefined;
  if (inv && inv.status !== 'Cancelled') throw new RaError(`Cancel RA bill ${inv.invoice_number} first.`);
  assertUnlocked({ id: m.id, issue_date: m.date, invoice_number: `RA ${m.ra_no}` }, 'cancel');
  const next = { ...m, status: 'cancelled' as const };
  setTable(RA_TABLE, all.map((x) => (x.id === id ? next : x)));
  return next;
}

/* ── RA register ─────────────────────────────────────────────── */

export interface RaRegisterRow {
  raNo: number;
  invoiceId: string;
  number: string;
  date: string;
  gross: number;
  cumulative: number;
  deductions: number;
  net: number;
  received: number;
  balance: number;
  final: boolean;
}

/** Per BOQ: RA no., date, gross this bill, cumulative gross, deductions, net, received (money), balance. */
export function raRegister(boqId: string, invoices: readonly InvoiceRecord[], payments: readonly { invoice_id: string; amount: number; ra_kind?: string; advance_id?: string }[]): RaRegisterRow[] {
  let cum = 0;
  return raBills(boqId, invoices).map((b) => {
    const gross = round2(num(b.total));
    cum = round2(cum + gross);
    const deductions = round2((b.ra_deductions ?? []).reduce((s, d) => s + d.amount, 0));
    const net = round2(num(b.ra_net_payable ?? gross - deductions));
    const received = round2(payments.filter((p) => p.invoice_id === b.id && !p.ra_kind && !p.advance_id).reduce((s, p) => s + num(p.amount), 0));
    return { raNo: num(b.ra_no), invoiceId: b.id, number: b.invoice_number, date: b.issue_date, gross, cumulative: cum, deductions, net, received, balance: round2(Math.max(net - received, 0)), final: !!b.ra_final };
  });
}

export const registerCsvRows = (rows: readonly RaRegisterRow[]): (string | number)[][] => [
  ['RA no.', 'Invoice', 'Date', 'Gross this bill', 'Cumulative gross', 'Deductions', 'Net payable', 'Received', 'Balance', 'Final'],
  ...rows.map((r) => [r.raNo, r.number, r.date, r.gross, r.cumulative, r.deductions, r.net, r.received, r.balance, r.final ? 'Yes' : '']),
];

export { lineValue };
