/**
 * R19-C1 / C3 disbursements on the client's behalf (pure; family `f-logistics`). A disbursement (customs duty paid
 * through our ICEGATE account, CFS / port / DO / shipping-line charges invoiced in the importer's name …) is an ordinary
 * expense row of `purchases` (the R14 PS-B1 precedent) with `PurchaseRecord.lg = { job_id, disb, on_behalf: true, ref?,
 * in_client_name? }`, no GST claimed, billable to the job's client as a pure agent — so the invoice editor's billable
 * costs and B's charge sheet bill it as a Rule 33 line (`charge_head_id: 'rule33'`, `bill_refs: [id]`) that GSTR-1 /
 * e-Invoice / e-Way leave out. Billed state is derived from live invoices (cancelling one frees the row); a write-off
 * stamps `lg.wo`. The ledger stays gross (LG11). Rows come in through `lg-recv-io.ts` (`readPurchase`). Working papers —
 * verify with your CA (LG10, LG11, LG36, LG37).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { LgCharge, LgHead, LgHeadKind, LgJob, LgSnapshot } from '../../types/logistics-r19';
import type { PurchaseRecord } from '../../types/purchases';
import { generateId } from '../storage';
import { round2 } from '../invoice-calc';
import { lgcT } from '../../i18n/areas/logistics-r19c';

export type LgDisbKind = NonNullable<NonNullable<PurchaseRecord['lg']>['disb']>;
export const LG_DISB_KINDS: readonly LgDisbKind[] = ['duty', 'cfs', 'port', 'do', 'shipping_line', 'insurance', 'other'];
/** Paper / ledger text (documents print in English). */
const LABEL: Record<LgDisbKind, string> = { duty: 'Customs duty', cfs: 'CFS charges', port: 'Port charges', do: 'DO charges', shipping_line: 'Shipping line charges', insurance: 'Cargo insurance', other: 'Other charges' };
export const disbLabel = (k: string): string => LABEL[k as LgDisbKind] ?? k;
export const DISB_CATEGORY = 'Disbursements on behalf of clients';

export interface DisbInput {
  job: Pick<LgJob, 'id' | 'number' | 'client_id'>;
  kind: LgDisbKind;
  payee: string;
  ref?: string;
  amount: number;
  date: string;
  /** Rule 33 limb (iv): the CFS / DO / line invoice or the duty challan is in the client's name, at actual. */
  in_client_name?: boolean;
}

/** Errors that stop the save (first one shown). */
export function validateDisb(i: DisbInput): string[] {
  const e: string[] = [];
  if (!i.job?.id || !i.job.client_id) e.push(lgcT('pick'));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date ?? '')) e.push(lgcT('eDate'));
  if (!i.payee?.trim()) e.push(lgcT('ePayee'));
  if (!(round2(Number(i.amount) || 0) > 0)) e.push(lgcT('eAmount'));
  return e;
}

/** The expense row: one 0 % line, no ITC, billable to the job's client as a pure agent, ledger category "on behalf". */
export function disbRecord(i: DisbInput): Omit<PurchaseRecord, 'id'> {
  const amount = round2(Number(i.amount) || 0);
  const ref = i.ref?.trim();
  const lg: NonNullable<PurchaseRecord['lg']> = { job_id: i.job.id, disb: i.kind, on_behalf: true, ...(ref ? { ref } : {}), ...(i.in_client_name ? { in_client_name: true } : {}) };
  return {
    kind: 'EXPENSE', vendor_name: i.payee.trim(), bill_number: ref || i.job.number, date: i.date, category: DISB_CATEGORY,
    lines: [{ id: generateId(), name: `${LABEL[i.kind]}: ${i.job.number}`, quantity: 1, rate: amount, tax_rate: 0 }],
    taxable: amount, cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: amount, amount_paid: 0,
    billable_to_client_id: i.job.client_id, pure_agent: true, notes: `Paid on the client's behalf: job ${i.job.number}`, lg,
  };
}

/**
 * The Rule 33 limbs not met (LG10): (i) the job holds the client's authorisation, (ii) shown separately — always, the
 * line is a `rule33` line, (iii) in addition to our own services, (iv) actual amount in the client's name. Warns, never blocks.
 */
export function rule33Gaps(x: { auth?: LgJob['auth']; extra: boolean; inName: boolean }): number[] {
  return [!(x.auth?.ref?.trim() || x.auth?.date) && 1, !x.extra && 3, !x.inName && 4].filter((n): n is number => !!n);
}

/** One purchases row as the bridge reads it through `readPurchase` (void rows flagged). */
export interface DisbSource { id: string; lg?: PurchaseRecord['lg']; client_id?: string; date: string; total: number; payee: string; void: boolean }

