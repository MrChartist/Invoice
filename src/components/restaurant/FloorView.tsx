import { Plus } from 'lucide-react';
import type { DiningTable, OrderChannel, TableOrder } from '../../types/restaurant';
import { floor, isLive, orderState, orderSubtotal, type TableState } from '../../lib/restaurant/tables';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { rT } from '../../i18n/areas/restaurant';
import controls from '../../styles/controls.module.css';
import styles from './restaurant.module.css';

const STATE_CLASS: Record<TableState, string> = { free: '', occupied: styles.occupied, printed: styles.printed, settling: styles.settling };
const CHIP_CLASS: Record<TableState, string> = { free: '', occupied: styles.stateOccupied, printed: styles.statePrinted, settling: styles.stateSettling };
const STATE_LABEL: Record<TableState, 'free' | 'occupied' | 'printed' | 'settling'> = { free: 'free', occupied: 'occupied', printed: 'printed', settling: 'settling' };

export interface FloorViewProps {
  /** An area id for dine-in, or a counter channel. */
  view: { kind: 'area'; areaId: string } | { kind: 'channel'; channel: Exclude<OrderChannel, 'dine_in'> };
  tables: readonly DiningTable[];
  orders: readonly TableOrder[];
  selectedId?: string;
  now: Date;
  onTable: (table: DiningTable, order?: TableOrder) => void;
  onOrder: (order: TableOrder) => void;
  onNew: (channel: Exclude<OrderChannel, 'dine_in'>) => void;
}

/** Floor grid of one area (status per table), or the token list of a counter channel. */
export function FloorView({ view, tables, orders, selectedId, now, onTable, onOrder, onNew }: FloorViewProps) {
  useT();
  if (view.kind === 'area') {
    const rows = floor(tables, orders, view.areaId, now);
    if (!rows.length) return <p className={styles.muted}>{rT('noTables')}</p>;
    return (
      <div className={styles.grid} role="list" aria-label={rT('tables')}>
        {rows.map((r) => (
          <button
            key={r.table.id}
            type="button"
            role="listitem"
            className={cn(styles.table, STATE_CLASS[r.state], r.order && r.order.id === selectedId && styles.selected)}
            onClick={() => onTable(r.table, r.order)}
            data-table={r.table.name}
            data-state={r.state}
            aria-label={`${rT('tableN', { name: r.table.name })}: ${rT(STATE_LABEL[r.state])}`}
          >
            <span className={styles.tableName}>{r.table.name}</span>
            <span className={cn(styles.state, CHIP_CLASS[r.state])}>{rT(STATE_LABEL[r.state])}</span>
            {r.order ? (
              <>
                <span className={styles.tableMeta}>{rT('coversN', { n: r.covers })} · {rT('minutes', { n: r.minutes })}</span>
                <span className={styles.tableAmt}>{formatCurrency(r.amount)}</span>
              </>
            ) : (
              <span className={styles.tableMeta}>{r.table.seats}</span>
            )}
          </button>
        ))}
      </div>
    );
  }
  const list = orders.filter((o) => isLive(o) && o.channel === view.channel).sort((a, b) => a.opened_at.localeCompare(b.opened_at));
  return (
    <div className={styles.panel}>
      <div>
        <button type="button" className={controls.btnPrimary} onClick={() => onNew(view.channel)} data-new-order={view.channel}>
          <Plus size={16} /> {rT('newOrder')}
        </button>
      </div>
      {!list.length ? (
        <p className={styles.muted}>{rT('noOrders')}</p>
      ) : (
        <div className={styles.grid} role="list">
          {list.map((o) => {
            const st = orderState(o);
            return (
              <button key={o.id} type="button" role="listitem" className={cn(styles.table, STATE_CLASS[st], o.id === selectedId && styles.selected)} onClick={() => onOrder(o)} data-token={o.token}>
                <span className={styles.tableName}>{rT('tokenN', { n: o.token ?? '' })}</span>
                <span className={cn(styles.state, CHIP_CLASS[st])}>{rT(STATE_LABEL[st])}</span>
                <span className={styles.tableMeta}>{[o.eco_name, o.ref, o.client?.name].filter(Boolean).join(' · ')}</span>
                <span className={styles.tableAmt}>{formatCurrency(orderSubtotal(o))}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
