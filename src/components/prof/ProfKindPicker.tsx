/**
 * PS-A1 professional picker (setup wizard under Services → Professional, Settings → Features "Professional profile"):
 * seven kinds plus, in Settings, "Custom"; the kind's sub-choice, the firm form (the annual pack's entity type) and, in
 * the wizard, the advocate's enrolment / Bar Council or the CA's membership / firm registration no.
 */
import { useT } from '../../i18n';
import { psPickT } from '../../i18n/areas/prof-r14a-pick';
import { FIRM_FORMS, PROF_KINDS, PROF_SUBS, type ProfKindId } from '../../lib/shop-presets';
import type { ProfIds } from '../../lib/prof/ps-profile';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

type K = Parameters<typeof psPickT>[0];

export function ProfKindPicker({ value, onPick, sub, onSub, form, onForm, ids, onIds, custom, gridClass, cardClass, disabled }: {
  value?: string;
  onPick: (kind: ProfKindId | '') => void;
  sub?: string;
  onSub?: (s: string) => void;
  form?: string;
  onForm?: (f: string) => void;
  ids?: ProfIds;
  onIds?: (ids: ProfIds) => void;
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  const subs = value ? PROF_SUBS[value as ProfKindId] : undefined;
  const id = (k: keyof ProfIds, label: K) => (
    <label className={controls.field}>
      <span className={controls.label}>{psPickT(label)}</span>
      <input className={controls.input} value={ids?.[k] ?? ''} disabled={disabled} onChange={(e) => onIds?.({ ...ids, [k]: e.target.value })} data-prof-id={k} />
    </label>
  );
  return (
    <>
      <div className={gridClass} role="radiogroup" aria-label={psPickT('title')} data-prof-kind style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {PROF_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} disabled={disabled} className={card(value === k)} onClick={() => onPick(k)} data-prof-kind-card={k}>
            <strong>{psPickT(`kind.${k}`)}</strong> <span>{psPickT(`hint.${k}`)}</span>
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked={!value} disabled={disabled} className={card(!value)} onClick={() => onPick('')}>
            <strong>{psPickT('custom')}</strong>
          </button>
        )}
      </div>
      {value && (
        <div className={controls.row3}>
          {subs && onSub && (
            <label className={controls.field}>
              <span className={controls.label}>{psPickT('sub')}</span>
              <SelectField className={controls.select} value={sub && subs.includes(sub) ? sub : subs[0]} disabled={disabled} onChange={(e) => onSub(e.target.value)} data-prof-sub>
                {subs.map((s) => <option key={s} value={s}>{psPickT(`sub.${s}` as K)}</option>)}
              </SelectField>
            </label>
          )}
          {onForm && (
            <label className={controls.field}>
              <span className={controls.label}>{psPickT('form')}</span>
              <SelectField className={controls.select} value={form ?? 'proprietorship'} disabled={disabled} onChange={(e) => onForm(e.target.value)} data-prof-form>
                {FIRM_FORMS.map((f) => <option key={f} value={f}>{psPickT(`form.${f}`)}</option>)}
              </SelectField>
            </label>
          )}
          {onIds && value === 'legal' && <>{id('enrolment', 'enrolment')}{id('bar_council', 'barCouncil')}</>}
          {onIds && value === 'ca' && <>{id('membership', 'membership')}{id('frn', 'frn')}</>}
        </div>
      )}
    </>
  );
}
