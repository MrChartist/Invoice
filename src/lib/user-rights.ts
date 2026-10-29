/**
 * Finer user rights — rules, presets, storage and the data-layer check (8H, roadmap 8.124).
 * The tiny part the shell needs (the role filter `rightsCan`, `isPosOnly`, the check hook) is `rights.ts`.
 *
 * Convenience access control, not security (see access.ts). Rights live on the device-local user
 * record (`mrchartist_inv_auth_users`) like the payroll grant: never backed up, never synced, every
 * change audited. They only narrow a clerk / viewer; the owner is never restricted by them and no
 * owner-only action (delete issued, settings, restore, erase, period override, approvals) is lifted.
 *
 * Importing this module registers the data-layer check (`setDocRightCheck`); until then a user WITH
 * rights is refused document writes ("still loading"), so nothing slips through on a slow start.
 */
import { AccessDeniedError, currentActor, currentRole, requireAccess } from './access';
import { audit } from './audit';
import { OWNER_ID, announceUserChange, readUsers, writeUsers } from './auth';
import { localDayOf } from './dates';
import { setRightsRules, type RightDoc, type RightOp, type RightsDoc, type UserRights } from './rights';

export type { RightDoc, RightOp, UserRights };

export class RightsError extends Error {
  readonly code = 'ACCESS_DENIED';
  constructor(message: string) {
    super(message);
    this.name = 'RightsError';
  }
}

export const RIGHT_DOCS: readonly RightDoc[] = ['sales', 'quote', 'note', 'challan', 'payment', 'purchase', 'voucher'];
export const RIGHT_OPS: readonly RightOp[] = ['create', 'alter', 'delete', 'print'];

export function rightAllows(rights: UserRights | undefined | null, doc: RightDoc, op: RightOp): boolean {
  return rights?.docs?.[doc]?.[op] !== false;
}

const SALES_DOCS: readonly RightDoc[] = ['sales', 'quote', 'note', 'challan'];

/** What finer rights do to an access action (narrowing only; actions without a document meaning pass). */
export function rightsFilter(rights: UserRights, action: string): boolean {
  const any = (op: RightOp) => SALES_DOCS.some((d) => rightAllows(rights, d, op));
  switch (action) {
    case 'doc.create':
      return any('create');
    case 'doc.edit':
      return any('alter');
    case 'doc.deleteDraft':
      return any('delete');
    case 'payment.record':
      return rightAllows(rights, 'payment', 'create');
    case 'books.edit':
      // A POS cashier still closes the day (Z report) and writes stock as a side effect of a sale.
      return !!rights.pos_only || rightAllows(rights, 'purchase', 'create') || rightAllows(rights, 'voucher', 'create');
    case 'master.edit':
    case 'report.export':
      return !rights.pos_only;
    default:
      return true;
  }
}

/** Stored document type (or a right family) → right family. */
export function docKindOf(docType: string | undefined): RightDoc {
  if (docType && (RIGHT_DOCS as readonly string[]).includes(docType)) return docType as RightDoc;
  switch (docType) {
    case 'QUOTATION':
    case 'PROFORMA':
    case 'SALES_ORDER':
      return 'quote';
    case 'CREDIT_NOTE':
    case 'DEBIT_NOTE':
      return 'note';
    case 'DELIVERY_CHALLAN':
      return 'challan';
    default:
      return 'sales';
  }
}

const DAY = 86_400_000;
const dayNum = (iso: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY : NaN;
};

/** '' when `date` (YYYY-MM-DD) is inside the back-dated window ending `today`; otherwise the reason. */
export function backdateProblem(rights: UserRights | undefined | null, date: string | undefined, today: string): string {
  const days = rights?.back_days;
  if (days === undefined || days === null || !Number.isFinite(days) || days < 0 || !date) return '';
  const gap = dayNum(today) - dayNum(date);
  if (!Number.isFinite(gap) || gap <= days) return '';
  return days === 0
    ? `Your user may only enter documents dated today (${date} is ${gap} day(s) back). Ask the owner.`
    : `Your user may enter documents up to ${days} day(s) back; ${date} is ${gap} day(s) back. Ask the owner.`;
}

/** '' when `percent` is within the user's discount cap; otherwise the reason. */
export function discountProblem(rights: UserRights | undefined | null, percent: number): string {
  const cap = rights?.discount_cap;
  if (cap === undefined || cap === null || !Number.isFinite(cap) || !(percent > cap + 1e-9)) return '';
  return `Your user may give at most ${cap}% discount (this document has ${Math.round(percent * 100) / 100}%). Ask the owner.`;
}

/** The highest discount % a document carries (line discounts and the bill discount). */
export function maxDiscountPercent(doc: RightsDoc | undefined): number {
  if (!doc) return 0;
  let max = 0;
  for (const l of doc.items ?? []) max = Math.max(max, Number(l.discount_percent) || 0);
  if (doc.discount_type === 'PERCENT') max = Math.max(max, Number(doc.discount_rate) || 0);
  else if (Number(doc.subtotal) > 0 && Number(doc.discount_amount) > 0) max = Math.max(max, (Number(doc.discount_amount) / Number(doc.subtotal)) * 100);
  return max;
}

