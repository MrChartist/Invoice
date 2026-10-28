/**
 * R18-A1 society picker (setup wizard card "Housing society / apartment association / RWA"; Settings → Features
 * "Society profile"): five kinds plus, in Settings, "Custom". Registration and State come from the wizard's own GST step.
 */
import { useT } from '../../i18n';
import { hsPickT } from '../../i18n/areas/society-r18a-pick';
import { SOCIETY_KINDS, type SocietyKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export function SocietyKindPicker({ value, onPick, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: SocietyKindId | '') => void;
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  return (
    <div className={gridClass} role="radiogroup" aria-label={hsPickT('title')} style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      {SOCIETY_KINDS.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-society-kind-card={k}>
          <strong>{hsPickT(`kind.${k}`)}</strong>
        </button>
      ))}
      {custom && (
        <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
          <strong>{hsPickT('custom')}</strong>
        </button>
      )}
    </div>
  );
}
