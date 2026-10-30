/**
 * R2-B2: progress / milestone billing from a quotation or a sales order (QuickBooks progress invoicing,
 * Xero progress payments, Refrens partial conversion).
 *
 * A stage invoice bills a share of the source: by % of the whole, by an amount (rupees before GST) or by
 * line (% per line). Each source line is scaled by its share — the QUANTITY is scaled, so the HSN, the
 * rate, the line discount and the GST rate are exactly the source's and the tax split (CGST + SGST vs
 * IGST) is recomputed the usual way. Every stage line carries `progress_line_of` (the source line id);
 * from a sales order also `order_line_id` + `sales_order_id`, so the order's "to invoice" quantity and
 * the normal conversion see what the stages already billed.
 *
 * Billed so far = quantity on live stage invoices less quantity on live credit notes raised against
 * them (credit-note lines keep the stage line's fields). A stage that would take a line past 100% is
 * refused unless over-billing is allowed with a reason. "Invoice remaining balance" bills exactly what
 * is left of every line; the paise left over by quantity rounding are absorbed in its rate, so the
 * stages add up to the source's line value to the paisa. It is linked `progress` with `final`, which
 * makes a quotation "Converted".
 *
 * Time of supply for continuous supply of services / works contracts (CGST Act Sec 13, Sec 31(5)) is a
 * judgement call: the date is the user's, the screen only reminds them — verify with your CA.
 */

import type { DocumentType, InvoiceItem, InvoiceRecord, RoundMode } from '../types/invoice';
import type { Milestone, ProgressBasis, ProgressOf } from '../types/sales-r2';
import { calcInputFromRecord, calculateInvoice, isExcludedLine, mulRound2, num, pctOf, resolveRoundMode, round2 } from './invoice-calc';
import { generateId, getTable, KEYS, setTable } from './storage';
import { localDb } from './localDb';
import { withTablesRollback } from './table-txn';
import { isPeriodLockedError } from './period-lock';
import { localDayOf } from './dates';

const DOC_LINKS_TABLE = 'doc_links';

export interface LinkLike {
  from_id: string;
  to_id: string;
  relation: string;
  final?: boolean;
}

const EPS = 1e-6;
/**
 * Stage quantities keep 6 decimals (QA5-2 F16: at 4, a 1-LOT line billed at 33.333% became 33.33% and left a
 * "0.0001" balance stage).
 */
export const roundQty = (n: number): number => Math.round((n + Math.sign(n) * Number.EPSILON) * 1e6) / 1e6 || 0;
const isBill = (t: DocumentType | undefined) => t === 'INVOICE' || t === 'TAX_INVOICE' || t === 'BILL_OF_SUPPLY';

/** Line value before GST: quantity × rate less the line discount. */
export function lineValue(i: Pick<InvoiceItem, 'quantity' | 'rate' | 'discount_percent'>): number {
  const gross = mulRound2(num(i.quantity), num(i.rate));
  return round2(gross - pctOf(gross, Math.min(Math.max(num(i.discount_percent), 0), 100)));
}

/** Lines of the source that are billed (unselected optional quotation lines are not). */
export function billableLines(source: Pick<InvoiceRecord, 'items'>): InvoiceItem[] {
  return (source.items ?? []).filter((i) => !isExcludedLine(i) && num(i.quantity) > 0 && (String(i.name ?? '').trim() || num(i.rate) > 0));
}

/** Live stage invoices of a source, oldest first. */
export function stageInvoices<T extends Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'issue_date' | 'progress_of'>>(sourceId: string, invoices: readonly T[]): T[] {
  return invoices
    .filter((i) => i.progress_of?.source_id === sourceId && isBill(i.doc_type) && i.status !== 'Cancelled')
    .sort((a, b) => (a.issue_date ?? '').localeCompare(b.issue_date ?? '') || num(a.progress_of?.stage) - num(b.progress_of?.stage));
}

/** Live credit notes raised against the given stage invoices. */
export function stageCredits(stageIds: ReadonlySet<string>, invoices: readonly InvoiceRecord[], links: readonly LinkLike[]): InvoiceRecord[] {
  const ids = new Set(links.filter((l) => l.relation === 'credit_note' && stageIds.has(l.from_id)).map((l) => l.to_id));
  return invoices.filter((i) => ids.has(i.id) && i.doc_type === 'CREDIT_NOTE' && i.status !== 'Cancelled');
}

