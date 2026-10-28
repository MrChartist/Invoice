/**
 * R19-B1 / B4 billing a job (pure; family `f-logistics`): the charge sheet (the job's typed lines `lg_jobs.charges`,
 * else every active head with a default rate, its quantity from the job's weights / containers / packages), and the
 * plan that turns it into documents grouped by (place of supply, currency, document kind) — `split: 'single'` puts all
 * on one and is refused when the lines need different places of supply (LG9). Each line's head is kept in
 * `lg.heads[lineId]`; pure-agent lines carry `charge_head_id: 'rule33'` and the Rule 33 text; the SAC sits in `hsn`.
 * Billed state is derived: a head on a live (not cancelled) document of the job is billed, and skipped. B4: a foreign-
 * currency line on a bill to a client in India is converted at the rate of the bill date (Rule 34(2), printed as
 * `lg.fx`); a bill to a client outside India stays in that currency with the rate on the document. Issue goes through
 * `lg-issue-io.ts` (`localDb.invoices.saveMany`). Working papers — verify with your CA.
 */
import { round2 } from '../invoice-calc';
import { lgbT } from '../../i18n/areas/logistics-r19b';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { LgCharge, LgHead, LgJob, LgSnapshot, LgUnit, LogisticsSettings } from '../../types/logistics-r19';
import { posRuleOf } from './lg-heads';
import { lgRegime, regimeHints, type LgGstMode, type LgRegime, type RegimeCtx } from './lg-regime';

export interface BillCtx extends RegimeCtx {
  heads: readonly LgHead[];
  settings: LogisticsSettings;
  /** ₹ per unit of a currency on the bill date (typed, else the currency master); null = none. */
  fx: (cur: string) => { rate: number; source: string } | null;
  /** Heads already on a live document of the job. */
  billed: ReadonlySet<string>;
  passText: string;
  newId: () => string;
}

export interface JobDraft {
  doc_type: 'TAX_INVOICE' | 'INVOICE' | 'BILL_OF_SUPPLY';
  pos: string;
  mode: LgGstMode;
  supply?: LgRegime['supply'];
  currency: string;
  exchange_rate?: number;
  items: InvoiceItem[];
  lg: LgSnapshot;
}
export interface JobPlan { drafts: JobDraft[]; skipped: string[]; errors: string[]; hints: string[] }

/** Quantity of a head's unit on a job (typed units and days start at 1). */
export function qtyOf(unit: LgUnit, j: LgJob): number {
  const n = { per_kg: j.chargeable_kg ?? j.gross_kg, per_cbm: j.cbm, per_wm: Math.ceil(Math.max(j.cbm ?? 0, (j.gross_kg ?? 0) / 1000) * 100) / 100, per_container: j.containers?.length, per_pkg: j.pkgs }[unit as 'per_kg'];
  return n || 1;
}

/** The job's charge lines: typed lines on the job, else every active head with a default rate. */
export function chargeSheet(j: LgJob, heads: readonly LgHead[]): LgCharge[] {
  if (j.charges?.length) return j.charges;
  return heads.filter((h) => h.active && (h.rate ?? 0) > 0).map((h) => { const qty = qtyOf(h.unit, j); return { head_id: h.id, qty, rate: h.rate!, currency: h.currency || 'INR', amount: round2(qty * h.rate!) }; });
}

/** Extra lines a job's bill carries beyond its charge sheet — the hook C / D fill (empty in B). */
export function billExtras(j: LgJob, ctx: BillCtx): LgCharge[] {
  void j; void ctx;
  const out: LgCharge[] = [];
  // R19-C: disbursement lines (recoveries at actual)
  // R19-D: agent notes
  return out;
}

/** The A snapshot of a job on its documents (job, refs, ports, weights). */
export const jobSnapshot = (j: LgJob): LgSnapshot => JSON.parse(JSON.stringify({ job_id: j.id, job_no: j.number, mode: j.mode, dir: j.dir, refs: j.refs, ports: { origin: j.origin, destination: j.destination, dest_country: j.dest_country }, weights: { pkgs: j.pkgs, gross_kg: j.gross_kg, chargeable_kg: j.chargeable_kg, cbm: j.cbm } }));

/** The job's live documents (not cancelled). */
export const jobDocs = (docs: readonly InvoiceRecord[], id: string) => docs.filter((d) => d.lg?.job_id === id && d.status !== 'Cancelled');

/** Heads already billed on the job's live documents (credit notes are not bills). */
export function billedHeads(docs: readonly InvoiceRecord[], id: string): Set<string> {
  return new Set(jobDocs(docs, id).filter((d) => d.doc_type !== 'CREDIT_NOTE').flatMap((d) => Object.values(d.lg?.heads ?? {})));
}

