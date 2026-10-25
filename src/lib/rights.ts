/**
 * Finer user rights for clerks / viewers (8H, roadmap 8.124) — Tally-style "security levels".
 *
 * CONVENIENCE ACCESS CONTROL, NOT SECURITY (same caveat as access.ts): anyone with the device and
 * the browser's developer tools can bypass these checks. They stop a counter clerk from editing
 * yesterday's bills or giving away 40 % discounts by mistake.
 *
 * Rights only ever NARROW what a role already allows. They are stored on the device-local user record
 * (`mrchartist_inv_auth_users`, like the payroll grant), never in a backup, and are ignored for the
 * owner — owner-only actions (delete issued, settings, restore, erase, period override, approvals)
 * can never be lifted by them.
 *
 * This module imports nothing and stays tiny (access.ts, and so the first paint, carries it). Everything
 * else — presets, the back-dated window, the discount cap, saving a user's rights and the data-layer
 * checks — lives in `user-rights.ts`, which loads with the screens that need it.
 */

/** Document families a right is set for. */
export type RightDoc = 'sales' | 'quote' | 'note' | 'challan' | 'payment' | 'purchase' | 'voucher';
export type RightOp = 'create' | 'alter' | 'delete' | 'print';

export interface UserRights {
  /** `false` denies; absent / true leaves the role's own rule. */
  docs?: Partial<Record<RightDoc, Partial<Record<RightOp, boolean>>>>;
  /**
   * Back-dated entry window (Tally "days allowed"): a document may be dated at most this many days
   * before today when created or altered. 0 = today only. Absent = no limit (the period lock still applies).
   */
  back_days?: number;
  /** Highest discount % on any line or the bill. Absent = no cap. */
  discount_cap?: number;
  /** POS-only cashier: the sidebar shows the Dashboard and POS only. */
  pos_only?: boolean;
  /** Name of the preset last applied (display only). */
  preset?: 'pos_cashier' | 'custom';
}

type Filter = (rights: UserRights, action: string) => boolean;
let filter: Filter | null = null;

/**
 * Narrowing filter used by access.ts after the role matrix said yes (the rules live in `user-rights.ts`,
 * registered when it loads — the shell starts loading it at once for a user who has rights). Rights never
 * lift anything; document writes stay refused until the rules are in (`checkDocRight` fails closed).
 */
export function rightsCan(rights: UserRights | undefined | null, action: string): boolean {
  return !rights || !filter || filter(rights, action);
}

/** True when the signed-in clerk / viewer is a POS-only cashier. */
export function isPosOnly(actor: { role?: string; rights?: UserRights } | null | undefined): boolean {
  return !!actor && actor.role !== 'owner' && !!actor.rights?.pos_only;
}

/** Fields of a document the lazy checker looks at (discount cap). */
export type RightsDoc = { items?: readonly { discount_percent?: number }[]; discount_type?: string; discount_rate?: number; subtotal?: number; discount_amount?: number };
type Check = (rights: UserRights, kind: string, op: RightOp, date?: string, doc?: RightsDoc) => void;
let check: Check | null = null;

/** Registered by `user-rights.ts` when it loads. */
export function setRightsRules(rules: { filter: Filter; check: Check } | null): void {
  filter = rules?.filter ?? null;
  check = rules?.check ?? null;
}

/**
 * Data-layer check (throws) for a clerk / viewer with rights: the document right, the back-dated window
 * and the discount cap. No-op for the owner, single-user installs and users without rights. Fails closed
 * while the rules are still loading.
 */
export function checkDocRight(actor: { role?: string; rights?: UserRights } | null, kind: string, op: RightOp, date?: string, doc?: RightsDoc): void {
  if (!actor || actor.role === 'owner' || !actor.rights) return;
  if (!check) throw new Error('User rights are loading. Try again.');
  check(actor.rights, kind, op, date, doc);
}