export interface LineBilling {
  line: InvoiceItem;
  quotedQty: number;
  quotedValue: number;
  /** Net of credit notes. */
  billedQty: number;
  billedValue: number;
  remainingQty: number;
  /** Share billed, 0–1 (can pass 1 when over-billed). */
  fraction: number;
}

export interface ProgressSummary {
  lines: LineBilling[];
  /** Source taxable value (before GST). */
  quoted: number;
  quotedTotal: number;
  /** Taxable value of the live stage invoices. */
  invoiced: number;
  invoicedTotal: number;
  /** Taxable value of credit notes against the stages. */
  credited: number;
  /** quoted − invoiced + credited. */
  remaining: number;
  /** (invoiced − credited) / quoted, 0–100+. */
  percent: number;
  stages: InvoiceRecord[];
  credits: InvoiceRecord[];
  /** The final (balance) invoice was raised. */
  closed: boolean;
}

/** Pure: billed vs quoted for a quotation / sales order. */
export function progressSummary(source: InvoiceRecord, invoices: readonly InvoiceRecord[], links: readonly LinkLike[]): ProgressSummary {
  const stages = stageInvoices(source.id, invoices);
  const credits = stageCredits(new Set(stages.map((s) => s.id)), invoices, links);
  const billed = new Map<string, { qty: number; value: number }>();
  const add = (doc: InvoiceRecord, sign: 1 | -1) => {
    for (const it of doc.items ?? []) {
      if (!it.progress_line_of) continue;
      const b = billed.get(it.progress_line_of) ?? { qty: 0, value: 0 };
      b.qty = roundQty(b.qty + sign * num(it.quantity));
      b.value = round2(b.value + sign * lineValue(it));
      billed.set(it.progress_line_of, b);
    }
  };
  for (const s of stages) add(s, 1);
  for (const c of credits) add(c, -1);
  const lines: LineBilling[] = billableLines(source).map((line) => {
    const quotedQty = num(line.quantity);
    const b = billed.get(line.id) ?? { qty: 0, value: 0 };
    return {
      line, quotedQty, quotedValue: lineValue(line), billedQty: b.qty, billedValue: b.value,
      remainingQty: Math.max(roundQty(quotedQty - b.qty), 0), fraction: quotedQty > 0 ? b.qty / quotedQty : 0,
    };
  });
  const calc = calculateInvoice(calcInputFromRecord({ ...source, items: billableLines(source) }, { amount_paid: 0 }));
  const invoiced = round2(stages.reduce((s, i) => s + num(i.taxable_value), 0));
  const invoicedTotal = round2(stages.reduce((s, i) => s + num(i.total), 0));
  const credited = round2(credits.reduce((s, i) => s + num(i.taxable_value), 0));
  const quoted = calc.taxable_value;
  return {
    lines, quoted, quotedTotal: calc.total, invoiced, invoicedTotal, credited,
    remaining: round2(quoted - invoiced + credited),
    percent: quoted > 0 ? round2(((invoiced - credited) / quoted) * 100) : 0,
    stages, credits,
    closed: links.some((l) => l.relation === 'progress' && l.final && l.from_id === source.id && stages.some((s) => s.id === l.to_id)),
  };
}

export interface ProgressRequest {
  basis: ProgressBasis;
  /** Percent (basis percent) or rupees before GST (basis amount). */
  value?: number;
  /** basis lines: percent per source line id. */
  linePercents?: Record<string, number>;
  /** R5-B4 basis measured: this-bill quantity per source line id (BOQ measurement). */
  lineQtys?: Record<string, number>;
  /** Bill a milestone of the plan (its percent). */
  milestoneId?: string;
  allowOver?: boolean;
  overReason?: string;
}

export interface StageContext {
  id: string;
  invoice_number: string;
  date: string;
  dueDays: number;
  /** Target bill type (default: Bill of Supply for a composition sender, else Tax Invoice). */
  docType?: DocumentType;
  invoices: readonly InvoiceRecord[];
  links: readonly LinkLike[];
}

export class ProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgressError';
  }
}

