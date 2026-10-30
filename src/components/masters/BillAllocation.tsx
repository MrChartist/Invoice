/**
 * Bill-wise details on a manual receipt (P0-11): Agst Ref against the party's open invoices and
 * opening bills; the remainder is On Account. Default export (lazy-loaded by the voucher editor).
 */
import { useMemo, useState } from 'react';
import { openRefsFor, type ReceiptAllocation } from '../../lib/bill-allocation';
import { formatDate, formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { mastersT } from '../../i18n/areas/masters';
import { c6T } from '../../i18n/areas/closures-r6';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './masters.module.css';

export interface BillAllocationProps {
  party: string;
  /** Credit to the party on this voucher, rupees. */
  total: number;
  voucherId?: string;
  value: ReceiptAllocation[];
  onChange: (next: ReceiptAllocation[]) => void;
}

export default function BillAllocation({ party, total, voucherId, value, onChange }: BillAllocationProps) {
  useT();
  const refs = useMemo(() => openRefsFor(party, voucherId), [party, voucherId]);
  const amountOf = (id: string) => value.find((a) => a.bill_id === id)?.amount ?? 0;
  // Raw text per ref while typing ("10." must not become "10").
  const [texts, setTexts] = useState<Record<string, string>>({});
  const textOf = (id: string) => texts[id] ?? (amountOf(id) ? amountOf(id).toFixed(2) : '');
  const set = (id: string, ref: string, text: string) => {
    setTexts((t) => ({ ...t, [id]: text }));
    const n = Math.max(0, Math.round((parseFloat(text.replace(/,/g, '')) || 0) * 100) / 100);
    const rest = value.filter((a) => a.bill_id !== id);
    onChange(n > 0 ? [...rest, { bill_id: id, ref, amount: n }] : rest);
  };
  const fifo = () => {
    let left = total;
    const next: ReceiptAllocation[] = [];
    for (const r of refs) {
      if (left <= 0.004) break;
      const amt = Math.round(Math.min(left, r.outstanding) * 100) / 100;
      next.push({ bill_id: r.id, ref: r.ref, amount: amt });
      left -= amt;
    }
    setTexts({});
    onChange(next);
  };
  const allocated = value.reduce((s, a) => s + a.amount, 0);
  const onAccount = Math.round((total - allocated) * 100) / 100;

  return (
    <section className={surface.panel} aria-label={mastersT('billwiseFor', { name: party })}>
      <div className={styles.head}>
        <strong>{mastersT('billwiseFor', { name: party })}</strong>
        {refs.length > 0 && (
          <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={fifo}>
            {mastersT('allocateFifo')}
          </button>
        )}
      </div>
      {refs.length === 0 ? (
        <p className={styles.note}>{mastersT('noOpenBills')}</p>
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th scope="col">{mastersT('typeOfRef')}</th>
                <th scope="col">{mastersT('refName')}</th>
                <th scope="col">{mastersT('dueDate')}</th>
                <th scope="col" className={surface.numeric}>{mastersT('pending')}</th>
                <th scope="col" className={surface.numeric}>{mastersT('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {refs.map((r) => (
                <tr key={r.id}>
                  <td>{mastersT('agstRef')}</td>
                  <td>{r.ref}{r.opening ? ` · ${mastersT('openingTag')}` : ''}</td>
                  <td>{formatDate(r.due)}</td>
                  <td className={surface.numeric}>
                    {formatMoney(r.outstanding)}
                    {r.tds ? <div className={styles.note} data-testid="alloc-tds">{c6T('allocTds', { amount: formatMoney(r.tds) })}</div> : null}
                  </td>
                  <td>
                    <input
                      className={`${controls.input} ${styles.cellInput}`}
                      inputMode="decimal"
                      aria-label={mastersT('allocateTo', { ref: r.ref })}
                      value={textOf(r.id)}
                      onChange={(e) => set(r.id, r.ref, e.target.value)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {value.length > 0 && (
        <p className={styles.note}>
          {mastersT('onAccount')}: {formatMoney(Math.max(onAccount, 0))}
          {onAccount < -0.004 ? `: ${mastersT('overAllocated')}` : ''}
        </p>
      )}
    </section>
  );
}
