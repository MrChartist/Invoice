import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import type { BooksData } from '../../lib/books';
import { getTable } from '../../lib/storage';
import { localDayOf } from '../../lib/dates';
import { buildInsights, type Insight, type StockRow } from '../../lib/insights';
import { buildUnitCosts } from '../../lib/margin';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import surface from '../../styles/surface.module.css';
import ux from './ux.module.css';
import { svcT } from '../../i18n/areas/service-r3'; // R3-B7
import { loadQuietSettings } from '../../lib/quiet-customers';
import type { Client } from '../../types/invoice';

const fmt = (i: Pick<Insight, 'unit'>, v: number) => (i.unit === 'inr' ? formatCurrency(v, 'INR') : i.unit === 'pct' ? `${v}%` : i.unit === 'days' ? uxT('inDays', { n: v }) : String(v));

function detail(i: Insight): string {
  const ch = i.changePct;
  const pct = ch === null || ch === undefined ? '' : `${ch >= 0 ? '+' : ''}${ch}%`;
  switch (i.id) {
    case 'revenue':
      return uxT('inRevenueD', { projected: fmt(i, i.rows[0]?.value ?? 0), avg: fmt(i, i.baseline ?? 0), pct });
    case 'topCustomers':
      return i.rows.length ? i.rows.map((r) => `${r.label} ${r.extra}%`).join(' · ') : uxT('inNone');
    case 'expenseSpike':
      return i.rows.length ? i.rows.map((r) => uxT('inSpikeRow', { head: r.label, now: formatCurrency(r.value, 'INR'), avg: formatCurrency(r.extra ?? 0, 'INR') })).join(' · ') : uxT('inSpikeNone');
    case 'dso':
      return i.baseline !== undefined ? uxT('inDsoD', { then: String(i.baseline) }) : uxT('inNone');
    case 'slowPayers':
      return i.rows.length ? i.rows.map((r) => uxT('inSlowRow', { name: r.label, now: r.value, before: r.extra ?? 0 })).join(' · ') : uxT('inSlowNone');
    case 'margin':
      return i.baseline !== undefined ? uxT('inMarginD', { avg: `${i.baseline}%` }) : uxT('inNone');
    case 'stockRisk':
      return i.rows.length ? i.rows.map((r) => (r.extra !== undefined ? uxT('inStockRow', { item: r.label, days: r.extra }) : r.label)).join(' · ') : uxT('inStockNone');
    case 'gstTrend':
      return uxT('inGstD', { avg: fmt(i, i.baseline ?? 0), pct });
    case 'quietCustomers':
      return i.rows.length ? i.rows.map((r) => svcT('insightRow', { name: r.label, days: r.value, gap: r.extra ?? 0 })).join(' · ') : svcT('insightNone');
  }
}

/** 8.108 offline insights tile: deterministic cards from `insights.ts`, each drilling into its report. */
export function InsightsPanel({ books, stock }: { books: BooksData; stock: StockRow[] }) {
  useT();
  const cards = useMemo(() => {
    const purchases = getTable('purchases');
    let costs;
    try {
      costs = buildUnitCosts(purchases, getTable<{ name: string }>('stock_items'), books.vendors);
    } catch {
      costs = undefined;
    }
    const quiet = { clients: getTable<Client>('clients'), settings: loadQuietSettings() }; // R3-B7
    return buildInsights({ invoices: books.invoices, payments: books.transactions, purchases, vendors: books.vendors, costs, stock, quiet }, localDayOf(new Date()));
  }, [books, stock]);
  return (
    <div className={surface.card} data-tile="insights">
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}><TrendingUp size={16} /> {uxT('inTitle')}</span></div>
      <div className={surface.cardBody}>
        <div className={ux.cards}>
          {cards.map((c) => (
            <Link key={c.id} to={c.href} className={c.tone === 'warn' ? ux.cardWarn : c.tone === 'good' ? ux.cardGood : ux.card} data-insight={c.id}>
              <span className={ux.cardTitle}>{c.id === 'quietCustomers' ? svcT('insightTitle') : uxT(`in_${c.id}` as const)}</span>
              <span className={ux.cardValue}>{fmt(c, c.value)}</span>
              <span className={ux.muted}>{detail(c)}</span>
            </Link>
          ))}
        </div>
        <p className={ux.muted}>{uxT('inFoot')}</p>
      </div>
    </div>
  );
}

export default InsightsPanel;
