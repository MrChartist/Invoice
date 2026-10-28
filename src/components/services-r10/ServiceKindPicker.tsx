/**
 * SV-A1 service picker (setup wizard under "Services", Settings → Features "Service profile"): nine kinds plus, for a
 * clinic, "Do you sell medicines from the clinic?" and, in Settings, "Custom" (packs and modules kept as set).
 */
import { useT } from '../../i18n';
import { svPickT } from '../../i18n/areas/services-r10-pick';
import { SERVICE_KINDS, type ServiceKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export function ServiceKindPicker({ value, onPick, pharmacy, onPharmacy, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: ServiceKindId | '') => void;
  pharmacy?: boolean;
  onPharmacy?: (on: boolean) => void;
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  return (
    <>
      <div className={gridClass} role="radiogroup" aria-label={svPickT('title')} data-service-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {SERVICE_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-service-kind-card={k}>
            <strong>{svPickT(`kind.${k}`)}</strong> <span>{svPickT(`hint.${k}`)}</span>
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
            <strong>{svPickT('custom')}</strong>
          </button>
        )}
      </div>
      {value === 'clinic' && onPharmacy && (
        <label className={controls.check} data-service-pharmacy>
          <input type="checkbox" checked={!!pharmacy} disabled={disabled} onChange={(e) => onPharmacy(e.target.checked)} /> {svPickT('pharmacy')}
        </label>
      )}
    </>
  );
}
