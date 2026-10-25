/**
 * Tally-style global function keys (Phase 7, Tally parity). Part of the app shell, so it stays tiny:
 * a table of combo → route plus a pure resolver. Labels live in the lazy Gateway area catalogue.
 *
 * Rules (tested in tests/gateway-keys.test.ts):
 *  - never fires while typing in an input / textarea / select / contenteditable — not even the
 *    Ctrl/Alt combos (forms such as the voucher screen handle their own keys and preventDefault);
 *  - never fires on /pos (POS owns F2–F10) or while a modal dialog is open;
 *  - entries the signed-in role cannot use are skipped;
 *  - an entry without a route is a ready hook that does nothing until its screen exists.
 */
import type { AccessAction } from './access';
import { matchesEvent, parseCombo } from '../hooks/useHotkeys';

export type TallyKeyId =
  | 'date'
  | 'period'
  | 'contra'
  | 'payment'
  | 'receipt'
  | 'journal'
  | 'sales'
  | 'purchase'
  | 'creditNote'
  | 'debitNote'
  | 'stockJournal'
  | 'physicalStock'
  | 'features'
  | 'configure'
  | 'goto'
  | 'gotoCtrl'
  | 'help';

export interface TallyKey {
  id: TallyKeyId;
  combo: string;
  /** Route to open; null = hook ready, screen not built yet. */
  to: string | null;
  /** Router state for the Gateway (opens the date / period dialog or focuses Go To). */
  state?: { tally: 'date' | 'period' | 'goto' };
  need?: AccessAction;
}

export const TALLY_KEYS: readonly TallyKey[] = [
  { id: 'date', combo: 'f2', to: '/gateway', state: { tally: 'date' } },
  { id: 'period', combo: 'alt+f2', to: '/gateway', state: { tally: 'period' } },
  { id: 'contra', combo: 'f4', to: '/gateway/voucher/contra', need: 'books.edit' },
  { id: 'payment', combo: 'f5', to: '/gateway/voucher/payment', need: 'books.edit' },
  { id: 'receipt', combo: 'f6', to: '/gateway/voucher/receipt', need: 'books.edit' },
  { id: 'journal', combo: 'f7', to: '/gateway/voucher/journal', need: 'books.edit' },
  { id: 'sales', combo: 'f8', to: '/invoice', need: 'doc.create' },
  { id: 'purchase', combo: 'f9', to: '/expenses?new=bill', need: 'books.edit' },
  { id: 'creditNote', combo: 'mod+f8', to: '/invoice?type=CREDIT_NOTE', need: 'doc.create' },
  { id: 'debitNote', combo: 'mod+f9', to: '/invoice?type=DEBIT_NOTE', need: 'doc.create' },
  // Alt+F7 opens the stock vouchers (Stock / Manufacturing Journal), Ctrl+F7 Physical Stock (Phase 7, /manufacturing).
  { id: 'stockJournal', combo: 'alt+f7', to: '/manufacturing?tab=journal', need: 'books.edit' },
  { id: 'physicalStock', combo: 'mod+f7', to: '/manufacturing?tab=physical', need: 'books.edit' },
  { id: 'features', combo: 'f11', to: '/settings?tab=defaults' },
  { id: 'configure', combo: 'f12', to: '/settings' },
  { id: 'goto', combo: 'alt+g', to: '/gateway', state: { tally: 'goto' } },
  { id: 'gotoCtrl', combo: 'mod+g', to: '/gateway', state: { tally: 'goto' } },
  { id: 'help', combo: 'mod+/', to: null },
];

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface TallyKeyContext {
  pathname: string;
  typing: boolean;
  modalOpen?: boolean;
  can?: (action: AccessAction) => boolean;
}

export const isPosPath = (pathname: string) => pathname === '/pos' || pathname.startsWith('/pos/');

/** The Tally key an event stands for in this context, or null. `help` is returned for Ctrl+/. */
export function resolveTallyKey(e: KeyLike, ctx: TallyKeyContext): TallyKey | null {
  if (ctx.typing || ctx.modalOpen || isPosPath(ctx.pathname)) return null;
  const hit = TALLY_KEYS.find((k) => matchesEvent(parseCombo(k.combo), e as KeyboardEvent));
  if (!hit) return null;
  if (hit.need && ctx.can && !ctx.can(hit.need)) return null;
  if (hit.id !== 'help' && !hit.to) return null;
  return hit;
}
