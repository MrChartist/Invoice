/** R5-C1 dues / defaulters: per class, instalment, amount, days overdue, fine due (added only on click), wa.me reminder, CSV. */
import { useMemo, useState } from 'react';
import type { FeePlan } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { whatsappLink } from '../../lib/share';
import { ageBucket, duesCsv, feeDues, type DueRow } from '../../lib/institutions/fee-dues';
import { addFine } from '../../lib/institutions/fee-billing';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import controls from '../../styles/controls.module.css';
import styles from './institutions.module.css';
import { B, T, Tbl } from './Views';
import { attempt, csv, feeCtx, rs, today, type Notify } from './ui';
import { attendanceLine } from '../../lib/services/sv-attendance'; // R10 (SV-C2): "Attendance this month: 18 / 22"

export function DuesPanel({ plans, notify, tick, refresh }: { plans: readonly FeePlan[]; notify: Notify; tick: number; refresh: () => void }) {
  const [cls, setCls] = useState('');
  const rows = useMemo(() => feeDues(localDb.invoices.getAll(), localDb.clients.getAll(), plans, today()), [plans, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.filter((r) => !cls || (r.student.class_label ?? '').toLowerCase() === cls.toLowerCase());
  const text = (r: DueRow) => iT('reminder', { who: r.student.name, what: `${r.plan.name}: ${r.label}`, amount: rs(r.due), date: r.due_date }) + attendanceLine(r.student.id, today());
  const head = [iT('name'), iT('rollNo'), iT('classLabel'), iT('plan'), iT('instalment'), iT('dueDate'), iT('due'), iT('days'), iT('fine'), iT('guardian'), iT('phone')];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <T l={iT('classLabel')} v={cls} on={setCls} />
        <B l={iT('csv')} on={() => csv('fee-dues.csv', duesCsv(shown, head))} />
        <B l={iT('copy')} on={() => void navigator.clipboard?.writeText(shown.map(text).join('\n\n'))} />
      </div>
      <div className={styles.figures}>{[0, 1, 2, 3].map((b) => <div key={b} className={styles.figure}>{['0–30', '31–60', '61–90', '90+'][b]} {iT('days')}<strong>{rs(shown.filter((r) => ageBucket(r.days) === b).reduce((s, r) => s + r.due, 0))}</strong></div>)}</div>
      <Tbl d="fee-dues" h={[iT('name'), iT('classLabel'), iT('instalment'), iT('due'), iT('days'), iT('fine'), '']} rows={shown.map((r) => [
        `${r.student.name}${r.student.roll_no ? ` (${r.student.roll_no})` : ''}`, r.student.class_label, `${r.plan.name}: ${r.label}`, rs(r.due), r.days, r.fine ? rs(r.fine) : '-',
        <>
          <a className={`${controls.btnOutline} ${controls.btnSm}`} href={whatsappLink(r.student.guardian?.phone || r.student.phone, text(r))} target="_blank" rel="noreferrer">{iT('remind')}</a>
          {r.fine > 0 && r.against && <B sm l={iT('addFine')} on={() => attempt(notify, () => { addFine(r.plan, r.idx, r.student, r.against!, feeCtx(today()), localDb.invoices.getAll()); refresh(); }, iT('saved'))} />}
        </>,
      ])} />
    </div>
  );
}
