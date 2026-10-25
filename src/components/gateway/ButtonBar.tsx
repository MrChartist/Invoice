import { useNavigate } from 'react-router-dom';
import { formatCombo } from '../../hooks/useHotkeys';
import { useCan } from '../../hooks/useCan';
import { gwT, type GwKey } from '../../i18n/areas/gateway';
import { TALLY_KEYS, type TallyKeyId } from '../../lib/tally-keys';
import { useGateway, useTallyTerms } from './context';
import { ariaKeys } from './keymap';
import { cn } from '../../lib/utils';
import styles from './Gateway.module.css';

export interface BarButton {
  id: string;
  combo: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}

const VOUCHER_IDS: TallyKeyId[] = ['contra', 'payment', 'receipt', 'journal', 'sales', 'purchase', 'creditNote', 'debitNote'];
const LABEL: Partial<Record<TallyKeyId, GwKey>> = {
  contra: 'contra',
  payment: 'payment',
  receipt: 'receipt',
  journal: 'journal',
  sales: 'sales',
  purchase: 'purchase',
  creditNote: 'creditNote',
  debitNote: 'debitNote',
};
const TALLY_LABEL: Partial<Record<TallyKeyId, GwKey>> = { sales: 'salesTally', purchase: 'purchaseTally' };

/**
 * Tally's function-key buttons as a scrollable top bar (mouse and touch users get every key).
 * `extra` buttons (Accept, Create ledger, Quit …) come first; `onVoucherType` lets the voucher screen
 * switch type in place instead of navigating.
 */
export function ButtonBar({ extra = [], onVoucherType }: { extra?: BarButton[]; onVoucherType?: (id: TallyKeyId) => boolean }) {
  const navigate = useNavigate();
  const { can } = useCan();
  const { openDate, openPeriod } = useGateway();
  const terms = useTallyTerms();

  const keyButton = (id: TallyKeyId): BarButton | null => {
    const k = TALLY_KEYS.find((x) => x.id === id);
    if (!k || !k.to || (k.need && !can(k.need))) return null;
    const label = gwT((terms && TALLY_LABEL[id]) || LABEL[id] || 'bbHelp');
    return { id, combo: k.combo, label, onClick: () => (onVoucherType?.(id) ? undefined : navigate(k.to!, k.state ? { state: k.state } : undefined)) };
  };

  const buttons: BarButton[] = [
    ...extra,
    { id: 'date', combo: 'f2', label: gwT('bbDate'), onClick: openDate },
    { id: 'period', combo: 'alt+f2', label: gwT('bbPeriod'), onClick: openPeriod },
    ...VOUCHER_IDS.map(keyButton).filter((b): b is BarButton => !!b),
    { id: 'goto', combo: 'alt+g', label: gwT('bbGoto'), onClick: () => navigate('/gateway', { state: { tally: 'goto' } }) },
    { id: 'features', combo: 'f11', label: gwT('bbFeatures'), onClick: () => navigate('/settings?tab=defaults') },
    { id: 'configure', combo: 'f12', label: gwT('bbConfigure'), onClick: () => navigate('/settings') },
    {
      id: 'help',
      combo: 'mod+/',
      label: gwT('bbHelp'),
      // The overlay belongs to the app shell: ask it the same way the key does.
      onClick: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', ctrlKey: true, bubbles: true })),
    },
  ];

  return (
    <div className={cn(styles.bar, 'no-print')} role="toolbar" aria-label={gwT('buttonBar')}>
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={cn(styles.barBtn, b.primary && styles.barPrimary)}
          onClick={b.onClick}
          disabled={b.disabled}
          aria-keyshortcuts={ariaKeys(b.combo)}
          data-testid={`bar-${b.id}`}
        >
          <span className={styles.barKey}>{formatCombo(b.combo).join('+')}</span>
          <span>{b.label}</span>
        </button>
      ))}
    </div>
  );
}
