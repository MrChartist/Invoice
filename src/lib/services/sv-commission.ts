/**
 * SV-A3 staff commission (pure): per line, per staff (`line.sv.staff_id`, assistant split `assist_id` / `assist_pct`),
 * on the line's TAXABLE value (GST excluded) or a fixed ₹ per unit. The nearest rule wins (item > category > kind).
 * A prepaid package redemption earns on the redeemed value (price ÷ sessions); a package / membership sale earns only
 * its own rule (default 0) — no double commission. Credit notes take back; drafts and cancelled bills earn nothing.
 * Basis `receipt` earns pro rata as the bill is paid (no-cash receipt rows — write-offs, vouchers — never count).
 * Monthly slab: above the target the `add` % applies to the excess, or `replace` re-rates the excess.
 * A working paper for payroll / payouts — TDS on commission is a CA call (SV16).
 */
import type { InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { CommissionKind, CommissionPlan, CommissionRule, ServiceStaff } from '../../types/services-r10';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { movedNoCash } from '../advance-tax';
import { isoDay } from '../dates';

export interface CommissionData {
  invoices: readonly InvoiceRecord[];
  payments: readonly Payment[];
  plans: readonly CommissionPlan[];
  /** Catalogue / stock items: id, name and category (stock group) for item and category rules. */
  items?: readonly { id: string; name: string; group_id?: string; category?: string }[];
}

export interface StatementLine {
  invoice_id: string;
  number: string;
  date: string;
  item: string;
  kind: CommissionKind;
  role: 'staff' | 'assist';
  base: number;
  /** `12.5%` or `₹50 × 2`. */
  rate: string;
  amount: number;
}

export interface Statement {
  lines: StatementLine[];
  base: number;
  serviceBase: number;
  commission: number;
  uplift: number;
  total: number;
}

const norm = (s: string | undefined) => String(s ?? '').trim().toLowerCase();

/** The kind of a sold line. */
export function lineKind(l: InvoiceItem, inv: Pick<InvoiceRecord, 'sv'>): CommissionKind {
  if (l.sv?.redeem) return 'package_redemption';
  if (inv.sv?.membership) return 'membership_sale';
  return l.type === 'Goods' || l.type === 'Product' ? 'product' : 'service';
}

/** The nearest rule for a line: item, then category, then kind. */
export function ruleFor(plan: CommissionPlan | undefined, l: InvoiceItem, kind: CommissionKind, items: CommissionData['items'] = []): CommissionRule | undefined {
  if (!plan) return undefined;
  const item = items.find((i) => norm(i.name) === norm(l.name));
  const cat = item?.category ?? item?.group_id;
  return (item && plan.rules.find((r) => r.item_id === item.id))
    ?? (cat ? plan.rules.find((r) => !r.item_id && r.category === cat) : undefined)
    ?? plan.rules.find((r) => !r.item_id && !r.category && r.kind === kind);
}

/** The commission of one staff member on one document (signed; GST excluded). */
export function documentCommission(inv: InvoiceRecord, staff: Pick<ServiceStaff, 'id' | 'plan_id'>, data: CommissionData): StatementLine[] {
  const plan = data.plans.find((p) => p.id === staff.plan_id);
  const calc = calculateInvoice(calcInputFromRecord(inv));
  const taxable = new Map(calc.lines.map((c) => [c.id, num(c.taxable)]));
  const sign = inv.doc_type === 'CREDIT_NOTE' ? -1 : 1;
  const out: StatementLine[] = [];
  for (const l of inv.items ?? []) {
    const sv = l?.sv;
    if (!sv || (sv.staff_id !== staff.id && sv.assist_id !== staff.id)) continue;
    const assistPct = sv.assist_id ? Math.min(100, Math.max(0, num(sv.assist_pct))) : 0;
    const share = (sv.staff_id === staff.id ? 100 - assistPct : 0) + (sv.assist_id === staff.id ? assistPct : 0);
    if (!share) continue;
    const kind = lineKind(l, inv);
    const base = round2(sign * (kind === 'package_redemption' ? num(sv.redeem?.value) : taxable.get(l.id) ?? 0) * share / 100);
    const rule = ruleFor(plan, l, kind, data.items);
    const qty = sign * num(l.quantity) * share / 100;
    const amount = !rule ? 0 : rule.per_unit ? round2(qty * num(rule.per_unit)) : round2((base * num(rule.pct)) / 100);
    out.push({
      invoice_id: inv.id, number: inv.invoice_number, date: isoDay(inv.issue_date), item: l.name, kind,
      role: sv.staff_id === staff.id ? 'staff' : 'assist', base,
      rate: !rule ? '0%' : rule.per_unit ? `₹${num(rule.per_unit)} × ${round2(Math.abs(qty))}` : `${num(rule.pct)}%`, amount,
    });
  }
  return out;
}

const counts = (inv: InvoiceRecord) => isRevenueDoc(inv) || (inv.doc_type === 'CREDIT_NOTE' && inv.status !== 'Draft' && inv.status !== 'Cancelled');

/** Commission statement of a staff member for a month (`YYYY-MM`). */
export function commissionFor(staff: Pick<ServiceStaff, 'id' | 'plan_id'>, month: string, data: CommissionData): Statement {
  const plan = data.plans.find((p) => p.id === staff.plan_id);
  const lines: StatementLine[] = [];
  if (plan?.basis === 'receipt') {
    const byInv = new Map(data.invoices.filter((i) => i && isRevenueDoc(i)).map((i) => [i.id, i]));
    const paid = new Map<string, number>();
    const rows = data.payments.filter((p) => p && byInv.has(p.invoice_id) && !movedNoCash(p)).slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const p of rows) {
      const inv = byInv.get(p.invoice_id)!;
      const total = num(inv.total);
      if (!(total > 0)) continue;
      const before = paid.get(inv.id) ?? 0;
      const upto = Math.min(before + num(p.amount), total);
      paid.set(inv.id, upto);
      const day = isoDay(p.date);
      if (day.slice(0, 7) !== month) continue;
      const f = (upto - before) / total;
      if (f > 0) for (const l of documentCommission(inv, staff, data)) lines.push({ ...l, date: day, base: round2(l.base * f), amount: round2(l.amount * f) });
    }
    // Credit notes take back in the month they are issued.
    for (const inv of data.invoices) if (inv?.doc_type === 'CREDIT_NOTE' && counts(inv) && isoDay(inv.issue_date).slice(0, 7) === month) lines.push(...documentCommission(inv, staff, data));
  } else {
    for (const inv of data.invoices) if (inv && counts(inv) && isoDay(inv.issue_date).slice(0, 7) === month) lines.push(...documentCommission(inv, staff, data));
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  const base = round2(lines.reduce((s, l) => s + l.base, 0));
  const serviceBase = round2(lines.filter((l) => l.kind === 'service' || l.kind === 'package_redemption').reduce((s, l) => s + l.base, 0));
  const commission = round2(lines.reduce((s, l) => s + l.amount, 0));
  let uplift = 0;
  const slab = plan?.slab;
  if (slab) {
    const slabBase = slab.base === 'service' ? serviceBase : base;
    const excess = slabBase - slab.target;
    if (excess > 0) {
      const earnedOnSlabBase = lines.filter((l) => slab.base === 'all' || l.kind === 'service' || l.kind === 'package_redemption').reduce((s, l) => s + l.amount, 0);
      const normalRate = slabBase > 0 ? earnedOnSlabBase / slabBase : 0;
      uplift = round2(slab.mode === 'add' ? (excess * slab.pct) / 100 : excess * (slab.pct / 100 - normalRate));
    }
  }
  return { lines, base, serviceBase, commission, uplift, total: round2(commission + uplift) };
}

/** Statement CSV rows (header first). */
export const statementRows = (st: Statement): (string | number)[][] => [
  ['Date', 'Bill', 'Item', 'Kind', 'Role', 'Base (taxable)', 'Rate', 'Commission'],
  ...st.lines.map((l) => [l.date, l.number, l.item, l.kind, l.role, l.base, l.rate, l.amount]),
  ['', '', '', '', '', st.base, 'Slab uplift', st.uplift],
  ['', '', '', '', '', '', 'Total', st.total],
];
