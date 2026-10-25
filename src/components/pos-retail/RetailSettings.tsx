import { useState, type KeyboardEvent } from 'react';
import { Modal } from '../ui/Modal';
import { POS_SHORTCUTS, keyCombo, type PosAction } from '../../lib/pos';
import { assignKey, effectiveKeys, isAssignableCombo, keymapConflicts, saveKeymap, type PosKeymap } from '../../lib/pos-keys';
import {
  cleanScaleProfile, makeScaleBarcode, parsePrefixList, parseScaleBarcode, saveScaleProfile, type ScaleProfile,
} from '../../lib/scale-barcode';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { retailT } from '../../i18n/areas/retail';
import controls from '../../styles/controls.module.css';
import styles from './retail.module.css';

type Tab = 'keys' | 'scale';

/**
 * Counter settings (this device only): function keys for every POS action (press the new key; a key
 * already in use swaps with the old one) and the weighing-scale label profile (+ live scale port).
 */
export function RetailSettings({ open, onClose, keymap, scale, onSaved, initialTab = 'keys' }: {
  open: boolean;
  onClose: () => void;
  keymap: PosKeymap;
  scale: ScaleProfile;
  onSaved: (keymap: PosKeymap, scale: ScaleProfile) => void;
  initialTab?: Tab;
}) {
  useT();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [map, setMap] = useState<PosKeymap>(keymap);
  const [capturing, setCapturing] = useState<PosAction | null>(null);
  const [refused, setRefused] = useState('');
  const [profile, setProfile] = useState<ScaleProfile>(scale);
  const [prefixText, setPrefixText] = useState(scale.prefixes.join(', '));
  const [testCode, setTestCode] = useState('');
  const [portMsg, setPortMsg] = useState('');
  const keys = effectiveKeys(map);
  const conflicts = keymapConflicts(map);

  const save = () => {
    const clean = cleanScaleProfile({ ...profile, prefixes: parsePrefixList(prefixText) });
    saveKeymap(map);
    saveScaleProfile(clean);
    onSaved(map, clean);
    onClose();
  };

  const capture = (action: PosAction, e: KeyboardEvent<HTMLButtonElement>) => {
    if (capturing !== action) return;
    if (e.key === 'Escape' || e.key === 'Tab') {
      setCapturing(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const combo = keyCombo(e);
    if (!combo) return;
    if (!isAssignableCombo(combo)) {
      setRefused(retailT('keyRefused', { key: combo }));
      return;
    }
    setRefused('');
    setMap(assignKey(map, action, combo));
    setCapturing(null);
  };

  const sample = makeScaleBarcode(profile, parsePrefixList(prefixText)[0] ?? '21', 123, profile.value === 'price' ? 125.5 : 1.25);
  const read = testCode.trim() ? parseScaleBarcode(testCode, cleanScaleProfile({ ...profile, enabled: true, prefixes: parsePrefixList(prefixText) })) : null;

  const pickPort = async () => {
    try {
      const m = await import('../../lib/scale-serial');
      if (!m.scaleSerialSupported()) return setPortMsg(retailT('noSerial'));
      await m.chooseScalePort();
      const w = await m.readScaleWeight(profile.baud);
      setPortMsg(w ? retailT('scaleRead', { kg: w.weight.toFixed(3), state: w.stable ? retailT('stable') : retailT('unstable') }) : retailT('scaleNothing'));
    } catch (err) {
      setPortMsg((err as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={retailT('setTitle')}
      subtitle={retailT('setSub')}
      footer={
        <>
          {tab === 'keys' && <button type="button" className={controls.btnGhost} onClick={() => setMap({})}>{retailT('resetKeys')}</button>}
          <button type="button" className={controls.btnOutline} onClick={onClose}>{retailT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save} disabled={conflicts.size > 0} data-retail-save>{retailT('save')}</button>
        </>
      }
    >
      <div className={styles.grid}>
        <div className={controls.segment} role="tablist">
          {(['keys', 'scale'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={cn(controls.segmentBtn, tab === t && controls.segmentBtnActive)} onClick={() => setTab(t)}>
              {retailT(t === 'keys' ? 'tabKeys' : 'tabScale')}
            </button>
          ))}
        </div>

        {tab === 'keys' ? (
          <>
            <p className={styles.muted}>{retailT('keysHint')}</p>
            {refused && <p className={styles.warn} role="alert">{refused}</p>}
            <table className={styles.table}>
              <tbody>
                {POS_SHORTCUTS.map((s) => (
                  <tr key={s.action}>
                    <td>{retailT(`a.${s.action}`)}</td>
                    <td className={styles.r}>
                      <button
                        type="button"
                        className={cn(controls.btnOutline, controls.btnSm, styles.capture, conflicts.has(keys[s.action]) && styles.conflict)}
                        onClick={() => { setRefused(''); setCapturing(s.action); }}
                        onKeyDown={(e) => capture(s.action, e)}
                        onBlur={() => capturing === s.action && setCapturing(null)}
                        aria-label={retailT('changeKey', { action: retailT(`a.${s.action}`) })}
                        data-key-for={s.action}
                      >
                        {capturing === s.action ? retailT('pressKey') : keys[s.action]}
                      </button>
                    </td>
                    <td className={styles.muted}>{keys[s.action] !== s.keys ? retailT('wasKey', { key: s.keys }) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <>
            <p className={styles.muted}>{retailT('scaleHint')}</p>
            <label className={controls.check}>
              <input type="checkbox" checked={profile.enabled} onChange={(e) => setProfile({ ...profile, enabled: e.target.checked })} data-scale-enabled /> {retailT('scaleOn')}
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{retailT('scalePrefixes')}</span>
                <input className={cn(controls.input, controls.inputMono)} value={prefixText} onChange={(e) => setPrefixText(e.target.value)} placeholder="21, 22" data-scale-prefixes />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{retailT('scalePlu')}</span>
                <select className={controls.select} value={profile.pluLength} onChange={(e) => setProfile({ ...profile, pluLength: Number(e.target.value) })}>
                  {[4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{retailT('scaleValue')}</span>
                <select className={controls.select} value={profile.value} onChange={(e) => setProfile({ ...profile, value: e.target.value === 'price' ? 'price' : 'weight', decimals: e.target.value === 'price' ? 2 : 3 })} data-scale-value>
                  <option value="weight">{retailT('scaleWeight')}</option>
                  <option value="price">{retailT('scalePrice')}</option>
                </select>
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{retailT('scaleDecimals')}</span>
                <select className={controls.select} value={profile.decimals} onChange={(e) => setProfile({ ...profile, decimals: Number(e.target.value) })}>
                  {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <label className={controls.check}>
              <input type="checkbox" checked={profile.checkDigit} onChange={(e) => setProfile({ ...profile, checkDigit: e.target.checked })} /> {retailT('scaleCheck')}
            </label>
            <p className={styles.muted}>{retailT('scaleSample', { code: sample, plu: '00123', value: profile.value === 'price' ? '₹125.50' : '1.250 kg' })}</p>
            <label className={controls.field}>
              <span className={controls.label}>{retailT('scaleTest')}</span>
              <input className={cn(controls.input, controls.inputMono)} value={testCode} onChange={(e) => setTestCode(e.target.value)} inputMode="numeric" />
              {testCode.trim() && (
                <span className={controls.hint}>{read ? retailT('scaleTestOk', { plu: read.plu, value: read.kind === 'price' ? `₹${read.value.toFixed(2)}` : `${read.value.toFixed(3)} kg` }) : retailT('scaleTestNo')}</span>
              )}
            </label>
            <p className={styles.section}>{retailT('liveTitle')}</p>
            <p className={styles.muted}>{retailT('liveHint')}</p>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{retailT('baud')}</span>
                <select className={controls.select} value={profile.baud} onChange={(e) => setProfile({ ...profile, baud: Number(e.target.value) })}>
                  {[1200, 2400, 4800, 9600, 19200, 38400].map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
              <div className={controls.field}>
                <span className={controls.label}>&nbsp;</span>
                <button type="button" className={controls.btnOutline} onClick={() => void pickPort()}>{retailT('pickPort')}</button>
              </div>
            </div>
            {portMsg && <p className={styles.muted} role="status">{portMsg}</p>}
          </>
        )}
      </div>
    </Modal>
  );
}
