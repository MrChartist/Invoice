/**
 * R5-C1 fee plans: heads (exempt / nil / taxable, once or per instalment), instalments with shares that sum to
 * 100, an optional late fine, and the presets that fill the tax class (working paper — verify with your CA).
 * Pure helpers + a small guarded store (`fee_plans`, `master.edit`).
 */
import type { FeeFine, FeeHead, FeeInstalment, FeePlan, FeePreset, FeeTax } from '../../types/institutions-r5';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { round2 } from '../invoice-calc';
import { FEE_PLANS_TABLE, FEE_RUNS_TABLE, R5cError, day, daysFrom, money, str } from './r5c';

/** Plan presets: tax class + SAC of a new head (entry 66 / entry 74 exemptions; coaching 18%) — verify with your CA. */
export const FEE_PRESETS: Readonly<Record<FeePreset, { tax: FeeTax; gst_rate?: number; sac: string }>> = {
  education: { tax: 'exempt', sac: '9992' },
  coaching: { tax: 'taxable', gst_rate: 18, sac: '999293' },
  clinic: { tax: 'exempt', sac: '9993' },
};

const TAXES: readonly FeeTax[] = ['exempt', 'nil', 'taxable'];

function cleanHead(h: Partial<FeeHead>): FeeHead {
  const tax = TAXES.includes(h.tax as FeeTax) ? (h.tax as FeeTax) : 'exempt';
  return {
    name: str(h.name),
    amount: Math.max(money(h.amount), 0),
    ...(str(h.sac) ? { sac: str(h.sac) } : {}),
    tax,
    ...(tax === 'taxable' ? { gst_rate: Math.max(money(h.gst_rate), 0) } : {}),
    frequency: h.frequency === 'once' ? 'once' : 'per_instalment',
    ...(Number(h.sessions) > 0 ? { sessions: Math.floor(Number(h.sessions)) } : {}),
  };
}

export function normalizePlan(raw: unknown): FeePlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<FeePlan>;
  const id = str(o.id);
  if (!id) return null;
  const fine = o.fine && typeof o.fine === 'object' ? o.fine : undefined;
  return {
    ...(o as FeePlan),
    id,
    name: str(o.name) || 'Fee plan',
    year_label: str(o.year_label),
    heads: Array.isArray(o.heads) ? o.heads.map(cleanHead) : [],
    instalments: Array.isArray(o.instalments) ? o.instalments.map((i) => ({ label: str(i?.label), due_date: day(i?.due_date), share: money(i?.share) })) : [],
    ...(fine ? { fine: { kind: fine.kind === 'per_day' ? 'per_day' : 'flat', amount: money(fine.amount), grace_days: Math.max(0, Math.floor(Number(fine.grace_days) || 0)), ...(money(fine.cap) > 0 ? { cap: money(fine.cap) } : {}) } } : {}),
  };
}

export function loadPlans(): FeePlan[] {
  return peekTable<unknown>(FEE_PLANS_TABLE).flatMap((r) => normalizePlan(r) ?? []);
}

/** Problems with a plan (empty = fine). Codes: name, heads, head, rate, instalments, shares, date. */
export function validatePlan(p: Pick<FeePlan, 'name' | 'heads' | 'instalments'>): string[] {
  const out: string[] = [];
  if (!str(p.name)) out.push('name');
  if (!p.heads.length) out.push('heads');
  if (p.heads.some((h) => !str(h.name) || !(h.amount > 0))) out.push('head');
  if (p.heads.some((h) => h.tax === 'taxable' && !(Number(h.gst_rate) > 0))) out.push('rate');
  if (!p.instalments.length) out.push('instalments');
  else {
    if (Math.abs(p.instalments.reduce((s, i) => s + money(i.share), 0) - 100) > 0.001) out.push('shares');
    if (p.instalments.some((i) => !day(i.due_date))) out.push('date');
  }
  return out;
}

