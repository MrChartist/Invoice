/**
 * R19-D1 overseas-agent accounts (pure; family `f-logistics`). An agent is a client + vendor pair (`Vendor.client_id`,
 * R15-A) with `Vendor.lg = { kind, foreign }`. "Debit agent": our note to the agent in its currency for a job (profit
 * share, freight, other) — an export of services (POS outside India by Sec 13(2), zero-rated under the LUT when one
 * covers the date, else IGST paid; LG3, LG30). "Agent's bill": their charges to us, booked in ₹ at the typed rate as an
 * import of services under reverse charge (IGST at the head's rate, ITC; LG17), the foreign amount kept in `lg.fx`.
 * The statement sets our open notes against their open bills in the currency, per month; a typed / imported statement
 * of the agent's (job or house bill, amount) is matched by job and the differences listed. Settlement (`lg-d-save.ts`)
 * nets the matched amount with the R15-A markers. Working papers — verify with your CA (LG3, LG17, LG30, LG31).
 */
import { round2 } from '../invoice-calc';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import type { LgHeadKind, LgJob, LgMode } from '../../types/logistics-r19';
import { lgRateFor, sacFor } from './lg-heads';
import { lgdT } from '../../i18n/areas/logistics-r19d';
import { lgDoc, periodOf, svcLine, type DocCtx } from './lg-doc';

