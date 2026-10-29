/**
 * R6-A6 one-time tip: a dismissible line in normal flow above a screen's content (never an overlay, never over a
 * field). Shown once per device; "Don't show tips" turns every tip off. Device-local keys, try / catch on every
 * access. Mounted lazily, one line per page: `<ScreenTip id="gst" />`.
 */
import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { getLanguage, useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { readRaw, writeRaw } from '../../lib/storage';
import { TIPS, TIPS_OFF_KEY, TIPS_SEEN_KEY, markSeen, shouldShowTip, type TipId } from '../../lib/help/tips';
import * as tipsData from '../../lib/help/tips';
import { withHindi, type HiTableLoader } from '../../lib/help/hi-tables';
import controls from '../../styles/controls.module.css';
import styles from './help.module.css';

const read = (k: string): string | null => {
  try {
    return readRaw(k);
  } catch {
    return null;
  }
};
// PERF-6: a build moves the tips' Hindi into the `lang-hi-help` pack (`loadHi`); put back when Hindi is on.
let hiReady: Promise<unknown> | null = null;
const loadTipsHi = () => (hiReady ??= withHindi((tipsData as { loadHi?: HiTableLoader<string> }).loadHi, (hi) => {
  for (const x of TIPS) x.hi = hi[x.id] || x.hi;
}));

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
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadTipsHi().then(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);
  const tip = TIPS.find((x) => x.id === id);
  // Hindi: wait for the tip's Hindi (English if the pack could not load).
  const text = tip && (getLanguage() === 'hi' ? tip.hi || (loaded ? tip.en : '') : tip.en);
  if (!show || !tip || !text) return null;
  return (
    <p className={`${styles.tip} no-print`} role="note" data-screen-tip={id}>
      <Info size={14} aria-hidden="true" />
      <span style={{ flex: '1 1 14rem' }}>{text}</span>
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { write(TIPS_SEEN_KEY, markSeen(id, read(TIPS_SEEN_KEY))); setShow(false); }}>
        {helpT('tipClose')}
      </button>
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { write(TIPS_OFF_KEY, '1'); setShow(false); }}>
        {helpT('tipOff')}
      </button>
    </p>
  );
}
