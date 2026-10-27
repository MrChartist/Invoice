/**
 * SV-A5 payer split and claims (table `payer_claims`, `doc.create`, audited "Payer claim", dated `date`, numbered
 * `CLM/FY…`). A job / admission / appointment billed partly to a payer (insurer, TPA, employer) becomes TWO ordinary
 * invoices: the payer's for the approved amount (with the beneficiary, policy and claim no. on paper — record
 * `sv.claim`) and the beneficiary's for the rest (depreciation, excess, non-covered, disallowed lines). Both go through
 * the usual save (period lock, numbering, snapshot; the insurer with a GSTIN reports in B2B). A short payment is written
 * off with reason "Claim deduction"; a rejection re-bills the beneficiary and CANCELS the payer invoice (never deletes).
 * Working papers — verify with your CA (SV9, SV22).
 */
import './sv-registry';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { PayerClaim, SvClaimPart } from '../../types/services-r10';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { assertUnlocked } from '../period-lock';
import { buildBillDraft } from '../timesheets';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { cancelDocument } from '../documents';
import { writeOffBill } from '../write-off';
import { todayInput } from '../utils';
import { SV_SERIES, SV_TABLES } from './sv-shared';

export const CLM = SV_SERIES.claims;
export const loadClaims = (): PayerClaim[] => getTable<PayerClaim>(SV_TABLES.claims).filter((c) => !!c && typeof c.id === 'string');

export interface SplitApproval {
  /** Per head: the approved amount, GST included (lines are scaled by approved ÷ job total). */
  approved?: number;
  /** Job total incl. GST (per-head factor). */
  total?: number;
  /** Per line: approved TAXABLE value by line id (lines not listed are not covered). */
  perLine?: Readonly<Record<string, number>>;
  /** Why the beneficiary pays each line's remainder (default: per line `disallowed`, per head `excess`). */
  parts?: Readonly<Record<string, SvClaimPart>>;
}

const lineValue = (l: InvoiceItem) => round2(num(l.quantity) * num(l.rate) * (1 - num(l.discount_percent) / 100));
const withValue = (l: InvoiceItem, value: number, part: SvClaimPart): InvoiceItem => {
  const qty = num(l.quantity) || 1;
  const rate = round2(value / qty / (1 - num(l.discount_percent) / 100 || 1));
  return { ...l, id: generateId(), rate, amount: round2(rate * qty), sv: { ...l.sv, claim_part: part } };
};

/**
 * Pure: split job lines between the payer and the beneficiary. Each line's value is divided exactly (the beneficiary
 * part is the remainder), so the two bills add up to the job; zero-value parts are dropped.
 */
export function splitForPayer(lines: readonly InvoiceItem[], a: SplitApproval): { payer: InvoiceItem[]; beneficiary: InvoiceItem[] } {
  const payer: InvoiceItem[] = [];
  const beneficiary: InvoiceItem[] = [];
  const f = a.perLine ? 0 : Math.min(1, Math.max(0, num(a.total) > 0 ? num(a.approved) / num(a.total) : 0));
  for (const l of lines) {
    const v = lineValue(l);
    const ap = a.perLine ? Math.min(v, Math.max(0, num(a.perLine[l.id]))) : round2(v * f);
    const rest = round2(v - ap);
    if (ap > 0) payer.push(withValue(l, ap, 'approved'));
    if (rest > 0) beneficiary.push(withValue(l, rest, a.parts?.[l.id] ?? (a.perLine ? 'disallowed' : 'excess')));
  }
  return { payer, beneficiary };
}

/** Grand total of lines on a document like `base` (GST by the document's own mode). */
export function linesTotal(base: InvoiceRecord, items: InvoiceItem[]): number {
  return calculateInvoice(calcInputFromRecord({ ...base, items })).total;
}

export type ClaimInput = Omit<PayerClaim, 'id' | 'number' | 'created_at' | 'status'> & { id?: string; status?: PayerClaim['status'] };

