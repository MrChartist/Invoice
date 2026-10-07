import { useMemo, useState } from 'react';
import { BellRing, CheckCircle2 } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import { localDb } from '../../lib/localDb';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import {
  STAGE_LABELS,
  pendingReminders,
  type PendingReminder,
  type ReminderStage,
} from '../../lib/reminders';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './share.module.css';
import { ReminderModal } from './ReminderModal';
import { useReminderLog } from './useReminderLog';

export interface RemindersPanelProps {
  /** Defaults to every saved invoice from localDb. */
  invoices?: InvoiceRecord[];
  /** Max rows shown (the rest is summarised). Default 5. */
  limit?: number;
  /** Override "today" (tests / demos). */
  today?: Date;
  className?: string;
}

function stageClass(stage: ReminderStage): string {
  if (stage === 'upcoming') return styles.stageUpcoming;
  if (stage === 'due_today') return styles.stageDue;
  return styles.stageLate;
}

function whenText(p: PendingReminder): string {
  if (p.daysToDue > 0) return `Due in ${p.daysToDue} day${p.daysToDue === 1 ? '' : 's'}`;
  if (p.daysToDue === 0) return 'Due today';
  const n = -p.daysToDue;
  return `${n} day${n === 1 ? '' : 's'} overdue`;
}

/** Card listing invoices that deserve a payment nudge today, one click to compose. */
export function RemindersPanel({ invoices, limit = 5, today, className }: RemindersPanelProps) {
  const { log, reload } = useReminderLog();
  const [active, setActive] = useState<InvoiceRecord | null>(null);
  const [all] = useState<InvoiceRecord[]>(() => invoices ?? (localDb.invoices.getAll() as InvoiceRecord[]));
  const source = invoices ?? all;

  const pending = useMemo(
    () => pendingReminders(source, today ?? new Date(), log),
    [source, today, log],
  );
  const shown = pending.slice(0, limit);
  const outstanding = pending.reduce((sum, p) => sum + p.invoice.balance_due, 0);

  return (
    <section className={cn(surface.card, className)} aria-label="Payment reminders">
      <div className={surface.cardHead}>
        <h2
          className={surface.pageSubtitle}
          style={{ margin: 0, color: 'var(--foreground)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <BellRing size={16} aria-hidden="true" />
          Payments to chase
        </h2>
        {pending.length > 0 && (
          <span className={cn(surface.badge, surface.badgePartial)}>
            {pending.length} · {formatCurrency(outstanding)}
          </span>
        )}
      </div>

      {shown.length === 0 ? (
        <div className={surface.cardBody}>
          <p className={surface.sectionNote} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
            <CheckCircle2 size={16} style={{ color: 'var(--profit)' }} />
            Nothing to chase today. Every invoice is paid, snoozed or not yet due.
          </p>
        </div>
      ) : (
        <ul className={styles.panelList}>
          {shown.map((p) => (
            <li key={p.invoice.id} className={styles.panelRow}>
              <div className={styles.panelMain}>
                <span className={styles.panelClient}>{p.invoice.client?.name || 'Client'}</span>
                <span className={styles.panelMeta}>
                  <span>{p.invoice.invoice_number}</span>
                  <span>{whenText(p)}</span>
                  <span>
                    {p.count > 0 && p.lastSentAt
                      ? `Reminded ${p.count}x, last ${formatDate(p.lastSentAt)}`
                      : 'Not reminded yet'}
                  </span>
                </span>
              </div>
              <div className={styles.panelAside}>
                <span className={cn(surface.badge, stageClass(p.stage))} title={STAGE_LABELS[p.stage]}>
                  {p.stage === 'upcoming' ? 'Upcoming' : p.stage === 'due_today' ? 'Due' : 'Overdue'}
                </span>
                <span className={styles.amount}>
                  {formatCurrency(p.invoice.balance_due, p.invoice.currency)}
                </span>
                <button
                  type="button"
                  className={cn(controls.btnOutline, controls.btnSm)}
                  onClick={() => setActive(p.invoice)}
                  aria-label={`Remind ${p.invoice.client?.name || 'client'} about ${p.invoice.invoice_number}`}
                >
                  Remind
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pending.length > shown.length && (
        <div className={surface.cardBody}>
          <p className={surface.sectionNote} style={{ margin: 0 }}>
            +{pending.length - shown.length} more invoices need a nudge.
          </p>
        </div>
      )}

      {active && (
        <ReminderModal
          invoice={active}
          open
          onClose={() => setActive(null)}
          onSent={() => reload()}
        />
      )}
    </section>
  );
}
