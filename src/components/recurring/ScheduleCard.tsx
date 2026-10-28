import { CalendarClock, Edit3, Pause, Play, SkipForward, Square, Trash2, Zap } from 'lucide-react';
import {
  daysBetween,
  scheduleStatus,
  templateTotals,
  type RecurringSchedule,
} from '../../lib/recurring';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './recurring.module.css';
import { useT } from '../../i18n';
import { frequencyText, recT } from '../../i18n/areas/recurring';

export interface ScheduleCardProps {
  schedule: RecurringSchedule;
  onEdit: (s: RecurringSchedule) => void;
  onRunNow: (s: RecurringSchedule) => void;
  onPause: (s: RecurringSchedule) => void;
  onResume: (s: RecurringSchedule) => void;
  onSkip: (s: RecurringSchedule) => void;
  onStop: (s: RecurringSchedule) => void;
  onDelete: (s: RecurringSchedule) => void;
}

function relativeDay(target: string, today: string): { text: string; tone?: string } {
  const diff = daysBetween(today, target);
  if (diff === 0) return { text: recT('today'), tone: styles.dueSoon };
  if (diff === 1) return { text: recT('tomorrow'), tone: styles.dueSoon };
  if (diff > 1) return { text: recT('inDays', { n: diff }), tone: diff <= 3 ? styles.dueSoon : undefined };
  return { text: diff === -1 ? recT('lateOne') : recT('lateMany', { n: -diff }), tone: styles.overdue };
}

export function ScheduleCard({
  schedule: s,
  onEdit,
  onRunNow,
  onPause,
  onResume,
  onSkip,
  onStop,
  onDelete,
}: ScheduleCardProps) {
  useT(); // re-render on a language switch (5.4)
  const status = scheduleStatus(s);
  const today = todayInput();
  const total = templateTotals(s.template).total;
  const rel = status === 'active' ? relativeDay(s.next_run, today) : null;
  const recent = [...s.history].reverse().slice(0, 6);
  const remaining = s.max_runs ? Math.max(s.max_runs - s.run_count - (s.skipped_count || 0), 0) : null;

  return (
    <article
      className={cn(styles.card, status === 'paused' && styles.cardPaused, status === 'ended' && styles.cardEnded)}
      aria-label={s.name}
    >
      <div className={styles.cardTop}>
        <div>
          <h3 className={styles.cardTitle}>{s.name}</h3>
          <p className={styles.cardSub}>
            {s.template.client.name || recT('noClient')} · {frequencyText(s)} ·{' '}
            {s.mode === 'issue' ? recT('issuedSent') : recT('createdDraft')}
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={styles.amount}>{formatCurrency(total, s.template.currency)}</div>
          <span
            className={cn(
              surface.badge,
              status === 'active' && styles.badgeActive,
              status === 'paused' && styles.badgePaused,
              status === 'ended' && styles.badgeEnded,
            )}
          >
            {recT(`status.${status}`)}
          </span>
        </div>
      </div>

      <div className={styles.facts}>
        <div>
          <span className={styles.factLabel}>{recT('nextRun')}</span>
          <span className={cn(styles.factValue, rel?.tone)}>
            {status === 'ended' ? '—' : formatDate(s.next_run)}
            {rel && <span style={{ fontWeight: 500 }}> · {rel.text}</span>}
          </span>
        </div>
        <div>
          <span className={styles.factLabel}>{recT('lastRun')}</span>
          <span className={styles.factValue}>{s.last_run ? formatDate(s.last_run) : recT('never')}</span>
        </div>
        <div>
          <span className={styles.factLabel}>{recT('invoices')}</span>
          <span className={styles.factValue}>
            {s.run_count}
            {remaining !== null ? recT('left', { n: remaining }) : ''}
          </span>
        </div>
      </div>

      <div className={styles.actions}>
        {status !== 'ended' && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => onRunNow(s)}>
            <Zap size={14} /> {recT('runNow')}
          </button>
        )}
        {status === 'active' && (
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => onPause(s)}>
            <Pause size={14} /> {recT('pause')}
          </button>
        )}
        {status === 'paused' && (
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => onResume(s)}>
            <Play size={14} /> {recT('resume')}
          </button>
        )}
        {status !== 'ended' && (
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => onSkip(s)}>
            <SkipForward size={14} /> {recT('skipNext')}
          </button>
        )}
        <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => onEdit(s)}>
          <Edit3 size={14} /> {recT('edit')}
        </button>
        {status !== 'ended' && (
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => onStop(s)}>
            <Square size={14} /> {recT('end')}
          </button>
        )}
        <button
          type="button"
          className={controls.btnDanger}
          onClick={() => onDelete(s)}
          aria-label={recT('deleteOf', { name: s.name })}
          title={recT('deleteSchedule')}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {recent.length > 0 && (
        <details className={styles.history}>
          <summary>
            <CalendarClock size={13} style={{ verticalAlign: '-2px' }} /> {recT('history', { n: s.history.length })}
          </summary>
          <ul className={styles.historyList}>
            {recent.map((h) => (
              <li key={`${h.date}-${h.invoice_id}`} className={styles.historyRow}>
                <span>{formatDate(h.date)}</span>
                {/* QA-3 F6: a draft is numbered when issued, so read the live number. */}
                <span className={styles.mono}>{h.invoice_number || localDb.invoices.getById(h.invoice_id)?.invoice_number || recT('unnumbered')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
