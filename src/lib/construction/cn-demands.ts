/**
 * CN-C3 stage demands. Certifying a stage of a tower lists every live booking there on a plan containing that stage;
 * "Raise demands" creates per booking ONE tax invoice (invoice series) with its own demand number `DMD/FY…` and the
 * snapshot `boq_terms.cn.demand` (unit, tower, carpet, RERA no., stage and %, agreement value, demanded so far,
 * received, interest, one-third land working, RERA account, plan table) printed by `DemandBlock`. Rate: the unit's
 * class on the demand date (1% / 5% effective = 1.5% / 7.5% on two-thirds, without ITC; old option: typed rate);
 * on / after the completion certificate a non-GST bill of supply "not a supply" (Sch III para 5(b)). Interest on delay
 * (Sec 15(2)(d)): owed on earlier demands × rate × days from the last due date, taxable at the unit's class, waivable
 * per booking. Open booking advances are adjusted through `advances.ts`. A stage is demanded once per booking.
 * GSTR-1 note (CN18 pending): the demand line carries the effective rate on the full value. Verify with your CA.
 */
import './cn-registry';
import type { InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { CnDemandSnapshot, PaymentPlan, PlanStage, RealtyBooking, RealtyProject, RealtyUnit, StageCertificate } from '../../types/construction-r11';
import type { AdvanceRecord } from '../../types/advances';
import { generateId, getTable } from '../storage';
import { requireAccess } from '../access';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { addDaysInput } from '../utils';
import { ruleAt } from '../tax-rules';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { advanceBalance, applyAdvance, invoiceOpen, loadAdvances } from '../advances';
import { bankAccountsDb } from '../bank-accounts';
import { REALTY_INTEREST_RULES } from '../construction-rules';
import { loadProjects } from './cn-realty-projects';
import { loadUnits } from './cn-units';
import { loadCerts, loadPlans, stageOf } from './cn-plans';
import { demandsOf, live, loadBookings, receivedFor } from './cn-bookings';
import { afterCc, landSplit } from './cn-realty-tax';
import { readConstructionSettings } from './cn-settings';

export const DMD = 'DMD';
const DAY = 864e5;
const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
export const daysBetween = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY);
const key = (s: string | undefined) => String(s ?? '').trim().toLowerCase();

/** Interest rate on delay: settings (state RERA rule) else the default row. */
export const interestRate = (date: string) => num(readConstructionSettings().realty?.interest_rate) || ruleAt(REALTY_INTEREST_RULES, date).rate;

/** Pure: interest on the amount owed on earlier demands, from the last earlier due date to `date` (simple, 365 days). */
export function delayInterest(earlier: readonly Pick<InvoiceRecord, 'total' | 'due_date'>[], received: number, date: string, rate: number): { days: number; rate: number; amount: number } | undefined {
  const owed = round2(earlier.reduce((s, i) => s + num(i.total), 0) - num(received));
  const due = earlier.map((i) => i.due_date).filter(Boolean).sort().at(-1);
  const days = due ? daysBetween(due, date) : 0;
  if (!(owed > 0.004) || days <= 0 || !(rate > 0)) return undefined;
  return { days, rate, amount: round2((owed * rate * days) / 36500) };
}

export interface DemandCtx {
  invoices: readonly InvoiceRecord[];
  advances: readonly AdvanceRecord[];
  payments: readonly Payment[];
  rate: number;
}

/** Pure: the demand snapshot of one booking for a certified stage on `date`. */
export function buildDemand(b: RealtyBooking, unit: RealtyUnit, project: RealtyProject, plan: PaymentPlan, stage: PlanStage, date: string, ctx: DemandCtx): CnDemandSnapshot & { amount: number } {
  const earlier = demandsOf(b.id, ctx.invoices);
  const amount = round2((b.agreement_value * num(stage.pct)) / 100);
  const prevDemanded = round2(earlier.reduce((s, i) => s + num(i.boq_terms?.cn?.demand?.pct) * b.agreement_value / 100, 0));
  const received = receivedFor(b.id, ctx.advances, ctx.payments, ctx.invoices, date).consideration;
  const interest = b.interest_waived ? undefined : delayInterest(earlier, received, date, ctx.rate);
  const cc = afterCc(project, date);
  const tower = project.towers.find((x) => x.id === unit.tower_id)?.name;
  const acc = bankAccountsDb.all().find((a) => a.id === (project.rera_account_id || project.collection_account_id));
  return {
    amount, booking_id: b.id, booking_no: b.number, unit: unit.unit_no, tower, carpet_sqm: unit.carpet_sqm, rera_no: project.rera_no, project: project.name,
    stage: stage.label, stage_id: stage.id, stage_label: stage.label, pct: num(stage.pct), agreement_value: b.agreement_value,
    previously_demanded: prevDemanded, demanded: round2(prevDemanded + amount), previously_received: received,
    ...(interest ? { interest } : {}), ...(cc ? { cc_after: true } : { land: landSplit(amount + (interest?.amount ?? 0), b.cls, date, project.old_rate) }), cls: b.cls,
    ...(acc ? { account: { name: acc.name, ...(acc.account_no ? { no: acc.account_no } : {}), ...(acc.ifsc ? { ifsc: acc.ifsc } : {}) } } : {}),
    plan: plan.stages.map((s) => ({ label: s.label, pct: s.pct })),
  };
}

