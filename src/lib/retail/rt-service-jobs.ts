/**
 * RT-D4 repair job sheets and warranty claims — the generic job engine (table `service_jobs`, `doc.create`, dated
 * `date`, numbered `SVC/FY…` through `series-counters.ts`, never reused after a delete). Round 10 SV-D (workshops) builds
 * on it: the asset is generic (`kind`: phone / computer / appliance / vehicle / other; a vehicle uses `asset.reg_no` /
 * `odometer`), the SAC comes from `REPAIR_SERVICE_RULES` by kind (or `sac` on the job).
 *
 *  - Status: received → diagnosed → approved → in_repair | at_service_centre → ready → delivered; `returned`
 *    (unrepaired) from any open step. `canMove` / `moveJob`.
 *  - Warranty: from the serial (`lookupSerial` on the stock-tracking map — sale date + warranty months) when the job is
 *    taken. Under warranty: a claim to the brand / service centre (a vendor) `sent → approved / rejected → settled`.
 *    A part / unit replaced free under warranty creates NO sale and no GST (RT13): on billing it leaves stock by a
 *    zero-value adjustment; a unit swap is two zero-value moves (old serial out, new serial in) — `replacementSwap`.
 *  - Billing (`billJob`): one invoice — the labour line (SAC by kind, 18%, the job number in its description) and the
 *    chargeable parts at their own HSN / rate (stock items: out of stock by the sale itself) — then the job's advance
 *    (a normal `advances` receipt) is adjusted. Nothing to charge (all under warranty) → no invoice.
 * Working paper — verify with your CA (RT13).
 */
import './rt-registry';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ServiceJob, ServicePart, ServiceStatus, WarrantyClaim } from '../../types/retail-r9';
import { REPAIR_SERVICE_RULES, WARRANTY_REPLACEMENT_RULES, type RepairKind } from '../retail-rules';
import { ruleAt } from '../tax-rules';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { localDb } from '../localDb';
import { makeDraft } from '../../store/invoice-defaults';
import { applyAdvance, advanceBalance, invoiceOpen, loadAdvances } from '../advances';
import { stockDb, type StockMove } from '../inventory';
import { lookupSerial, serialKey, type TrackingMap } from '../stock-tracking';
import { RT_SERIES, RT_TABLES } from './rt-shared';

export const SERVICE_TABLE = RT_TABLES.serviceJobs;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/* ── Pure ── */

export const SERVICE_FLOW: readonly ServiceStatus[] = ['received', 'diagnosed', 'approved', 'in_repair', 'ready', 'delivered'];
const OPEN = new Set<ServiceStatus>(['received', 'diagnosed', 'approved', 'in_repair', 'at_service_centre']);

/** Allowed moves: one step on, the service-centre branch in place of in_repair, `returned` from any open step. */
export function canMove(from: ServiceStatus, to: ServiceStatus): boolean {
  if (from === 'delivered' || from === 'returned') return false;
  if (to === 'returned') return true;
  if (to === 'at_service_centre') return from === 'received' || from === 'diagnosed' || from === 'approved';
  if (from === 'at_service_centre') return to === 'ready' || to === 'in_repair';
  return SERVICE_FLOW[SERVICE_FLOW.indexOf(from) + 1] === to;
}

export const nextServiceStatus = (s: ServiceStatus): ServiceStatus | undefined => (s === 'at_service_centre' ? 'ready' : SERVICE_FLOW[SERVICE_FLOW.indexOf(s) + 1]);
export const isOpenJob = (j: Pick<ServiceJob, 'status'>): boolean => OPEN.has(j.status) || j.status === 'ready';

export const nextServiceNumber = (date: string, jobs: readonly Pick<ServiceJob, 'number'>[]): string => nextSeriesNumberFor(RT_SERIES.serviceJobs, date, jobs.map((j) => j.number));

/** SAC + rate of the labour line for a kind on a date (a job's own `sac` wins). */
export function repairRule(kind: RepairKind, date?: string, sac?: string): { sac: string; rate: number } {
  const r = ruleAt(REPAIR_SERVICE_RULES, date);
  return { sac: sac?.trim() || r.sac[kind] || r.sac.other, rate: r.rate };
}

/** Warranty status of a serial on `day` from the stock engine (sale date + warranty months); none when unknown. */
export function warrantyFor(tracking: TrackingMap, serial: string | undefined, day: string): { status: 'none' | 'active' | 'expired'; until?: string; saleInvoiceId?: string; itemId?: string } {
  if (!serial?.trim()) return { status: 'none' };
  const hit = lookupSerial(tracking, serial, day, 5).find((r) => serialKey(r.serial) === serialKey(serial));
  if (!hit) return { status: 'none' };
  return { status: hit.warranty, ...(hit.warrantyUntil ? { until: hit.warrantyUntil } : {}), ...(hit.sale?.refId ? { saleInvoiceId: hit.sale.refId } : {}), itemId: hit.item.id };
}

