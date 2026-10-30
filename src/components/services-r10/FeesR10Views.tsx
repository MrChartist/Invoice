/**
 * SV-C coaching views of Recurring → Fees (one lazy chunk, mounted by the R5-C fees tab): `batches` (timetable, the
 * students of each batch), `attendance` (one tap all present, P / A / Late per student, this month's %) and `refunds`
 * (pro rata refund on leaving: preview, credit notes, due in 10 days, overdue in red, mark paid). Working papers.
 */
import { useMemo, useState } from 'react';
import type { AttendanceMark } from '../../types/services-r10';
import { localDb } from '../../lib/localDb';
import { loadPlans } from '../../lib/institutions/fee-plans';
import { studentsOf } from '../../lib/institutions/enrolments';
import { loadClasses, setBatch, studentsOfBatch } from '../../lib/services/sv-classes';
import { attendanceOf, loadAttendance, saveAttendance } from '../../lib/services/sv-attendance';
import { coachingRefund, issueCoachingRefund, markRefundPaid, refundBasis, type RefundCalc } from '../../lib/services/sv-coaching-refund';
import { useT } from '../../i18n';
import { mcT } from '../../i18n/areas/services-r10c';
import { B, S, T, Tbl } from '../institutions/Views';
import { attempt, rs, today, type Notify } from '../institutions/ui';
import styles from '../institutions/institutions.module.css';
import { ClassForm, Timetable } from './MembersDesk';
import { SelectField } from '../ui/SelectField';

const MARKS: AttendanceMark[] = ['P', 'A', 'L'];

