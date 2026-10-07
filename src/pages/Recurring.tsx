import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarClock, Pause, Plus, Repeat, TrendingUp } from 'lucide-react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/useToast';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { RecurringEditor } from '../components/recurring/RecurringEditor';
import { ScheduleCard } from '../components/recurring/ScheduleCard';
import {
  monthlyValue,
  pauseSchedule,
  recurringDb,
  resumeSchedule,
  runNow,
  scheduleStatus,
  skipNext,
  stopSchedule,
  type RecurringSchedule,
} from '../lib/recurring';
import { formatCurrency, formatDate, todayInput } from '../lib/utils';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './Recurring.module.css';

export interface RecurringPageProps {
  /** Open the create modal prefilled from this saved invoice. */
  fromInvoiceId?: string;
}

type Confirm =
  | { kind: 'delete'; schedule: RecurringSchedule }
  | { kind: 'stop'; schedule: RecurringSchedule }
  | { kind: 'skip'; schedule: RecurringSchedule }
  | null;

export function Recurring({ fromInvoiceId }: RecurringPageProps = {}) {
  const [params, setParams] = useSearchParams();
  const queryFrom = params.get('from') ?? undefined;
  const prefillId = fromInvoiceId ?? queryFrom;

  const [schedules, setSchedules] = useState<RecurringSchedule[]>(() => recurringDb.getAll());
  const [editorOpen, setEditorOpen] = useState(Boolean(prefillId));
  const [editing, setEditing] = useState<RecurringSchedule | undefined>();
  const [prefill, setPrefill] = useState<string | undefined>(prefillId);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const { notify, toastNode } = useToast();

  const reload = useCallback(() => setSchedules(recurringDb.getAll()), []);
  useEffect(() => {
    const onFocus = () => reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  const today = todayInput();

  const stats = useMemo(() => {
    const live = schedules.filter((s) => scheduleStatus(s) === 'active');
    const paused = schedules.filter((s) => scheduleStatus(s) === 'paused').length;
    const next = live.map((s) => s.next_run).sort()[0];
    const mrr = live.reduce((sum, s) => sum + monthlyValue(s), 0);
    return { active: live.length, paused, next, mrr };
  }, [schedules]);

  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (err) {
      notify((err as Error).message || 'Could not update the schedule', 'error');
    }
    reload();
  };

  const openCreate = () => {
    setEditing(undefined);
    setPrefill(undefined);
    setEditorOpen(true);
  };
  const openEdit = (s: RecurringSchedule) => {
    setEditing(s);
    setPrefill(undefined);
    setEditorOpen(true);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(undefined);
    setPrefill(undefined);
    if (queryFrom) {
      const next = new URLSearchParams(params);
      next.delete('from');
      setParams(next, { replace: true });
    }
  };

  const onRunNow = (s: RecurringSchedule) =>
    guard(() => {
      const res = runNow(s.id, today);
      if (!res) notify('This schedule has ended', 'error');
      else notify(res.created ? `Created ${res.invoice.invoice_number}` : 'That invoice already exists', res.created ? 'success' : 'info');
    });

  const runConfirmed = () => {
    if (!confirm) return;
    const { kind, schedule } = confirm;
    guard(() => {
      if (kind === 'delete') {
        recurringDb.remove(schedule.id);
        notify('Schedule deleted. Invoices already created are kept.');
      } else if (kind === 'stop') {
        stopSchedule(schedule.id, today);
        notify('Schedule ended');
      } else {
        skipNext(schedule.id);
        notify(`Skipped ${formatDate(schedule.next_run)}`, 'info');
      }
    });
  };

  const confirmCopy = confirm && {
    delete: {
      title: 'Delete recurring schedule?',
      message: `"${confirm.schedule.name}" will stop generating invoices. Invoices it has already created stay in your ledger.`,
      label: 'Delete',
      destructive: true,
    },
    stop: {
      title: 'End this schedule?',
      message: `"${confirm.schedule.name}" will stop permanently. Its history is kept, but it cannot be resumed.`,
      label: 'End schedule',
      destructive: true,
    },
    skip: {
      title: 'Skip the next invoice?',
      message: `No invoice will be created for ${formatDate(confirm.schedule.next_run)}. The schedule continues afterwards.`,
      label: 'Skip',
      destructive: false,
    },
  }[confirm.kind];

  return (
    <div className={surface.page}>
      <PageHeader
        title="Recurring"
        subtitle="Subscriptions and retainers that invoice themselves — monthly plans, quarterly retainers and more."
        actions={
          <button type="button" className={controls.btnPrimary} onClick={openCreate}>
            <Plus size={16} aria-hidden="true" /> New schedule
          </button>
        }
      />

      <section className={surface.statGrid} aria-label="Recurring summary">
        <StatCard label="Active" value={stats.active} hint={`${stats.paused} paused`} icon={Repeat} tone="profit" />
        <StatCard label="Next run" value={stats.next ? formatDate(stats.next) : '—'} hint="Across all active schedules" icon={CalendarClock} />
        <StatCard label="Monthly recurring" value={formatCurrency(stats.mrr)} hint="Estimated, incl. tax" icon={TrendingUp} tone="brand" />
        <StatCard label="Paused" value={stats.paused} hint="Resume without back-filling" icon={Pause} tone={stats.paused ? 'warning' : 'default'} />
      </section>

      {schedules.length === 0 ? (
        <div className={surface.card}>
          <EmptyState
            icon={Repeat}
            title="No recurring invoices yet"
            text="Create a schedule from scratch, or open any saved invoice and choose “Make recurring”. New invoices are created when you open the app on or after each date."
            action={
              <button type="button" className={controls.btnPrimary} onClick={openCreate}>
                <Plus size={16} /> New schedule
              </button>
            }
          />
        </div>
      ) : (
        <div className={styles.grid}>
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onEdit={openEdit}
              onRunNow={onRunNow}
              onPause={(x) => guard(() => { pauseSchedule(x.id); notify('Schedule paused', 'info'); })}
              onResume={(x) => guard(() => { resumeSchedule(x.id, today); notify('Schedule resumed'); })}
              onSkip={(x) => setConfirm({ kind: 'skip', schedule: x })}
              onStop={(x) => setConfirm({ kind: 'stop', schedule: x })}
              onDelete={(x) => setConfirm({ kind: 'delete', schedule: x })}
            />
          ))}
        </div>
      )}

      <RecurringEditor
        open={editorOpen}
        onClose={closeEditor}
        schedule={editing}
        fromInvoiceId={prefill}
        onSaved={(s) => {
          notify(editing ? 'Schedule updated' : `Schedule "${s.name}" created`);
          reload();
        }}
      />

      {confirmCopy && (
        <ConfirmDialog
          open
          title={confirmCopy.title}
          message={confirmCopy.message}
          confirmLabel={confirmCopy.label}
          destructive={confirmCopy.destructive}
          onConfirm={runConfirmed}
          onClose={() => setConfirm(null)}
        />
      )}
      {toastNode}
    </div>
  );
}
