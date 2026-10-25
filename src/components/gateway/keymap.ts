/**
 * Tally keyboard map shown in the shortcuts overlay (Ctrl+/ or ?) and the Gateway button bar.
 * The routes behind the global keys live in src/lib/tally-keys.ts (shell); this file adds labels.
 */
import { gwT, type GwKey } from '../../i18n/areas/gateway';
import type { ShortcutInfo } from '../../hooks/useHotkeys';
import type { TallyKeyId } from '../../lib/tally-keys';

export const TALLY_LABELS: Record<TallyKeyId, GwKey> = {
  date: 'dateTitle',
  period: 'periodTitle',
  contra: 'contra',
  payment: 'payment',
  receipt: 'receipt',
  journal: 'journal',
  sales: 'sales',
  purchase: 'purchase',
  creditNote: 'creditNote',
  debitNote: 'debitNote',
  stockJournal: 'stockJournal',
  physicalStock: 'physicalStock',
  features: 'bbFeatures',
  configure: 'bbConfigure',
  goto: 'helpGateway',
  gotoCtrl: 'helpGateway',
  help: 'helpHelp',
};

/** Rows for the shortcuts overlay. */
export function tallyShortcuts(): ShortcutInfo[] {
  const group = gwT('helpGroup');
  const row = (combo: string, label: string): ShortcutInfo => ({ combo, label, group });
  return [
    row('alt+g', gwT('helpGateway')),
    row('mod+g', gwT('helpGateway')),
    row('mod+/', gwT('helpHelp')),
    row('f2', gwT('dateTitle')),
    row('alt+f2', gwT('periodTitle')),
    row('f4', gwT('contra')),
    row('f5', gwT('payment')),
    row('f6', gwT('receipt')),
    row('f7', gwT('journal')),
    row('f8', gwT('sales')),
    row('f9', gwT('purchase')),
    row('mod+f8', gwT('creditNote')),
    row('mod+f9', gwT('debitNote')),
    row('alt+f7', gwT('stockJournal')),
    row('mod+f7', gwT('physicalStock')),
    row('f11', gwT('bbFeatures')),
    row('f12', gwT('bbConfigure')),
    row('mod+a', `${gwT('bbAccept')} (${gwT('scrVouchers')})`),
    row('alt+c', gwT('bbCreate')),
    row('alt+d', `${gwT('bbDelete')} (${gwT('scrVouchers')})`),
    row('enter', gwT('helpDrill')),
  ];
}

/** "mod+f8" → "Control+F8" for aria-keyshortcuts. */
export function ariaKeys(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p === 'mod' || p === 'ctrl' ? 'Control' : p === 'alt' ? 'Alt' : p.length <= 3 ? p.toUpperCase() : p))
    .join('+');
}