export type AgentKind = NonNullable<Vendor['lg']>['kind'];
export const AGENT_KINDS: readonly AgentKind[] = ['agent', 'shipping_line', 'airline', 'co_loader', 'cfs', 'transporter', 'other'];
export const NOTE_KINDS = ['profit_share', 'freight', 'other'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface Agent { vendor: Vendor; client?: Client }
/** Vendors with a logistics role, each with its client (the netting pair). */
export const lgAgents = (vendors: readonly Vendor[], clients: readonly Client[]): Agent[] =>
  vendors.filter((v) => v?.lg).map((vendor) => ({ vendor, client: vendor.client_id ? clients.find((c) => c.id === vendor.client_id) : undefined }));

const FREIGHT: Partial<Record<LgMode, LgHeadKind>> = { air: 'freight_air', sea_fcl: 'freight_sea', sea_lcl: 'freight_sea', rail: 'freight_rail', multimodal: 'freight_multimodal', courier: 'courier', road: 'freight_road' };
const headOf = (k: NoteKind, job?: LgJob): LgHeadKind => (k === 'freight' ? FREIGHT[job?.mode ?? 'air'] ?? 'other' : k === 'profit_share' ? 'commission' : 'other');
const jobText = (j?: LgJob) => (j ? [`Job ${j.number}`, `${j.origin} → ${j.destination}`, j.refs.hawb || j.refs.hbl].filter(Boolean).join(' · ') : '');

export interface NoteInput { agent: Agent; job?: LgJob; kind: NoteKind; amount: number; currency: string; rate: number; lut?: { lut_number: string; lut_date: string } | null }
/** "Debit agent": the document in the agent's currency (export of services; LUT → zero-rated). */
export function agentNote(i: NoteInput, ctx: DocCtx): InvoiceRecord {
  if (!i.agent.client) throw new Error(lgdT('eAgentClient'));
  const head = headOf(i.kind, i.job);
  const name = i.kind === 'profit_share' ? 'Profit share' : i.kind === 'freight' ? 'Freight' : 'Other charges';
  const item = svcLine(name, jobText(i.job), i.amount, sacFor(head, ctx.date), lgRateFor(head, ctx.date, i.job?.legs)?.rate ?? 18);
  return lgDoc(ctx, i.agent.client, [item], '96', {
    currency: i.currency.toUpperCase(), exchange_rate: i.rate, supply_type: i.lut ? 'EXPORT_LUT' : 'EXPORT_WITH_PAYMENT', ...(i.lut ?? {}),
    notes: `${name} — ${jobText(i.job)}`.trim(),
    lg: {
      ...(i.job ? { job_id: i.job.id, job_no: i.job.number } : {}), agent: { id: i.agent.vendor.id, name: i.agent.vendor.name, kind: i.kind }, regime: i.lut ? 'export_lut' : 'export_igst',
      fx: { currency: i.currency.toUpperCase(), rate: i.rate }, pos_reason: `Place of supply: the recipient's location outside India (96) — Sec 13(2) IGST Act; export of services${i.lut ? ` under LUT ${i.lut.lut_number}` : ''}.`,
    },
  });
}

export interface BillInput { agent: Agent; job: LgJob; bill_no: string; date: string; amount: number; currency: string; rate: number; gst_rate?: number; home: string }
/** "Agent's bill": an import of services under reverse charge, booked in ₹ (`total` = taxable + IGST, the supplier is owed the taxable). */
export function agentBill(i: BillInput, id: string): PurchaseRecord {
  const taxable = round2(i.amount * i.rate), gst = i.gst_rate ?? 18, igst = round2((taxable * gst) / 100);
  return {
    id, kind: 'EXPENSE', vendor_id: i.agent.vendor.id, vendor_name: i.agent.vendor.name, bill_number: i.bill_no.trim(), date: i.date, place_of_supply: i.home, category: 'Freight & forwarding',
    lines: [{ id: `${id}-1`, name: `Agent charges — ${jobText(i.job)}`, unit: 'NOS', quantity: 1, rate: taxable, tax_rate: gst }],
    taxable, cgst: 0, sgst: 0, igst, itc_eligible: true, reverse_charge: true, import_type: 'SERVICES', total: round2(taxable + igst), amount_paid: 0,
    notes: `${i.currency.toUpperCase()} ${i.amount.toFixed(2)} @ ₹${i.rate}`, created_at: new Date().toISOString(), lg: { job_id: i.job.id, fx: { currency: i.currency.toUpperCase(), amount: round2(i.amount), rate: i.rate } },
  };
}

export interface OpenItem { id: string; number: string; date: string; job_id?: string; open: number; rate: number; cur: string }
/** Our open notes to the agent (live, in their currency). */
export const agentNotes = (a: Agent, invoices: readonly InvoiceRecord[]): OpenItem[] => invoices
  .filter((i) => i.lg?.agent?.id === a.vendor.id && i.status !== 'Cancelled' && i.status !== 'Draft' && round2(i.total - (i.amount_paid ?? 0)) > 0.004)
  .map((i) => ({ id: i.id, number: i.invoice_number, date: i.issue_date, job_id: i.lg?.job_id, open: round2(i.total - (i.amount_paid ?? 0)), rate: i.exchange_rate ?? 1, cur: (i.currency || 'INR').toUpperCase() }));
/** Their open bills (the supplier's side: total less the reverse-charge tax, less paid), in the bill's currency. */
export const agentBills = (a: Agent, purchases: readonly PurchaseRecord[]): OpenItem[] => purchases
  .filter((b) => b.vendor_id === a.vendor.id && b.lg?.fx && b.status !== 'draft')
  .map((b) => { const owed = round2(b.total - (b.reverse_charge ? b.cgst + b.sgst + b.igst : 0)), fx = b.lg!.fx!; return { id: b.id, number: b.bill_number, date: b.date, job_id: b.lg!.job_id, open: round2((fx.amount * Math.max(owed - (b.amount_paid ?? 0), 0)) / (owed || 1)), rate: fx.rate, cur: fx.currency }; })
  .filter((b) => b.open > 0.004);

export interface Statement { notes: OpenItem[]; bills: OpenItem[]; ours: number; theirs: number; net: number }
/** Open notes vs open bills (all, or one `YYYY-MM`); `net` > 0 = the agent owes us. */
export function agentStatement(a: Agent, invoices: readonly InvoiceRecord[], purchases: readonly PurchaseRecord[], period?: string): Statement {
  const inP = (x: OpenItem) => !period || periodOf(x.date) === period;
  const by = (x: OpenItem, y: OpenItem) => x.date.localeCompare(y.date);
  const notes = agentNotes(a, invoices).filter(inP).sort(by), bills = agentBills(a, purchases).filter(inP).sort(by);
  const ours = round2(notes.reduce((s, x) => s + x.open, 0)), theirs = round2(bills.reduce((s, x) => s + x.open, 0));
  return { notes, bills, ours, theirs, net: round2(ours - theirs) };
}

/**
 * Match the agent's statement (rows of job no. / house bill and the net they show for it: + we owe them, − they owe
 * us) against ours by job. `diff` lists jobs whose amounts differ or that one side lacks.
 */
export function matchStatement(rows: readonly { ref: string; amount: number }[], st: Statement, jobs: readonly LgJob[]): { matched: number; diff: { ref: string; ours: number; theirs: number }[] } {
  const keyOf = (ref: string) => { const r = ref.trim().toUpperCase(); return jobs.find((j) => j.number.toUpperCase() === r || [j.refs.hbl, j.refs.hawb].some((h) => h && h.toUpperCase() === r))?.id ?? `?${r}`; };
  const ours = new Map<string, number>();
  for (const x of st.bills) ours.set(x.job_id ?? '', round2((ours.get(x.job_id ?? '') ?? 0) + x.open));
  for (const x of st.notes) ours.set(x.job_id ?? '', round2((ours.get(x.job_id ?? '') ?? 0) - x.open));
  const theirs = new Map<string, number>();
  for (const r of rows) theirs.set(keyOf(r.ref), round2((theirs.get(keyOf(r.ref)) ?? 0) + r.amount));
  const no = (id: string) => (id.startsWith('?') ? id.slice(1) : jobs.find((j) => j.id === id)?.number ?? id);
  const diff = [...new Set([...ours.keys(), ...theirs.keys()])].map((k) => ({ ref: no(k), ours: ours.get(k) ?? 0, theirs: theirs.get(k) ?? 0 })).filter((d) => Math.abs(d.ours - d.theirs) > 0.004);
  return { matched: round2(Math.min(st.ours, st.theirs)), diff };
}

/** Pair the notes and bills oldest first for `amount` (in the currency): one (note, bill, amount) per receipt row. */
export function pairAgent(notes: readonly OpenItem[], bills: readonly OpenItem[], amount: number): { note: OpenItem; bill: OpenItem; amount: number }[] {
  const out: { note: OpenItem; bill: OpenItem; amount: number }[] = [], left = bills.map((b) => b.open);
  let rest = round2(amount), j = 0;
  for (const note of notes) {
    let take = round2(Math.min(note.open, rest));
    while (take > 0.004 && j < bills.length) {
      const a = round2(Math.min(take, left[j]));
      if (a > 0.004) out.push({ note, bill: bills[j], amount: a });
      left[j] = round2(left[j] - a); take = round2(take - a); rest = round2(rest - a);
      if (left[j] <= 0.004) j++;
    }
    if (rest <= 0.004) break;
  }
  return out;
}
