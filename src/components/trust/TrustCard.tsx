/**
 * R4-C4 / C6 card in Settings → Data: "Recently deleted" and "Export everything (CSV / Excel)"; plus the retention
 * note under "Erase" (books and the edit log are kept 8 FYs — verify with your CA). Lazy with its strings.
 */
import { FileSpreadsheet, History, ShieldCheck } from 'lucide-react';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-trust-r4';
import surface from '../../styles/surface.module.css';
import settings from '../settings/Settings.module.css';

export default function TrustCard({ onOpen, canExport }: { onOpen: (which: 'bin' | 'export') => void; canExport: boolean }) {
  useT();
  return (
    <section className={surface.card} data-trust-card>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><ShieldCheck size={16} aria-hidden="true" /> {trT('trustCardTitle')}</span>
      </div>
      <div className={surface.cardBody}>
        <div className={settings.actionGrid}>
          <button type="button" className={settings.action} onClick={() => onOpen('bin')}>
            <strong><History size={16} aria-hidden="true" /> {trT('binOpen')}</strong>
            <span>{trT('binCardText')}</span>
          </button>
          {canExport && (
            <button type="button" className={settings.action} onClick={() => onOpen('export')}>
              <strong><FileSpreadsheet size={16} aria-hidden="true" /> {trT('openButton')}</strong>
              <span>{trT('openText')}</span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function RetentionNote() {
  useT();
  return <p className={surface.sectionNote} role="note" data-retention-note>{trT('retentionErase')}</p>;
}
