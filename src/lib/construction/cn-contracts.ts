/**
 * CN-B1: the contract register (table `works_contracts`). One contract per BOQ; its particulars reach every RA bill
 * through CN-A's header snapshot (`contractOfBoq` reads `boq_id`, the `ContractLike` field names are kept), and its
 * terms (retention / SD / water + electricity %, advances, LD, escalation) win over the BOQ's deduction set.
 * Delay meter and LD exposure are informational only — the LD the client actually deducts is typed on the bill (B4).
 * Working paper — verify with your CA.
 */
import type { DeductionRule } from '../../types/transport-works-r5';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { WorksContract } from '../../types/construction-r11';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { ruleAt } from '../tax-rules';
import { ADVANCE_DEFAULTS } from '../construction-rules';
import { raDueSplit } from '../works/ra-due';
import { movedNoCash } from '../advance-tax';
import './cn-registry';

export const CONTRACTS_TABLE = 'works_contracts';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const utc = (d: string) => (DAY.test(d ?? '') ? Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5 : NaN);
/** Whole days from `a` to `b` (local `YYYY-MM-DD`; 0 when either is missing). */
export const daysBetween = (a: string | undefined, b: string | undefined): number => {
  const n = utc(b ?? '') - utc(a ?? '');
  return Number.isFinite(n) ? n : 0;
};