/** Pure: the demand invoice record (number assigned on save). */
export function demandInvoice(d: CnDemandSnapshot & { amount: number }, b: RealtyBooking, project: RealtyProject, stage: PlanStage, date: string, number: string): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile();
  const client = (b.client_id && localDb.clients.getById(b.client_id)) || undefined;
  const cc = !!d.cc_after;
  const rate = cc ? 0 : d.land!.effective;
  const draft = makeDraft({ settings, sender, docType: cc ? 'BILL_OF_SUPPLY' : 'TAX_INVOICE' });
  const line = (name: string, amount: number, description: string): InvoiceItem => ({ id: generateId(), name, description, type: 'service', hsn: '9954', unit: 'NOS', quantity: 1, rate: amount, tax_rate: rate, discount_percent: 0, amount });
  const items = [line(`${stage.label} — ${num(stage.pct)}% of agreement value`, d.amount, `Unit ${d.unit}${d.tower ? `, ${d.tower}` : ''} · ${project.name} · booking ${b.number} · demand ${number}`)];
  if (d.interest) items.push(line('Interest on delayed payment', d.interest.amount, `${d.interest.days} days at ${d.interest.rate}% a year (Sec 15(2)(d): part of the value)`));
  const home = senderStateCode(sender);
  const rec: InvoiceRecord = {
    ...draft, issue_date: date, due_date: addDaysInput(num(stage.due_days), date), status: 'Sent',
    client: client ? { ...client } : { ...draft.client, name: b.client_name }, items, place_of_supply: project.state_code,
    gst_mode: cc ? 'NONE' : deriveGstMode({ senderStateCode: home, placeOfSupply: project.state_code, senderHasGstin: !!sender?.companyGstin?.trim(), taxEnabled: true }),
    ...(cc ? { exempt_kind: 'NON_GST' as const } : {}), ...(project.cost_centre_id ? { cost_centre_id: project.cost_centre_id } : {}),
    notes: cc ? 'Sale of building after the completion certificate — not a supply (Schedule III para 5(b)); no GST. Verify with your CA.' : 'Construction service at the concessional rate without input tax credit; value of land deemed one-third. Verify with your CA.',
    boq_terms: { cn: { v: 1, demand: { ...d, number } } },
  };
  delete (rec.boq_terms!.cn!.demand as { amount?: number }).amount;
  const tt = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return { ...rec, subtotal: tt.subtotal, discount_amount: tt.discount_amount, taxable_value: tt.taxable_value, cgst_amount: tt.cgst_amount, sgst_amount: tt.sgst_amount, igst_amount: tt.igst_amount, tax_amount: tt.tax_amount, round_off: tt.round_off, total: tt.total, balance_due: tt.balance_due, cess_amount: tt.cess_amount };
}

export interface Candidate {
  booking: RealtyBooking;
  unit: RealtyUnit;
  plan: PaymentPlan;
  stage: PlanStage;
  /** Already demanded for this stage (skipped by the run). */
  done: boolean;
}

/** Live bookings in the certificate's tower on a plan containing the stage. */
export function candidates(c: StageCertificate, invoices: readonly InvoiceRecord[] = localDb.invoices.getAll()): Candidate[] {
  const units = new Map(loadUnits().map((u) => [u.id, u]));
  const plans = loadPlans();
  return loadBookings().filter(live).flatMap((b) => {
    const unit = units.get(b.unit_id);
    const plan = plans.find((p) => p.id === b.plan_id);
    const stage = stageOf(plan, c);
    if (!unit || unit.tower_id !== c.tower_id || !plan || !stage) return [];
    const done = demandsOf(b.id, invoices).some((i) => i.boq_terms?.cn?.demand?.stage_id === stage.id || key(i.boq_terms?.cn?.demand?.stage_label) === key(stage.label));
    return [{ booking: b, unit, plan, stage, done }];
  });
}

