/**
 * R2-B1: batch invoices — one template × many parties (QuickBooks batch invoicing).
 *
 * A source (saved invoice, quotation or recurring template) is billed to many parties at once, with
 * optional per-party overrides of the first line's quantity / rate, the notes and the PO number (the
 * source's own PO is never copied: it is another customer's order reference — QA5-2 F14).
 * Each draft takes the party's own place of supply (state code → GSTIN → state name) and the GST split
 * is re-derived from it (CGST + SGST inside the sender's state, IGST outside). A domestic party with
 * no state and no GSTIN never inherits the source's place of supply: it falls back to the seller's
 * state (intra-state, as the editor does for a walk-in) and the draft carries a `stateWarning` so the
 * user can pick the state before issuing (QA5-2 F7). Exports / SEZ keep the source's place of supply.
 * Issue saves every invoice in one all-or-nothing step (`withTablesRollback`), numbered consecutively
 * in the Indian FY series of the issue date through `localDb.invoices.save` — so the period lock,
 * approvals and the credit-limit gate apply and the sender profile is snapshotted on every invoice
 * (Critical Rule 3). A draft run (and an invoice held for a serial / batch pick) takes NO number: it
 * is numbered in its series when issued, like recurring drafts, so undoing it leaves no hole and no
 * number is handed out twice (QA5-2 F15). Invoices held for approval stay numbered Drafts and are listed.
 *
 * A `batch_runs` row records each run. Undo deletes the run's drafts; issued invoices are only ever
 * cancelled (with a reason), never deleted silently. The same source × date × party list cannot be
 * issued twice by accident (re-run guard; "issue again" must be explicit).
 */

import type { Client, DocumentType, InvoiceItem, InvoiceRecord, SenderProfile } from '../types/invoice';
import type {} from '../types/sales-r2';
import type {} from '../types/contacts';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, isExcludedLine, num, round2 } from './invoice-calc';
import { resolveStateCode } from './india-states';
import { einvoiceMandatory, isGstinShaped } from './gst-guards';
import { normalizeRecord, senderStateCode } from '../store/invoice-defaults';
import { generateId, getTable, KEYS, setTable } from './storage';
import { localDb } from './localDb';
import { withTablesRollback } from './table-txn';
import { requireAccess } from './access';
import { liveDocTrackingIssues } from './stock-tracking';
import { cancelDocument } from './documents';
import { createSchedule, recurringDb, RECURRING_TABLE, templateFromInvoice, type Frequency, type RecurringMode, type RecurringTemplate } from './recurring';

export const BATCH_RUNS_TABLE = 'batch_runs';

export type BatchSourceKind = 'invoice' | 'quotation' | 'recurring';

export interface BatchOverride {
  /** Quantity of the first line. */
  qty?: number;
  /** Rate of the first line. */
  rate?: number;
  notes?: string;
  po_number?: string;
}

export interface BatchParty {
  /** Stable key of the party (`partyKey`). */
  key: string;
  client: Client;
  override?: BatchOverride;
}

export interface BatchRun {
  id: string;
  created_at: string;
  /** Issue date of the run's invoices (YYYY-MM-DD). */
  date: string;
  source_id: string;
  source_kind: BatchSourceKind;
  source_label?: string;
  party_keys: string[];
  invoice_ids: string[];
  /** Ids held as drafts (approval / credit / missing serial or batch). */
  held_ids?: string[];
  totals: { count: number; taxable: number; total: number };
  mode: RecurringMode;
  status: 'done' | 'partly_undone' | 'undone';
  /** Re-run guard: source × date × parties. */
  run_key: string;
  undone_at?: string;
}

export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchError';
  }
}

const clean = (s: unknown) => String(s ?? '').trim();

/** Stable key of a party: master id, else GSTIN, else the folded name. */
export const partyKey = (c: Pick<Client, 'id' | 'gstin' | 'name'>): string => clean(c.id) || clean(c.gstin).toUpperCase() || `n:${clean(c.name).toLowerCase()}`;

/** The document snapshot of a party (no master-only fields: credit terms, contacts, address book, beats). */
export function partySnapshot(c: Client): Client {
  return {
    ...(c.id ? { id: c.id } : {}),
    name: clean(c.name), company: c.company ?? '', email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '',
    city: c.city ?? '', zip: c.zip ?? '', state: c.state ?? '', state_code: c.state_code ?? '', gstin: c.gstin ?? '',
    ...(c.pan ? { pan: c.pan } : {}),
  };
}

