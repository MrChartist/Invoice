/**
 * R15-C3 cancel a booking or a whole trip (lazy, from the bookings table): supplier charge, our fee, refund due from
 * the supplier; the refund to the client is worked out (billed − fee with its GST at the principal supply's rate,
 * TV15). Makes the credit notes, the fee draft and the supplier debit note in one step. Working papers — verify with
 * your CA.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { tvT } from '../../i18n/areas/travel-r15b';
import { cvT } from '../../i18n/areas/travel-r15c';
import type { TravelBooking } from '../../types/travel-r15';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { cancelBookings, cancelPlan } from '../../lib/travel/tv-cancel';
import { costInr, loadBookings } from '../../lib/travel/tv-bookings';
import { loadTrips } from '../../lib/travel/tv-trips';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './tv-ui';
import { runWith, type Notify } from './tv-run';

export default function CancelDialog({ targets, notify, onDone }: { targets: TravelBooking[]; notify: Notify; onDone: () => void }) {
  useT();
  const cost = targets.reduce((s, b) => s + costInr(b), 0);
  const [f, setF] = useState({ date: todayInput(), supplier_charge: '0', fee: '0', refund_in: String(cost) });
  const input = { date: f.date, supplier_charge: Number(f.supplier_charge) || 0, fee: Number(f.fee) || 0, refund_in: Number(f.refund_in) || 0 };
  const plan = useMemo(() => {
    try {
      const regime = loadTrips().find((t) => t.id === targets[0]?.trip_id)?.tv.regime ?? 'agent';
      return cancelPlan(targets, loadBookings(), localDb.invoices.getAll(), regime, input);
    } catch (e) { return (e as Error).message; }
  }, [targets, f]); // eslint-disable-line react-hooks/exhaustive-deps
  const num = (k: 'supplier_charge' | 'fee' | 'refund_in', label: string) => <Field label={label}><input className={controls.input} inputMode="decimal" value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value, ...(k === 'supplier_charge' ? { refund_in: String(Math.max(cost - (Number(e.target.value) || 0), 0)) } : {}) }))} data-tv-cancel={k} /></Field>;
  return (
    <div className={surface.card} style={{ marginTop: '0.75rem', padding: '0.75rem' }} role="group" aria-label={tvT('cancellation')} data-tv-cancel-dialog>
      <strong>{tvT('cancellation')}: {targets.map((b) => b.ref || b.component).join(', ')} · {tvT('cost')} {formatCurrency(cost)}</strong>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
        <Field label={tvT('from')}><input type="date" className={controls.input} value={f.date} onChange={(e) => setF((x) => ({ ...x, date: e.target.value }))} /></Field>
        {num('supplier_charge', cvT('sc'))}{num('fee', cvT('ourFee'))}{num('refund_in', cvT('rin'))}
      </div>
      {typeof plan === 'string' ? <p className={controls.hint} role="alert">{plan}</p> : (
        <p className={controls.hint} data-tv-cancel-plan>{cvT('billed')} {formatCurrency(plan.billed)} · {cvT('ourFee')} {plan.rate} % GST · {cvT('rout')} {formatCurrency(plan.refundOut)}</p>
      )}
      <button type="button" className={controls.btnPrimary} disabled={typeof plan === 'string'} data-tv-cancel-go onClick={() => {
        const r = runWith(notify)(() => cancelBookings(targets.map((b) => b.id), input));
        if (r) { notify(cvT('done', { n: r.notes.length })); onDone(); }
      }}>{tvT('cancellation')}</button>
    </div>
  );
}