/** Raise the demands of a certificate (all or nothing): one invoice per booking, advances adjusted. */
export function raiseDemands(certId: string, date: string, today?: string): InvoiceRecord[] {
  requireAccess('doc.create');
  const cert = loadCerts().find((c) => c.id === certId);
  if (!cert) throw new Error('Stage certificate not found.');
  if (date < cert.certified_on) throw new Error('Date the demands on or after the certificate.');
  const project = loadProjects().find((p) => p.id === cert.project_id);
  if (!project) throw new Error('Project not found.');
  const todo = candidates(cert).filter((c) => !c.done);
  if (!todo.length) throw new Error('No booking is left to demand for this stage.');
  assertUnlocked({ issue_date: date, invoice_number: '' }, 'create');
  return withTablesRollback(['invoices', 'transactions', 'clients', 'items_catalog', 'series_counters', 'advances'], () => {
    const out: InvoiceRecord[] = [];
    for (const c of todo) {
      const invoices = localDb.invoices.getAll();
      const ctx: DemandCtx = { invoices, advances: loadAdvances(), payments: getTable<Payment>('transactions'), rate: interestRate(date) };
      const d = buildDemand(c.booking, c.unit, project, c.plan, c.stage, date, ctx);
      const number = nextSeriesNumberFor(DMD, date, invoices.map((i) => String(i.boq_terms?.cn?.demand?.number ?? '')).filter(Boolean));
      const saved = localDb.invoices.save(demandInvoice(d, c.booking, project, c.stage, date, number));
      recordSeries(number);
      // Open booking advances (not pass-through) settle the demand, oldest first (a bill of supply takes none).
      if (saved.doc_type !== 'BILL_OF_SUPPLY') {
        for (const a of loadAdvances().filter((x) => x.booking_id === c.booking.id && !x.pass_through).sort((x, y) => x.date.localeCompare(y.date))) {
          const inv = localDb.invoices.getById(saved.id)!;
          const amt = round2(Math.min(advanceBalance(a, getTable<Payment>('transactions'), localDb.invoices.getAll()).open, invoiceOpen(inv)));
          if (amt > 0.004) applyAdvance({ advanceId: a.id, invoiceId: saved.id, amount: amt, date: a.date > date ? a.date : date }, { today });
        }
      }
      out.push(localDb.invoices.getById(saved.id)!);
    }
    return out;
  });
}

/** Ageing per booking: open balance of its demands by days past due (0–30, 31–60, 61–90, 90+). */
export function demandAgeing(invoices: readonly InvoiceRecord[], asOf: string) {
  const by = new Map<string, { booking: string; unit: string; tower: string; open: number; buckets: number[] }>();
  for (const i of invoices) {
    const d = i.boq_terms?.cn?.demand;
    if (!d?.booking_id || i.status === 'Cancelled' || i.doc_type === 'CREDIT_NOTE') continue;
    const open = round2(Math.max(num(i.total) - num(i.amount_paid), 0));
    const r = by.get(d.booking_id) ?? { booking: String(d.booking_no ?? ''), unit: String(d.unit ?? ''), tower: String(d.tower ?? ''), open: 0, buckets: [0, 0, 0, 0] };
    const late = i.due_date ? daysBetween(i.due_date, asOf) : 0;
    r.open = round2(r.open + open);
    r.buckets[late > 90 ? 3 : late > 60 ? 2 : late > 30 ? 1 : 0] += open;
    by.set(d.booking_id, r);
  }
  return [...by.values()].filter((r) => r.open > 0.004);
}

/** WhatsApp text of a demand. */
export const demandText = (i: InvoiceRecord, money: (n: number) => string) => {
  const d = i.boq_terms?.cn?.demand;
  return `Demand ${d?.number ?? ''} (${i.invoice_number}) for unit ${d?.unit ?? ''}: ${d?.stage_label ?? ''} ${d?.pct ?? ''}% — ${money(num(i.total))} due by ${i.due_date}.${d?.account ? ` Pay only to ${d.account.name}${d.account.no ? ` ${d.account.no}` : ''}.` : ''}`;
};