/** Intimate a claim (new number) or edit it. */
export function saveClaim(i: ClaimInput): PayerClaim {
  requireAccess('doc.create');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new Error('Choose the claim date.');
  if (!i.payer_name.trim() || !i.beneficiary_name.trim()) throw new Error('Choose the payer and the beneficiary.');
  if (num(i.approved) < 0 || num(i.estimate) < 0) throw new Error('Amounts cannot be negative.');
  const all = loadClaims();
  const prev = i.id ? all.find((c) => c.id === i.id) : undefined;
  if (prev) {
    const row: PayerClaim = { ...prev, ...i, id: prev.id, number: prev.number, status: i.status ?? prev.status, updated_at: new Date().toISOString() };
    setTable(SV_TABLES.claims, all.map((c) => (c.id === row.id ? row : c)));
    return row;
  }
  const number = nextSeriesNumberFor(CLM, i.date, all.map((c) => c.number));
  const row: PayerClaim = { ...i, id: generateId(), number, status: i.status ?? (num(i.approved) > 0 ? 'approved' : 'intimated'), created_at: new Date().toISOString() };
  return withTablesRollback([SV_TABLES.claims, 'series_counters'], () => {
    setTable(SV_TABLES.claims, [...all, row]);
    recordSeries(number);
    return row;
  });
}

/** Data-layer delete (recycle bin). A claim with bills cannot be deleted; its number stays used. */
export function deleteClaim(id: string): void {
  requireAccess('doc.create');
  const c = loadClaims().find((x) => x.id === id);
  if (c?.payer_invoice_id || c?.beneficiary_invoice_id) throw new Error('This claim has bills. Cancel the bills instead.');
  setTable(SV_TABLES.claims, loadClaims().filter((x) => x.id !== id));
}

const clientOf = (id: string | undefined, name: string): Client => (id ? localDb.clients.getById(id) : undefined) ?? { ...blankClient(), name };

/** A claim bill; `reuse` (the job's own draft) keeps its id and number, so no number of the series is skipped. */
function draftFor(claim: PayerClaim, role: 'payer' | 'beneficiary', items: InvoiceItem[], date: string, reuse?: InvoiceRecord): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = reuse ?? { ...makeDraft({ settings, sender, docType: 'INVOICE', templateId: localDb.template.get() }), id: generateId() };
  const client = role === 'payer' ? clientOf(claim.payer_id, claim.payer_name) : clientOf(claim.beneficiary_id, claim.beneficiary_name);
  const draft = buildBillDraft({ ...base, issue_date: date }, client, items, sender);
  const sv = { claim: { id: claim.id, number: claim.number, role, ...(claim.policy_no ? { policy_no: claim.policy_no } : {}), ...(claim.claim_no ? { claim_no: claim.claim_no } : {}), beneficiary: claim.beneficiary_name, payer: claim.payer_name } };
  const note = `Part of claim ${claim.number}${claim.claim_no ? ` (claim no. ${claim.claim_no})` : ''}${role === 'payer' ? ` — insured / patient: ${claim.beneficiary_name}${claim.policy_no ? `, policy ${claim.policy_no}` : ''}` : ` — balance after ${claim.payer_name}'s approval`}.`;
  return { ...draft, sv: { ...draft.sv, ...sv }, notes: [note, draft.notes].filter(Boolean).join('\n'), invoice_number: reuse?.invoice_number || localDb.invoices.nextNumber(date, draft.doc_type, sender?.invoicePrefix || undefined) };
}

/**
 * Make the two draft bills of a claim from the job lines; the claim becomes `billed`. With `reuse` (the job's draft
 * bill), that draft becomes the beneficiary's bill. Returns the saved drafts.
 */