/** Billing state of a job against its sheet. */
export function billState(sheet: readonly LgCharge[], billed: ReadonlySet<string>): 'unbilled' | 'part' | 'billed' {
  const n = sheet.filter((l) => billed.has(l.head_id)).length;
  return !n ? 'unbilled' : n < sheet.length ? 'part' : 'billed';
}

const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The documents a job's sheet makes (nothing written). */
export function planJobBills(j: LgJob, sheet: readonly LgCharge[], c: BillCtx): JobPlan {
  const out: JobPlan = { drafts: [], skipped: [], errors: [], hints: regimeHints(j, c.date) };
  const headOf = (id: string) => c.heads.find((h) => h.id === id);
  const freight = sheet.map((l) => headOf(l.head_id)).find((h) => h && h.role === 'own' && posRuleOf(h) === 'transport');
  const fr = freight && lgRegime(freight, j, c);
  const groups = new Map<string, JobDraft & { regimes: LgRegime[] }>();
  const single = c.settings.split === 'single';
  let mixed = false;
  for (const l of [...sheet, ...billExtras(j, c)]) {
    const h = headOf(l.head_id);
    if (!h) { out.errors.push(lgbT('eHead')); continue; }
    if (c.billed.has(h.id)) { out.skipped.push(h.name); continue; }
    const g = fr && h.role === 'own' && c.settings.composite_with_freight?.includes(h.id) ? fr : lgRegime(h, j, c);
    const cur = (l.currency || 'INR').toUpperCase();
    const docCur = c.recipient.foreign ? cur : 'INR';
    const fx = cur === 'INR' ? null : c.fx(cur);
    if (cur !== 'INR' && !fx) { out.errors.push(lgbT('eFx', { c: cur })); continue; }
    const rate = docCur === cur ? l.rate : round2(l.rate * fx!.rate);
    const pure = g.key === 'pure_agent';
    const kind = !c.sender.registered ? 'INVOICE' : 'TAX_INVOICE';
    const key = single ? docCur : `${g.pos}|${docCur}|${kind}|${g.supply ?? ''}`;
    if (single && groups.get(key) && groups.get(key)!.pos !== g.pos) mixed = true;
    const d = groups.get(key) ?? { doc_type: kind, pos: g.pos, mode: g.mode, ...(g.supply ? { supply: g.supply } : {}), currency: docCur, ...(docCur !== 'INR' ? { exchange_rate: fx!.rate } : {}), items: [], lg: { ...jobSnapshot(j), heads: {}, ...(fx ? { fx: { currency: cur, rate: fx.rate, source: fx.source } } : {}) }, regimes: [] };
    const id = c.newId();
    const name = `${h.name}${docCur !== cur ? ` (${cur} ${money(l.rate)} × ${l.qty} = ${cur} ${money(l.qty * l.rate)} @ ₹${money(fx!.rate)})` : ''}${l.note ? ` — ${l.note}` : ''}`;
    d.items.push({ id, name, type: 'Service', ...(h.sac && !pure ? { hsn: h.sac } : {}), quantity: l.qty, rate, amount: round2(l.qty * rate), tax_rate: g.rate, discount_percent: 0, ...(pure ? { charge_head_id: 'rule33', description: c.passText } : {}), ...(g.key === 'exempt' ? { sv: { exempt: 'EXEMPT' } } : {}) } as InvoiceItem);
    d.lg.heads![id] = h.id;
    if (!d.mode || d.mode === 'NONE') d.mode = g.mode;
    if (!d.lg.fx && fx) d.lg.fx = { currency: cur, rate: fx.rate, source: fx.source };
    d.regimes.push(g);
    groups.set(key, d);
  }
  // `single`: one document per currency, refused when its lines need different places of supply (LG9).
  if (mixed) return { ...out, errors: [...out.errors, lgbT('eSingle')] };
  for (const { regimes, ...d } of groups.values()) {
    const own = regimes.filter((g) => g.key !== 'pure_agent');
    const exempt = own.length > 0 && own.every((g) => g.key === 'exempt');
    out.drafts.push({ ...d, ...(exempt && d.doc_type === 'TAX_INVOICE' ? { doc_type: 'BILL_OF_SUPPLY', mode: 'NONE' } : {}), lg: { ...d.lg, regime: (own[0] ?? regimes[0]).key, pos_reason: [...new Set((own.length ? own : regimes).map((g) => g.reason))].join(' · ') } });
  }
  if (out.drafts.some((d) => d.supply === 'EXPORT_WITH_PAYMENT') && c.exportOk && !c.lut) out.hints.push(lgbT('hLut'));
  return out;
}
