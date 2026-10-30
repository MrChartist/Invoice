/**
 * MF-A1 manufacturing picker (setup wizard behind the "Factory / manufacturing" card, Settings → Features
 * "Manufacturing profile"): five kinds plus "Other", the sub-choice and, in Settings, "Custom". In the wizard it also
 * asks for the Udyam number and category (optional); the wizard's GST step answers "Are you registered under GST?".
 */
import { useT } from '../../i18n';
import { mfPickT } from '../../i18n/areas/mfg-r13a-pick';
import { MFG_KINDS, MFG_SUBS, type MfgKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

export interface UdyamValue { no: string; category: string }

export function MfgKindPicker({ value, onPick, sub, onSub, udyam, onUdyam, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: MfgKindId | '') => void;
  sub?: string;
  onSub?: (s: string) => void;
  udyam?: UdyamValue;
  onUdyam?: (u: UdyamValue) => void;
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  const subs = value ? MFG_SUBS[value as MfgKindId] : undefined;
  return (
    <>
      <div className={gridClass} role="radiogroup" aria-label={mfPickT('title')} data-mfg-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {MFG_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-mfg-kind-card={k}>
            <strong>{mfPickT(`kind.${k}`)}</strong> <span>{mfPickT(`hint.${k}`)}</span>
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
            <strong>{mfPickT('custom')}</strong>
          </button>
        )}
      </div>
      {subs && onSub && (
        <label className={controls.field} data-mfg-sub>
          <span className={controls.label}>{mfPickT('sub')}</span>
          <SelectField className={controls.select} value={sub && subs.includes(sub) ? sub : subs[0]} disabled={disabled} onChange={(e) => onSub(e.target.value)}>
            {subs.map((s) => <option key={s} value={s}>{mfPickT(`sub.${s}` as Parameters<typeof mfPickT>[0])}</option>)}
          </SelectField>
        </label>
      )}
      {value && udyam && onUdyam && (
        <div className={controls.row3} data-mfg-udyam>
          <label className={controls.field}>
            <span className={controls.label}>{mfPickT('udyam')}</span>
            <input className={`${controls.input} ${controls.inputMono}`} value={udyam.no} placeholder="UDYAM-MH-01-0000001" onChange={(e) => onUdyam({ ...udyam, no: e.target.value.toUpperCase() })} data-mfg-udyam-no />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{mfPickT('category')}</span>
            <SelectField className={controls.select} value={udyam.category} onChange={(e) => onUdyam({ ...udyam, category: e.target.value })} data-mfg-udyam-cat>
              {(['MICRO', 'SMALL', 'MEDIUM'] as const).map((c) => <option key={c} value={c}>{mfPickT(`cat.${c}`)}</option>)}
            </SelectField>
          </label>
        </div>
      )}
    </>
  );
}
