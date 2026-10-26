/**
 * TR-C5 trade picker (setup wizard under "Wholesale", Settings → Features "Trade profile"): Distributor / stockist,
 * Wholesaler, Commodity trader, Commission agent / broker — and, in Settings, "Custom" (packs kept as set).
 */
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { TRADE_KINDS, type TradeKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export function TradeKindPicker({ value, onPick, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: TradeKindId | '') => void;
  /** Offer "Custom" (clears the profile; packs and modules stay as they are). */
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  return (
    <div className={gridClass} role="radiogroup" aria-label={trT('tradeTitle')} data-trade-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {TRADE_KINDS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-trade-kind-card={k}>
          <strong>{trT(`trade.${k}`)}</strong> <span>{trT(`tradeHint.${k}`)}</span>
        </button>
      ))}
      {custom && (
        <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
          <strong>{trT('tradeCustom')}</strong>
        </button>
      )}
    </div>
  );
}