export function savePlan(input: Omit<FeePlan, 'id'> & { id?: string }): FeePlan {
  requireAccess('master.edit');
  const plan = normalizePlan({ ...input, id: input.id || generateId() })!;
  const bad = validatePlan(plan);
  if (bad.length) throw new R5cError(bad[0]);
  const all = getTable<FeePlan>(FEE_PLANS_TABLE);
  const now = new Date().toISOString();
  const prev = all.find((p) => p.id === plan.id);
  const row = { ...plan, created_at: prev?.created_at ?? now, ...(prev ? { updated_at: now } : {}) };
  setTable(FEE_PLANS_TABLE, prev ? all.map((p) => (p.id === row.id ? row : p)) : [...all, row]);
  return row;
}

/** Delete a plan nothing was billed on (`master.edit`). */
export function deletePlan(id: string): void {
  requireAccess('master.edit');
  if (peekTable<{ plan_id?: string; undone?: boolean }>(FEE_RUNS_TABLE).some((r) => r.plan_id === id && !r.undone)) throw new R5cError('inUse');
  setTable(FEE_PLANS_TABLE, getTable<FeePlan>(FEE_PLANS_TABLE).filter((p) => p.id !== id));
}

/** Equal shares for `n` instalments (the last one takes the rounding). */
export function equalShares(n: number): number[] {
  const k = Math.max(1, Math.floor(n));
  const s = round2(100 / k);
  return Array.from({ length: k }, (_, i) => (i === k - 1 ? round2(100 - s * (k - 1)) : s));
}

export interface FeeLine {
  head: FeeHead;
  amount: number;
}

/**
 * The heads billed on instalment `idx`: once-heads in full on the first instalment, per-instalment heads by share
 * (the last instalment takes the rounding, so the instalments add up to the head exactly).
 */
export function instalmentLines(plan: Pick<FeePlan, 'heads' | 'instalments'>, idx: number): FeeLine[] {
  const inst = plan.instalments;
  if (idx < 0 || idx >= inst.length) return [];
  const out: FeeLine[] = [];
  for (const head of plan.heads) {
    if (head.frequency === 'once') {
      if (idx === 0) out.push({ head, amount: round2(head.amount) });
      continue;
    }
    const part = (k: number) => round2((head.amount * money(inst[k].share)) / 100);
    const amount = idx === inst.length - 1 ? round2(head.amount - inst.slice(0, -1).reduce((s, _i, k) => s + part(k), 0)) : part(idx);
    if (amount > 0) out.push({ head, amount });
  }
  return out;
}

/**
 * The documents an instalment needs: exempt / nil heads on a Bill of Supply, taxable heads on a tax invoice — a mixed
 * plan gives TWO documents, never one mixed document (§7 Q8).
 */
export function splitByTax(lines: readonly FeeLine[]): { bos: FeeLine[]; tax: FeeLine[]; exemptKind: 'EXEMPT' | 'NIL' } {
  const bos = lines.filter((l) => l.head.tax !== 'taxable');
  return { bos, tax: lines.filter((l) => l.head.tax === 'taxable'), exemptKind: bos.some((l) => l.head.tax === 'exempt') ? 'EXEMPT' : 'NIL' };
}

/** Fine due on `today` for an instalment due on `due` (0 inside the grace days); per-day fines stop at the cap. */
export function fineDue(fine: FeeFine | undefined, due: string, today: string): number {
  if (!fine || !(fine.amount > 0) || !day(due)) return 0;
  const late = daysFrom(due, today) - fine.grace_days;
  if (late <= 0) return 0;
  const v = fine.kind === 'per_day' ? fine.amount * late : fine.amount;
  return round2(fine.cap ? Math.min(v, fine.cap) : v);
}

/** Head preset → the fields a new head gets. */
export function presetHead(preset: FeePreset | undefined, name: string, amount: number): FeeHead {
  const p = FEE_PRESETS[preset ?? 'education'];
  return cleanHead({ name, amount, sac: p.sac, tax: p.tax, gst_rate: p.gst_rate, frequency: 'per_instalment' });
}

export type { FeeInstalment };
