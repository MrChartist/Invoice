import { Download, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { formatDate, formatMoney, cn } from '../../lib/utils';
import { ledgerCsv, type StockPosition } from '../../lib/inventory';
import { StockChip } from './StockChip';
import { useT } from '../../i18n';
import { invT } from '../../i18n/areas/inventory';
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
  useT(); // re-render on a language switch (5.4)
  if (!open || !position) return null;
  const { item } = position;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      flush
      title={<>{item.name} <StockChip status={position.status} /></>}
      subtitle={invT('ledgerSub')}
      footer={
        <>
          <button
            type="button" className={controls.btnOutline}
            onClick={() => onDownload(`stock-ledger-${item.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, ledgerCsv(position))}
          >
            <Download size={15} /> {invT('exportCsv')}
          </button>
          <button type="button" className={controls.btnPrimary} onClick={onClose}>{invT('close')}</button>
        </>
      }
    >
      <div style={{ padding: '1rem 1.25rem 0' }}>
        <div className={styles.summaryStrip}>
          <Cell label={invT('closingQty')} value={`${position.qty} ${item.unit}`} negative={position.qty < 0} />
          <Cell label={invT('thAvgCost')} value={formatMoney(position.avgCost)} />
          <Cell label={invT('statValue')} value={formatMoney(position.value)} negative={position.value < 0} />
          <Cell label={invT('thSold')} value={`${position.soldQty} ${item.unit}`} />
          <Cell label={invT('cogs')} value={formatMoney(position.cogs)} />
        </div>
      </div>
      <div className={cn(surface.tableWrap, styles.ledgerWrap)} style={{ marginTop: '1rem' }}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th>{invT('thDate')}</th><th>{invT('thParticulars')}</th>
              <th className={surface.numeric}>{invT('thIn')}</th><th className={surface.numeric}>{invT('thOut')}</th>
              <th className={surface.numeric}>{invT('thRate')}</th><th className={surface.numeric}>{invT('thBalance')}</th>
              <th className={surface.numeric}>{invT('thValue')}</th><th><span className={surface.srOnly}>{invT('thActions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {position.ledger.length === 0 && (
              <tr><td colSpan={8} className={styles.muted}>{invT('noMovements')}</td></tr>
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
                      type="button" className={controls.btnDanger} aria-label={invT('deleteAdjOn', { date: r.date })}
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
