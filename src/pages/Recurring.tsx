import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
  runNowIsEarly,
  scheduleStatus,
  skipNext,
  stopSchedule,
  type RecurringSchedule,
} from '../lib/recurring';
import { formatCurrency, formatDate, todayInput } from '../lib/utils';
import { RECURRING_RAN_EVENT, RECURRING_RUN_EVENT } from '../hooks/useRecurringRunner';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './Recurring.module.css';
import { useT } from '../i18n';
import { recT } from '../i18n/areas/recurring';
import { s2T } from '../i18n/areas/sales-r2';
import { defineArea } from '../i18n/area';
import { visibleTabs, type PackId } from '../lib/industry-packs'; // R5-C
import { localDb } from '../lib/localDb';
import { RECURRING_TABS, type RecurringTab } from './page-tabs'; // R6-B1

// R2-B1: batch invoices (one template, many parties), loaded on demand.
const BatchTab = lazy(() => import('../components/recurring/BatchTab').then((m) => ({ default: m.BatchTab })));
// R5-C: fees (institutions) and leases (property) — listed only with their pack on; the URL always opens them.
const FeesTab = lazy(() => import('../components/institutions/r5c-lazy').then((l) => l.r5c()).then((m) => ({ default: m.FeesTab })));
const LeasesTab = lazy(() => import('../components/institutions/r5c-lazy').then((l) => l.r5c()).then((m) => ({ default: m.LeasesTab })));
const r5cTabT = defineArea({ fees: 'Fees', leases: 'Leases', society: 'Society' } as const, { fees: 'फ़ीस', leases: 'लीज़', society: 'सोसाइटी' }); // R18-A: + society
// R18-A: the Society desk (units / tariff; B–D add views) — listed with the `society` pack, one lazy chunk.
const SocietyDesk = lazy(() => import('../components/society/SocietyDesk'));
type RecTab = RecurringTab;
// R6-B1: the ids (and packs) live in recurring-tabs.ts; the labels stay here.
const TAB_LABEL: Record<RecTab, () => string> = {
  schedules: () => s2T('rec.tabSchedules'),
  batch: () => s2T('rec.tabBatch'),
  fees: () => r5cTabT('fees'), // R5-C
  leases: () => r5cTabT('leases'), // R5-C
  society: () => r5cTabT('society'), // R18-A
};
const REC_TABS: { id: RecTab; label: () => string; pack?: PackId }[] = RECURRING_TABS.map((t) => ({ ...t, label: TAB_LABEL[t.id] }));

export interface RecurringPageProps {
  /** Open the create modal prefilled from this saved invoice. */
  fromInvoiceId?: string;
}

type Confirm =
  | { kind: 'delete'; schedule: RecurringSchedule }
  | { kind: 'stop'; schedule: RecurringSchedule }
  | { kind: 'skip'; schedule: RecurringSchedule }
  | { kind: 'early'; schedule: RecurringSchedule }
  | null;

export function Recurring({ fromInvoiceId }: RecurringPageProps = {}) {
  useT(); // re-render on a language switch (5.4)
  const [params, setParams] = useSearchParams();
  const queryFrom = params.get('from') ?? undefined;
  const prefillId = fromInvoiceId ?? queryFrom;
  const tab: RecTab = REC_TABS.find((t) => t.id === params.get('tab'))?.id ?? 'schedules';

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
    // QA-3 F6: the shell's runner generated documents (e.g. the first run of a schedule just saved).
    window.addEventListener(RECURRING_RAN_EVENT, onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(RECURRING_RAN_EVENT, onFocus);
    };
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

  const runAndTell = (id: string, early: boolean) =>
    guard(() => {
      const res = runNow(id, today, { early });
      if (!res) notify(recT('ended'), 'error');
      else notify(res.created ? recT('created', { number: res.invoice.invoice_number || recT('draftShort') }) : recT('exists'), res.created ? 'success' : 'info');
    });
  // QA-3 F6: judged on the stored schedule (the card may be stale); a period not due yet asks first.
  const onRunNow = (s: RecurringSchedule) => {
    const fresh = recurringDb.getById(s.id) ?? s;
    if (runNowIsEarly(fresh, today)) {
      reload();
      setConfirm({ kind: 'early', schedule: fresh });
    } else runAndTell(s.id, false);
  };

  const runConfirmed = () => {
    if (!confirm) return;
    const { kind, schedule } = confirm;
    if (kind === 'early') return runAndTell(schedule.id, true);
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
    early: {
      title: recT('earlyTitle'),
      message: recT('earlyMsg', { date: formatDate(confirm.schedule.next_run) }),
      label: recT('earlyLabel'),
      destructive: false,
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

      {/* R2-B1: Schedules | Batch invoices */}
      <div className={controls.segment} role="tablist" aria-label={recT('title')}>
        {visibleTabs(REC_TABS, localDb.settings.get(), tab).map(({ id: k, label }) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? controls.segmentBtnActive : controls.segmentBtn}
            onClick={() => { const next = new URLSearchParams(params); next.delete('view'); if (k !== 'schedules') next.set('tab', k); else next.delete('tab'); setParams(next, { replace: true }); }}>
            {label()}
          </button>
        ))}
      </div>

      {tab === 'batch' || tab === 'fees' || tab === 'leases' || tab === 'society' ? (
        <Suspense fallback={null}>
          {tab === 'batch' ? <BatchTab /> : tab === 'fees' ? <FeesTab notify={notify} /> : tab === 'society' ? <SocietyDesk view={params.get('view') ?? undefined} notify={notify} /> : <LeasesTab notify={notify} />}
        </Suspense>
      ) : (
      <>
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

      </>
      )}

      <RecurringEditor
        open={editorOpen}
        onClose={closeEditor}
        schedule={editing}
        fromInvoiceId={prefill}
        onSaved={(s) => {
          notify(editing ? recT('updated') : recT('createdSchedule', { name: s.name }));
          reload();
          // A schedule due today runs now; the list re-reads when the runner reports back.
          if (s.next_run <= today) window.dispatchEvent(new Event(RECURRING_RUN_EVENT));
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
