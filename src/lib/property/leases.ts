/**
 * R5-C5 leases. Saving a lease creates (or updates) an ordinary recurring schedule with additive `lease_id` and
 * `escalation`: the generator's amount hook (`recurring.ts` → `escalation.ts`) bills rent / CAM escalated from each
 * step date and pro rata, so issued documents are snapshots that never change. The schedule ends on the lease end.
 * GST class per use (`lease-gst.ts`); 194-I: a tenant who deducts TDS gets `tds_section` 194I-B / 194I-A at the
 * date-keyed rate, so the 26AS reconciler works unchanged. Rent roll: current rent, next escalation, deposit, dues.
 */
import type { Client, InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';
import type { Lease, Property, ScheduleEscalation, SecurityDeposit } from '../../types/institutions-r5';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { createSchedule, recurringDb, RECURRING_TABLE, type RecurringSchedule, type RecurringTemplate } from '../recurring';
import { partySnapshot } from '../batch-invoices';
import { deriveGstMode, round2 } from '../invoice-calc';
import { resolveStateCode } from '../india-states';
import { senderStateCode } from '../../store/invoice-defaults';
import { sectionRate } from '../tds-rules';
import { receivableBalance } from '../rcm';
import { toCsv } from '../csv';
import { LEASES_TABLE, R5cError, day, money, str } from '../institutions/r5c';
import { escalatedAmount, nextEscalation } from './escalation';
import { leaseDocType } from './lease-gst';
import { LEASE_GST_RULES, ruleAt } from '../r5c-rules';
import { depositBalance } from './deposits';

export function normalizeLease(raw: unknown): Lease | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Lease;
  return str(o.id) ? { ...o, unit_ids: Array.isArray(o.unit_ids) ? o.unit_ids : [], status: o.status === 'ended' || o.status === 'terminated' ? o.status : 'active' } : null;
}
export const loadLeases = (): Lease[] => peekTable<unknown>(LEASES_TABLE).flatMap((r) => normalizeLease(r) ?? []);

/** Monthly CAM in rupees (per sq ft × the units' area when `cam_basis` is `sqft`). */
export function camAmount(l: Pick<Lease, 'cam' | 'cam_basis' | 'unit_ids'>, p: Property | undefined): number {
  const v = money(l.cam);
  if (l.cam_basis !== 'sqft') return v;
  const area = (p?.units ?? []).filter((u) => l.unit_ids.includes(u.id)).reduce((s, u) => s + (u.area ?? 0), 0);
  return round2(v * area);
}