/** Why a source cannot take progress invoices ('' = it can). */
export function progressBlocked(source: Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'order_closed_on'>, links: readonly LinkLike[]): string {
  if (source.doc_type !== 'QUOTATION' && source.doc_type !== 'SALES_ORDER') return 'Progress invoices are raised from a quotation or a sales order.';
  if (source.status === 'Cancelled') return 'This document is cancelled.';
  if (source.status === 'Draft') return 'Save the document as issued (not a draft) first.';
  if (source.order_closed_on) return 'This sales order is closed.';
  if (links.some((l) => l.relation === 'revised' && l.from_id === source.id)) return 'A later revision replaced this quotation: bill the latest one.';
  if (links.some((l) => l.relation === 'converted' && l.from_id === source.id && source.doc_type === 'QUOTATION')) return 'This quotation was already converted in full.';
  if (links.some((l) => l.relation === 'progress' && l.final && l.from_id === source.id)) return 'The remaining balance was already invoiced.';
  return '';
}

const dayNum = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN;
};
function addDays(d: string, days: number): string {
  const base = dayNum(d);
  if (!Number.isFinite(base)) return d;
  const t = new Date((base + Math.max(0, Math.round(days))) * 864e5);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** The invoice-level discount of the source as a percent of its net line value (a stage takes its share). */
function equivalentDiscountPct(source: InvoiceRecord): number {
  if (source.discount_type !== 'AMOUNT') return num(source.discount_rate);
  const c = calculateInvoice(calcInputFromRecord({ ...source, items: billableLines(source) }, { shipping: 0, other_charges: 0, round_off_enabled: false, round_mode: 'none', amount_paid: 0 }));
  const net = round2(c.subtotal - c.line_discount_total);
  return net > 0 ? (c.invoice_discount_amount / net) * 100 : 0;
}

function recompute(input: InvoiceRecord): InvoiceRecord {
  const rec: InvoiceRecord = input.reverse_charge && input.doc_type !== 'BILL_OF_SUPPLY' ? { ...input, rcm_tax_excluded: true } : { ...input, rcm_tax_excluded: undefined };
  const t = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total,
    balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount,
  };
}

/** "33.33%", "33.333%", "100.0001%": up to 4 decimals, so a share just past 100% never reads as "100%". */
const fmtPct = (n: number) => `${Math.round(n * 1e4) / 1e4}%`;

/**
 * QA5-2 F16: each stage rounds its own total, so with round-off on the stages can miss the quotation's total by
 * a rupee. The balance stage takes the rounding direction (nearest / up / down) that brings the stages to the
 * quotation total — a stored round mode, so every reader that recomputes the bill gets the same figure. Not
 * done once credit notes changed the stages (the target is no longer the quotation total).
 */
function absorbRoundOff(draft: InvoiceRecord, summary: ProgressSummary): InvoiceRecord {
  const mode = resolveRoundMode(draft.round_mode, !!draft.round_off_enabled);
  if (mode === 'none' || summary.credits.length) return draft;
  const target = round2(summary.quotedTotal - summary.stages.reduce((s, i) => s + num(i.total), 0));
  let best = draft;
  for (const m of ['nearest', 'up', 'down'] as RoundMode[]) {
    if (m === mode) continue;
    const alt = recompute({ ...draft, round_mode: m, round_off_enabled: true });
    if (Math.abs(alt.total - target) < Math.abs(best.total - target) - 0.001) best = alt;
  }
  return best;
}

/** The shell of a stage invoice: the source's parties, tax setup and terms, nothing that belongs to the source alone. */
function stageShell(source: InvoiceRecord, ctx: StageContext, items: InvoiceItem[], progress: ProgressOf, title: string, charges: { shipping: number; other: number }): InvoiceRecord {
  const docType: DocumentType = ctx.docType ?? (source.sender?.gst_scheme === 'composition' ? 'BILL_OF_SUPPLY' : 'TAX_INVOICE');
  const fromOrder = source.doc_type === 'SALES_ORDER';
  return recompute({
    ...source,
    id: ctx.id,
    invoice_number: ctx.invoice_number,
    doc_type: docType,
    issue_date: ctx.date,
    due_date: addDays(ctx.date, ctx.dueDays),
    status: 'Draft',
    items,
    client: { ...source.client },
    sender: source.sender ? { ...source.sender } : null,
    discount_type: 'PERCENT',
    discount_rate: equivalentDiscountPct(source),
    shipping: charges.shipping,
    other_charges: charges.other,
    amount_paid: 0,
    notes: [title, source.notes].filter((s) => String(s ?? '').trim()).join('\n'),
    progress_of: progress,
    sales_order_id: fromOrder ? source.id : undefined,
    ...(docType === 'BILL_OF_SUPPLY' ? { gst_mode: 'NONE' as const, reverse_charge: false } : {}),
    // Nothing that belongs to the source alone.
    quote_status: undefined, acceptance: undefined, revision_of: undefined, revision_no: undefined, proposal_sections: undefined,
    milestones: undefined, payment_schedule: undefined, recurring_id: undefined, recurring_date: undefined, late_fee_for: undefined,
    party_balance_snapshot: undefined, attachments: undefined, created_at: undefined, updated_at: undefined, order_closed_on: undefined,
    amends: undefined, pos: undefined, challan_purpose: undefined, approval: undefined, loyalty_redeem: undefined, branch_transfer_id: undefined,
  });
}

