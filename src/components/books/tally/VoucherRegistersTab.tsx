import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { loadVouchers, makeRegular, postDatedSummary, variantRegister, voucherClasses, VOUCHER_TYPE_LABELS } from '../../../lib/ledger';
import { getTable } from '../../../lib/storage';
import { formatDate, formatMoney } from '../../../lib/utils';
import { useCan } from '../../../hooks/useCan';
import { useT } from '../../../i18n';
import { tallyT } from '../../../i18n/areas/tally';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './tally.module.css';

type Reg = 'optional' | 'memo' | 'postdated' | 'reversing';

/** Optional / memorandum registers, post-dated summary and reversing journals (Tally parity). */
export function VoucherRegistersTab({ today, notify, onChanged }: { today: string; notify: (m: string, tone?: 'success' | 'error') => void; onChanged: () => void }) {
  useT();
  const canEdit = useCan().can('books.edit');
  const [reg, setReg] = useState<Reg>('optional');
  const [cls, setCls] = useState('');
  const [version, setVersion] = useState(0);
  const manual = useMemo(() => {
    void version;
    return loadVouchers();
  }, [version]);
  const rows = useMemo(() => variantRegister(manual, reg === 'postdated' ? 'postdated' : reg, today, cls), [manual, reg, today, cls]);
  const pdc = useMemo(() => (reg === 'postdated' ? postDatedSummary(manual, today, getTable<unknown>('cheques')) : []), [manual, reg, today]);
  const classes = voucherClasses(manual);
  const labels: Record<Reg, string> = { optional: tallyT('regOptional'), memo: tallyT('regMemo'), postdated: tallyT('regPostdated'), reversing: tallyT('regReversing') };

  const regularise = (id: string, number: string) => {
    try {
      makeRegular(id);
      setVersion((v) => v + 1);
      onChanged();
      notify(tallyT('madeRegular', { number }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <div className={books.stack}>
      <div className={`${books.toolbar} no-print`}>
        <div className={styles.subTabs} role="group" aria-label={tallyT('regTitle')}>
          {(Object.keys(labels) as Reg[]).map((k) => (
            <button key={k} type="button" className={reg === k ? books.chipActive : books.chip} aria-pressed={reg === k} onClick={() => setReg(k)}>{labels[k]}</button>
          ))}
        </div>
        {classes.length > 0 && reg !== 'postdated' && (
          <label className={books.toolbarGroup}>
            <span className={books.muted}>{tallyT('classLabel')}</span>
            <select className={controls.select} value={cls} onChange={(e) => setCls(e.target.value)}>
              <option value="">{tallyT('allClasses')}</option>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
      </div>
      <div className={surface.card}>
        <div className={surface.tableWrap}>
          {reg === 'postdated' ? (
            pdc.length === 0 ? <p className={`${books.muted} ${surface.cardBody}`}>{tallyT('emptyReg')}</p> : (
              <table className={surface.table}>
                <caption className={surface.srOnly}>{labels[reg]}</caption>
                <thead><tr><th scope="col">{tallyT('date')}</th><th scope="col">{tallyT('source')}</th><th scope="col">{tallyT('number')}</th><th scope="col">{tallyT('party')}</th><th scope="col" className={surface.numeric}>{tallyT('amount')}</th><th scope="col">{tallyT('status')}</th></tr></thead>
                <tbody>
                  {pdc.map((r) => (
                    <tr key={`${r.source}:${r.id}`}>
                      <td>{formatDate(r.date)}</td>
                      <td>{r.source === 'voucher' ? tallyT('voucher') : r.direction === 'out' ? tallyT('chequeOut') : tallyT('chequeIn')}</td>
                      <td className={surface.mono}>{r.number}</td>
                      <td>{r.party}</td>
                      <td className={surface.numeric}>{formatMoney(r.amount / 100)}</td>
                      <td>{r.status === 'pending' ? tallyT('pending') : tallyT('matured')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : rows.length === 0 ? (
            <p className={`${books.muted} ${surface.cardBody}`}>{tallyT('emptyReg')}</p>
          ) : (
            <table className={surface.table}>
              <caption className={surface.srOnly}>{labels[reg]}</caption>
              <thead><tr><th scope="col">{tallyT('date')}</th><th scope="col">{tallyT('number')}</th><th scope="col">{tallyT('type')}</th><th scope="col">{tallyT('narration')}</th><th scope="col">{tallyT('classLabel')}</th><th scope="col" className={surface.numeric}>{tallyT('amount')}</th><th scope="col">{tallyT('action')}</th></tr></thead>
              <tbody>
                {rows.map(({ voucher: v, amount }) => (
                  <tr key={v.id}>
                    <td>{formatDate(v.date)}</td>
                    <td className={surface.mono}>{v.number}</td>
                    <td>{VOUCHER_TYPE_LABELS[v.type]}</td>
                    <td>{v.narration}{reg === 'reversing' && v.reverse_on ? <div className={styles.alloc}>{tallyT('reversesOn', { date: formatDate(v.reverse_on) })}</div> : null}</td>
                    <td>{v.voucher_class ?? ''}</td>
                    <td className={surface.numeric}>{formatMoney(amount / 100)}</td>
                    <td>{reg === 'optional' && canEdit && <button type="button" className={controls.btnOutline} onClick={() => regularise(v.id, v.number)}>{tallyT('makeRegular')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <p className={books.muted}><Info size={13} aria-hidden="true" /> {tallyT('regNote')}</p>
    </div>
  );
}