/** A batch template from a saved document (serials / batches dropped, unselected optional lines left out). */
export function templateFromDocument(doc: InvoiceRecord): RecurringTemplate {
  const t = templateFromInvoice({ ...doc, items: (doc.items ?? []).filter((i) => !isExcludedLine(i)) });
  delete t.po_number;
  t.items = t.items.map((i) => {
    const { optional: _o, selected: _s, alt_group: _g, order_line_id: _l, progress_line_of: _p, bill_refs: _b, ...rest } = i;
    void [_o, _s, _g, _l, _p, _b];
    return rest;
  });
  return t;
}

/** Bill type a batch issues: the source's own bill type, else Tax Invoice (Bill of Supply for a composition sender). */
export function batchDocType(t: Pick<RecurringTemplate, 'doc_type'>, sender: SenderProfile | null): DocumentType {
  if (sender?.gst_scheme === 'composition') return 'BILL_OF_SUPPLY';
  return t.doc_type === 'INVOICE' || t.doc_type === 'TAX_INVOICE' || t.doc_type === 'BILL_OF_SUPPLY' ? t.doc_type : 'TAX_INVOICE';
}

export interface BatchContext {
  date: string;
  dueDays: number;
  /** Issuing profile snapshotted on every invoice (default: the template's). */
  sender?: SenderProfile | null;
  /** Credit-limit warning for a draft ('' = none). */
  creditWarning?: (draft: InvoiceRecord) => string;
  newId?: () => string;
}

export type EInvoiceFlag = 'yes' | 'no' | 'unknown';

export interface BatchDraft {
  party: BatchParty;
  record: InvoiceRecord;
  creditWarning: string;
  /** e-Invoice applies (B2B party and the sender's AATO over the mandate on the date); unknown without an AATO. */
  einvoice: EInvoiceFlag;
  /** Non-empty when the party has no state or GSTIN and the seller's state was used as the place of supply. */
  stateWarning: string;
}

export const NO_STATE_WARNING = "The party has no state or GSTIN: your own state is used (CGST + SGST). Set the party's state if the supply is inter-state.";

function totalsOf(rec: InvoiceRecord): InvoiceRecord {
  const r = rec.reverse_charge && rec.doc_type !== 'BILL_OF_SUPPLY' ? { ...rec, rcm_tax_excluded: true } : rec;
  const t = calculateInvoice(calcInputFromRecord(r, { amount_paid: 0 }));
  return {
    ...r, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total,
    balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount,
  };
}

const addDays = (d: string, n: number) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + Math.max(0, Math.round(n))));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

/** Pure: one draft per party (no number yet), with its own place of supply, GST split and overrides. */
export function buildBatchDrafts(template: RecurringTemplate, parties: readonly BatchParty[], ctx: BatchContext): BatchDraft[] {
  const sender = ctx.sender === undefined ? template.sender : ctx.sender;
  const fromState = senderStateCode(sender);
  const docType = batchDocType(template, sender);
  const newId = ctx.newId ?? generateId;
  return parties.map((party) => {
    const client = partySnapshot(party.client);
    const zeroOrExport = template.supply_type && template.supply_type !== 'B2B' && template.supply_type !== 'B2C';
    const own = resolveStateCode({ code: client.state_code, gstin: client.gstin, name: client.state });
    // Never the source party's state for a domestic party (QA5-2 F7); an export keeps the source's.
    const pos = own || (zeroOrExport ? template.place_of_supply : '') || fromState;
    const stateWarning = !own && !zeroOrExport ? NO_STATE_WARNING : '';
    const gst_mode = docType === 'BILL_OF_SUPPLY' || template.gst_mode === 'NONE' || template.gst_mode === 'SINGLE' || zeroOrExport
      ? (docType === 'BILL_OF_SUPPLY' ? 'NONE' : template.gst_mode)
      : deriveGstMode({ senderStateCode: fromState, placeOfSupply: pos, senderHasGstin: !!clean(sender?.companyGstin), taxEnabled: true });
    const id = newId();
    const o = party.override ?? {};
    let first = true;
    const items: InvoiceItem[] = template.items.map((i, n) => {
      const line: InvoiceItem = { ...i, id: `${id}-l${n + 1}` };
      if (first && (clean(i.name) || num(i.rate) > 0)) {
        first = false;
        if (o.qty !== undefined && num(o.qty) > 0) line.quantity = num(o.qty);
        if (o.rate !== undefined && num(o.rate) >= 0) line.rate = num(o.rate);
      }
      line.amount = round2(num(line.quantity) * num(line.rate));
      return line;
    });
    const raw = {
      ...template,
      id,
      invoice_number: '',
      doc_type: docType,
      issue_date: ctx.date,
      due_date: addDays(ctx.date, ctx.dueDays),
      status: 'Draft',
      amount_paid: 0,
      client,
      sender: sender ? { ...sender } : null,
      items,
      place_of_supply: pos,
      gst_mode,
      notes: clean(o.notes) || template.notes,
      po_number: clean(o.po_number),
      ...(docType === 'BILL_OF_SUPPLY' ? { reverse_charge: false } : {}),
    };
    const record = totalsOf(normalizeRecord(raw, template.template_id));
    const b2b = isGstinShaped(client.gstin);
    const aato = Number(sender?.einvoice_aato) > 0 ? Number(sender?.einvoice_aato) : undefined;
    const einvoice: EInvoiceFlag = !b2b || docType === 'BILL_OF_SUPPLY' || sender?.gst_scheme === 'composition' ? 'no' : aato === undefined ? 'unknown' : einvoiceMandatory(aato, ctx.date) ? 'yes' : 'no';
    return { party, record, creditWarning: ctx.creditWarning?.(record) ?? '', einvoice, stateWarning };
  });
}

