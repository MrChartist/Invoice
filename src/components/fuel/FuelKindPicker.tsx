/**
 * R21-A1 fuel picker (setup wizard card "Petrol pump, CNG station or LPG distributor"; Settings → Features "Fuel
 * profile"): five kinds plus, in Settings, "Custom". In the wizard `card` adds the card itself; picking a kind there
 * means business type `kirana` (the wizard applies `applyFuelKind` on finish).
 */
import { useT } from '../../i18n';
import { fuPickT } from '../../i18n/areas/fuel-r21a-pick';
import { FUEL_KINDS, type FuelKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export function FuelKindPicker({ value, onPick, custom, card, gridClass, cardClass, disabled }: {
  value: FuelKindId | '';
  onPick: (v: FuelKindId | '') => void;
  custom?: boolean;
  /** Wizard: the card ("Petrol pump, CNG station or LPG distributor"); the kinds show once it is picked. */
  card?: { on: boolean; pick: () => void };
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const cls = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  const btn = (on: boolean, label: string, click: () => void, k: string) => (
    <button key={k} type="button" role="radio" aria-checked={on} disabled={disabled} className={cls(on)} onClick={click} data-fu-kind-card={k}><strong>{label}</strong></button>
  );
  if (card && !card.on) {
    return <button type="button" role="radio" aria-checked={false} className={cls(false)} onClick={card.pick} data-wizard-fuel-card><strong>{fuPickT('card')}</strong><span>{fuPickT('cardHint')}</span></button>;
  }
  const kinds = [...FUEL_KINDS.map((k) => btn(value === k, fuPickT(`kind.${k}`), () => onPick(k), k)), ...(custom ? [btn(!value, fuPickT('custom'), () => onPick(''), 'custom')] : [])];
  return card ? <>{kinds}</> : <div className={gridClass} role="radiogroup" aria-label={fuPickT('title')} style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>{kinds}</div>;
}
