/**
 * R5-C1 enrolment: a student / patient is a `clients` row with additive pack fields (roll no. / UHID, class /
 * batch, guardian, enrolments with concessions). Concessions become line discounts with the reason printed;
 * bulk enrol from CSV maps columns by header synonyms (`findCol`).
 */
import type { Client } from '../../types/invoice';
import type { Concession, Enrolment } from '../../types/institutions-r5';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { round2 } from '../invoice-calc';
import { R5cError, day, findCol, money, str } from './r5c';
import type { FeeLine } from './fee-plans';

/** Students / patients enrolled on a plan (optionally one class / batch). */
export function studentsOf(planId: string, clients: readonly Client[], classLabel?: string): Client[] {
  const cl = str(classLabel).toLowerCase();
  return clients.filter((c) => (c.enrolments ?? []).some((e) => e.plan_id === planId) && (!cl || str(c.class_label).toLowerCase() === cl));
}

export const enrolmentOf = (c: Pick<Client, 'enrolments'>, planId: string): Enrolment | undefined => (c.enrolments ?? []).find((e) => e.plan_id === planId);

export interface DiscountedLine extends FeeLine {
  /** Rupees off the head. */
  discount: number;
  /** Printed reason(s): "Sibling 10%". */
  note: string;
}

/**
 * Concessions as line discounts: `pct` takes that share of the head (or of every head when none is named);
 * `amount` comes off the named head, or off the heads in order when none is named. Never below zero.
 */
export function applyConcessions(lines: readonly FeeLine[], concessions: readonly Concession[] = []): DiscountedLine[] {
  const out: DiscountedLine[] = lines.map((l) => ({ ...l, discount: 0, note: '' }));
  const add = (l: DiscountedLine, v: number, c: Concession) => {
    const off = round2(Math.min(v, l.amount - l.discount));
    if (off <= 0) return 0;
    l.discount = round2(l.discount + off);
    const what = c.kind === 'pct' ? `${c.value}%` : `₹${off}`;
    l.note = [l.note, `${str(c.reason) || 'Concession'} ${what}`].filter(Boolean).join('; ');
    return off;
  };
  for (const c of concessions) {
    const value = money(c.value);
    if (!(value > 0)) continue;
    const targets = out.filter((l) => !c.head || l.head.name.toLowerCase() === c.head.toLowerCase());
    if (c.kind === 'pct') for (const l of targets) add(l, (l.amount * Math.min(value, 100)) / 100, c);
    else {
      let left = value;
      for (const l of targets) if (left > 0) left = round2(left - add(l, left, c));
    }
  }
  return out;
}

export interface EnrolInput {
  id?: string;
  name: string;
  roll_no?: string;
  class_label?: string;
  guardian?: { name?: string; phone?: string };
  phone?: string;
}

/** Create / update the party and put it on the plan (one enrolment per plan; concessions replaced). */
export function enrol(input: EnrolInput, e: Enrolment): string {
  requireAccess('master.edit');
  if (!str(input.name)) throw new R5cError('name');
  if (!str(e.plan_id) || !day(e.from)) throw new R5cError('plan');
  const prev = input.id ? localDb.clients.getById(input.id) : undefined;
  const others = (prev?.enrolments ?? []).filter((x) => x.plan_id !== e.plan_id);
  const g = input.guardian;
  return localDb.clients.upsert({
    ...(prev ?? { email: '', address: '', city: '', zip: '' }),
    ...(input.id ? { id: input.id } : {}),
    name: str(input.name),
    ...(str(input.roll_no) ? { roll_no: str(input.roll_no) } : {}),
    ...(str(input.class_label) ? { class_label: str(input.class_label) } : {}),
    ...(g && (str(g.name) || str(g.phone)) ? { guardian: { name: str(g.name), phone: str(g.phone) } } : {}),
    ...(str(input.phone) || str(g?.phone) ? { phone: str(input.phone) || str(g?.phone) } : {}),
    enrolments: [...others, { ...e, concessions: (e.concessions ?? []).filter((c) => money(c.value) > 0) }],
  });
}

export function unenrol(clientId: string, planId: string): void {
  requireAccess('master.edit');
  const c = localDb.clients.getById(clientId);
  if (c) localDb.clients.upsert({ ...c, enrolments: (c.enrolments ?? []).filter((e) => e.plan_id !== planId) });
}

/** Clinic package: record a visit (a ₹0 consumption entry). Refused when no session is left. */
export function recordVisit(clientId: string, planId: string, date: string, sessions: number): number {
  requireAccess('doc.create');
  const c = localDb.clients.getById(clientId);
  const e = c && enrolmentOf(c, planId);
  if (!c || !e) throw new R5cError('plan');
  const visits = [...(e.visits ?? []), day(date)].filter(Boolean);
  if (visits.length > sessions) throw new R5cError('noSessions');
  localDb.clients.upsert({ ...c, enrolments: (c.enrolments ?? []).map((x) => (x.plan_id === planId ? { ...x, visits } : x)) });
  return sessions - visits.length;
}

/* ── Bulk enrol (CSV) ────────────────────────────────────────── */

export const ENROL_FIELDS = {
  name: ['name', 'student name', 'patient name', 'student', 'patient'],
  roll_no: ['roll no', 'roll number', 'admission no', 'uhid', 'reg no'],
  class_label: ['class', 'batch', 'section', 'grade', 'standard'],
  guardian: ['guardian', 'guardian name', 'parent', 'father name', 'mother name'],
  phone: ['phone', 'mobile', 'guardian phone', 'contact', 'whatsapp'],
} as const;
export type EnrolField = keyof typeof ENROL_FIELDS;

/** Column index per field (−1 = not found): exact header first, then a header containing the synonym. */
export function mapEnrolColumns(headers: readonly string[]): Record<EnrolField, number> {
  const out = {} as Record<EnrolField, number>;
  const used = new Set<number>();
  for (const f of Object.keys(ENROL_FIELDS) as EnrolField[]) {
    out[f] = findCol(headers, ENROL_FIELDS[f], used);
    if (out[f] >= 0) used.add(out[f]);
  }
  return out;
}

/** Rows of a CSV as enrol inputs (rows without a name are skipped). */
export function enrolRowsFromCsv(headers: readonly string[], rows: readonly (readonly string[])[]): EnrolInput[] {
  const m = mapEnrolColumns(headers);
  const cell = (r: readonly string[], f: EnrolField) => (m[f] >= 0 ? str(r[m[f]]) : '');
  return rows.flatMap((r) => {
    const name = cell(r, 'name');
    return name ? [{ name, roll_no: cell(r, 'roll_no'), class_label: cell(r, 'class_label'), guardian: { name: cell(r, 'guardian'), phone: cell(r, 'phone') } }] : [];
  });
}

/** Enrol many at once (matched to existing parties by roll no., else by name). Returns the count. */
export function bulkEnrol(inputs: readonly EnrolInput[], e: Omit<Enrolment, 'concessions'>): number {
  const all = localDb.clients.getAll();
  let n = 0;
  for (const i of inputs) {
    const hit = (i.roll_no && all.find((c) => str(c.roll_no) === i.roll_no)) || all.find((c) => str(c.name).toLowerCase() === i.name.toLowerCase());
    enrol({ ...i, ...(hit?.id ? { id: hit.id } : {}) }, { ...e, concessions: hit ? (enrolmentOf(hit, e.plan_id)?.concessions ?? []) : [] });
    n++;
  }
  return n;
}