export default function FeesR10Views({ view, notify }: { view: 'batches' | 'attendance' | 'refunds'; notify: Notify }) {
  useT();
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((x) => x + 1);
  const plans = useMemo(() => loadPlans(), []);
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const plan = plans.find((p) => p.id === planId);
  /* eslint-disable react-hooks/exhaustive-deps */
  const batches = useMemo(() => loadClasses().filter((c) => c.kind === 'batch' && c.fee_plan_id === planId), [tick, planId]);
  const clients = useMemo(() => localDb.clients.getAll(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const [batchId, setBatchId] = useState('');
  const batch = batches.find((b) => b.id === batchId) ?? batches[0];
  const students = batch ? studentsOfBatch(batch, clients) : [];
  const d = today();
  const [day, setDay] = useState(d);
  const [marks, setMarks] = useState<Record<string, AttendanceMark>>({});
  const [r, setR] = useState({ student: '', leave: d, request: d, basis: 'days' as 'days' | 'months' });
  const [pre, setPre] = useState<(RefundCalc & { course: number; paid: number; from: string }) | null>(null);
  if (!plan) return null; // the fees tab says there is no plan
  const pickPlan = plans.length > 1 && <S l={mcT('plan')} v={planId} o={plans.map((p) => [p.id, p.name] as const)} on={setPlanId} />;
  const pickBatch = <S l={mcT('batch')} v={batch?.id} o={batches.map((b) => [b.id, b.name] as const)} on={setBatchId} d="fee-batch" />;
  const stored = batch && loadAttendance().find((a) => a.class_id === batch.id && a.date === day);
  const shown = { ...stored?.marks, ...marks };
  const enrolled = studentsOf(plan.id, clients);
  const sr = enrolled.find((x) => x.id === r.student) ?? enrolled[0];
  const calc = () => {
    if (!sr || !batch?.to) throw new Error(mcT('courseEnd'));
    const e = sr.enrolments!.find((x) => x.plan_id === plan.id)!;
    const b = refundBasis(sr, plan, localDb.invoices.getAll());
    return { ...coachingRefund({ from: e.from, to: batch.to, leave: r.leave, request: r.request, course: b.course, paid: b.paid, basis: r.basis }), ...b, from: e.from };
  };
  return (
    <div className={styles.stack} data-fees-r10={view}>
      <div className={styles.toolbar}>{pickPlan}{view !== 'batches' && pickBatch}</div>
      {view === 'batches' && (
        <>
          <ClassForm notify={notify} onSaved={refresh} kind="batch" feePlanId={plan.id} />
          <Timetable classes={batches} />
          <Tbl h={[mcT('student'), mcT('batch')]} rows={enrolled.map((s) => [s.name, <SelectField key="b" value={s.enrolments?.find((e) => e.plan_id === plan.id)?.class_id ?? ''} onChange={(e) => attempt(notify, () => { setBatch(s.id!, plan.id, e.target.value); refresh(); })} aria-label={mcT('put')}><option value="">-</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</SelectField>])} />
        </>
      )}
      {view === 'attendance' && batch && (
        <>
          <div className={styles.toolbar}>
            <T l={mcT('time')} t="date" v={day} on={(v) => { setDay(v); setMarks({}); }} />
            <B l={mcT('all')} d="att-all" on={() => setMarks(Object.fromEntries(students.map((s) => [s.id!, 'P' as const])))} />
            <B p l={mcT('save')} d="att-save" on={() => attempt(notify, () => { saveAttendance(batch.id, day, Object.fromEntries(students.map((s) => [s.id!, shown[s.id!] ?? 'A']))); setMarks({}); refresh(); }, mcT('saved'))} />
          </div>
          <Tbl d="att-table" h={[mcT('student'), mcT('present'), mcT('pct')]} rows={students.map((s) => {
            const p = attendanceOf(s.id!, day.slice(0, 7), d, [batch], loadAttendance());
            return [s.name, <span key="m">{MARKS.map((m) => <B key={m} sm p={shown[s.id!] === m} g={shown[s.id!] !== m} l={mcT(m)} on={() => setMarks({ ...marks, [s.id!]: m })} />)}</span>, p.held ? `${p.present} / ${p.held}` : '-'];
          })} />
        </>
      )}
      {view === 'refunds' && (
        <>
          <div className={styles.toolbar}>
            <S l={mcT('student')} v={sr?.id} o={enrolled.map((s) => [s.id!, s.name] as const)} on={(student) => { setR({ ...r, student }); setPre(null); }} d="refund-student" />
            <T l={mcT('leave')} t="date" v={r.leave} on={(leave) => { setR({ ...r, leave }); setPre(null); }} d="refund-leave" />
            <T l={mcT('request')} t="date" v={r.request} on={(request) => setR({ ...r, request })} />
            <S l={mcT('basis')} v={r.basis} o={[['days', mcT('b.days')], ['months', mcT('b.months')]]} on={(b) => { setR({ ...r, basis: b as 'days' }); setPre(null); }} d="refund-basis" />
            <B l={mcT('preview')} d="refund-preview" on={() => attempt(notify, () => setPre(calc()))} />
          </div>
          {pre && (
            <p data-refund-calc>
              {mcT('calc', { course: rs(pre.course), paid: rs(pre.paid), used: pre.used, total: pre.total, amount: rs(pre.amount), due: pre.due })}{' '}
              <B p sm l={mcT('refundIt')} d="refund-issue" dis={!(pre.amount > 0)} on={() => attempt(notify, () => { issueCoachingRefund(sr!.id!, plan, { from: pre.from, to: batch!.to!, leave: r.leave, request: r.request, basis: r.basis }); setPre(null); refresh(); }, mcT('saved'))} />
            </p>
          )}
          <Tbl d="refund-list" h={[mcT('student'), mcT('leave'), mcT('amount'), mcT('due'), '']} rows={enrolled.filter((s) => s.enrolments?.some((e) => e.plan_id === plan.id && e.refund)).map((s) => {
            const f = s.enrolments!.find((e) => e.plan_id === plan.id)!.refund!;
            return [s.name, f.leave, rs(f.amount), <span key="d" className={!f.paid_on && d > f.due ? styles.bad : undefined}>{f.due}{!f.paid_on && d > f.due ? ` · ${mcT('overdue')}` : ''}</span>, f.paid_on ? mcT('paidOn', { date: f.paid_on }) : <B key="p" sm l={mcT('paid')} on={() => attempt(notify, () => { markRefundPaid(s.id!, plan.id, d); refresh(); })} />];
          })} />
        </>
      )}
    </div>
  );
}