function stageLine(source: InvoiceRecord, line: InvoiceItem, qty: number, id: string, note: string): InvoiceItem {
  const out: InvoiceItem = {
    ...line, id, quantity: qty, amount: round2(qty * num(line.rate)), progress_line_of: line.id,
    description: [line.description, note].filter((s) => String(s ?? '').trim()).join(' · '),
  };
  delete out.optional;
  delete out.selected;
  delete out.alt_group;
  delete out.serials;
  if (source.doc_type === 'SALES_ORDER') out.order_line_id = line.id;
  else delete out.order_line_id;
  return out;
}

/** Pure: the next stage invoice (Draft). Throws `ProgressError` for a blocked source or a request past 100%. */
export function buildProgressInvoice(source: InvoiceRecord, req: ProgressRequest, ctx: StageContext): InvoiceRecord {
  const blocked = progressBlocked(source, ctx.links);
  if (blocked) throw new ProgressError(blocked);
  const summary = progressSummary(source, [...ctx.invoices], ctx.links);
  if (!summary.lines.length) throw new ProgressError('There are no lines to bill on this document.');
  let basis = req.basis;
  let value = num(req.value);
  let milestone: Milestone | undefined;
  if (req.milestoneId) {
    milestone = (source.milestones ?? []).find((m) => m.id === req.milestoneId);
    if (!milestone) throw new ProgressError('That milestone is not on this document.');
    if (milestone.invoice_id && ctx.invoices.some((i) => i.id === milestone!.invoice_id && i.status !== 'Cancelled')) throw new ProgressError(`Milestone "${milestone.name}" is already billed.`);
    basis = 'percent';
    value = num(milestone.percent);
  }
  const base = summary.lines.reduce((s, l) => s + l.quotedValue, 0);
  const share = (l: LineBilling): number => {
    if (basis === 'percent') return value / 100;
    if (basis === 'amount') return base > 0 ? value / base : 0;
    if (basis === 'measured') return l.quotedQty > 0 ? num(req.lineQtys?.[l.line.id]) / l.quotedQty : 0; // R5-B4
    return num(req.linePercents?.[l.line.id]) / 100;
  };
  if (basis !== 'lines' && basis !== 'measured' && !(value > 0)) throw new ProgressError(basis === 'percent' ? 'Enter a percent above zero.' : 'Enter an amount above zero.');
  const over: string[] = [];
  const stage = summary.stages.length + 1;
  const items: InvoiceItem[] = [];
  let newValue = 0;
  summary.lines.forEach((l, k) => {
    const f = share(l);
    if (!(f > 0)) return;
    if (l.fraction + f > 1 + EPS) over.push(`"${l.line.name || 'Item'}" would be ${fmtPct((l.fraction + f) * 100)} billed`);
    const qty = basis === 'measured' ? roundQty(num(req.lineQtys?.[l.line.id])) : roundQty(l.quotedQty * f); // R5-B4: the measured quantity as entered
    if (!(qty > 0)) return;
    const line = stageLine(source, l.line, qty, `${ctx.id}-l${k + 1}`, `${fmtPct(f * 100)} of ${Math.round(l.quotedQty * 1e4) / 1e4}${l.line.unit ? ` ${l.line.unit}` : ''}`);
    newValue += lineValue(line);
    items.push(line);
  });
  if (!items.length) throw new ProgressError('Enter a share above zero for at least one line.');
  if (over.length && !req.allowOver) throw new ProgressError(`Billing beyond 100% is not allowed: ${over.join('; ')}. Tick "Allow over-billing" and give a reason to go ahead.`);
  if (over.length && !String(req.overReason ?? '').trim()) throw new ProgressError('Give a reason for billing beyond 100%.');
  const weight = base > 0 ? newValue / base : 0;
  const pctLabel = basis === 'percent' ? fmtPct(value) : basis === 'amount' ? `₹${round2(value).toLocaleString('en-IN')}` : fmtPct(weight * 100);
  const progress: ProgressOf = {
    source_id: source.id, basis, value: basis === 'lines' || basis === 'measured' ? round2(weight * 100) : round2(value), stage,
    ...(milestone ? { milestone_id: milestone.id } : {}),
    ...(over.length ? { over_reason: String(req.overReason).trim() } : {}),
  };
  const title = `Stage ${stage}: ${pctLabel} of ${source.invoice_number}${milestone ? ` (${milestone.name})` : ''}`;
  return stageShell(source, ctx, items, progress, title, {
    shipping: round2(num(source.shipping) * weight),
    other: round2(num(source.other_charges) * weight),
  });
}

