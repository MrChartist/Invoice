import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Store } from 'lucide-react';
import { useCan } from '../../hooks/useCan';
import { localDb } from '../../lib/localDb';
import { enabledModules } from '../../lib/shop-mode';
import { DASHBOARD_ACTIONS, quickActions } from '../../lib/quick-create';
import { buildChecklist } from '../../lib/checklist';
import { DB_PREFIX, getTable, readRaw, reloadAfterFlush } from '../../lib/storage';
import { QUICK_ICONS } from '../layout/quick-icons';
import { useT } from '../../i18n';
import { reachT } from '../../i18n/areas/reach';
import controls from '../../styles/controls.module.css';
import own from '../layout/QuickCreate.module.css';
import styles from '../../pages/Dashboard.module.css';

/**
 * Dashboard start (8H): the quick-action row (New invoice, ₹ Received, POS, Expense — by role and
 * shop mode), the getting-started checklist v2 and, on an empty company, "Try with sample data".
 * Lazy, so the Dashboard's first paint is unchanged.
 */
export function DashboardStart({ profileReady }: { profileReady: boolean }) {
  useT();
  const { can } = useCan();
  const [facts] = useState(() => ({
    profileReady,
    clients: localDb.clients.getAll().length,
    items: localDb.items.getAll().length,
    invoices: localDb.invoices.getAll().length,
    messagesSent: getTable<{ channel?: string }>('reminders').filter((r) => r && r.channel !== 'snooze').length,
    payments: getTable('transactions').length,
    lastBackup: readRaw(`${DB_PREFIX}last_backup`) ?? '',
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const actions = quickActions(can, enabledModules(localDb.settings.get()), DASHBOARD_ACTIONS);
  const steps = buildChecklist(facts);
  const showChecklist = can('settings.manage') && steps.some((s) => !s.done);
  const done = steps.filter((s) => s.done).length;

  const loadSample = async () => {
    setBusy(true);
    try {
      const { loadDemoData } = await import('../../lib/demo-data');
      const r = loadDemoData();
      if (!r.ok) throw new Error(r.reason);
      // QA-3 F5: reload only once IndexedDB has the sample data (a bare reload dropped it).
      reloadAfterFlush();
    } catch (err) {
      setError(reachT('sampleFailed', { message: (err as Error).message }));
      setBusy(false);
    }
  };

  return (
    <>
      {actions.length > 0 && (
        <nav className={own.row} aria-label={reachT('qa.row')}>
          {actions.map((a) => {
            const Icon = QUICK_ICONS[a.id];
            return (
              <Link key={a.id} to={a.to} className={own.rowAction} data-quick-row={a.id}>
                <Icon size={16} aria-hidden="true" /> {reachT(`qa.${a.id}`)}
              </Link>
            );
          })}
        </nav>
      )}
      {facts.invoices === 0 && can('settings.manage') && (
        <div className={own.sample}>
          <button type="button" className={controls.btnOutline} onClick={() => void loadSample()} disabled={busy}>
            <Store size={16} /> {reachT('sampleCta')}
          </button>
          <span>{reachT('sampleHint')}</span>
          {error && <span role="alert">{error}</span>}
        </div>
      )}
      {showChecklist && (
        <section className={styles.checklist} aria-label={reachT('ck.head')}>
          <div className={styles.checklistHead}>
            <h2>{reachT('ck.head')}</h2>
            <span>{reachT('ck.doneOf', { done, total: steps.length })}</span>
          </div>
          <ul>
            {steps.map((c) => (
              <li key={c.id}>
                <Link to={c.to} className={c.done ? styles.stepDone : styles.step} data-step={c.id}>
                  {c.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  <span>{reachT(`ck.${c.id}`)}</span>
                  {!c.done && <ArrowRight size={14} className={styles.stepArrow} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
