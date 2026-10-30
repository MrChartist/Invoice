/**
 * R16-C2 re-issue form on an `air` booking (Bookings table → Re-issue): the ticket, the new ticket no., the fare
 * difference (negative = a credit note on the old invoice), the airline's change penalty and our fee → a draft
 * (`reissueTicket`). In the desk chunk (a lazy entry's preload list costs more than the form). Working papers.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { r16cT } from '../../i18n/areas/travel-r16c';
import { cvT } from '../../i18n/areas/travel-r15c';
import type { TravelBooking } from '../../types/travel-r15';
import { reissueTicket } from '../../lib/travel/tv-reissue';
import controls from '../../styles/controls.module.css';
import { Field } from './tv-ui';
import { SelectField } from '../ui/SelectField';

export default function ReissueForm({ booking, date, onDone }: { booking: TravelBooking; date: string; onDone: (r: ReturnType<typeof reissueTicket>) => void }) {
  useT();
  const open = (booking.tkt ?? []).filter((t) => t.ticket_no && !t.reissued_by);
  const [f, setF] = useState({ old_no: open[0]?.ticket_no ?? '', new_no: '', diff: '', penalty: '', fee: '' });
  const [err, setErr] = useState('');
  const inp = (k: keyof typeof f, label: string) => <Field label={label}><input className={controls.input} inputMode={k === 'new_no' ? 'numeric' : 'decimal'} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-tv-re={k} /></Field>;
  const go = () => {
    try { onDone(reissueTicket(booking.id, { old_no: f.old_no, new_no: f.new_no, diff: Number(f.diff) || 0, penalty: Number(f.penalty) || 0, fee: Number(f.fee) || 0, date })); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.5rem' }} data-tv-reissue>
      <Field label={cvT('tno')}><SelectField className={controls.select} value={f.old_no} onChange={(e) => setF({ ...f, old_no: e.target.value })}>{open.map((t) => <option key={t.ticket_no} value={t.ticket_no}>{[t.ticket_no, t.pax, t.sector].filter(Boolean).join(' · ')}</option>)}</SelectField></Field>
      {inp('new_no', r16cT('newNo'))}{inp('diff', r16cT('diff'))}{inp('penalty', r16cT('penalty'))}{inp('fee', r16cT('fee'))}
      <button type="button" className={controls.btnPrimary} onClick={go} data-tv-re-go>{r16cT('reissue')}</button>
      {err && <p className={controls.hint} role="alert">{err}</p>}
    </div>
  );
}
