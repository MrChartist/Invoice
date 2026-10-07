import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { sortRows, type SortDir } from '../../lib/sales-reports';
import surface from '../../styles/surface.module.css';
import styles from './reports.module.css';

export interface Column<T> {
  id: string;
  label: string;
  /** Right-aligned monospace figures. */
  numeric?: boolean;
  /** Sort key; omit for a non-sortable column. */
  sort?: (row: T) => string | number | null | undefined;
  cell: (row: T) => ReactNode;
  /** Footer cell (totals row). */
  total?: ReactNode;
}

export interface SortableTableProps<T> {
  caption: string;
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowKey: (row: T) => string;
  initialSort?: { id: string; dir: SortDir };
  /** Shown instead of the table when there are no rows. */
  empty?: ReactNode;
}

/**
 * Accessible sortable table: every sortable header is a real <button>, the `th` carries `aria-sort`,
 * and the first click on a numeric column sorts high-to-low (what people want from a report).
 */
export function SortableTable<T>({ caption, rows, columns, rowKey, initialSort, empty }: SortableTableProps<T>) {
  const [sort, setSort] = useState<{ id: string; dir: SortDir } | null>(initialSort ?? null);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.id === sort?.id);
    return col?.sort && sort ? sortRows(rows, col.sort, sort.dir) : [...rows];
  }, [rows, columns, sort]);

  if (rows.length === 0) return <>{empty}</>;

  const hasTotals = columns.some((c) => c.total !== undefined);
  const click = (c: Column<T>) =>
    setSort((s) => (s?.id === c.id ? { id: c.id, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { id: c.id, dir: c.numeric ? 'desc' : 'asc' }));

  return (
    <div className={surface.tableWrap}>
      <table className={`${surface.table} ${styles.table}`}>
        <caption className={surface.srOnly}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.id === c.id;
              const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sort ? 'none' : undefined;
              return (
                <th key={c.id} scope="col" aria-sort={ariaSort} className={c.numeric ? styles.thNum : undefined}>
                  {c.sort ? (
                    <button type="button" className={`${styles.sortBtn} ${c.numeric ? styles.sortBtnNum : ''}`} onClick={() => click(c)}>
                      <span>{c.label}</span>
                      {active ? (sort!.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />) : <ChevronsUpDown size={12} aria-hidden="true" className={styles.sortIdle} />}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)}>
              {columns.map((c) => (
                <td key={c.id} className={c.numeric ? surface.numeric : undefined}>{c.cell(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
        {hasTotals && (
          <tfoot>
            <tr>
              {columns.map((c, i) => (
                <td key={c.id} className={c.numeric ? `${surface.numeric} ${styles.totalCell}` : styles.totalCell}>
                  {c.total ?? (i === 0 ? 'Total' : '')}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
