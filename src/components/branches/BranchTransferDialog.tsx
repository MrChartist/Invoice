/**
 * Sec 25(4) inter-branch transfer (WP-9): raise the tax invoice from the sending branch and the
 * matching purchase bill at the receiving branch for a stock transfer between two GSTINs.
 * Lazy (opened from the stock-transfer list only).
 */
import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useT } from '../../i18n';
import { branchT } from '../../i18n/areas/branch-books';
import { defaultTransferRates, raiseTransferPair } from '../../lib/branch-transfer';
import { loadPositions, type StockItem } from '../../lib/inventory';
import type { Branch } from '../../lib/branch';
import type { StockTransfer } from '../../types/stock';
import { num } from '../../lib/invoice-calc';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';

export default function BranchTransferDialog({ transfer, from, to, items, onClose, onSaved }: {
  transfer: StockTransfer;
  from: Branch;
  to: Branch;
  items: StockItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  useT();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [rates, setRates] = useState<Record<string, string>>(() => {
    let avg = new Map<string, number>();
    try {
      avg = new Map(loadPositions().map((p) => [p.item.id, p.avgCost]));
    } catch {
      /* no stock engine data: fall back to item rates */
    }
    const r = defaultTransferRates(transfer, items, avg);
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ? String(v) : '']));
  });
  const [error, setError] = useState('');

  const raise = () => {
    setError('');
    try {
      const { invoice } = raiseTransferPair(transfer, Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, num(v)])));
      onSaved(branchT('taxPairDone', { number: invoice.invoice_number }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={branchT('taxPairTitle', { number: transfer.transfer_number })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{branchT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={raise} data-testid="bt-raise">{branchT('taxPairRaise')}</button>
        </>
      }
    >
      <p>{branchT('taxPairIntro', { from: from.name, fromGstin: from.gstin ?? '', to: to.name, toGstin: to.gstin ?? '' })}</p>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th scope="col">{branchT('taxPairItem')}</th>
              <th scope="col" className={surface.numeric}>{branchT('taxPairQty')}</th>
              <th scope="col" className={surface.numeric}>{branchT('taxPairRate')}</th>
            </tr>
          </thead>
          <tbody>
            {transfer.lines.map((l) => (
              <tr key={l.id}>
                <td>{byId.get(l.item_id)?.name ?? '—'}</td>
                <td className={surface.numeric}>{l.qty}</td>
                <td className={surface.numeric}>
                  <input
                    className={controls.input}
                    inputMode="decimal"
                    aria-label={`${branchT('taxPairRate')} — ${byId.get(l.item_id)?.name ?? ''}`}
                    value={rates[l.id] ?? ''}
                    onChange={(e) => setRates((r) => ({ ...r, [l.id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={controls.hint}>{branchT('taxPairCa')}</p>
      {error && <div className={controls.error} role="alert">{error}</div>}
    </Modal>
  );
}
