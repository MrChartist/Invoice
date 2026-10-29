/**
 * R20-A1 / A3: the "Tally keys" switch and the key layout picker (TallyPrime / Tally.ERP 9, only while on). One
 * component for every twin: the cheat sheet header, the Gateway menu, Settings → Defaults. Announces the change in a
 * polite live region.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { keysT } from '../../i18n/areas/keys-r20a';
import { setKeysLayout, setKeysMode, type KeysLayout } from '../../lib/keys/stub';
import { useKeysState } from '../../lib/keys/use-key-actions';
import { formatCombo, isApplePlatform } from '../../hooks/useHotkeys';
import s from './keys.module.css';

export function KeysSwitch({ hint }: { hint?: boolean }) {
  useT();
  const [on, layout] = useKeysState();
  const [said, setSaid] = useState('');
  return (
    <span className={s.switch}>
      <label className={s.toggle} title={keysT('switchHint')}>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          data-testid="tally-keys-switch"
          onChange={(e) => {
            setKeysMode(e.target.checked ? 'on' : 'off');
            setSaid(keysT(e.target.checked ? 'on' : 'off'));
          }}
        />
        {keysT('switch_')}
      </label>
      {on && (
        <select className={s.select} aria-label={keysT('layout')} value={layout} onChange={(e) => setKeysLayout(e.target.value as KeysLayout)} data-testid="tally-keys-layout">
          <option value="prime">{keysT('prime')}</option>
          <option value="erp9">{keysT('erp9')}</option>
        </select>
      )}
      {hint && <span className={s.hint}>{keysT('switchHint')}</span>}
      <span className={s.sr} aria-live="polite">{said}</span>
    </span>
  );
}

/** Key caps of a combo (Latin, `lang="en"`); on a Mac an F-key shows "fn" first. Hidden from screen readers. */
export function KeyCaps({ combo }: { combo: string }) {
  const apple = isApplePlatform();
  const parts = formatCombo(combo, apple);
  if (apple && /(^|\+)f\d+$/.test(combo)) parts.unshift('fn');
  return (
    <span className={s.caps} aria-hidden="true" lang="en">
      {parts.map((k, i) => (k === 'then' ? <span key={i}>{keysT('then')}</span> : <kbd key={i} className={s.kbd}>{k}</kbd>))}
    </span>
  );
}

export default KeysSwitch;
