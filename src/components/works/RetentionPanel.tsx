/**
 * R5-B5 "Retention & held": every live RA bill split into due now and held buckets (retention with its release day,
 * GST TDS awaiting credit, cess, SD, LD / other); record the client's GST TDS / cess deductions, recover the advance,
 * release retention or security deposit.
 */
import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { Payment } from '../../types/invoice';
import { num, round2 } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { raDueSplit } from '../../lib/works/ra-due';
import { CLEARING_KINDS, recordDeductionRow, recoverAdvance, releaseHeld, type ClearingKind } from '../../lib/works/ra-receivable';
import type { RaDeductionKind } from '../../types/transport-works-r5';
import { B, errText, fmtMoney, today, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';
import own from './works.module.css';

export function RetentionPanel({ notify, refresh, tick }: PanelProps) {
  const bills = useMemo(() => localDb.invoices.getAll().filter((i) => i.ra_deductions?.length && i.status !== 'Cancelled' && i.status !== 'Draft'), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const payments = useMemo(() => peekTable<Payment>('transactions'), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState({ day: today(), method: 'Bank transfer' });
  const run = (fn: () => unknown) => {
    try {
      fn();
      notify(twT('saved'));
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  if (!bills.length) return <p className={styles.note}>{twT('heldEmpty')}</p>;
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <F l={twT('date')}><input className={controls.input} type="date" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} /></F>
        <F l={twT('method')}><input className={controls.input} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })} /></F>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{twT('invoice')}</th><th>{twT('client')}</th><th className={surface.numeric}>{twT('dueNow')}</th><th>{twT('held')}</th></tr></thead>
          <tbody>
            {bills.map((b) => {
              const mine = payments.filter((p) => p.invoice_id === b.id);
              const outstanding = round2(num(b.ra_net_payable) + (b.ra_deductions ?? []).filter((d) => d.kind !== 'it_tds').reduce((s, d) => s + d.amount, 0) - mine.reduce((s, p) => s + num(p.amount), 0));
              const split = raDueSplit(b, mine, outstanding);
              return (
                <tr key={b.id} data-ra-split={b.invoice_number}>
                  <td className={surface.mono}>{b.invoice_number}{b.ra_no ? ` · RA ${b.ra_no}` : ''}</td>
                  <td>{b.client?.name}</td>
                  <td className={`${surface.numeric} ${own.due}`} data-ra-due>{fmtMoney(split.dueNow)}</td>
                  <td>
                    {split.held.length === 0 ? '-' : split.held.map((h) => (
                      <div key={h.kind} className={styles.toolbar}>
                        <span className={own.held} data-ra-held={h.kind}>{h.label}: {fmtMoney(h.amount)}{h.release_on ? ` · ${twT('releaseOn')} ${h.release_on}` : ''}</span>
                        {CLEARING_KINDS.includes(h.kind as RaDeductionKind) && <button type="button" className={B.gs} onClick={() => run(() => recordDeductionRow(b.id, h.kind as ClearingKind, { date: f.day }))}>{twT('recordDeducted')}</button>}
                        {h.kind === 'advance_recovery' && <button type="button" className={B.gs} onClick={() => run(() => recoverAdvance(b.id, { date: f.day }))}>{twT('recoverAdvance')}</button>}
                        {['retention', 'security_deposit', 'withheld', 'ld'].includes(h.kind) && <button type="button" className={B.os} onClick={() => run(() => releaseHeld(b.id, h.kind as 'retention' | 'security_deposit' | 'withheld' | 'ld', { date: f.day, amount: h.amount, method: f.method }))}><HandCoins size={14} aria-hidden="true" /> {twT('release')}</button>}
                      </div>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>{twT('heldHint')}</p>
    </div>
  );
}