export function billClaim(claimId: string, lines: readonly InvoiceItem[], a: SplitApproval, date = todayInput(), reuse?: InvoiceRecord): { payer?: InvoiceRecord; beneficiary?: InvoiceRecord } {
  requireAccess('doc.create');
  const claim = loadClaims().find((c) => c.id === claimId);
  if (!claim) throw new Error('Claim not found.');
  if (claim.payer_invoice_id || claim.beneficiary_invoice_id) throw new Error(`Claim ${claim.number} is already billed.`);
  const split = splitForPayer(lines, a);
  if (!split.payer.length && !split.beneficiary.length) throw new Error('Nothing to bill.');
  assertUnlocked({ issue_date: date, invoice_number: claim.number }, 'create');
  return withTablesRollback([SV_TABLES.claims, 'invoices', 'series_counters'], () => {
    if (reuse && reuse.status !== 'Draft') throw new Error('Only a draft bill can be split.');
    // The job's draft becomes the beneficiary's bill (or the payer's when the payer takes it all).
    const toBen = split.beneficiary.length ? reuse : undefined;
    const payer = split.payer.length ? localDb.invoices.save(draftFor(claim, 'payer', split.payer, date, toBen ? undefined : reuse)) : undefined;
    const beneficiary = split.beneficiary.length ? localDb.invoices.save(draftFor(claim, 'beneficiary', split.beneficiary, date, toBen)) : undefined;
    setTable(SV_TABLES.claims, loadClaims().map((c) => (c.id === claim.id ? { ...c, status: 'billed' as const, payer_invoice_id: payer?.id, beneficiary_invoice_id: beneficiary?.id, updated_at: new Date().toISOString() } : c)));
    return { payer, beneficiary };
  });
}

/** Outstanding of the payer's bill (claims desk, with age in days). */
export function claimOutstanding(c: PayerClaim, invoices: readonly InvoiceRecord[], today: string): { due: number; age: number } {
  const inv = invoices.find((i) => i.id === c.payer_invoice_id);
  if (!inv || inv.status === 'Cancelled') return { due: 0, age: 0 };
  const due = round2(num(inv.balance_due ?? num(inv.total) - num(inv.amount_paid)));
  const [y, m, d] = String(inv.issue_date).slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return { due, age: Math.max(0, Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000)) };
}

/** Short payment: write off the payer bill's balance (reason "Claim deduction"); the claim becomes `short_paid`. */
export function writeOffShort(claimId: string, date = todayInput()): void {
  requireAccess('doc.create');
  const c = loadClaims().find((x) => x.id === claimId);
  if (!c?.payer_invoice_id) throw new Error('This claim has no payer bill.');
  writeOffBill(c.payer_invoice_id, { date, reason: `Claim deduction (${c.number})` });
  setTable(SV_TABLES.claims, loadClaims().map((x) => (x.id === c.id ? { ...x, status: 'short_paid' as const, updated_at: new Date().toISOString() } : x)));
}

/** Rejection: bill the beneficiary for the payer bill's lines and cancel the payer bill (never deleted). */
export function rejectAndRebill(claimId: string, reason: string, date = todayInput()): InvoiceRecord {
  requireAccess('doc.create');
  if (!reason.trim()) throw new Error('Give the rejection reason.');
  const c = loadClaims().find((x) => x.id === claimId);
  const payerInv = c?.payer_invoice_id ? localDb.invoices.getById(c.payer_invoice_id) : undefined;
  if (!c || !payerInv) throw new Error('This claim has no payer bill.');
  return withTablesRollback([SV_TABLES.claims, 'invoices', 'doc_links', 'series_counters'], () => {
    const rebill = localDb.invoices.save(draftFor(c, 'beneficiary', payerInv.items.map((l) => ({ ...l, id: generateId(), sv: { ...l.sv, claim_part: 'non_covered' as const } })), date));
    if (payerInv.status !== 'Cancelled') cancelDocument(payerInv, `Claim ${c.number} rejected: ${reason.trim()}`, { acknowledgePayments: true });
    setTable(SV_TABLES.claims, loadClaims().map((x) => (x.id === c.id ? { ...x, status: 'rejected' as const, rebill_invoice_id: rebill.id, notes: [x.notes, `Rejected: ${reason.trim()}`].filter(Boolean).join('\n'), updated_at: new Date().toISOString() } : x)));
    return rebill;
  });
}

/** Mark paid (the receipt itself is recorded on the bill as usual). */
export function markClaimPaid(claimId: string): void {
  requireAccess('doc.create');
  setTable(SV_TABLES.claims, loadClaims().map((x) => (x.id === claimId ? { ...x, status: 'paid' as const, updated_at: new Date().toISOString() } : x)));
}
