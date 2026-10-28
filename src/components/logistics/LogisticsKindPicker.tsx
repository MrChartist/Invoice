/**
 * R19-A1 logistics picker (setup wizard card "Freight forwarding, customs clearance, courier or warehouse"; Settings →
 * Features "Logistics profile"): five kinds plus, in Settings, "Custom"; for `multi` the courier / warehouse extras; and
 * "We also run our own lorries" (adds the R5-B `transport` pack). Registration comes from the wizard's own GST step.
 */
import { useT } from '../../i18n';
import { lgPickT } from '../../i18n/areas/logistics-r19a-pick';
import { reachT } from '../../i18n/areas/reach';
import { LOGISTICS_KINDS, type LogisticsKindId } from '../../lib/shop-presets';
import controls from '../../styles/controls.module.css';

export type LgExtra = 'courier' | 'warehouse';
export interface LgPick { kind: LogisticsKindId | ''; extra: LgExtra[]; lorries: boolean }

export function LogisticsKindPicker({ value, onPick, custom, gridClass, cardClass, disabled }: {
  value: LgPick;
  onPick: (v: LgPick) => void;
  custom?: boolean;
  gridClass?: string;
  cardClass?: string;
  disabled?: boolean;
}) {
  useT();
  const card = (on: boolean) => cardClass ?? (on ? controls.btnPrimary : controls.btnOutline);
  const tick = (label: string, on: boolean, flip: () => void, attr: string) => (
    <label key={attr} className={controls.check} data-lg-pick={attr}><input type="checkbox" checked={on} disabled={disabled} onChange={flip} /> {label}</label>
  );
  return (
    <>
      <div className={gridClass} role="radiogroup" aria-label={lgPickT('title')} style={gridClass ? undefined : { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {LOGISTICS_KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={value.kind === k} disabled={disabled} className={card(value.kind === k)} onClick={() => onPick({ ...value, kind: k })} data-lg-kind-card={k}>
            <strong>{lgPickT(`kind.${k}`)}</strong>
          </button>
        ))}
        {custom && (
          <button type="button" role="radio" aria-checked={!value.kind} disabled={disabled} className={card(!value.kind)} onClick={() => onPick({ ...value, kind: '' })}>
            <strong>{lgPickT('custom')}</strong>
          </button>
        )}
      </div>
      {value.kind === 'multi' && (['courier', 'warehouse'] as const).map((x) => tick(`${lgPickT('extra')} ${reachT(`pack.${x}`)}`, value.extra.includes(x), () => onPick({ ...value, extra: value.extra.includes(x) ? value.extra.filter((e) => e !== x) : [...value.extra, x] }), x))}
      {value.kind && tick(lgPickT('lorries'), value.lorries, () => onPick({ ...value, lorries: !value.lorries }), 'lorries')}
    </>
  );
}