/** `YYYY-MM-DD` + whole months (day clamped to the month's end). */
export function plusMonths(d: string, months: number): string {
  const t = +d.slice(0, 4) * 12 + +d.slice(5, 7) - 1 + Math.round(months);
  const y = Math.floor(t / 12);
  const m = (t % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(+d.slice(8, 10), new Date(y, m, 0).getDate())).padStart(2, '0')}`;
}

export const loadContracts = (): WorksContract[] => peekTable<WorksContract>(CONTRACTS_TABLE).filter((c) => c && typeof c.id === 'string');
export const contractById = (id: string | undefined) => loadContracts().find((c) => c.id === id);

/** Latest completion date in force (stipulated, or the last EOT). */
export const latestCompletion = (c: Pick<WorksContract, 'stipulated_completion' | 'eots'>): string => [c.stipulated_completion ?? '', ...(c.eots ?? []).map((e) => e.upto)].sort().pop() ?? '';

/** The date LD runs from: the stipulated completion or the last EOT granted WITHOUT LD. */
export const ldFrom = (c: Pick<WorksContract, 'stipulated_completion' | 'eots'>): string => [c.stipulated_completion ?? '', ...(c.eots ?? []).filter((e) => !e.with_ld).map((e) => e.upto)].sort().pop() ?? '';

/** Days of delay on `day` beyond the latest completion (0 when on time / completed in time / no date). */
export function delayDays(c: WorksContract, day: string): number {
  const end = latestCompletion(c);
  return end ? Math.max(daysBetween(end, c.completed_on || day), 0) : 0;
}

/** Informational LD exposure: value × % per week × weeks of delay (from `ldFrom`), capped at cap % of the value. */
export function ldExposure(c: WorksContract, day: string): number {
  const from = ldFrom(c);
  const pct = num(c.ld?.pct_per_week);
  if (!from || !(pct > 0)) return 0;
  const weeks = Math.max(daysBetween(from, c.completed_on || day), 0) / 7;
  const raw = (num(c.contract_value) * pct * weeks) / 100;
  const cap = num(c.ld?.cap_pct) > 0 ? (num(c.contract_value) * num(c.ld?.cap_pct)) / 100 : Infinity;
  return Math.round(Math.min(raw, cap));
}

const txt = (v: unknown, n = 160) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const day = (v: unknown) => (typeof v === 'string' && DAY.test(v) ? v : undefined);
const pos = (v: unknown) => (num(v) > 0 ? round2(num(v)) : undefined);
const tidy = <T extends object>(o: T): T => {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined || o[k] === '') delete o[k];
  return o;
};

/** Pure: clean / validate a contract (EOTs in date order, each after the previous date; derived fields filled). */
export function cleanContract(i: Partial<WorksContract>): WorksContract {
  const name = txt(i.name_of_work, 300);
  if (!name) throw new Error('Name of work is required.');
  if (!(num(i.contract_value) > 0)) throw new Error('Contract value must be above zero.');
  const eots = (i.eots ?? []).filter((e) => day(e?.upto)).map((e) => tidy({ upto: e.upto, ref: txt(e.ref, 60), date: day(e.date), with_ld: e.with_ld ? true : undefined })).sort((a, b) => a.upto.localeCompare(b.upto));
  let last = day(i.stipulated_completion) ?? '';
  for (const e of eots) {
    if (last && e.upto <= last) throw new Error(`Extension to ${e.upto} must be after ${last}.`);
    last = e.upto;
  }
  const d = ruleAt(ADVANCE_DEFAULTS, i.agreement_date);
  const jv = i.jv?.name?.trim() ? { name: txt(i.jv.name, 120), ...(pos(i.jv.share_pct) ? { share_pct: pos(i.jv.share_pct)! } : {}), ...(i.jv.lead ? { lead: true } : {}) } : undefined;
  return tidy<WorksContract>({
    id: i.id || generateId(),
    boq_id: i.boq_id || undefined,
    client_id: i.client_id || undefined,
    client_name: txt(i.client_name, 160),
    name_of_work: name,
    agreement_no: txt(i.agreement_no, 80), agreement_date: day(i.agreement_date),
    work_order_no: txt(i.work_order_no, 80), work_order_date: day(i.work_order_date),
    tender_ref: txt(i.tender_ref, 80), client_office: txt(i.client_office), engineer: txt(i.engineer),
    site: i.site && (i.site.address || i.site.state_code) ? tidy({ address: txt(i.site.address, 300), state_code: txt(i.site.state_code, 2) }) : undefined,
    contract_value: round2(num(i.contract_value)),
    stipulated_start: day(i.stipulated_start), stipulated_completion: day(i.stipulated_completion),
    eots: eots.length ? eots : undefined,
    extended_completion: eots.length ? eots[eots.length - 1].upto : undefined,
    ld: pos(i.ld?.pct_per_week) ? tidy({ pct_per_week: pos(i.ld?.pct_per_week), cap_pct: pos(i.ld?.cap_pct) }) : undefined,
    deviation_pct: i.deviation_pct !== undefined && String(i.deviation_pct) !== '' && num(i.deviation_pct) >= 0 ? num(i.deviation_pct) : undefined,
    dlp_months: pos(i.dlp_months) ? Math.round(num(i.dlp_months)) : undefined,
    retention_pct: pos(i.retention_pct), sd_pct: pos(i.sd_pct), water_pct: pos(i.water_pct), power_pct: pos(i.power_pct),
    government: i.government ? true : undefined,
    jv,
    jv_note: jv ? `Consortium: ${jv.name}${jv.share_pct ? ` (our share ${jv.share_pct}%)` : ''}` : undefined,
    advance_terms: (i.advance_terms ?? []).filter((t) => t?.advance_id).map((t) => tidy({
      advance_id: t.advance_id, kind: t.kind === 'plant' ? 'plant' as const : 'mobilisation' as const,
      interest_pct: t.interest_pct === undefined ? d.interest_pct : num(t.interest_pct), interest_basis: 'simple' as const,
      recover_from_pct: t.recover_from_pct === undefined ? d.recover_from_pct : num(t.recover_from_pct),
      recover_by_pct: t.recover_by_pct === undefined ? d.recover_by_pct : num(t.recover_by_pct), bg_id: t.bg_id || undefined,
    })),
    escalation: i.escalation?.components?.length ? i.escalation : undefined,
    status: i.status === 'completed' || i.status === 'closed' ? i.status : 'running',
    completed_on: day(i.completed_on),
    cost_centre_id: i.cost_centre_id || undefined,
    notes: txt(i.notes, 600),
    closure: i.closure,
    created_at: i.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

/** Save a contract (roles; one contract per BOQ). Audited through the table's edit log. */
export function saveContract(i: Partial<WorksContract>): WorksContract {
  requireAccess('master.edit');
  const c = cleanContract(i);
  const all = getTable<WorksContract>(CONTRACTS_TABLE);
  if (c.boq_id && all.some((x) => x.id !== c.id && x.boq_id === c.boq_id)) throw new Error('This BOQ already has a contract.');
  if (c.advance_terms?.some((t, n) => c.advance_terms!.findIndex((x) => x.advance_id === t.advance_id) !== n)) throw new Error('An advance is linked twice.');
  setTable(CONTRACTS_TABLE, all.some((x) => x.id === c.id) ? all.map((x) => (x.id === c.id ? c : x)) : [...all, c]);
  return c;
}

/** Delete a contract that has no RA bill yet (the recycle bin keeps it). */
export function deleteContract(id: string, invoices: readonly InvoiceRecord[]): void {
  requireAccess('master.edit');
  const c = contractById(id);
  if (c?.boq_id && invoices.some((i) => i.boq_id === c.boq_id && num(i.ra_no) > 0 && i.status !== 'Cancelled')) throw new Error('This contract has RA bills; close it instead.');
  setTable(CONTRACTS_TABLE, getTable<WorksContract>(CONTRACTS_TABLE).filter((x) => x.id !== id));
}

/** Live RA bills of a contract (its BOQ's stage invoices with an RA number). */
export const contractBills = (c: Pick<WorksContract, 'boq_id'>, invoices: readonly InvoiceRecord[]): InvoiceRecord[] =>
  c.boq_id ? invoices.filter((i) => i.boq_id === c.boq_id && num(i.ra_no) > 0 && i.status !== 'Cancelled' && i.status !== 'Draft').sort((a, b) => num(a.ra_no) - num(b.ra_no)) : [];

/** Contract deduction rules: the contract's retention / SD / water + electricity % win over the BOQ's set. */
export function contractRules(rules: readonly DeductionRule[], c?: WorksContract): DeductionRule[] {
  if (!c) return [...rules];
  const out = [...rules];
  const put = (kind: DeductionRule['kind'], rate: number | undefined, label?: string) => {
    if (!(num(rate) > 0)) return;
    const n = out.findIndex((r) => r.kind === kind);
    const row: DeductionRule = { ...(n >= 0 ? out[n] : {}), kind, rate: num(rate), ...(label ? { label } : {}) };
    if (n >= 0) out[n] = row;
    else out.push(row);
  };
  put('retention', c.retention_pct);
  put('security_deposit', c.sd_pct);
  put('water_power', num(c.water_pct) + num(c.power_pct), `Water & electricity charges ${num(c.water_pct)}% + ${num(c.power_pct)}%`);
  return out;
}

export interface ContractSummary {
  billed: number;
  pct: number;
  received: number;
  retention: number;
  delay: number;
  daysLeft: number;
  ld: number;
}

/** Register row: billed (value before GST), % billed, money received, retention held, days left / delay, LD exposure. */
export function contractSummary(c: WorksContract, invoices: readonly InvoiceRecord[], payments: readonly Payment[], today: string): ContractSummary {
  const bills = contractBills(c, invoices);
  const billed = round2(bills.reduce((s, b) => s + num(b.taxable_value), 0));
  let received = 0;
  let retention = 0;
  for (const b of bills) {
    const mine = payments.filter((p) => p.invoice_id === b.id);
    received += mine.filter((p) => !movedNoCash(p)).reduce((s, p) => s + num(p.amount), 0);
    const out = num(b.ra_net_payable ?? b.total) + (b.ra_deductions ?? []).filter((d) => d.kind !== 'it_tds').reduce((s, d) => s + d.amount, 0) - mine.reduce((s, p) => s + num(p.amount), 0);
    retention += raDueSplit(b, mine, out).held.filter((h) => h.kind === 'retention').reduce((s, h) => s + h.amount, 0);
  }
  const end = latestCompletion(c);
  return {
    billed, pct: num(c.contract_value) > 0 ? round2((billed / num(c.contract_value)) * 100) : 0, received: round2(received), retention: round2(retention),
    delay: delayDays(c, today), daysLeft: end && !c.completed_on ? Math.max(daysBetween(today, end), 0) : 0, ld: ldExposure(c, today),
  };
}