/** True when the job's free parts are covered (warranty active, or the brand approved / settled the claim). */
export const warrantyCovers = (j: Pick<ServiceJob, 'warranty' | 'claim'>): boolean => j.claim ? j.claim.status === 'approved' || j.claim.status === 'settled' : j.warranty?.status === 'active';

/** The bill lines of a job: labour (SAC by kind) and the chargeable parts; warranty parts are no sale (RT13). */
export function jobLines(job: ServiceJob, date: string, newId: () => string = generateId): InvoiceItem[] {
  const free = warrantyCovers(job) && ruleAt(WARRANTY_REPLACEMENT_RULES, date).noSale;
  const out: InvoiceItem[] = [];
  const labour = round2(num(job.labour));
  if (labour > 0) {
    const r = repairRule(job.kind, date, job.sac);
    out.push({ id: newId(), name: `Repair — ${job.asset.model}`, description: job.number, type: 'Service', hsn: r.sac, unit: 'NOS', quantity: 1, rate: labour, tax_rate: r.rate, discount_percent: 0, amount: labour });
  }
  for (const p of job.parts) {
    if (p.warranty && free) continue;
    const q = num(p.qty);
    out.push({ id: newId(), name: p.name, description: job.number, type: 'Product', hsn: p.hsn ?? '', unit: 'NOS', quantity: q, rate: round2(num(p.rate)), tax_rate: num(p.tax_rate), discount_percent: 0, amount: round2(q * num(p.rate)), ...(p.serials?.length ? { serials: p.serials } : {}) });
  }
  return out;
}

/** Parts that leave stock free under warranty (no sale): zero-value adjustment moves. */
export function warrantyMoves(job: ServiceJob, date: string): StockMove[] {
  if (!warrantyCovers(job)) return [];
  return job.parts.filter((p) => p.warranty && p.item_id && num(p.qty) > 0).map((p) => ({
    id: generateId(), item_id: p.item_id!, date, qty: -Math.abs(num(p.qty)), rate: 0, kind: 'adjustment' as const, ref_type: 'service_job', ref_id: job.id,
    note: `Warranty replacement — ${job.number} (no sale, no GST; verify with your CA)`, ...(p.serials?.length ? { serials: p.serials } : {}),
  }));
}

/** Jobs past their due day and not ready (the bell / board's overdue list). */
export const overdueJobs = (jobs: readonly ServiceJob[], today: string): ServiceJob[] => jobs.filter((j) => OPEN.has(j.status) && !!j.due && j.due < today);

/** Age in days of an open job (board). */
export const jobAge = (j: Pick<ServiceJob, 'date'>, today: string): number => Math.max(Math.round((Date.parse(`${today}T00:00:00`) - Date.parse(`${j.date}T00:00:00`)) / 864e5), 0);

/* ── Storage ── */

export const loadJobs = (): ServiceJob[] => getTable<ServiceJob>(SERVICE_TABLE).filter((r) => r && typeof r.id === 'string').map((j) => ({ ...j, parts: j.parts ?? [], history: j.history ?? [] }));

const write = (jobs: ServiceJob[]) => setTable(SERVICE_TABLE, jobs);
const findJob = (jobs: readonly ServiceJob[], id: string): ServiceJob => {
  const j = jobs.find((x) => x.id === id);
  if (!j) throw new Error('Job sheet not found.');
  return j;
};

export interface JobInput {
  date: string;
  kind?: RepairKind;
  customer: string;
  client_id?: string;
  phone?: string;
  asset: ServiceJob['asset'];
  complaint: string;
  accessories?: string;
  condition?: string;
  estimate?: number;
  technician?: string;
  due?: string;
  advance_id?: string;
  sac?: string;
}