/** Pure: the "remaining balance" invoice — exactly what is left of every line (and of the charges). */
export function buildBalanceInvoice(source: InvoiceRecord, ctx: StageContext): InvoiceRecord {
  const blocked = progressBlocked(source, ctx.links);
  if (blocked) throw new ProgressError(blocked);
  const summary = progressSummary(source, [...ctx.invoices], ctx.links);
  const stage = summary.stages.length + 1;
  const items: InvoiceItem[] = [];
  summary.lines.forEach((l, k) => {
    const qty = l.remainingQty;
    if (!(qty > EPS)) return;
    const line = stageLine(source, l.line, qty, `${ctx.id}-l${k + 1}`, `balance ${Math.round(qty * 1e4) / 1e4} of ${Math.round(l.quotedQty * 1e4) / 1e4}${l.line.unit ? ` ${l.line.unit}` : ''}`);
    // Absorb the paise that quantity rounding left behind: the stages add up to the line value exactly.
    const target = round2(l.quotedValue - l.billedValue);
    if (Math.abs(lineValue(line) - target) >= 0.005 && num(line.discount_percent) === 0) {
      const rate = Math.round((target / qty) * 1e6) / 1e6;
      if (Math.abs(lineValue({ ...line, rate }) - target) < 0.005) {
        line.rate = rate;
        line.amount = round2(qty * rate);
      }
    }
    items.push(line);
  });
  if (!items.length) throw new ProgressError('Nothing is left to bill: every line is fully invoiced.');
  const billedCharges = summary.stages.reduce((s, i) => ({ shipping: s.shipping + num(i.shipping), other: s.other + num(i.other_charges) }), { shipping: 0, other: 0 });
  const progress: ProgressOf = { source_id: source.id, basis: 'percent', value: round2(Math.max(100 - summary.percent, 0)), stage, final: true };
  return absorbRoundOff(stageShell(source, ctx, items, progress, `Stage ${stage}: remaining balance of ${source.invoice_number}`, {
    shipping: Math.max(round2(num(source.shipping) - billedCharges.shipping), 0),
    other: round2(num(source.other_charges) - billedCharges.other),
  }), summary);
}

/* ── Progress billing summary report ────────────────────────────── */

export interface ProgressReportRow {
  sourceId: string;
  number: string;
  docType: DocumentType;
  date: string;
  party: string;
  quoted: number;
  invoiced: number;
  credited: number;
  remaining: number;
  percent: number;
  stages: number;
  closed: boolean;
}

/** Every quotation / sales order with at least one stage invoice, by party then number. */
export function progressReport(invoices: readonly InvoiceRecord[], links: readonly LinkLike[]): ProgressReportRow[] {
  const sources = new Set(invoices.filter((i) => i.progress_of?.source_id && isBill(i.doc_type)).map((i) => i.progress_of!.source_id));
  const rows: ProgressReportRow[] = [];
  for (const src of invoices) {
    if (!sources.has(src.id)) continue;
    const s = progressSummary(src, invoices, links);
    rows.push({
      sourceId: src.id, number: src.invoice_number, docType: src.doc_type, date: src.issue_date, party: src.client?.name ?? '',
      quoted: s.quoted, invoiced: s.invoiced, credited: s.credited, remaining: s.remaining, percent: s.percent, stages: s.stages.length, closed: s.closed,
    });
  }
  return rows.sort((a, b) => a.party.localeCompare(b.party) || a.number.localeCompare(b.number, undefined, { numeric: true }));
}

