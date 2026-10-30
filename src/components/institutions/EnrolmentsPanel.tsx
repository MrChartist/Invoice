/** R5-C1 students / patients on a plan: enrol (with a concession), bulk enrol from CSV, clinic visits. */
import { useMemo, useState } from 'react';
import type { Concession, FeePlan } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { parseTable } from '../../lib/csv';
import { bulkEnrol, enrol, enrolRowsFromCsv, enrolmentOf, recordVisit, studentsOf, unenrol } from '../../lib/institutions/enrolments';
import { sessionsLeft } from '../../lib/institutions/fee-dues';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from './institutions.module.css';
import { B, F, S, T, Tbl } from './Views';
import { attempt, num, today, type Notify } from './ui';

export function EnrolmentsPanel({ plan, notify, tick, refresh }: { plan: FeePlan; notify: Notify; tick: number; refresh: () => void }) {
  const [cls, setCls] = useState('');
  const [f, setF] = useState({ name: '', roll_no: '', class_label: '', g: '', phone: '', from: today() });
  const [c, setC] = useState<Concession>({ kind: 'pct', value: 0, reason: '' });
  const list = useMemo(() => studentsOf(plan.id, localDb.clients.getAll(), cls), [plan.id, cls, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: Partial<typeof f>) => setF({ ...f, ...x });
  const run = (fn: () => void, ok?: string) => attempt(notify, () => { fn(); refresh(); }, ok);
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <T l={iT('name')} v={f.name} on={(name) => set({ name })} d="enrol-name" />
        <T l={iT('rollNo')} v={f.roll_no} on={(roll_no) => set({ roll_no })} />
        <T l={iT('classLabel')} v={f.class_label} on={(class_label) => set({ class_label })} />
        <T l={iT('guardian')} v={f.g} on={(g) => set({ g })} />
        <T l={iT('phone')} v={f.phone} on={(phone) => set({ phone })} />
        <T l={iT('from')} t="date" v={f.from} on={(from) => set({ from })} />
        <S l={iT('concession')} v={c.kind} o={[['pct', '%'], ['amount', '₹']]} on={(v) => setC({ ...c, kind: v as 'pct' })} />
        <T l={iT('value')} v={c.value || ''} on={(v) => setC({ ...c, value: num(v) })} />
        <S l={iT('head')} v={c.head} o={[['', iT('all')], ...plan.heads.map((h) => [h.name, h.name] as const)]} on={(v) => setC({ ...c, head: v || undefined })} />
        <T l={iT('reason')} v={c.reason} on={(reason) => setC({ ...c, reason })} />
        <B p l={iT('enrol')} d="enrol-add" on={() => run(() => { enrol({ ...f, guardian: { name: f.g, phone: f.phone } }, { plan_id: plan.id, from: f.from, concessions: c.value ? [c] : [] }); set({ name: '', roll_no: '' }); }, iT('saved'))} />
        <F l={iT('importCsv')} on={async (file) => { const t = parseTable(await file.text()); run(() => notify(iT('nDone', { n: bulkEnrol(enrolRowsFromCsv(t.headers, t.rows), { plan_id: plan.id, from: f.from }) }))); }} />
      </div>
      <p className={styles.note}>{iT('csvCols')}</p>
      <T l={iT('classLabel')} v={cls} on={setCls} />
      <Tbl d="enrol-list" h={[iT('name'), iT('rollNo'), iT('classLabel'), iT('guardian'), iT('concession'), iT('sessions'), '']} rows={list.map((s) => {
        const left = sessionsLeft(s, plan);
        return [s.name, s.roll_no, s.class_label, [s.guardian?.name, s.guardian?.phone].filter(Boolean).join(' · '),
          (enrolmentOf(s, plan.id)?.concessions ?? []).map((x) => `${x.reason} ${x.kind === 'pct' ? `${x.value}%` : `₹${x.value}`}`).join('; '),
          left ? `${left.left} / ${left.total}` : '-',
          <>{left && <B sm l={iT('visit')} on={() => run(() => recordVisit(s.id!, plan.id, today(), left.total), iT('saved'))} />}<B g sm l={iT('remove')} on={() => run(() => unenrol(s.id!, plan.id))} /></>];
      })} />
    </div>
  );
}