/** Take a job in (numbered `SVC/FY…`); the warranty is read from the serial when `tracking` is given. */
export function addJob(input: JobInput, tracking?: TrackingMap): ServiceJob {
  requireAccess('doc.create');
  if (!DAY.test(input.date) || (input.due && !DAY.test(input.due))) throw new Error('Choose the dates.');
  if (!input.customer.trim()) throw new Error('Type the customer\'s name.');
  if (!input.asset?.model?.trim()) throw new Error('Type the device / model.');
  if (!input.complaint.trim()) throw new Error('Type the complaint.');
  const all = loadJobs();
  const number = nextServiceNumber(input.date, all);
  assertUnlocked({ issue_date: input.date, invoice_number: number }, 'create');
  const w = tracking ? warrantyFor(tracking, input.asset.serial, input.date) : { status: 'none' as const };
  const job: ServiceJob = {
    id: generateId(), number, date: input.date, kind: input.kind ?? 'phone', customer: input.customer.trim(), complaint: input.complaint.trim(),
    asset: { ...input.asset, model: input.asset.model.trim(), ...(w.itemId && !input.asset.item_id ? { item_id: w.itemId } : {}), ...('saleInvoiceId' in w && w.saleInvoiceId ? { sale_invoice_id: w.saleInvoiceId } : {}) },
    estimate: round2(num(input.estimate)), status: 'received', parts: [], labour: 0, history: [{ status: 'received', date: input.date }], created_at: new Date().toISOString(),
    warranty: { status: w.status, ...('until' in w && w.until ? { until: w.until } : {}) },
    ...(input.client_id ? { client_id: input.client_id } : {}), ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    ...(input.accessories?.trim() ? { accessories: input.accessories.trim() } : {}), ...(input.condition?.trim() ? { condition: input.condition.trim() } : {}),
    ...(input.technician?.trim() ? { technician: input.technician.trim() } : {}), ...(input.due ? { due: input.due } : {}),
    ...(input.advance_id ? { advance_id: input.advance_id } : {}), ...(input.sac?.trim() ? { sac: input.sac.trim() } : {}),
  };
  write([...all, job]);
  recordSeries(number);
  return job;
}

/** Edit the work on a job: parts, labour, estimate, technician, due (not once billed). */
export function updateJob(id: string, patch: Partial<Pick<ServiceJob, 'parts' | 'labour' | 'estimate' | 'technician' | 'due' | 'advance_id' | 'sac' | 'warranty'>>): ServiceJob {
  requireAccess('doc.create');
  const all = loadJobs();
  const j = findJob(all, id);
  if (j.invoice_id || j.billed_on) throw new Error(`${j.number} is billed; edit the bill instead.`);
  const parts: ServicePart[] | undefined = patch.parts?.map((p) => ({ ...p, id: p.id || generateId(), qty: num(p.qty), rate: round2(num(p.rate)), tax_rate: num(p.tax_rate) }));
  if (parts?.some((p) => !p.name.trim() || !(p.qty > 0) || p.rate < 0)) throw new Error('Each part needs a name, a quantity and a rate.');
  const next: ServiceJob = { ...j, ...patch, ...(parts ? { parts } : {}), ...(patch.labour !== undefined ? { labour: round2(num(patch.labour)) } : {}), updated_at: new Date().toISOString() };
  write(all.map((x) => (x.id === id ? next : x)));
  return next;
}

/** Move a job along its flow on `day`. */
export function moveJob(id: string, to: ServiceStatus, day: string): ServiceJob {
  requireAccess('doc.create');
  const all = loadJobs();
  const j = findJob(all, id);
  if (!canMove(j.status, to)) throw new Error(`A job that is ${j.status.replace(/_/g, ' ')} cannot move to ${to.replace(/_/g, ' ')}.`);
  const next: ServiceJob = { ...j, status: to, history: [...j.history, { status: to, date: day }], updated_at: new Date().toISOString() };
  write(all.map((x) => (x.id === id ? next : x)));
  return next;
}

/** Set / move the warranty claim to the brand / service centre. */
export function setClaim(id: string, claim: WarrantyClaim): ServiceJob {
  requireAccess('doc.create');
  const all = loadJobs();
  const j = findJob(all, id);
  if (!claim.vendor_name.trim()) throw new Error('Pick the brand / service centre.');
  const order = ['sent', 'approved', 'rejected', 'settled'];
  if (j.claim && order.indexOf(claim.status) < order.indexOf(j.claim.status) && claim.status !== 'sent') throw new Error('A claim cannot go back.');
  if (claim.status === 'settled' && j.claim?.status !== 'approved' && j.claim?.status !== 'settled') throw new Error('Only an approved claim is settled.');
  const next: ServiceJob = { ...j, claim: { ...claim, vendor_name: claim.vendor_name.trim() }, updated_at: new Date().toISOString() };
  write(all.map((x) => (x.id === id ? next : x)));
  return next;
}

