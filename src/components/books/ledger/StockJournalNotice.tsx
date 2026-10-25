/**
 * Warning shown on the ledger P&L / balance sheet when report-time closing-stock valuation is on AND a
 * closing-stock journal (year-end wizard or a typed "closing stock" journal) is in the books. The
 * statements already show the valuation net of the journal (`netOfStockJournals`), so nothing is
 * counted twice; the notice says so and offers the one-click switch to journal-only.
 */
import { AlertTriangle } from 'lucide-react';
import type { StockValuer } from '../../../lib/ledger';
import { loadClosingStockConfig, saveClosingStockConfig } from '../../../lib/ledger/closing-stock';
import { reportsT } from '../../../i18n/areas/reports-engine';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';

export function StockJournalNotice({ stock, onChanged, notify }: { stock?: StockValuer; onChanged: () => void; notify?: (msg: string) => void }) {
  const netted = stock?.netted ?? [];
  if (!netted.length) return null;
  const numbers = [...new Set(netted.map((p) => p.number))].join(', ');
  return (
    <div className={books.notice} role="status">
      <AlertTriangle size={16} className={books.noticeIcon} aria-hidden="true" />
      <span>
        {reportsT('stockJournalNotice', { numbers })}{' '}
        <button
          type="button"
          className={`${controls.btnGhost} ${controls.btnSm}`}
          onClick={() => {
            try {
              saveClosingStockConfig({ ...loadClosingStockConfig(), mode: 'none' });
              notify?.(reportsT('stockSaved'));
              onChanged();
            } catch (err) {
              notify?.((err as Error).message);
            }
          }}
        >
          {reportsT('stockJournalOnly')}
        </button>
      </span>
    </div>
  );
}
