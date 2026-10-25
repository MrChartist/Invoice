import { useMemo, type ReactNode } from 'react';
import { formatDate } from '../../lib/utils';
import type { VoucherCostSnapshot } from '../../types/manufacturing';
import { mfgT } from '../../i18n/areas/manufacturing';
import { money } from './context';
import surface from '../../styles/surface.module.css';
import styles from './manufacturing.module.css';

/** Newest-first voucher register shared by the journal tabs. */
export function VoucherList<T extends { id: string; number: string; date: string }>({ rows, describe, value, actions }: {
  rows: T[];
  describe: (r: T) => ReactNode;
  value?: (r: T) => number | undefined;
  actions?: (r: T) => ReactNode;
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true })), [rows]);
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead>
          <tr>
            <th>{mfgT('number')}</th><th>{mfgT('date')}</th><th>{mfgT('items')}</th>
            {value && <th className={styles.num}>{mfgT('value')}</th>}
            <th><span className={surface.srOnly}>{mfgT('actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const v = value?.(r);
            return (
              <tr key={r.id}>
                <td className={surface.mono}>{r.number}</td>
                <td>{formatDate(r.date)}</td>
                <td>{describe(r)}</td>
                {value && <td className={styles.num}>{v === undefined ? '—' : money(v)}</td>}
                <td className={surface.rowActions}>{actions?.(r)}</td>
              </tr>
            );
          })}
          {sorted.length === 0 && <tr><td colSpan={value ? 5 : 4} className={styles.muted}>{mfgT('noVouchers')}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Component cost + additional − by-products/scrap = finished value, and the unit cost. */
export function CostSummary({ s, finishedLabel }: { s: VoucherCostSnapshot; finishedLabel?: string }) {
  const cells: [string, string][] = [
    [mfgT('componentCost'), money(s.components)],
    [mfgT('additional'), money(s.additional)],
    [mfgT('deductions'), money(s.deductions)],
    [finishedLabel ?? mfgT('finishedValue'), money(s.finished)],
    [mfgT('unitCost'), money(s.unit)],
  ];
  return (
    <section aria-label={mfgT('costSummary')} className={styles.summary}>
      {cells.map(([k, v]) => <div key={k} className={styles.cell}><span>{k}</span><strong>{v}</strong></div>)}
    </section>
  );
}