/** Trimmed milestone plan: a name and a percent above zero are needed. */
export function cleanMilestones(plan: readonly Partial<Milestone>[] | undefined): Milestone[] {
  const out: Milestone[] = [];
  for (const m of plan ?? []) {
    const name = String(m?.name ?? '').trim();
    const percent = round2(num(m?.percent));
    if (!name || !(percent > 0)) continue;
    out.push({
      id: String(m.id ?? '').trim() || generateId(), name: name.slice(0, 120), percent,
      ...(/^\d{4}-\d{2}-\d{2}$/.test(String(m.expected_date ?? '')) ? { expected_date: m.expected_date } : {}),
      ...(m.invoice_id ? { invoice_id: m.invoice_id } : {}),
    });
  }
  return out;
}

/* ── Storage ────────────────────────────────────────────────────── */

type StoredLink = LinkLike & { id: string; created_at: string };

function saveStage(source: InvoiceRecord, draft: InvoiceRecord, final: boolean): InvoiceRecord {
  return withTablesRollback([KEYS.invoices, DOC_LINKS_TABLE], () => {
    const saved = localDb.invoices.save(draft);
    setTable(DOC_LINKS_TABLE, [...getTable<StoredLink>(DOC_LINKS_TABLE), { id: generateId(), from_id: source.id, to_id: saved.id, relation: 'progress', ...(final ? { final: true } : {}), created_at: new Date().toISOString() }]);
    // Tick the milestone this stage billed; a source inside a locked period keeps its plan (the stage stands).
    const mid = saved.progress_of?.milestone_id;
    try {
      if (mid && source.milestones?.some((m) => m.id === mid)) {
        const fresh = localDb.invoices.getById(source.id);
        if (fresh) localDb.invoices.save({ ...fresh, milestones: (fresh.milestones ?? []).map((m) => (m.id === mid ? { ...m, invoice_id: saved.id } : m)) });
      }
      // Billing a quotation means the client said yes (as a conversion does).
      if (source.doc_type === 'QUOTATION' && !source.quote_status) localDb.invoices.setQuoteStatus(source.id, 'Accepted');
    } catch (err) {
      if (!isPeriodLockedError(err)) throw err;
    }
    return saved;
  });
}

function stageContext(source: InvoiceRecord, date?: string): StageContext {
  const day = date || localDayOf(new Date());
  return {
    id: generateId(),
    invoice_number: localDb.invoices.nextNumber(day, source.sender?.gst_scheme === 'composition' ? 'BILL_OF_SUPPLY' : 'TAX_INVOICE', source.sender?.invoicePrefix || undefined),
    date: day,
    dueDays: num(localDb.settings.get().defaultDueDays, 14),
    invoices: localDb.invoices.getAll(),
    links: getTable<LinkLike>(DOC_LINKS_TABLE),
  };
}

/** Create, save and link the next stage invoice (Draft) of a quotation / sales order. */
export function createProgressInvoice(source: InvoiceRecord, req: ProgressRequest, date?: string): InvoiceRecord {
  const fresh = localDb.invoices.getById(source.id) ?? source;
  return saveStage(fresh, buildProgressInvoice(fresh, req, stageContext(fresh, date)), false);
}

/** Create, save and link the "remaining balance" invoice that closes the source. */
export function createBalanceInvoice(source: InvoiceRecord, date?: string): InvoiceRecord {
  const fresh = localDb.invoices.getById(source.id) ?? source;
  return saveStage(fresh, buildBalanceInvoice(fresh, stageContext(fresh, date)), true);
}

/** Live summary for one source. */
export function loadProgressSummary(sourceId: string): ProgressSummary | null {
  const src = localDb.invoices.getById(sourceId);
  return src ? progressSummary(src, localDb.invoices.getAll(), getTable<LinkLike>(DOC_LINKS_TABLE)) : null;
}

/** Save the milestone plan of a quotation / sales order (percents must not pass 100). */
export function saveMilestones(sourceId: string, plan: readonly Partial<Milestone>[]): InvoiceRecord {
  const fresh = localDb.invoices.getById(sourceId);
  if (!fresh) throw new ProgressError('Document not found.');
  const milestones = cleanMilestones(plan);
  const sum = round2(milestones.reduce((s, m) => s + m.percent, 0));
  if (sum > 100 + EPS) throw new ProgressError(`The milestones add up to ${sum}%, more than 100%.`);
  return localDb.invoices.save({ ...fresh, milestones: milestones.length ? milestones : undefined });
}
