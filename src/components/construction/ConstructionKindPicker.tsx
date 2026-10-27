/**
 * CN-A1 construction picker (setup wizard under "Contractor", Settings → Features "Construction profile"): Civil / EPC,
 * Sub-contractor, Builder, Interiors, MEP, Labour contractor, Other — plus, for civil / sub-contractor / MEP, "Do you
 * work for government departments / PSUs?" and, in Settings, "Custom" (switches kept as set).
 */
import { useT } from '../../i18n';
import { cnPickT } from '../../i18n/areas/construction-r11-pick';
import { CONSTRUCTION_KINDS, CONSTRUCTION_PROFILES, type ConstructionKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export function ConstructionKindPicker({ value, onPick, government, onGovernment, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: ConstructionKindId | '') => void;
  government?: boolean;
  onGovernment?: (on: boolean) => void;
  /** Offer "Custom" (clears the profile; packs, modules and switches stay as they are). */
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  const asks = !!value && (CONSTRUCTION_PROFILES as Record<string, { asksGovernment?: boolean }>)[value]?.asksGovernment;
  return (
    <>
      <div className={gridClass} role="radiogroup" aria-label={cnPickT('title')} data-construction-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {CONSTRUCTION_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-construction-kind-card={k}>
            <strong>{cnPickT(`kind.${k}`)}</strong> <span>{cnPickT(`hint.${k}`)}</span>
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
            <strong>{cnPickT('custom')}</strong>
          </button>
        )}
      </div>
      {asks && onGovernment && (
        <label className={controls.check} data-construction-government>
          <input type="checkbox" checked={!!government} disabled={disabled} onChange={(e) => onGovernment(e.target.checked)} /> {cnPickT('government')}
        </label>
      )}
    </>
  );
}