export interface LgDisbRow { id: string; job_id: string; client_id: string; date: string; kind: LgDisbKind; ref: string; payee: string; amount: number; in_client_name: boolean; billed: boolean; wo?: { date: string; reason: string; by?: string }; age: number }

const dayNo = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;

/** The disbursement rows (on behalf, tagged to a job, not void), oldest first, with billed state and age on `today`. */
export function disbRows(src: readonly DisbSource[], billed: (id: string) => boolean, today: string): LgDisbRow[] {
  const out: LgDisbRow[] = [];
  for (const s of src) {
    const lg = s.lg;
    if (!lg?.on_behalf || !lg.disb || !lg.job_id || s.void) continue;
    out.push({ id: s.id, job_id: lg.job_id, client_id: s.client_id ?? '', date: s.date, kind: lg.disb, ref: lg.ref ?? '', payee: s.payee, amount: round2(s.total), in_client_name: !!lg.in_client_name, billed: billed(s.id), ...(lg.wo ? { wo: lg.wo } : {}), age: Math.max(Math.round(dayNo(today) - dayNo(s.date)), 0) || 0 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)); // stable: same-day rows keep their entry order
}

/**
 * The billed test of a row (the invoice editor's billable-cost rule, `timesheets.ts` `billedBy`): a live (not cancelled)
 * invoice line names it in `bill_refs`, or — for an invoice without any `bill_refs` — its `rebilled_in` is live.
 */
export function billedBy(invoices: readonly Pick<InvoiceRecord, 'id' | 'status' | 'items'>[], rebilled: ReadonlyMap<string, string | undefined>): (id: string) => boolean {
  const live = new Set<string>();
  const withRefs = new Set<string>();
  const refs = new Set<string>();
  for (const inv of invoices) {
    if (!inv?.id || inv.status === 'Cancelled') continue;
    live.add(inv.id);
    for (const l of inv.items ?? []) for (const r of l.bill_refs ?? []) { refs.add(r); withRefs.add(inv.id); }
  }
  return (id) => { const by = rebilled.get(id); return refs.has(id) || (!!by && live.has(by) && !withRefs.has(by)); };
}

/** Not on a live invoice and not written off. */
export const unrecovered = (rows: readonly LgDisbRow[]): LgDisbRow[] => rows.filter((r) => !r.billed && !r.wo);
export const sumOf = (rows: readonly { amount: number }[]): number => round2(rows.reduce((s, r) => s + r.amount, 0));

/** 0–30 / 31–60 / 61–90 / > 90 days. */
export function ageBuckets(rows: readonly Pick<LgDisbRow, 'age' | 'amount'>[]): number[] {
  const out = [0, 0, 0, 0];
  for (const r of rows) {
    const k = r.age <= 30 ? 0 : r.age <= 60 ? 1 : r.age <= 90 ? 2 : 3;
    out[k] = round2(out[k] + r.amount);
  }
  return out;
}

/** The pure-agent head a disbursement kind bills under (else any active pure-agent head). */
const HEAD_KIND: Record<LgDisbKind, LgHeadKind | ''> = { duty: 'duty', cfs: 'cfs', port: 'port', do: 'do_charges', shipping_line: 'do_charges', insurance: 'insurance', other: '' };

/**
 * C3 through B's `billExtras` (`lg-bill.ts`): the job's unrecovered disbursements as charge lines of a pure-agent head
 * (one per row, at actual in rupees, `disb_id` becomes the line's `bill_refs`, `disb` its `lg.disb` row). A row with no
 * pure-agent head among the heads stays unrecovered.
 */
export function disbCharges(rows: readonly LgDisbRow[], heads: readonly LgHead[]): LgCharge[] {
  const pa = heads.filter((h) => h.active && h.role === 'pure_agent');
  return unrecovered(rows).flatMap((r) => {
    const h = pa.find((x) => x.kind === HEAD_KIND[r.kind]) ?? pa[0];
    return h ? [{ head_id: h.id, qty: 1, rate: r.amount, currency: 'INR', amount: r.amount, note: [r.ref, r.payee].filter(Boolean).join(', paid to '), disb_id: r.id, disb: { date: r.date, kind: r.kind, ...(r.ref ? { ref: r.ref } : {}), payee: r.payee, amount: r.amount } }] : [];
  });
}

/** The printed schedule (C3): rows with English labels and the total recoverable at actual. */
export function disbSchedule(lg: Pick<LgSnapshot, 'disb'>): { rows: [string, string, string, string, number][]; total: number } {
  const rows = (lg.disb ?? []).map((d): [string, string, string, string, number] => [d.date.split('-').reverse().join('/'), disbLabel(d.kind), d.ref ?? '', d.payee ?? '', round2(d.amount)]);
  return { rows, total: round2(rows.reduce((s, r) => s + r[4], 0)) };
}
