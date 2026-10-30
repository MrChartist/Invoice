/**
 * R17-A1 manpower picker (setup wizard under Services → Security, housekeeping and manpower supply; Settings →
 * Features "Manpower profile"): five kinds plus, in Settings, "Custom"; the firm form (the annual pack's entity type —
 * entry 14 depends on it) when the host passes `onForm`.
 */
import { useT } from '../../i18n';
import { mpPickT } from '../../i18n/areas/manpower-r17a-pick';
import { psPickT } from '../../i18n/areas/prof-r14a-pick';
import { FIRM_FORMS, MANPOWER_KINDS, type ManpowerKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

export function ManpowerKindPicker({ value, onPick, form, onForm, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: ManpowerKindId | '') => void;
  form?: string;
  onForm?: (f: string) => void;
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  return (
    <>
      <div className={gridClass} role="radiogroup" aria-label={mpPickT('title')} data-manpower-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {MANPOWER_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-manpower-kind-card={k}>
            <strong>{mpPickT(`kind.${k}`)}</strong> <span>{mpPickT(`hint.${k}`)}</span>
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
            <strong>{mpPickT('custom')}</strong>
          </button>
        )}
      </div>
      {value && onForm && (
        <label className={controls.field}>
          <span className={controls.label}>{psPickT('form')}</span>
          <SelectField className={controls.select} value={form ?? 'proprietorship'} disabled={disabled} onChange={(e) => onForm(e.target.value)} data-manpower-form>
            {FIRM_FORMS.map((f) => <option key={f} value={f}>{psPickT(`form.${f}`)}</option>)}
          </SelectField>
        </label>
      )}
    </>
  );
}
