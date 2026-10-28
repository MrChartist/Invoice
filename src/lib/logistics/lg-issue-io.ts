/**
 * R19-B1 / B4 bridge: a job's plan (`lg-bill.ts`) issued as documents through ONE `localDb.invoices.saveMany` (numbered
 * like `save` in each document's own FY series, period lock, approvals and the sender snapshot intact), all or nothing.
 * "Bill job" bills one job; "Bill delivered jobs" bills every delivered job of a month in one call (a job whose plan
 * has an error — no exchange rate — is skipped and named). Exchange rates: typed on the screen, else the currency master
 * (8H) on the bill date (Rule 34(2), LG13). The job's typed charge lines are saved on the job (`lg_jobs.charges`).
 * Working papers — verify with your CA.
 */
import './lg-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { LgCharge, LgJob } from '../../types/logistics-r19';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { calcInputFromRecord, calculateInvoice } from '../invoice-calc';
import { addDaysInput } from '../utils';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { PURE_AGENT_CHARGE } from '../trade/pure-agent';
import { loadRates, rateOn } from '../currency-rates';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { billedHeads, chargeSheet, planJobBills, type JobDraft, type JobPlan } from './lg-bill';
import { loadJobs, saveJob } from './lg-save';
import { lgDefaultsFor } from './lg-settings';
import { lutOn, regimeCtx } from './lg-tax-io';

export interface BillOpts { date: string; /** Typed ₹ rates by currency (win over the master). */ fx?: Record<string, number> }

const sender = () => localDb.settings.activeProfile() ?? null;
const clientOf = (j: LgJob) => ({ ...blankClient(), ...localDb.clients.getById(j.client_id) });

/** A job's plan on the date (nothing written). */
export function planJob(j: LgJob, o: BillOpts, docs: readonly InvoiceRecord[] = localDb.invoices.getAll()): JobPlan {
  const s = lgDefaultsFor(), rates = loadRates();
  return planJobBills(j, chargeSheet(j, s.heads ?? []), {
    ...regimeCtx(o.date, clientOf(j), sender()), heads: s.heads ?? [], settings: s, billed: billedHeads(docs, j.id), passText: PURE_AGENT_CHARGE, newId: generateId,
    fx: (c) => (o.fx?.[c] ? { rate: o.fx[c], source: 'typed' } : ((r) => (r ? { rate: r.rate, source: r.source } : null))(rateOn(rates, c, o.date))),
  });
}

function toRecord(d: JobDraft, j: LgJob, date: string): InvoiceRecord {
  const settings = localDb.settings.get(), snd = sender(), client = clientOf(j);
  const rec: InvoiceRecord = {
    ...makeDraft({ settings, sender: snd, docType: d.doc_type, templateId: localDb.template.get() }),
    id: generateId(), issue_date: date, due_date: addDaysInput(Number(settings.defaultDueDays) || 30, date), status: 'Sent', currency: d.currency, client, items: d.items,
    place_of_supply: d.pos, gst_mode: d.mode, supply_type: d.supply ?? (client.gstin?.trim() ? 'B2B' : 'B2C'), notes: `Job ${j.number}`, lg: d.lg,
    ...(d.exchange_rate ? { exchange_rate: d.exchange_rate } : {}), ...(d.supply === 'EXPORT_LUT' ? lutOn(date, snd?.companyGstin) : {}), ...(d.doc_type === 'BILL_OF_SUPPLY' ? { exempt_kind: 'EXEMPT' as const } : {}),
  };
  const t = calculateInvoice(calcInputFromRecord(rec));
  return { ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, cess_amount: t.cess_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount };
}

export interface BillResult { invoices: InvoiceRecord[]; skipped: string[]; errors: string[]; hints: string[] }

/** Issue the plans of `jobs` in one `saveMany` (`doc.create`). Nothing to bill → nothing written. */
function issue(jobs: readonly LgJob[], o: BillOpts, label = false): BillResult {
  requireAccess('doc.create');
  const docs = localDb.invoices.getAll();
  const out: BillResult = { invoices: [], skipped: [], errors: [], hints: [] };
  const recs: InvoiceRecord[] = [];
  for (const j of jobs) {
    const p = planJob(j, o, docs);
    const tag = (m: string) => (label ? `${j.number}: ${m}` : m);
    out.skipped.push(...p.skipped.map(tag));
    out.hints.push(...p.hints.map(tag));
    if (p.errors.length) { out.errors.push(...p.errors.map(tag)); continue; }
    recs.push(...p.drafts.map((d) => toRecord(d, j, o.date)));
  }
  if (recs.length) out.invoices = withTablesRollback(['invoices', 'series_counters'], () => localDb.invoices.saveMany(recs));
  return out;
}

/** "Bill job": the job's unbilled lines as documents. */
export function billJob(id: string, o: BillOpts): BillResult {
  const j = loadJobs().find((x) => x.id === id);
  if (!j) throw new Error(lgT('eNoJob'));
  return issue([j], o);
}

/** "Bill delivered jobs": every delivered job dated in `month` (`YYYY-MM`) with something left to bill, in one batch. */
export const billMonth = (month: string, o: BillOpts): BillResult => issue(loadJobs().filter((j) => j.status === 'delivered' && j.date.startsWith(month)), o, true);

/** Save the job's typed charge lines (blank / zero lines dropped). */
export const saveCharges = (j: LgJob, charges: readonly LgCharge[]): LgJob => saveJob({ ...j, charges: charges.filter((c) => c.head_id && c.qty > 0).map((c) => ({ ...c, amount: Math.round(c.qty * c.rate * 100) / 100 })) }).job;
