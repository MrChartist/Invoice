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
import { useT } from '../i18n';
import { recT } from '../i18n/areas/recurring';

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
  useT(); // re-render on a language switch (5.4)
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
      notify((err as Error).message || recT('updateFailed'), 'error');
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
      if (!res) notify(recT('ended'), 'error');
      else notify(res.created ? recT('created', { number: res.invoice.invoice_number }) : recT('exists'), res.created ? 'success' : 'info');
    });

  const runConfirmed = () => {
    if (!confirm) return;
    const { kind, schedule } = confirm;
    guard(() => {
      if (kind === 'delete') {
        recurringDb.remove(schedule.id);
        notify(recT('deleted'));
      } else if (kind === 'stop') {
        stopSchedule(schedule.id, today);
        notify(recT('endedToast'));
      } else {
        skipNext(schedule.id);
        notify(recT('skipped', { date: formatDate(schedule.next_run) }), 'info');
      }
    });
  };

  const confirmCopy = confirm && {
    delete: {
      title: recT('delTitle'),
      message: recT('delMsg', { name: confirm.schedule.name }),
      label: recT('delete'),
      destructive: true,
    },
    stop: {
      title: recT('stopTitle'),
      message: recT('stopMsg', { name: confirm.schedule.name }),
      label: recT('stopLabel'),
      destructive: true,
    },
    skip: {
      title: recT('skipTitle'),
      message: recT('skipMsg', { date: formatDate(confirm.schedule.next_run) }),
      label: recT('skipLabel'),
      destructive: false,
    },
  }[confirm.kind];

  return (
    <div className={surface.page}>
      <PageHeader
        title={recT('title')}
        subtitle={recT('subtitle')}
        actions={
          <button type="button" className={controls.btnPrimary} onClick={openCreate}>
            <Plus size={16} aria-hidden="true" /> {recT('newSchedule')}
          </button>
        }
      />

      <section className={surface.statGrid} aria-label={recT('summary')}>
        <StatCard label={recT('active')} value={stats.active} hint={recT('nPaused', { n: stats.paused })} icon={Repeat} tone="profit" />
        <StatCard label={recT('nextRun')} value={stats.next ? formatDate(stats.next) : '—'} hint={recT('nextRunHint')} icon={CalendarClock} />
        <StatCard label={recT('mrr')} value={formatCurrency(stats.mrr)} hint={recT('mrrHint')} icon={TrendingUp} tone="brand" />
        <StatCard label={recT('paused')} value={stats.paused} hint={recT('pausedHint')} icon={Pause} tone={stats.paused ? 'warning' : 'default'} />
      </section>

      {schedules.length === 0 ? (
        <div className={surface.card}>
          <EmptyState
            icon={Repeat}
            title={recT('emptyTitle')}
            text={recT('emptyText')}
            action={
              <button type="button" className={controls.btnPrimary} onClick={openCreate}>
                <Plus size={16} /> {recT('newSchedule')}
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
              onPause={(x) => guard(() => { pauseSchedule(x.id); notify(recT('pausedToast'), 'info'); })}
              onResume={(x) => guard(() => { resumeSchedule(x.id, today); notify(recT('resumedToast')); })}
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
          notify(editing ? recT('updated') : recT('createdSchedule', { name: s.name }));
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
