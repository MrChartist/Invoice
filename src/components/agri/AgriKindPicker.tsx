/**
 * AG-A1 agri picker (setup wizard behind the "Farm, dairy & food processing" card, Settings → Features "Agriculture
 * profile"): seven kinds plus "Other", the mill sub-choice and, in Settings, "Custom" (packs and modules kept as set).
 * The wizard's GST step answers "Are you registered under GST?".
 */
import { useT } from '../../i18n';
import { agPickT } from '../../i18n/areas/agri-r12-pick';
import { AGRI_KINDS, MILL_KINDS, type AgriKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export function AgriKindPicker({ value, onPick, mill, onMill, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: AgriKindId | '') => void;
  mill?: string;
  onMill?: (m: string) => void;
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  return (
    <>
      <div className={gridClass} role="radiogroup" aria-label={agPickT('title')} data-agri-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {AGRI_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-agri-kind-card={k}>
            <strong>{agPickT(`kind.${k}`)}</strong> <span>{agPickT(`hint.${k}`)}</span>
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
            <strong>{agPickT('custom')}</strong>
          </button>
        )}
      </div>
      {value === 'mill' && onMill && (
        <label className={controls.field} data-agri-mill>
          <span className={controls.label}>{agPickT('mill')}</span>
          <select className={controls.select} value={mill || 'rice'} disabled={disabled} onChange={(e) => onMill(e.target.value)}>
            {MILL_KINDS.map((m) => <option key={m} value={m}>{agPickT(`mill.${m}`)}</option>)}
          </select>
        </label>
      )}
    </>
  );
}
