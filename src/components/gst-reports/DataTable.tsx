import type { ReactNode } from 'react';
import { round2 } from '../../lib/invoice-calc';
import { formatMoney } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import styles from './gst-reports.module.css';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Right-aligned monetary/numeric column. */
  numeric?: boolean;
  /** Accessor that enables a total in the footer row. */
  total?: (row: T) => number;
  /** Footer number format; default is money. */
  totalFormat?: (n: number) => string;
}

export function Money({ value }: { value: number }) {
  return <span className={value < 0 ? styles.neg : undefined}>{formatMoney(value)}</span>;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  caption: string;
  emptyText: string;
}

/** Plain accessible table with an optional totals row. */
export function DataTable<T>({ columns, rows, rowKey, caption, emptyText }: DataTableProps<T>) {
  if (rows.length === 0) {
    return <p className={surface.sectionNote}>{emptyText}</p>;
  }
  const hasTotals = columns.some((c) => c.total);
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <caption className={surface.srOnly}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={c.numeric ? { textAlign: 'right' } : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? surface.numeric : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr className={styles.totalRow}>
              {columns.map((c, i) => {
                if (!c.total) return <td key={c.key}>{i === 0 ? 'Total' : ''}</td>;
                const sum = round2(rows.reduce((s, r) => s + c.total!(r), 0));
                return (
                  <td key={c.key} className={surface.numeric}>
                    {c.totalFormat ? c.totalFormat(sum) : <Money value={sum} />}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
