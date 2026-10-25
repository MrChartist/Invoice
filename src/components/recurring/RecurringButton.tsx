import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { RecurringEditor } from './RecurringEditor';
import { useToast } from '../ui/useToast';
import type { RecurringSchedule } from '../../lib/recurring';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { recT } from '../../i18n/areas/recurring';

export interface RecurringButtonProps {
  invoice: InvoiceRecord;
  className?: string;
  /** Called after the schedule is saved (e.g. to navigate to /recurring). */
  onCreated?: (schedule: RecurringSchedule) => void;
}

/** Small outline button that opens the recurring editor prefilled from `invoice`. */
export function RecurringButton({ invoice, className, onCreated }: RecurringButtonProps) {
  useT(); // re-render on a language switch (5.4)
  const [open, setOpen] = useState(false);
  const { notify, toastNode } = useToast();

  return (
    <>
      <button
        type="button"
        className={className ?? `${controls.btnOutline} ${controls.btnSm}`}
        onClick={() => setOpen(true)}
        title={recT('makeTitle')}
      >
        <Repeat size={14} /> {recT('make')}
      </button>
      <RecurringEditor
        open={open}
        onClose={() => setOpen(false)}
        sourceInvoice={invoice}
        onSaved={(s) => {
          notify(recT('madeToast', { name: s.name }));
          onCreated?.(s);
        }}
      />
      {toastNode}
    </>
  );
}
