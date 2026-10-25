import { Link } from 'react-router-dom';
import { Boxes, Users } from 'lucide-react';
import type { Period } from '../../lib/books';
import {
  itemProfitCsv,
  partyProfitCsv,
  type ItemProfitRow,
  type PartyProfitRow,
  type itemProfitability,
  type partyProfitability,
} from '../../lib/profitability';
import { EmptyState } from '../ui/EmptyState';
import { ExportButton } from './bits';
import { money } from './fmt';
import { SortableTable, type Column } from './SortableTable';
import surface from '../../styles/surface.module.css';
import styles from './reports.module.css';
import { useT } from '../../i18n';
import { repT } from '../../i18n/areas/reports';
import { plural } from '../../i18n/areas/plural';

const slug = (p: Period) => `${p.start}_to_${p.end}`;
const pct = (m: number | null) => (m === null ? '—' : `${m.toFixed(1)}%`);
const SOURCE_KEY = { stock: 'srcStock', purchases: 'srcPurchases', none: 'srcNone', mixed: 'srcMixed' } as const;
const costSourceLabel = (s: ItemProfitRow['source']) => repT(SOURCE_KEY[s]);
const signed = (n: number) => <span className={n < 0 ? styles.neg : styles.pos}>{money(n)}</span>;

function Basis({ excluded }: { excluded: number }) {
  useT();
  return (
    <p className={styles.muted}>
      {repT('basis')}
      {excluded > 0 && ` ${plural(repT, 'basisForeignOne', 'basisForeignMany', excluded)}`}
    </p>
  );
}

export function ItemProfitTab({ rep, period }: { rep: ReturnType<typeof itemProfitability>; period: Period }) {
  useT();
  const t = rep.totals;
  const cols: Column<ItemProfitRow>[] = [
    { id: 'name', label: repT('colItemOnly'), sort: (r) => r.name, cell: (r) => r.name, total: repT('total') },
    { id: 'hsn', label: 'HSN/SAC', sort: (r) => r.hsn, cell: (r) => <span className={surface.mono}>{r.hsn || '—'}</span> },
    { id: 'qty', label: repT('colQty'), numeric: true, sort: (r) => r.quantity, cell: (r) => `${r.quantity}${r.unit ? ` ${r.unit}` : ''}` },
    { id: 'rev', label: repT('colSalesExcl'), numeric: true, sort: (r) => r.revenue, cell: (r) => money(r.revenue), total: money(t.revenue) },
    { id: 'cost', label: repT('colCost'), numeric: true, sort: (r) => r.cost, cell: (r) => money(r.cost), total: money(t.cost) },
    { id: 'profit', label: repT('colProfit'), numeric: true, sort: (r) => r.profit, cell: (r) => signed(r.profit), total: money(t.profit) },
    { id: 'margin', label: repT('colMargin'), numeric: true, sort: (r) => r.margin, cell: (r) => pct(r.margin), total: pct(t.margin) },
    { id: 'basis', label: repT('colCostBasis'), sort: (r) => r.source, cell: (r) => <span className={r.source === 'none' ? styles.muted : undefined}>{costSourceLabel(r.source)}</span> },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Basis excluded={rep.excluded} />
        <ExportButton filename={`item-profitability-${slug(period)}.csv`} csv={() => itemProfitCsv(rep, period)} />
      </div>
      <div className={surface.card}>
        <SortableTable
          caption={repT('capItemProfit')}
          rows={rep.rows}
          columns={cols}
          rowKey={(r) => r.key}
          initialSort={{ id: 'profit', dir: 'desc' }}
          empty={
            <EmptyState
              icon={Boxes}
              title={repT('noSalesTitle')}
              text={repT('itemProfitEmpty')}
              action={<Link to="/inventory" className={styles.link}>{repT('trackStock')}</Link>}
            />
          }
        />
      </div>
    </div>
  );
}

export function PartyProfitTab({ rep, period }: { rep: ReturnType<typeof partyProfitability>; period: Period }) {
  useT();
  const t = rep.totals;
  const cols: Column<PartyProfitRow>[] = [
    {
      id: 'name',
      label: repT('colCustomer'),
      sort: (r) => r.name,
      cell: (r) => <Link className={styles.link} to={`/receivables?tab=statements&party=${encodeURIComponent(r.partyKey)}`}>{r.name}</Link>,
      total: repT('total'),
    },
    { id: 'docs', label: repT('colDocs'), numeric: true, sort: (r) => r.docs, cell: (r) => r.docs },
    { id: 'rev', label: repT('colSalesExcl'), numeric: true, sort: (r) => r.revenue, cell: (r) => money(r.revenue), total: money(t.revenue) },
    { id: 'cogs', label: repT('colCogs'), numeric: true, sort: (r) => r.cogs, cell: (r) => money(r.cogs), total: money(t.cogs) },
    { id: 'exp', label: repT('colBillable'), numeric: true, sort: (r) => r.expenses, cell: (r) => money(r.expenses), total: money(t.expenses) },
    { id: 'profit', label: repT('colProfit'), numeric: true, sort: (r) => r.profit, cell: (r) => signed(r.profit), total: money(t.profit) },
    { id: 'margin', label: repT('colMargin'), numeric: true, sort: (r) => r.margin, cell: (r) => pct(r.margin), total: pct(t.margin) },
    { id: 'unc', label: repT('colNotCosted'), numeric: true, sort: (r) => r.uncosted, cell: (r) => (r.uncosted ? money(r.uncosted) : '—'), total: money(t.uncosted) },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Basis excluded={rep.excluded} />
        <ExportButton filename={`party-profitability-${slug(period)}.csv`} csv={() => partyProfitCsv(rep, period)} />
      </div>
      <p className={styles.muted}>{repT('billableNote')}</p>
      <div className={surface.card}>
        <SortableTable
          caption={repT('capPartyProfit')}
          rows={rep.rows}
          columns={cols}
          rowKey={(r) => r.key}
          initialSort={{ id: 'profit', dir: 'desc' }}
          empty={<EmptyState icon={Users} title={repT('noSalesTitle')} text={repT('partyProfitEmpty')} />}
        />
      </div>
    </div>
  );
}