/** First billing date on / after the lease start for `billing_day` (1–28; 0 = the start day). */
export function firstBilling(start: string, billingDay: number): string {
  const d = Math.floor(billingDay) || 0;
  if (d < 1 || d > 28 || +start.slice(8, 10) === d) return start;
  const [y, m] = [+start.slice(0, 4), +start.slice(5, 7)];
  const t = +start.slice(8, 10) < d ? y * 12 + m - 1 : y * 12 + m;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export interface LeaseContext {
  tenant: Client;
  property: Property;
  sender: SenderProfile | null;
  templateId: string;
  roundOff?: boolean;
}

/** The recurring template and escalation for a lease (pure). Null for an exempt lease billed with no document. */
export function leaseSchedulePart(l: Lease, ctx: LeaseContext): { template: RecurringTemplate; escalation: ScheduleEscalation; start: string } | null {
  const kind = leaseDocType(l.gst_class);
  if (!kind) return null;
  const units = ctx.property.units.filter((u) => l.unit_ids.includes(u.id)).map((u) => u.name).join(', ');
  const g = ruleAt(LEASE_GST_RULES, l.start);
  const rate = kind.gst ? g.commercialRate : 0;
  const line = (id: string, name: string, amount: number): InvoiceItem => ({ id, name, type: 'Service', hsn: g.sac, quantity: 1, rate: round2(amount), tax_rate: rate, amount: round2(amount) });
  const items = [line('rent', `Rent: ${ctx.property.name}${units ? ` (${units})` : ''}, {period}`, l.rent)];
  const cam = camAmount(l, ctx.property);
  if (cam > 0) items.push(line('cam', 'Common area maintenance (CAM): {period}', cam));
  (l.heads ?? []).forEach((h, i) => money(h.amount) > 0 && items.push(line(`h${i + 1}`, `${str(h.name) || 'Charges'}: {period}`, money(h.amount))));
  const pos = resolveStateCode({ code: ctx.property.state, name: ctx.property.state }) || senderStateCode(ctx.sender);
  const tdsRate = l.tds ? (l.tds.rate ?? sectionRate(l.tds.section, l.start) ?? 0) : 0;
  const template = {
    doc_type: kind.doc, currency: 'INR', template_id: ctx.templateId, client: partySnapshot(ctx.tenant), sender: ctx.sender, items,
    gst_mode: kind.gst ? deriveGstMode({ senderStateCode: senderStateCode(ctx.sender), placeOfSupply: pos, senderHasGstin: !!str(ctx.sender?.companyGstin), taxEnabled: true }) : 'NONE',
    place_of_supply: pos, reverse_charge: kind.reverse, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0,
    round_off_enabled: ctx.roundOff !== false, notes: `Lease of ${ctx.property.name}${units ? `: ${units}` : ''}`, terms: '',
    ...(l.tds && tdsRate > 0 ? { tds_enabled: true, tds_section: l.tds.section, tds_rate: tdsRate } : {}),
    ...(kind.doc === 'BILL_OF_SUPPLY' ? { exempt_kind: 'EXEMPT' } : {}),
  } as RecurringTemplate;
  const start = firstBilling(l.start, l.billing_day);
  const escalation: ScheduleEscalation = {
    ...(l.escalation ?? {}), lines: ['rent', ...(l.escalation?.include_cam && cam > 0 ? ['cam'] : [])], prorata_lines: items.map((i) => i.id),
    lease_start: l.start, ...(l.end ? { lease_end: l.end } : {}), ...(l.prorata ? { prorata: true } : {}),
  };
  return { template, escalation, start };
}

export function validateLease(l: Partial<Lease>): string[] {
  const out: string[] = [];
  if (!str(l.tenant_id)) out.push('tenant');
  if (!str(l.property_id) || !(l.unit_ids ?? []).length) out.push('unit');
  if (!day(l.start) || !day(l.end) || (l.end ?? '') <= (l.start ?? '')) out.push('dates');
  if (!(money(l.rent) > 0)) out.push('rent');
  if (l.escalation && !(l.escalation.every_months > 0)) out.push('escalation');
  return out;
}

/** Save a lease and its recurring schedule as one change. */
export function saveLease(input: Omit<Lease, 'id' | 'schedule_id' | 'status'> & { id?: string }, ctx: LeaseContext): Lease {
  requireAccess('master.edit');
  const bad = validateLease(input);
  if (bad.length) throw new R5cError(bad[0]);
  const all = getTable<Lease>(LEASES_TABLE);
  const prev = input.id ? all.find((l) => l.id === input.id) : undefined;
  const lease: Lease = { ...prev, ...input, id: prev?.id ?? generateId(), schedule_id: prev?.schedule_id ?? '', status: prev?.status ?? 'active', created_at: prev?.created_at ?? new Date().toISOString() };
  return withTablesRollback([LEASES_TABLE, RECURRING_TABLE], () => {
    const part = leaseSchedulePart(lease, ctx);
    const old = lease.schedule_id ? recurringDb.getById(lease.schedule_id) : undefined;
    if (part) {
      const base: RecurringSchedule = old ?? createSchedule({ name: '', template: part.template, frequency: 'monthly', start_date: part.start, mode: 'issue' });
      const fresh = !old || old.run_count === 0;
      const s = recurringDb.save({
        ...base, name: `Rent: ${ctx.tenant.name}, ${ctx.property.name}`, template: part.template, lease_id: lease.id, escalation: part.escalation,
        end_date: lease.end, due_in_days: Math.max(0, Math.floor(lease.due_days) || 0), mode: 'issue',
        ...(fresh ? { start_date: part.start, next_run: part.start } : {}),
      });
      lease.schedule_id = s.id;
    } else if (old) {
      recurringDb.save({ ...old, active: false, end_date: old.last_run ?? old.start_date });
    }
    setTable(LEASES_TABLE, prev ? all.map((l) => (l.id === lease.id ? lease : l)) : [...all, lease]);
    return lease;
  });
}

/** End (or terminate) a lease on `on`: the schedule stops billing after that day. */
export function endLease(id: string, on: string, terminated = false): Lease {
  requireAccess('master.edit');
  const all = getTable<Lease>(LEASES_TABLE);
  const l = all.find((x) => x.id === id);
  if (!l || !day(on)) throw new R5cError('dates');
  return withTablesRollback([LEASES_TABLE, RECURRING_TABLE], () => {
    const s = l.schedule_id ? recurringDb.getById(l.schedule_id) : undefined;
    if (s) recurringDb.save({ ...s, end_date: on, ...(s.escalation ? { escalation: { ...s.escalation, lease_end: on } } : {}) });
    const row: Lease = { ...l, end: on < l.end ? on : l.end, status: terminated ? 'terminated' : 'ended', ...(terminated ? { terminated_on: on } : {}) };
    setTable(LEASES_TABLE, all.map((x) => (x.id === id ? row : x)));
    return row;
  });
}

export interface RentRow {
  lease: Lease;
  property?: Property;
  units: string;
  tenant: string;
  rent: number;
  next: { date: string; from: number; to: number } | null;
  deposit: number;
  dues: number;
}

/** Rent roll on `today`. */
export function rentRoll(leases: readonly Lease[], props: readonly Property[], clients: readonly Client[], invoices: readonly InvoiceRecord[], deposits: readonly SecurityDeposit[], today: string): RentRow[] {
  return leases.map((lease) => {
    const property = props.find((p) => p.id === lease.property_id);
    const dues = invoices.filter((i) => i.recurring_id && i.recurring_id === lease.schedule_id && i.status !== 'Draft' && i.status !== 'Cancelled').reduce((s, i) => s + Math.max(receivableBalance(i), 0), 0);
    return {
      lease, property, units: (property?.units ?? []).filter((u) => lease.unit_ids.includes(u.id)).map((u) => u.name).join(', '),
      tenant: clients.find((c) => c.id === lease.tenant_id)?.name ?? '',
      rent: escalatedAmount(lease.rent, lease.escalation, lease.start, today),
      next: lease.status === 'active' ? nextEscalation(lease.rent, lease.escalation, lease.start, today) : null,
      deposit: deposits.filter((d) => d.direction === 'received' && (d.lease_id === lease.id || d.id === lease.deposit_id)).reduce((s, d) => s + depositBalance(d), 0),
      dues: round2(dues),
    };
  });
}

export function rentRollCsv(rows: readonly RentRow[], head: readonly string[]): string {
  return toCsv([[...head], ...rows.map((r) => [r.property?.name ?? '', r.units, r.tenant, r.lease.start, r.lease.end, r.rent, r.next?.date ?? '', r.next?.to ?? '', r.deposit, r.dues, r.lease.status])]);
}

/** Informational late-payment interest on dues (simple, % a year) — never added to a document. */
export const lateInterest = (dues: number, pct: number | undefined, days: number) => (pct && dues > 0 && days > 0 ? round2((dues * pct * days) / 36500) : 0);
