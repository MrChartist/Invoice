import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2 } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import { localDb } from '../../lib/localDb';
import { formatCurrency, formatDate, cn } from '../../lib/utils';
import {
  pendingReminders,
  type PendingReminder,
  type PriorityLevel,
  type ReminderStage,
} from '../../lib/reminders';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './share.module.css';
import { useReminderLog } from './useReminderLog';
import { getTable } from '../../lib/storage';
import { linkedCredits, type CreditLinkRow } from '../../lib/amount-due';
import { useT } from '../../i18n';
import { remindT } from '../../i18n/areas/reminders';
import type { PendingOptions } from '../../lib/reminders';

// The dialog (and its strings) loads only when a reminder is opened, off the Dashboard's first paint.
const ReminderModal = lazy(() => import('./ReminderModal').then((m) => ({ default: m.ReminderModal })));

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

function priorityClass(level: PriorityLevel): string {
  if (level === 'high') return styles.stageLate;
  if (level === 'medium') return styles.stageDue;
  return styles.stageUpcoming;
}

function whenText(p: PendingReminder): string {
  if (p.daysToDue > 0) return p.daysToDue === 1 ? remindT('dueInOne') : remindT('dueInMany', { n: p.daysToDue });
  if (p.daysToDue === 0) return remindT('dueToday');
  const n = -p.daysToDue;
  return n === 1 ? remindT('lateOne') : remindT('lateMany', { n });
}

/** Card listing invoices that deserve a payment nudge today, highest chase priority first. */
export function RemindersPanel({ invoices, limit = 5, today, className }: RemindersPanelProps) {
  useT(); // re-render on a language switch (5.4)
  const { log, reload } = useReminderLog();
  const [active, setActive] = useState<InvoiceRecord | null>(null);
  const [all] = useState<InvoiceRecord[]>(() => invoices ?? (localDb.invoices.getAll() as InvoiceRecord[]));
  const source = invoices ?? all;
  // R2-A4/A5/A7: company schedule, party reminder mode, promises-to-pay (hold / firm) and payment grades.
  // Loaded after first paint (the Dashboard is in the shell), then the list re-sorts.
  const [extra, setExtra] = useState<Partial<PendingOptions>>({});
  useEffect(() => {
    let live = true;
    void Promise.all([import('../../lib/reminder-context'), import('../../lib/payment-score')]).then(([ctx, score]) => {
      if (!live) return;
      const day = today ?? new Date();
      try {
        setExtra({ ...ctx.reminderOptions(source, day), gradeOf: score.gradeLookup(source, day) });
      } catch {
        /* the panel still works with the default schedule */
      }
    });
    return () => {
      live = false;
    };
  }, [source, today, log]);

  const pending = useMemo(
    // Credit notes linked to an invoice settle part of it: never chased (src/lib/amount-due.ts).
    () => pendingReminders(source, today ?? new Date(), log, { credits: linkedCredits(getTable<CreditLinkRow>('doc_links'), source), ...extra }),
    [source, today, log, extra],
  );
  const shown = pending.slice(0, limit);
  const outstanding = pending.reduce((sum, p) => sum + p.balance, 0);

  return (
    <section className={cn(surface.card, className)} aria-label={remindT('aria')}>
      <div className={surface.cardHead}>
        <h2
          className={surface.pageSubtitle}
          style={{ margin: 0, color: 'var(--foreground)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <BellRing size={16} aria-hidden="true" />
          {remindT('title')}
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
            {remindT('none')}
          </p>
        </div>
      ) : (
        <ul className={styles.panelList}>
          {shown.map((p) => (
            <li key={p.invoice.id} className={styles.panelRow}>
              <div className={styles.panelMain}>
                <span className={styles.panelClient}>{p.invoice.client?.name || remindT('client')}</span>
                <span className={styles.panelMeta}>
                  <span
                    className={cn(surface.badge, priorityClass(p.priorityLevel))}
                    title={remindT('priorityTitle', { score: p.priority, reasons: p.priorityReasons.join(', ') })}
                  >
                    {remindT(p.priorityLevel === 'high' ? 'high' : p.priorityLevel === 'medium' ? 'medium' : 'low')}
                  </span>
                  <span>{p.invoice.invoice_number}</span>
                  <span>{whenText(p)}</span>
                  <span>
                    {p.count > 0 && p.lastSentAt
                      ? remindT('reminded', { n: p.count, date: formatDate(p.lastSentAt) })
                      : remindT('notReminded')}
                  </span>
                </span>
              </div>
              <div className={styles.panelAside}>
                <span className={cn(surface.badge, stageClass(p.stage))} title={remindT(`stage.${p.stage}`)}>
                  {remindT(p.stage === 'upcoming' ? 'upcoming' : p.stage === 'due_today' ? 'due' : 'overdue')}
                </span>
                <span className={styles.amount}>
                  {formatCurrency(p.balance, p.invoice.currency)}
                </span>
                <button
                  type="button"
                  className={cn(controls.btnOutline, controls.btnSm)}
                  onClick={() => setActive(p.invoice)}
                  aria-label={remindT('remindAria', { client: p.invoice.client?.name || remindT('clientLower'), number: p.invoice.invoice_number })}
                >
                  {remindT('remind')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pending.length > shown.length && (
        <div className={surface.cardBody}>
          <p className={surface.sectionNote} style={{ margin: 0 }}>
            {remindT('more', { n: pending.length - shown.length })}
          </p>
        </div>
      )}

      {active && (
        <Suspense fallback={null}>
          <ReminderModal
            invoice={active}
            open
            onClose={() => setActive(null)}
            onSent={() => reload()}
          />
        </Suspense>
      )}
    </section>
  );
}
