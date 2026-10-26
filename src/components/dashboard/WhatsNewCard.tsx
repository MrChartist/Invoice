/**
 * R6-A4: "What's new in <version>" on the Dashboard, once after an upgrade (the newest entry's first three items).
 * Device-local `mrchartist_whats_new_seen` holds the last dismissed version; a fresh install records the current
 * version silently and never shows the card. Lazy, mounted by DashboardStart.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { History, X } from 'lucide-react';
import { getLanguage, useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import { APP_VERSION } from '../../lib/app-version';
import { WHATS_NEW_SEEN_KEY, newestEntry, shouldShowCard } from '../../lib/whats-new';
import { readRaw, writeRaw } from '../../lib/storage';
import controls from '../../styles/controls.module.css';
import help from '../help/help.module.css';

const read = (): string | null => {
  try {
    return readRaw(WHATS_NEW_SEEN_KEY);
  } catch {
    return null;
  }
};
const markSeen = () => {
  try {
    writeRaw(WHATS_NEW_SEEN_KEY, APP_VERSION);
  } catch {
    /* storage blocked: the card may show again next time */
  }
};

export default function WhatsNewCard({ hadData, onSeeAll }: { hadData: boolean; onSeeAll?: () => void }) {
  useT();
  const [show, setShow] = useState(() => shouldShowCard(read(), APP_VERSION, hadData));
  // A fresh install starts "seen" at this version, so only a later upgrade shows the card.
  useEffect(() => {
    if (!read() && !hadData) markSeen();
  }, [hadData]);
  if (!show) return null;
  const entry = newestEntry();
  const hi = getLanguage() === 'hi';
  const close = () => {
    markSeen();
    setShow(false);
  };
  return (
    <section className={help.card} aria-label={helpT('newIn', { v: entry.version })} data-whats-new-card>
      <div className={help.cardHead}>
        <h2><History size={16} aria-hidden="true" /> {helpT('newIn', { v: entry.version })}</h2>
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={close} aria-label={helpT('dismiss')}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <ul className={help.items}>
        {entry.items.slice(0, 3).map((it) => (
          <li key={it.title}>
            {it.href ? <Link to={it.href} onClick={markSeen}>{hi ? it.hi : it.title}</Link> : <strong>{hi ? it.hi : it.title}</strong>}
            {it.text && <span className={help.muted} style={{ display: 'block' }}>{it.text}</span>}
          </li>
        ))}
      </ul>
      {onSeeAll && (
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} style={{ justifySelf: 'start' }} onClick={() => { close(); onSeeAll(); }}>
          {helpT('seeAll')}
        </button>
      )}
    </section>
  );
}
