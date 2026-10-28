/**
 * R6-A3 "About this tab": one line under the tab bar of the GST / TDS / payroll pages, read from the screen-help
 * registry (topic `what`). "More" opens Help on the topic; "Hide strips" turns them off on this device
 * (`mrchartist_help_strips`, outside the company prefix; Help → On this screen turns them back on).
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Info } from 'lucide-react';
import { useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { STRIPS_EVENT, setStrips, stripsOn } from '../../lib/help/strips';
import type { HelpTopic } from '../../lib/help/types';
import controls from '../../styles/controls.module.css';
import styles from './help.module.css';

const HelpModal = lazy(() => import('../layout/HelpModal').then((m) => ({ default: m.HelpModal })));

export default function AboutStrip() {
  useT();
  const { pathname, search } = useLocation();
  const [on, setOn] = useState(stripsOn);
  const [topic, setTopic] = useState<HelpTopic | null>(null);
  const [help, setHelp] = useState(false);
  // Stays mounted after the first open, so a Report dialog opened from Help survives Help closing.
  const [helpLoaded, setHelpLoaded] = useState(false);

  useEffect(() => {
    const sync = () => setOn(stripsOn());
    window.addEventListener(STRIPS_EVENT, sync);
    return () => window.removeEventListener(STRIPS_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!on) return;
    let alive = true;
    import('../../lib/help/registry')
      .then((m) => m.helpFor(pathname, search))
      .then((x) => alive && setTopic(x), () => undefined);
    return () => {
      alive = false;
    };
  }, [on, pathname, search]);

  if (!on) return null;
  return (
    <>
      {topic && (
        <div className={`${styles.strip} no-print`} role="note" aria-label={helpT('aboutLabel')} data-about-strip={topic.id}>
          <Info size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
          <p className={styles.stripText}>{topic.what}</p>
          <span className={styles.stripBtns}>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { setHelpLoaded(true); setHelp(true); }} data-about-more>{helpT('aboutMore')}</button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setStrips(false)}>{helpT('aboutHide')}</button>
          </span>
        </div>
      )}
      {helpLoaded && (
        <Suspense fallback={null}>
          <HelpModal open={help} onClose={() => setHelp(false)} topic={topic?.id} />
        </Suspense>
      )}
    </>
  );
}
