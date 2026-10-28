/** R16-D4: one lazy note per screen for GST Council recommendations not yet notified (`lib/pending-changes.ts`). */
import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import type { PendingArea } from '../../lib/pending-changes';
import controls from '../../styles/controls.module.css';

type Mod = typeof import('../../lib/pending-changes');

export default function PendingNote({ area, day = new Date().toLocaleDateString('en-CA') }: { area: PendingArea; day?: string }) {
  useT(); // re-render on a language switch
  const [m, setM] = useState<Mod | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../lib/pending-changes').then((x) => { if (live) setM(x); }, () => undefined);
    return () => { live = false; };
  }, []);
  const rows = m ? m.pendingFor(area, day) : [];
  if (!m || !rows.length) return null;
  return <p className={controls.hint} role="note" data-pending={area}>{m.pendingLead()} {rows.map(m.pendingLine).join(' ')}</p>;
}
