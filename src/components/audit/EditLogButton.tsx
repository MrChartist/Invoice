/**
 * "Edit log" button (WP-7 wiring): opens the MCA edit log of one record. The dialog chunk loads on
 * first click, so screens that mount the button pay only for the button.
 */
import { Suspense, lazy, useState } from 'react';
import { History } from 'lucide-react';
import { useT } from '../../i18n';
import { wireT } from '../../i18n/areas/wiring';
import controls from '../../styles/controls.module.css';

const EditLog = lazy(() => import('./EditLog').then((m) => ({ default: m.EditLog })));

export function EditLogButton({ recordId, name, className }: { recordId: string; name?: string; className?: string }) {
  useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className ?? controls.btnGhost} onClick={() => setOpen(true)}>
        <History size={16} aria-hidden="true" /> {wireT('editLog')}
      </button>
      {open && (
        <Suspense fallback={null}>
          <EditLog open recordId={recordId} name={name} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
