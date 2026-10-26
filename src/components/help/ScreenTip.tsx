/**
 * R6-A6 one-time tip: a dismissible line in normal flow above a screen's content (never an overlay, never over a
 * field). Shown once per device; "Don't show tips" turns every tip off. Device-local keys, try / catch on every
 * access. Mounted lazily, one line per page: `<ScreenTip id="gst" />`.
 */
import { useState } from 'react';
import { Info } from 'lucide-react';
import { getLanguage, useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { readRaw, writeRaw } from '../../lib/storage';
import { TIPS, TIPS_OFF_KEY, TIPS_SEEN_KEY, markSeen, shouldShowTip, type TipId } from '../../lib/help/tips';
import controls from '../../styles/controls.module.css';
import styles from './help.module.css';

const read = (k: string): string | null => {
  try {
    return readRaw(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    writeRaw(k, v);
  } catch {
    /* private window / blocked storage: the tip just shows again next time */
  }
};

export default function ScreenTip({ id }: { id: TipId }) {
  useT();
  const [show, setShow] = useState(() => shouldShowTip(id, read(TIPS_SEEN_KEY), read(TIPS_OFF_KEY)));
  const tip = TIPS.find((x) => x.id === id);
  if (!show || !tip) return null;
  return (
    <p className={`${styles.tip} no-print`} role="note" data-screen-tip={id}>
      <Info size={14} aria-hidden="true" />
      <span style={{ flex: '1 1 14rem' }}>{getLanguage() === 'hi' ? tip.hi : tip.en}</span>
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { write(TIPS_SEEN_KEY, markSeen(id, read(TIPS_SEEN_KEY))); setShow(false); }}>
        {helpT('tipClose')}
      </button>
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { write(TIPS_OFF_KEY, '1'); setShow(false); }}>
        {helpT('tipOff')}
      </button>
    </p>
  );
}