/** Re-run guard key: the same source, issue date and party list. */
export const runKey = (sourceId: string, date: string, keys: readonly string[]) => `${sourceId}|${date}|${[...keys].sort().join(',')}`;

/**
 * Parties named in pasted text (one per line, or comma / semicolon separated): a 15-character GSTIN
 * or a party name (case-insensitive). Unknown entries are returned for the user to fix.
 */
export function matchPastedParties(text: string, clients: readonly Client[]): { matched: Client[]; unknown: string[] } {
  const byGstin = new Map(clients.filter((c) => clean(c.gstin)).map((c) => [clean(c.gstin).toUpperCase(), c]));
  const byName = new Map(clients.map((c) => [clean(c.name).toLowerCase(), c]));
  const matched: Client[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? '').split(/[\n;,\t]+/)) {
    const t = clean(raw);
    if (!t) continue;
    const c = (isGstinShaped(t) ? byGstin.get(t.toUpperCase()) : undefined) ?? byName.get(t.toLowerCase());
    if (!c) {
      unknown.push(t);
      continue;
    }
    const k = partyKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      matched.push(c);
    }
  }
  return { matched, unknown };
}

/* ── Storage ────────────────────────────────────────────────────── */

export const batchRunsDb = {
  all: (): BatchRun[] => getTable<BatchRun>(BATCH_RUNS_TABLE),
  get: (id: string): BatchRun | undefined => batchRunsDb.all().find((r) => r.id === id),
};

export interface IssueResult {
  run: BatchRun;
  invoices: InvoiceRecord[];
  /** Saved as drafts although "issue" was asked: approval / credit hold, or a serial / batch to pick. */
  held: { invoice: InvoiceRecord; reason: string }[];
}

/**
 * Save the drafts in one step, numbered consecutively in the FY series of `date`. `mode: 'issue'` issues
 * them (Sent); `force` lets the same source × date × parties run again on purpose.
 */
