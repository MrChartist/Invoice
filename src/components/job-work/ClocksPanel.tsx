import { formatDate, formatMoney } from '../../lib/utils';
import { godownName } from '../../lib/godowns';
import { stockWithJobWorkers } from '../../lib/job-work';
import { jwT } from '../../i18n/areas/job-work';
import { ClockBadge } from './shared';
import { qtyText, type JwData } from './lines';
import surface from '../../styles/surface.module.css';
import styles from './job-work.module.css';

/** Sec 143 return clocks per challan line, and our stock still with each job worker. */
export function ClocksPanel({ data }: { data: JwData }) {
  const { ctx } = data;
  const item = (id: string) => ctx.items.find((i) => i.id === id);
  const lines = [...data.balances.lines].sort((a, b) => Number(a.status === 'settled') - Number(b.status === 'settled') || (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  const withJw = stockWithJobWorkers(data.balances);
  return (
    <>
      <p className={styles.muted} style={{ margin: '0 0 0.75rem' }}>{jwT('clocksIntro')}</p>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th>{jwT('challanNo')}</th><th>{jwT('jobWorker')}</th><th>{jwT('item')}</th>
              <th className={styles.num}>{jwT('sent')}</th><th className={styles.num}>{jwT('back')}</th><th className={styles.num}>{jwT('pending')}</th>
              <th>{jwT('deadline')}</th><th className={styles.num}>{jwT('daysLeft')}</th><th>{jwT('status')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineId}>
                <td className={styles.mono}>{l.number}<div className={styles.muted}>{formatDate(l.date)}</div></td>
                <td>{l.party}</td>
                <td>{item(l.item_id)?.name ?? '?'}</td>
                <td className={styles.num}>{qtyText(l.sent)} {item(l.item_id)?.unit ?? ''}</td>
                <td className={styles.num}>{qtyText(l.consumed + l.returned + l.supplied + l.lost)}</td>
                <td className={styles.num}><strong>{qtyText(l.pending)}</strong></td>
                <td>{l.deadline ? formatDate(l.deadline) : '-'}</td>
                <td className={styles.num}>{l.status === 'settled' || l.daysLeft === null ? '-' : l.daysLeft}</td>
                <td><ClockBadge status={l.status} />{l.late ? <div className={styles.muted}>{jwT('late')}</div> : null}</td>
              </tr>
            ))}
            {lines.length === 0 && <tr><td colSpan={9} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      <h3 className={styles.heading}>{jwT('withJobWorkers')}</h3>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{jwT('jwGodown')}</th><th>{jwT('item')}</th><th className={styles.num}>{jwT('pending')}</th><th className={styles.num}>{jwT('pendingValue')}</th></tr></thead>
          <tbody>
            {withJw.map((r) => (
              <tr key={`${r.godown}|${r.item_id}`}>
                <td>{godownName(ctx.godowns, r.godown)}</td>
                <td>{item(r.item_id)?.name ?? '?'}</td>
                <td className={styles.num}>{qtyText(r.pending)} {item(r.item_id)?.unit ?? ''}</td>
                <td className={styles.num}>{formatMoney(r.value)}</td>
              </tr>
            ))}
            {withJw.length === 0 && <tr><td colSpan={4} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
