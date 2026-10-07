import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { RecurringEditor } from './RecurringEditor';
import { useToast } from '../ui/useToast';
import type { RecurringSchedule } from '../../lib/recurring';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';

export interface RecurringButtonProps {
  invoice: InvoiceRecord;
  className?: string;
  /** Called after the schedule is saved (e.g. to navigate to /recurring). */
  onCreated?: (schedule: RecurringSchedule) => void;
}

/** Small outline button that opens the recurring editor prefilled from `invoice`. */
export function RecurringButton({ invoice, className, onCreated }: RecurringButtonProps) {
  const [open, setOpen] = useState(false);
  const { notify, toastNode } = useToast();

  return (
    <>
      <button
        type="button"
        className={className ?? `${controls.btnOutline} ${controls.btnSm}`}
        onClick={() => setOpen(true)}
        title="Create a schedule that repeats this invoice"
      >
        <Repeat size={14} /> Make recurring
      </button>
      <RecurringEditor
        open={open}
        onClose={() => setOpen(false)}
        sourceInvoice={invoice}
        onSaved={(s) => {
          notify(`Recurring schedule "${s.name}" created`);
          onCreated?.(s);
        }}
      />
      {toastNode}
    </>
  );
}
