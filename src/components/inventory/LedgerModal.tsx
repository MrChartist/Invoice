import { Download, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { formatDate, formatMoney, cn } from '../../lib/utils';
import { ledgerCsv, type StockPosition } from '../../lib/inventory';
import { StockChip } from './StockChip';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './inventory.module.css';

export interface LedgerModalProps {
  open: boolean;
  position: StockPosition | null;
  onClose: () => void;
  /** Delete a manual adjustment (ledger rows with refType 'move'). */
  onDeleteMove: (moveId: string) => void;
  onDownload: (filename: string, csv: string) => void;
}

export function LedgerModal({ open, position, onClose, onDeleteMove, onDownload }: LedgerModalProps) {
  if (!open || !position) return null;
  const { item } = position;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      flush
      title={<>{item.name} <StockChip status={position.status} /></>}
      subtitle="Stock ledger — opening, purchases, sales, returns and adjustments"
      footer={
        <>
          <button
            type="button" className={controls.btnOutline}
            onClick={() => onDownload(`stock-ledger-${item.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, ledgerCsv(position))}
          >
            <Download size={15} /> Export CSV
          </button>
          <button type="button" className={controls.btnPrimary} onClick={onClose}>Close</button>
        </>
      }
    >
      <div style={{ padding: '1rem 1.25rem 0' }}>
        <div className={styles.summaryStrip}>
          <Cell label="Closing qty" value={`${position.qty} ${item.unit}`} negative={position.qty < 0} />
          <Cell label="Avg cost" value={formatMoney(position.avgCost)} />
          <Cell label="Stock value" value={formatMoney(position.value)} negative={position.value < 0} />
          <Cell label="Sold" value={`${position.soldQty} ${item.unit}`} />
          <Cell label="COGS" value={formatMoney(position.cogs)} />
        </div>
      </div>
      <div className={cn(surface.tableWrap, styles.ledgerWrap)} style={{ marginTop: '1rem' }}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th>Date</th><th>Particulars</th>
              <th className={surface.numeric}>In</th><th className={surface.numeric}>Out</th>
              <th className={surface.numeric}>Rate</th><th className={surface.numeric}>Balance</th>
              <th className={surface.numeric}>Value</th><th><span className={surface.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {position.ledger.length === 0 && (
              <tr><td colSpan={8} className={styles.muted}>No movements yet.</td></tr>
            )}
            {position.ledger.map((r) => (
              <tr key={r.key}>
                <td>{r.date ? formatDate(r.date) : '—'}</td>
                <td className={styles.particulars}>{r.particulars}</td>
                <td className={cn(surface.numeric, styles.in)}>{r.qtyIn || ''}</td>
                <td className={cn(surface.numeric, styles.out)}>{r.qtyOut || ''}</td>
                <td className={surface.numeric}>{formatMoney(r.rate)}</td>
                <td className={cn(surface.numeric, r.balance < 0 && styles.negative)}>{r.balance}</td>
                <td className={cn(surface.numeric, r.value < 0 && styles.negative)}>{formatMoney(r.value)}</td>
                <td>
                  {r.refType === 'move' && r.refId && r.kind !== 'opening' && (
                    <button
                      type="button" className={controls.btnDanger} aria-label={`Delete adjustment on ${r.date}`}
                      onClick={() => onDeleteMove(r.refId!)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function Cell({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className={styles.summaryCell}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={cn(styles.summaryValue, negative && styles.negative)}>{value}</span>
    </div>
  );
}
