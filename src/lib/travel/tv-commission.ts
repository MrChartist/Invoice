/**
 * R15-C4 commission income: commission / PLB / incentive due from principals (airlines, consolidators, hotels,
 * insurers) — typed on bookings (`commission`) or earned on statements (net-remit commission) — grouped by principal
 * for a period, and "Bill commission": one draft invoice to the principal at 18 % (SAC by kind) with 194H expected
 * (rate by date from `tax-rules.ts`; the existing TDS receivable register lists it). An insurer's invoice is reverse
 * charge (the insurer pays the GST; TV17). Billed while that invoice is live (`commission_inv`), never a stored flag
 * that drifts. Working papers — verify with your CA (TV16, TV17).
 */
import './tv-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { SupplierStatement, TravelBooking } from '../../types/travel-r15';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { round2 } from '../invoice-calc';
import { ruleAt, tdsSections } from '../tax-rules';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { AIR_SAC_RULES } from '../travel-rules';
import { loadBookings } from './tv-bookings';
import { loadStatements } from './tv-statements';
import { TV_TABLES } from './tv-shared';

export interface CommissionDue { vendor_id: string; amount: number; insurance: boolean; air: boolean; bookings: string[]; statements: string[] }

/** Pure: unbilled commission of the period [from, to] by principal (bookings by start, statements by period end). */
export function commissionDue(bookings: readonly TravelBooking[], statements: readonly SupplierStatement[], live: ReadonlySet<string>, from: string, to: string): CommissionDue[] {
  const by = new Map<string, CommissionDue>();
  const row = (v: string) => by.get(v) ?? by.set(v, { vendor_id: v, amount: 0, insurance: true, air: false, bookings: [], statements: [] }).get(v)!;
  const open = (id?: string) => !id || !live.has(id);
  for (const b of bookings) {
    if (!(Number(b.commission) > 0) || !b.vendor_id || b.status === 'cancelled' || b.start < from || b.start > to || !open(b.commission_inv)) continue;
    const r = row(b.vendor_id);
    r.amount = round2(r.amount + Number(b.commission));
    r.bookings.push(b.id);
    if (b.component !== 'insurance') r.insurance = false;
    if (b.component === 'air') r.air = true;
  }
  for (const s of statements) {
    if (!(s.totals.commission > 0) || s.period_end < from || s.period_end > to || !open(s.commission_inv)) continue;
    const r = row(s.vendor_id);
    r.amount = round2(r.amount + s.totals.commission);
    r.statements.push(s.id);
    r.insurance = false;
    if (s.kind !== 'bedbank') r.air = true;
  }
  return [...by.values()];
}

const liveIds = () => new Set(localDb.invoices.getAll().filter((i) => i.status !== 'Cancelled').map((i) => i.id));

/** Unbilled commission now (reads bookings, statements and invoices). */
export const loadCommissionDue = (from: string, to: string) => commissionDue(loadBookings(), loadStatements(), liveIds(), from, to);

/** Draft commission invoice to one principal for [from, to] (`doc.create`). The principal becomes a client if needed. */
export function billCommission(vendorId: string, from: string, to: string, date?: string): InvoiceRecord {
  requireAccess('doc.create');
  const due = loadCommissionDue(from, to).find((d) => d.vendor_id === vendorId);
  if (!due?.amount) throw new Error('No commission is due from this principal in the period.');
  const v = getTable<{ id: string; name: string; gstin?: string; state_code?: string; client_id?: string }>('vendors').find((x) => x.id === vendorId);
  if (!v) throw new Error('This supplier is no longer on the list.');
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings: localDb.settings.get(), sender, docType: 'INVOICE', templateId: localDb.template.get() });
  const day = date ?? base.issue_date;
  const sac = ruleAt(AIR_SAC_RULES, day);
  const tds = tdsSections(day).find((s) => s.section === '194H')?.rate ?? 0;
  return withTablesRollback(['invoices', 'clients', TV_TABLES.bookings, TV_TABLES.statements], () => {
    const clients = localDb.clients.getAll();
    const name = v.name.trim().toLowerCase();
    const client = (v.client_id && localDb.clients.getById(v.client_id)) || clients.find((c) => (v.gstin && c.gstin === v.gstin) || c.name.trim().toLowerCase() === name)
      || localDb.clients.getById(localDb.clients.upsert({ ...blankClient(), name: v.name, ...(v.gstin ? { gstin: v.gstin } : {}), ...(v.state_code ? { state_code: v.state_code } : {}) }))!;
    const item = { id: generateId(), name: `Commission / incentive ${from} – ${to}`, type: 'Service', hsn: due.insurance ? sac.insurance : due.air ? sac.air : sac.other, unit: 'NOS', quantity: 1, rate: due.amount, amount: due.amount, tax_rate: sac.rate, discount_percent: 0 };
    const draft = buildBillDraft({ ...base, id: generateId(), issue_date: day, tds_enabled: tds > 0, tds_section: '194H', tds_rate: tds, tds_on_taxable: true, ...(due.insurance ? { reverse_charge: true, rcm_tax_excluded: true } : {}) }, client, [item], sender);
    const saved = localDb.invoices.save(draft);
    const bk = new Set(due.bookings), st = new Set(due.statements);
    setTable(TV_TABLES.bookings, getTable<TravelBooking>(TV_TABLES.bookings).map((b) => (bk.has(b.id) ? { ...b, commission_inv: saved.id } : b)));
    if (st.size) setTable(TV_TABLES.statements, loadStatements().map((s) => (st.has(s.id) ? { ...s, commission_inv: saved.id } : s)));
    return saved;
  });
}
