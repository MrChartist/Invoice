/** R4-C5 / C4 buttons in Settings → Activity: "Auditor pack…" and "Recently deleted" (lazy, with their strings). */
import { FileArchive, History } from 'lucide-react';
import { can } from '../../lib/access';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';

export default function ActivityTrustButtons({ onOpen }: { onOpen: (which: 'pack' | 'bin') => void }) {
  useT();
  return (
    <>
      {can('report.export') && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => onOpen('pack')}><FileArchive size={14} aria-hidden="true" /> {trT('packButton')}</button>}
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => onOpen('bin')}><History size={14} aria-hidden="true" /> {trT('binOpen')}</button>
    </>
  );
}