/** A warranty unit swap in stock: old serial out, new serial in, both at no value (stock count unchanged). */
export function replacementSwap(id: string, input: { itemId: string; outSerial: string; inSerial: string; date: string }): StockMove[] {
  requireAccess('books.edit');
  const all = loadJobs();
  const j = findJob(all, id);
  if (!input.outSerial.trim() || !input.inSerial.trim()) throw new Error('Type both serials.');
  const base = { item_id: input.itemId, date: input.date, rate: 0, kind: 'adjustment' as const, ref_type: 'service_job', ref_id: j.id };
  const moves: StockMove[] = [
    { ...base, id: generateId(), qty: -1, serials: [input.outSerial.trim()], note: `Warranty swap out — ${j.number}` },
    { ...base, id: generateId(), qty: 1, serials: [input.inSerial.trim()], note: `Warranty swap in — ${j.number} (no value; verify with your CA)` },
  ];
  for (const m of moves) stockDb.addMove(m);
  write(all.map((x) => (x.id === id ? { ...j, swap_move_ids: [...(j.swap_move_ids ?? []), ...moves.map((m) => m.id)], updated_at: new Date().toISOString() } : x)));
  return moves;
}

/**
 * Bill a job: saves the invoice (labour + chargeable parts), adjusts the job's advance, issues warranty parts out of
 * stock at no value and stamps the job. Returns the invoice, or undefined when nothing is chargeable.
 */
export function billJob(id: string, date: string): InvoiceRecord | undefined {
  requireAccess('doc.create');
  const all = loadJobs();
  const j = findJob(all, id);
  if (j.invoice_id) throw new Error(`${j.number} is already billed (${j.invoice_number}).`);
  if (j.billed_on) throw new Error(`${j.number} was already billed on ${j.billed_on} (nothing chargeable; warranty parts issued).`); // QA10 R9
  const lines = jobLines(j, date);
  const issued = warrantyMoves(j, date);
  for (const m of issued) stockDb.addMove(m);
  let saved: InvoiceRecord | undefined;
  if (lines.length) {
    const settings = localDb.settings.get();
    const sender = localDb.settings.activeProfile();
    const draft = makeDraft({ settings, sender });
    const known: Client | undefined = j.client_id ? localDb.clients.getById(j.client_id) : undefined;
    const client: Client = known ? { ...draft.client, ...known } : { ...draft.client, name: j.customer, phone: j.phone ?? '' };
    const rec: InvoiceRecord = { ...draft, issue_date: date, due_date: date, client, items: lines, status: 'Sent', notes: `Repair job ${j.number}${j.asset.serial ? ` · ${j.asset.serial}` : ''}` };
    const t = calculateInvoice(calcInputFromRecord(rec));
    saved = localDb.invoices.save({ ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount });
    const adv = j.advance_id ? loadAdvances().find((a) => a.id === j.advance_id) : undefined;
    if (adv) {
      const open = advanceBalance(adv, localDb.payments.getAll(), localDb.invoices.getAll()).open;
      const amt = round2(Math.min(open, invoiceOpen(saved)));
      if (amt > 0) applyAdvance({ advanceId: adv.id, invoiceId: saved.id, amount: amt, date: date >= adv.date ? date : adv.date });
    }
    saved = localDb.invoices.getById(saved.id) ?? saved;
  }
  // QA10 R9: stamped billed even with nothing chargeable (a zero-value record), so the warranty parts never issue twice.
  const stamp = { billed_on: date, ...(issued.length ? { warranty_move_ids: issued.map((m) => m.id) } : {}), ...(saved ? { invoice_id: saved.id, invoice_number: saved.invoice_number } : {}) };
  write(loadJobs().map((x) => (x.id === id ? { ...x, ...stamp, updated_at: new Date().toISOString() } : x)));
  return saved;
}

/** Delete a job (recycle bin; its number stays used). Refused once billed. */
export function deleteJob(id: string): void {
  requireAccess('doc.create');
  const all = loadJobs();
  const j = all.find((x) => x.id === id);
  if (!j) return;
  if (j.invoice_id) throw new Error('This job is billed; cancel the bill first.');
  assertUnlocked({ id, issue_date: j.date, invoice_number: j.number }, 'delete');
  if (j.billed_on) assertUnlocked({ id, issue_date: j.billed_on, invoice_number: j.number }, 'delete');
  // QA10 R9: an all-warranty job's part issues go with it (recycle bin; restored with the job).
  withTablesRollback([SERVICE_TABLE, 'stock_moves'], () => {
    for (const mv of j.warranty_move_ids ?? []) stockDb.deleteMove(mv);
    write(all.filter((x) => x.id !== id));
  });
}

/** `wa.me` status update (undefined without a phone); the user taps it, nothing is sent. */
export function jobLink(job: Pick<ServiceJob, 'phone'>, message: string): string | undefined {
  const d = String(job.phone ?? '').replace(/\D/g, '');
  return d.length < 10 ? undefined : `https://wa.me/${d.length === 10 ? `91${d}` : d}?text=${encodeURIComponent(message)}`;
}
