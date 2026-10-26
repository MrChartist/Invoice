import { lazy, Suspense, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Circle, Store } from 'lucide-react';
import { useCan } from '../../hooks/useCan';
import { localDb } from '../../lib/localDb';
import { enabledModules } from '../../lib/shop-mode';
import { DASHBOARD_ACTIONS, quickActions } from '../../lib/quick-create';
import { buildChecklist } from '../../lib/checklist';
import { loadSetupProgress, readChecklistInputs, saveSetupProgress, showCard, withSkipped, type SetupProgress } from '../../lib/checklist-steps';
import { reloadAfterFlush } from '../../lib/storage';
import { QUICK_ICONS } from '../layout/quick-icons';
import { stepLabel } from '../help/labels';
import { useT } from '../../i18n';
import { reachT } from '../../i18n/areas/reach';
import controls from '../../styles/controls.module.css';
import own from '../layout/QuickCreate.module.css';
import styles from '../../pages/Dashboard.module.css';

// R6-A4 / A6: the What's-new card (once after an upgrade), the Dashboard tip and Help on "What's new" — all lazy.
const WhatsNewCard = lazy(() => import('./WhatsNewCard'));
const ScreenTip = lazy(() => import('../help/ScreenTip'));
const HelpModal = lazy(() => import('../layout/HelpModal').then((m) => ({ default: m.HelpModal })));

/**
 * Dashboard start (8H, R6-A): the quick-action row (New invoice, ₹ Received, POS, Expense — by role and shop mode),
 * the business-aware setup checklist v3 (skip a step, hide the card; Help → Setup checklist brings it back), the
 * What's-new card and, on an empty company, "Try with sample data". Lazy, so the Dashboard's first paint is unchanged.
 */
export function DashboardStart({ profileReady }: { profileReady: boolean }) {
  useT();
  const { can } = useCan();
  const [{ facts, ctx }] = useState(() => {
    const x = readChecklistInputs();
    return { ...x, facts: { ...x.facts, profileReady } };
  });
  const [progress, setProgress] = useState<SetupProgress>(loadSetupProgress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [helpView, setHelpView] = useState(false);
  const actions = quickActions(can, enabledModules(localDb.settings.get()), DASHBOARD_ACTIONS);
  const steps = buildChecklist(facts, ctx, progress);
  const showChecklist = showCard(steps, progress, ctx.role);
  const done = steps.filter((s) => s.done).length;

  const save = (next: SetupProgress) => {
    try {
      setProgress(saveSetupProgress(next));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const hide = () => {
    if (window.confirm(reachT('ck.hideConfirm'))) save({ ...progress, hidden_at: new Date().toISOString() });
  };

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
      <Suspense fallback={null}>
        <ScreenTip id="dashboard" />
        <WhatsNewCard hadData={facts.invoices > 0} onSeeAll={() => setHelpView(true)} />
        {helpView && <HelpModal open onClose={() => setHelpView(false)} view="whatsnew" />}
      </Suspense>
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
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {showChecklist && (
        <section className={styles.checklist} aria-label={reachT('ck.head')} data-setup-card>
          <div className={styles.checklistHead}>
            <h2>{reachT('ck.head')}</h2>
            <span>
              {reachT('ck.doneOf', { done, total: steps.length })}{' '}
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={hide} data-hide-checklist>
                {reachT('ck.hide')}
              </button>
            </span>
          </div>
          <ul>
            {steps.map((c) => (
              <li key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Link to={c.to} className={c.done ? styles.stepDone : styles.step} data-step={c.key} style={{ flex: 1 }}>
                  {c.done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                  <span>
                    {stepLabel(c)}
                    {c.skipped ? ` · ${reachT('ck.skipped')}` : ''}
                  </span>
                  {!c.done && <ArrowRight size={14} className={styles.stepArrow} />}
                </Link>
                {!c.done && (
                  <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => save(withSkipped(progress, c.key, true))} data-skip-step={c.key}>
                    {reachT('ck.skip')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
