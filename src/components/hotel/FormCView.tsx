/**
 * Front desk → Form C (R7-C2): foreign guests by status (overdue / due / check-out to update / filed / done), the data
 * sheet in the portal's order with copy buttons and "Copy all", "Mark filed" with the reference, and the check-out tick.
 * The user files on boi.gov.in; nothing is uploaded. Deadline and penalty as reported — verify (HT13).
 */
import { useMemo, useState } from 'react';
import { Globe } from 'lucide-react';
import { hT } from '../../i18n/areas/hotel-frontdesk-r7';
import { cT } from '../../i18n/areas/hotel-compliance-r7';
import { hotelDb } from '../../lib/hotel/hotel-store';
import { formCRule } from '../../lib/hotel/hotel-rules';
import { FORM_C_STATUSES, dataSheet, formCRows, markCheckoutUpdated, markFiled, sheetText, type FormCStatus } from '../../lib/hotel/form-c';
import { copyText } from '../share/clipboard';
import { B } from '../transport/shared';
import { Fields, Row, Tbl, type Ctx, type Rec } from './FrontDesk';
import styles from './hotel.module.css';

const label = (k: string) => (Object.hasOwn(hT.en, k) ? hT(k as never) : k.replace(/_/g, ' '));

export default function FormCView({ ctx }: { ctx: Ctx }) {
  const [filter, setFilter] = useState<FormCStatus | ''>('');
  const [open, setOpen] = useState('');
  const [refs, setRefs] = useState<Rec>({});
  const d = useMemo(() => ({ rows: formCRows(hotelDb.reservations(), hotelDb.guests(), new Date()), rooms: hotelDb.rooms() }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rule = formCRule(ctx.day);
  const copy = (text: string) => void copyText(text).then((ok) => ok && ctx.notify(cT('copied')));
  return (
    <div className={styles.stack} data-hotel-formc>
      <p className={styles.note}><Globe size={14} aria-hidden="true" /> {cT('fcNote')} {cT('fcLaw', { h: rule.hours, law: rule.law, p: (rule.penalty ?? 50000).toLocaleString('en-IN') })}</p>
      <Row>
        {(['', ...FORM_C_STATUSES] as const).map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} className={filter === s ? styles.viewOn : styles.view} onClick={() => setFilter(s)}>
            {cT(s ? `st.${s}` : 'all')} ({d.rows.filter((r) => !s || r.status === s).length})
          </button>
        ))}
      </Row>
      {!d.rows.length && <p className={styles.note}>{hT('empty')}</p>}
      {d.rows.filter((r) => !filter || r.status === filter).map((r) => {
        const id = r.line.id;
        const room = d.rooms.find((x) => x.id === r.line.room_id)?.number ?? '';
        const late = r.status === 'overdue';
        return (
          <div key={id} className={styles.box} data-formc-row={r.res.number} data-formc-status={r.status}>
            <Row>
              <strong>{r.guests.map((g) => g.name).join(', ') || r.res.guest.name}</strong>
              {hT('room')} {room} · {r.res.number}
              <span className={late ? styles.bad : styles.note} data-formc-clock>
                {cT(`st.${r.status}`)} · {r.status === 'due' || late ? cT(late ? 'late' : 'left', { h: Math.abs(r.hours) }) : r.line.form_c?.ref} · {cT('due')} {new Date(r.due_at).toLocaleString()}
              </span>
            </Row>
            <Row>
              <button type="button" className={B.os} onClick={() => setOpen(open === id ? '' : id)} data-formc-sheet>{cT('sheet')}</button>
              {(r.status === 'due' || late) && <>
                <Fields v={refs} set={(x) => setRefs({ ...refs, ...x })} spec={[[id, cT('ref')]]} />
                <button type="button" className={B.ps} onClick={() => ctx.run(() => markFiled(r.res.id, id, String(refs[id] ?? '')))} data-formc-filed>{cT('markFiled')}</button>
              </>}
              {r.status === 'departed_not_updated' && <button type="button" className={B.ps} onClick={() => ctx.run(() => markCheckoutUpdated(r.res.id, id))}>{cT('coUpdated')}</button>}
            </Row>
            {open === id && r.guests.map((g) => {
              const sheet = dataSheet(g, r.res, r.line, room);
              return (
                <div key={g.id} className={styles.stack} data-formc-data>
                  <Tbl head={[hT('name'), '', '']} rows={sheet.map(([k, v]) => [label(k), v, v && <button type="button" className={B.gs} onClick={() => copy(v)}>{cT('copy')}</button>])} />
                  <Row><button type="button" className={B.os} onClick={() => copy(sheetText(sheet, label))} data-formc-copyall>{cT('copyAll')}</button></Row>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
