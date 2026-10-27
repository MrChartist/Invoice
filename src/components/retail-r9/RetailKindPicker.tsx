/**
 * RT-A1 shop picker (setup wizard under "Kirana / retail shop", Settings → Features "Shop profile"): Grocery /
 * supermarket, Medical store, Garments, Electronics / mobiles, Jewellery, Other retail — and, in Settings, "Custom"
 * (packs kept as set).
 */
import { useT } from '../../i18n';
import { pickT } from '../../i18n/areas/retail-r9-pick';
import { RETAIL_KINDS, type RetailKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export function RetailKindPicker({ value, onPick, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: RetailKindId | '') => void;
  /** Offer "Custom" (clears the profile; packs and modules stay as they are). */
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  return (
    <div className={gridClass} role="radiogroup" aria-label={pickT('retailTitle')} data-retail-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {RETAIL_KINDS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-retail-kind-card={k}>
          <strong>{pickT(`kind.${k}`)}</strong> <span>{pickT(`hint.${k}`)}</span>
        </button>
      ))}
      {custom && (
        <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
          <strong>{pickT('custom')}</strong>
        </button>
      )}
    </div>
  );
}
