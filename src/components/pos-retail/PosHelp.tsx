import { Modal } from '../ui/Modal';
import { POS_SHORTCUTS } from '../../lib/pos';
import { effectiveKeys, type PosKeymap } from '../../lib/pos-keys';
import { useT } from '../../i18n';
import { posT } from '../../i18n/areas/pos';
import { retailT } from '../../i18n/areas/retail';
import controls from '../../styles/controls.module.css';
import styles from './retail.module.css';

/** Every POS hotkey (Shift+F1 by default), with this device's own keys, and the scan-box shortcuts. */
export function PosHelp({ open, onClose, keymap, onCustomise }: { open: boolean; onClose: () => void; keymap: PosKeymap; onCustomise: () => void }) {
  useT();
  const keys = effectiveKeys(keymap);
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={retailT('helpTitle')}
      subtitle={retailT('helpSub')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onCustomise}>{retailT('customise')}</button>
          <button type="button" className={controls.btnPrimary} onClick={onClose}>{retailT('done')}</button>
        </>
      }
    >
      <div className={styles.grid} data-pos-help>
        <ul className={styles.keyList}>
          {POS_SHORTCUTS.map((s) => (
            <li key={s.action}><kbd className={styles.kbd}>{keys[s.action]}</kbd> {retailT(`a.${s.action}`)}</li>
          ))}
          <li><kbd className={styles.kbd}>Ctrl+Enter</kbd> {posT('scSave')}</li>
          <li><kbd className={styles.kbd}>Alt+P</kbd> {retailT('altP')}</li>
        </ul>
        <p className={styles.section}>{retailT('entryTitle')}</p>
        <ul className={styles.keyList}>
          <li><kbd className={styles.kbd}>3*code</kbd> {retailT('entryQty')}</li>
          <li><kbd className={styles.kbd}>3 SB</kbd> {retailT('entryQtySpace')}</li>
          <li><kbd className={styles.kbd}>3*</kbd> {retailT('entryQtyNext')}</li>
          <li><kbd className={styles.kbd}>SB</kbd> {retailT('entryShort')}</li>
          <li><kbd className={styles.kbd}>=500</kbd> {retailT('entryGross')}</li>
          <li><kbd className={styles.kbd}>=</kbd> {retailT('entryRateKey')}</li>
          <li><kbd className={styles.kbd}>21…</kbd> {retailT('entryScale')}</li>
        </ul>
      </div>
    </Modal>
  );
}
