/**
 * R15-B1 travel picker (setup wizard under Services → Travel, Settings → Features "Travel profile"): five kinds plus,
 * in Settings, "Custom"; for an agent "IATA / BSP or consolidator?", for a planner "We also book travel".
 */
import { useT } from '../../i18n';
import { tvT } from '../../i18n/areas/travel-r15b';
import { TRAVEL_KINDS, type TravelKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export function TravelKindPicker({ value, onPick, bsp, onBsp, alsoTravel, onAlsoTravel, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: TravelKindId | '') => void;
  bsp?: boolean;
  onBsp?: (on: boolean) => void;
  alsoTravel?: boolean;
  onAlsoTravel?: (on: boolean) => void;
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  const tick = (label: string, on: boolean | undefined, set: ((v: boolean) => void) | undefined, attr: string) => set && (
    <label className={controls.check} {...{ [attr]: '' }}>
      <input type="checkbox" checked={!!on} disabled={disabled} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );
  return (
    <>
      <div className={gridClass} role="radiogroup" aria-label={tvT('title')} data-travel-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {TRAVEL_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-travel-kind-card={k}>
            <strong>{tvT(`kind.${k}`)}</strong> <span>{tvT(`hint.${k}`)}</span>
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
            <strong>{tvT('custom')}</strong>
          </button>
        )}
      </div>
      {value === 'agent' && tick(tvT('bsp'), bsp, onBsp, 'data-travel-bsp')}
      {value === 'events' && tick(tvT('alsoTravel'), alsoTravel, onAlsoTravel, 'data-travel-also')}
    </>
  );
}
