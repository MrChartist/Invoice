import { useMemo } from 'react';
import { Download, Trophy } from 'lucide-react';
import { adjustmentsDb, loyaltyLiability, readProgram } from '../../lib/loyalty';
import { peekTable } from '../../lib/storage';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { cn, formatCurrency, todayInput } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './retail-r4.module.css';

/**
 * Loyalty liability (R4-B2): outstanding points × today's point value, and points lapsing this month — a working figure
 * for the CA's provision (Ind AS 115 / AS 9 treatment: verify with your CA). Lazy, inside the loyalty tile.
 */
export default function LoyaltyLiability() {
  useT();
  const today = todayInput();
  const l = useMemo(() => loyaltyLiability(peekTable<InvoiceRecord>('invoices'), adjustmentsDb.all(), readProgram(), today), [today]);
  const csv = () => downloadText(`loyalty-liability-${today}.csv`, toCsv([
    ['Loyalty liability — working paper (verify with your CA)', today],
    ['Customer', 'Tier', 'Points', 'Value', 'Expiring this month'],
    ...l.rows.map((r) => [r.name, r.tier ?? '', r.points, r.value, r.expiring]),
    [], ['Total', '', l.points, l.value, l.expiringPoints],
  ]), 'text/csv');
  return (
    <div className={css.box} data-loyalty-liability>
      <div className={css.boxHead}>
        <span><Trophy size={14} aria-hidden="true" /> {sT('lyLiability')}</span>
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={csv}><Download size={14} aria-hidden="true" /> {sT('csv')}</button>
      </div>
      <div className={css.stats}>
        <div className={css.stat}><span className={css.statLabel}>{sT('lyCustomers')}</span><span className={css.statValue}>{l.customers}</span></div>
        <div className={css.stat}><span className={css.statLabel}>{sT('lyPoints')}</span><span className={css.statValue}>{l.points}</span></div>
        <div className={css.stat}><span className={css.statLabel}>{sT('lyValue')}</span><span className={css.statValue}>{formatCurrency(l.value)}</span></div>
        <div className={css.stat}><span className={css.statLabel}>{sT('lyExpiring')}</span><span className={css.statValue}>{l.expiringPoints} · {formatCurrency(l.expiringValue)}</span></div>
      </div>
      {l.rows.length > 0 && (
        <div className={css.wrap}>
          <table className={surface.table}>
            <thead><tr><th>{sT('customer')}</th><th>{sT('lyTier')}</th><th className={css.num}>{sT('lyPoints')}</th><th className={css.num}>{sT('lyValue')}</th><th className={css.num}>{sT('lyExpiring')}</th></tr></thead>
            <tbody>{l.rows.slice(0, 20).map((r) => (
              <tr key={r.name}><td>{r.name}</td><td>{r.tier ?? '—'}</td><td className={css.num}>{r.points}</td><td className={css.num}>{formatCurrency(r.value)}</td><td className={css.num}>{r.expiring || ''}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className={css.note}>{sT('lyNote')}</p>
    </div>
  );
}
