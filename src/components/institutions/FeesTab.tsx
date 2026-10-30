/**
 * Recurring → Fees (R5-C1): plans, students / patients, the billing run (one Bill of Supply and / or one tax invoice
 * per student per instalment, issued in one batch, undo by cancelling) and dues. Lazy; listed with the `fees` pack.
 */
import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import type { FeePlan } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { deletePlan, loadPlans } from '../../lib/institutions/fee-plans';
import { studentsOf } from '../../lib/institutions/enrolments';
import { issueFeeRun, loadFeeRuns, planFeeRun, undoFeeRun, type FeeRunPlan } from '../../lib/institutions/fee-billing';
import { useT } from '../../i18n';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from './institutions.module.css';
import { FeePlanForm } from './FeePlanForm';
import { EnrolmentsPanel } from './EnrolmentsPanel';
import { DuesPanel } from './DuesPanel';
import { B, S, Shell, T } from './Views';
import { attempt, feeCtx, rs, today, useView, type Notify } from './ui';

const VIEWS = ['plans', 'students', 'bill', 'dues', 'batches', 'attendance', 'refunds'] as const; // R10 (SV-C): coaching views
const FeesR10Views = lazy(() => import('../services-r10/FeesR10Views'));

export default function FeesTab({ notify }: { notify: Notify }) {
  useT();
  const [view, go] = useView(VIEWS);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const plans = useMemo(() => loadPlans(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [planId, setPlanId] = useState('');
  const plan = plans.find((p) => p.id === planId) ?? plans[0];
  const [editing, setEditing] = useState<FeePlan | null>();
  const [b, setB] = useState({ idx: 0, cls: '', date: today() });
  const [pre, setPre] = useState<FeeRunPlan | null>(null);
  const runs = useMemo(() => loadFeeRuns().filter((r) => !r.undone).reverse(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const setBill = (x: Partial<typeof b>) => { setB({ ...b, ...x }); setPre(null); };
  const pick = plans.length > 1 && <S l={iT('plan')} v={plan?.id} o={plans.map((p) => [p.id, p.name] as const)} on={(v) => { setPlanId(v); setPre(null); }} />;
  const nameOf = (id: string, i: number) => { const p = plans.find((x) => x.id === id); return `${p?.name}: ${p?.instalments[i]?.label}`; };

  return (
    <Shell pack="fees" views={VIEWS} view={view} go={go} label={(v) => iT(`fees.${v}`)} note={iT('feesNote')} d="fees-tab">
      {view === 'plans' && (editing !== undefined ? (
        <FeePlanForm key={editing?.id ?? 'new'} plan={editing ?? undefined} notify={notify} onSaved={() => { setEditing(undefined); refresh(); }} />
      ) : (
        <div className={styles.lines}>
          <div><B p l={iT('newPlan')} d="fee-plan-new" on={() => setEditing(null)} /></div>
          {plans.map((p) => (
            <div key={p.id} className={styles.line}>
              <strong>{p.name}</strong><span className={styles.note}>{p.year_label} · {p.instalments.length} × · {rs(p.heads.reduce((s, h) => s + h.amount, 0))}</span>
              <B sm l={iT('edit')} on={() => setEditing(p)} />
              <B g sm l={iT('remove')} on={() => attempt(notify, () => { deletePlan(p.id); refresh(); })} />
            </div>
          ))}
        </div>
      ))}
      {view !== 'plans' && !plan && <p className={styles.note}>{iT('noPlans')}</p>}
      {view === 'students' && plan && <div className={styles.stack}>{pick}<EnrolmentsPanel plan={plan} notify={notify} tick={tick} refresh={refresh} /></div>}
      {view === 'bill' && plan && (
        <div className={styles.stack}>
          <div className={styles.toolbar}>
            {pick}
            <S l={iT('instalment')} v={b.idx} o={plan.instalments.map((x, i) => [i, `${x.label} · ${x.due_date}`] as const)} on={(v) => setBill({ idx: +v })} />
            <T l={iT('classLabel')} v={b.cls} on={(cls) => setBill({ cls })} />
            <T l={iT('date')} t="date" v={b.date} on={(date) => setBill({ date })} />
            <B l={iT('preview')} d="fee-preview" on={() => attempt(notify, () => setPre(planFeeRun(plan, b.idx, studentsOf(plan.id, localDb.clients.getAll(), b.cls), localDb.invoices.getAll(), feeCtx(b.date))))} />
          </div>
          {pre && (
            <div className={styles.stack} data-fee-run-preview>
              <p>{iT('previewLine', { bos: pre.drafts.filter((d) => d.record.doc_type === 'BILL_OF_SUPPLY').length, tax: pre.drafts.filter((d) => d.record.doc_type !== 'BILL_OF_SUPPLY').length, total: rs(pre.drafts.reduce((s, d) => s + d.record.total, 0)), skipped: pre.skipped.length })}</p>
              <div><B p l={iT('issue')} d="fee-issue" dis={!pre.drafts.length} on={() => attempt(notify, () => { const r = issueFeeRun(plan, b.idx, pre, b.date); notify(iT('nDone', { n: r.invoices.length })); setPre(null); refresh(); })} /></div>
            </div>
          )}
          {runs.map((r) => (
            <div key={r.id} className={styles.line}>
              <span>{r.date} · {nameOf(r.plan_id, r.instalment)} · {r.student_ids.length}</span>
              <B g sm l={iT('undo')} on={() => { const why = window.prompt(iT('reason')); if (why) attempt(notify, () => { undoFeeRun(r.id, why); refresh(); }, iT('saved')); }} />
            </div>
          ))}
        </div>
      )}
      {view === 'dues' && <DuesPanel plans={plans} notify={notify} tick={tick} refresh={refresh} />}
      {(view === 'batches' || view === 'attendance' || view === 'refunds') && <Suspense fallback={null}><FeesR10Views view={view} notify={notify} /></Suspense>}
    </Shell>
  );
}