/** Preset: a POS-only cashier — sells and takes money at the counter, today only, up to 10 % discount. */
export const POS_CASHIER: UserRights = {
  preset: 'pos_cashier',
  pos_only: true,
  back_days: 0,
  discount_cap: 10,
  docs: {
    sales: { alter: false, delete: false },
    quote: { create: false, alter: false, delete: false, print: false },
    note: { create: false, alter: false, delete: false, print: false },
    challan: { create: false, alter: false, delete: false, print: false },
    payment: { alter: false, delete: false },
    purchase: { create: false, alter: false, delete: false, print: false },
    voucher: { create: false, alter: false, delete: false, print: false },
  },
};

/** Validate a stored / typed rights object; undefined when nothing restrictive is left. */
export function cleanRights(raw: unknown): UserRights | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: UserRights = {};
  const docsIn = r.docs && typeof r.docs === 'object' ? (r.docs as Record<string, unknown>) : {};
  const docs: NonNullable<UserRights['docs']> = {};
  for (const d of RIGHT_DOCS) {
    const ops = docsIn[d] && typeof docsIn[d] === 'object' ? (docsIn[d] as Record<string, unknown>) : null;
    if (!ops) continue;
    const row: Partial<Record<RightOp, boolean>> = {};
    for (const op of RIGHT_OPS) if (ops[op] === false) row[op] = false;
    if (Object.keys(row).length) docs[d] = row;
  }
  if (Object.keys(docs).length) out.docs = docs;
  const given = (v: unknown) => v !== undefined && v !== null && v !== '';
  const back = Number(r.back_days);
  if (given(r.back_days) && Number.isFinite(back) && back >= 0) out.back_days = Math.floor(back);
  const cap = Number(r.discount_cap);
  if (given(r.discount_cap) && Number.isFinite(cap) && cap >= 0 && cap <= 100) out.discount_cap = cap;
  if (r.pos_only === true) out.pos_only = true;
  if (!Object.keys(out).length) return undefined;
  if (r.preset === 'pos_cashier' || r.preset === 'custom') out.preset = r.preset;
  return out;
}

/** The pure check behind `checkDocRight` (throws). `today` is injectable for tests. */
export function enforceRights(rights: UserRights, kind: string, op: RightOp, date?: string, doc?: RightsDoc, today: string = localDayOf(new Date())): void {
  const family = docKindOf(kind);
  if (!rightAllows(rights, family, op)) {
    // PENDING 52: purchase bills and vouchers name their own type.
    if (family === 'purchase' || family === 'voucher') throw new RightsError(`Your user may not ${op === 'alter' ? 'change' : op} ${family === 'purchase' ? 'purchase bills' : 'vouchers'}. Ask the owner.`);
    throw new AccessDeniedError(op === 'delete' ? 'doc.deleteDraft' : op === 'alter' ? 'doc.edit' : 'doc.create', currentRole());
  }
  if (op !== 'create' && op !== 'alter') return;
  const late = backdateProblem(rights, date, today);
  if (late) throw new RightsError(late);
  const over = discountProblem(rights, maxDiscountPercent(doc));
  if (over) throw new RightsError(over);
}

setRightsRules({ filter: rightsFilter, check: (rights, kind, op, date, doc) => enforceRights(rights, kind, op, date, doc) });

/** May the signed-in user do `op` on a document of `docType` (or a right family)? Owner: always. */
export function canDocRight(docType: string, op: RightOp): boolean {
  const a = currentActor();
  return !a || a.role === 'owner' || rightAllows(a.rights, docKindOf(docType), op);
}

/** The clerks / viewers on this device and their rights. */
export function rightsHolders(): { id: string; name: string; role: 'clerk' | 'viewer'; rights?: UserRights }[] {
  return readUsers().map((u) => ({ id: u.id, name: u.name, role: u.role, ...(u.rights ? { rights: u.rights } : {}) }));
}

export function describeRights(r: UserRights | undefined): string {
  if (!r) return 'no extra limits';
  const parts: string[] = [];
  if (r.pos_only) parts.push('POS only');
  if (r.back_days !== undefined) parts.push(`back-dated ${r.back_days} day(s)`);
  if (r.discount_cap !== undefined) parts.push(`discount cap ${r.discount_cap}%`);
  const denied = Object.entries(r.docs ?? {}).flatMap(([d, ops]) => Object.keys(ops ?? {}).map((op) => `${d}.${op}`));
  if (denied.length) parts.push(`denied: ${denied.join(', ')}`);
  return parts.join('; ') || 'no extra limits';
}

/** Save one user's rights (undefined / empty clears them). Owner only (`security.manage`); audited. */
export function setUserRights(userId: string, rights: UserRights | undefined): UserRights | undefined {
  requireAccess('security.manage');
  if (userId === OWNER_ID) throw new RightsError('The owner always has every right.');
  const users = readUsers();
  const u = users.find((x) => x.id === userId);
  if (!u) throw new RightsError('That user no longer exists.');
  const clean = cleanRights(rights);
  const next = { ...u };
  if (clean) next.rights = clean;
  else delete next.rights;
  writeUsers(users.map((x) => (x.id === userId ? next : x)));
  audit.record({
    entity: 'settings',
    entity_id: 'users',
    action: 'update',
    summary: `User rights for ${u.name} (${u.role}) changed: ${describeRights(u.rights)} → ${describeRights(clean)}`,
  });
  announceUserChange();
  return clean;
}
