/**
 * Quick create (8H, Vyapar-style "+"): the phone tab bar's "+" opens a sheet of the everyday
 * "new …" actions, and the Dashboard shows a row of the four most used ones. Each action is filtered
 * by the signed-in user's role (`can`) and by the company's shop-mode modules, so a kirana counter
 * sees POS first and a services firm never sees a purchase bill it does not use.
 *
 * The old one-tap behaviour ("+" opens a new invoice straight away) is a device-local preference
 * (`PLUS_ONE_TAP_KEY`, outside the `mrchartist_inv_` prefix: never backed up or synced).
 */
import type { AccessAction } from './access';
import type { ModuleId } from './shop-mode';

export type QuickId = 'sale' | 'pos' | 'payment' | 'expense' | 'bill' | 'quote';

export interface QuickAction {
  id: QuickId;
  to: string;
  need: AccessAction;
  module?: ModuleId;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'sale', to: '/invoice', need: 'doc.create' },
  { id: 'pos', to: '/pos', need: 'doc.create', module: 'pos' },
  // "₹ Payment in": the unpaid list with the payment dialog (same deep link as the command palette).
  { id: 'payment', to: '/clients?pay=1', need: 'payment.record' },
  { id: 'expense', to: '/expenses?new=expense', need: 'books.edit', module: 'purchases' },
  { id: 'bill', to: '/expenses?new=bill', need: 'books.edit', module: 'purchases' },
  { id: 'quote', to: '/invoice?type=QUOTATION', need: 'doc.create' },
];

/** The Dashboard row: New invoice, ₹ Received, POS, Expense. */
export const DASHBOARD_ACTIONS: readonly QuickId[] = ['sale', 'payment', 'pos', 'expense'];

export const PLUS_ONE_TAP_KEY = 'mrchartist_plus_one_tap';

/** Actions this user may run in this company (`modules` null = every module). `ids` narrows and orders. */
export function quickActions(can: (a: AccessAction) => boolean, modules: ReadonlySet<ModuleId> | null, ids?: readonly QuickId[]): QuickAction[] {
  const list = ids ? ids.map((id) => QUICK_ACTIONS.find((a) => a.id === id)!).filter(Boolean) : [...QUICK_ACTIONS];
  return list.filter((a) => can(a.need) && (!a.module || !modules || modules.has(a.module)));
}