export function issueBatch(drafts: readonly BatchDraft[], opts: { sourceId: string; sourceKind: BatchSourceKind; sourceLabel?: string; date: string; mode: RecurringMode; force?: boolean }): IssueResult {
  requireAccess('doc.create');
  if (!drafts.length) throw new BatchError('Pick at least one party.');
  const keys = drafts.map((d) => d.party.key);
  const key = runKey(opts.sourceId, opts.date, keys);
  const prior = batchRunsDb.all().find((r) => r.run_key === key && r.status !== 'undone');
  if (prior && !opts.force) throw new BatchError(`This batch was already issued on ${prior.created_at.slice(0, 10)} (${prior.invoice_ids.length} invoices). Undo that run first, or choose "Issue again".`);
  const runId = generateId();
  return withTablesRollback([KEYS.invoices, BATCH_RUNS_TABLE, KEYS.clients, KEYS.items], () => {
    const saved: InvoiceRecord[] = [];
    const held: IssueResult['held'] = [];
    for (const d of drafts) {
      // The due date keeps its distance from the issue date when the run is dated differently from the preview.
      const termDays = Math.max(Math.round((Date.parse(`${d.record.due_date}T00:00:00Z`) - Date.parse(`${d.record.issue_date}T00:00:00Z`)) / 864e5) || 0, 0);
      const rec: InvoiceRecord = { ...d.record, issue_date: opts.date, due_date: addDays(opts.date, termDays), status: opts.mode === 'issue' ? 'Sent' : 'Draft', batch_run_id: runId };
      let reason = '';
      if (rec.status !== 'Draft') {
        const issues = liveDocTrackingIssues(rec);
        const problems = [...issues.errors, ...issues.expired];
        if (problems.length) {
          reason = problems.join(' ');
          rec.status = 'Draft';
        }
      }
      // Number on issue (QA5-2 F15): a draft stays unnumbered until it is issued.
      rec.invoice_number = rec.status === 'Draft' ? '' : localDb.invoices.nextNumber(opts.date, rec.doc_type, rec.sender?.invoicePrefix || undefined);
      const out = localDb.invoices.save(rec);
      if (!reason && opts.mode === 'issue' && out.approval?.state === 'pending') reason = out.approval.reason === 'credit' ? 'Held: over the credit limit (owner approval).' : 'Held for approval.';
      if (reason) held.push({ invoice: out, reason });
      saved.push(out);
    }
    const run: BatchRun = {
      id: runId, created_at: new Date().toISOString(), date: opts.date, source_id: opts.sourceId, source_kind: opts.sourceKind,
      ...(opts.sourceLabel ? { source_label: opts.sourceLabel } : {}),
      party_keys: keys, invoice_ids: saved.map((s) => s.id), ...(held.length ? { held_ids: held.map((h) => h.invoice.id) } : {}),
      totals: { count: saved.length, taxable: round2(saved.reduce((s, i) => s + num(i.taxable_value), 0)), total: round2(saved.reduce((s, i) => s + num(i.total), 0)) },
      mode: opts.mode, status: 'done', run_key: key,
    };
    setTable(BATCH_RUNS_TABLE, [...batchRunsDb.all(), run]);
    return { run, invoices: saved, held };
  });
}

export interface UndoResult {
  removed: number;
  cancelled: number;
  /** Issued invoices left as they are (no cancel reason given, or they could not be cancelled). */
  kept: InvoiceRecord[];
}

/**
 * Undo a run: its drafts are deleted; issued invoices are cancelled with `cancelReason` (never deleted),
 * or kept and listed when no reason is given. All or nothing.
 */
export function undoBatch(runId: string, opts: { cancelReason?: string } = {}): UndoResult {
  const run = batchRunsDb.get(runId);
  if (!run) throw new BatchError('Batch run not found.');
  if (run.status === 'undone') throw new BatchError('This run was already undone.');
  return withTablesRollback([KEYS.invoices, KEYS.transactions, 'doc_links', BATCH_RUNS_TABLE], () => {
    let removed = 0;
    let cancelled = 0;
    const kept: InvoiceRecord[] = [];
    for (const id of run.invoice_ids) {
      const inv = localDb.invoices.getById(id);
      if (!inv || inv.status === 'Cancelled') continue;
      if (inv.status === 'Draft') {
        localDb.invoices.remove(id);
        removed++;
      } else if (clean(opts.cancelReason)) {
        cancelDocument(inv, clean(opts.cancelReason));
        cancelled++;
      } else {
        kept.push(inv);
      }
    }
    const status: BatchRun['status'] = kept.length ? 'partly_undone' : 'undone';
    setTable(BATCH_RUNS_TABLE, batchRunsDb.all().map((r) => (r.id === runId ? { ...r, status, undone_at: new Date().toISOString() } : r)));
    return { removed, cancelled, kept };
  });
}

/** "Save as batch recurring": one recurring schedule per party (no change to the recurring schema). */
export function batchToRecurring(template: RecurringTemplate, parties: readonly BatchParty[], rule: {
  name: string; frequency: Frequency; interval?: number; start_date: string; due_in_days?: number; mode?: RecurringMode;
}): number {
  if (!parties.length) throw new BatchError('Pick at least one party.');
  const drafts = buildBatchDrafts(template, parties, { date: rule.start_date, dueDays: rule.due_in_days ?? 14 });
  return withTablesRollback([RECURRING_TABLE], () => {
    for (const d of drafts) {
      const t = templateFromInvoice(d.record);
      recurringDb.save(createSchedule({ ...rule, name: `${clean(rule.name) || 'Batch'} — ${d.party.client.name}`, template: t }));
    }
    return drafts.length;
  });
}
