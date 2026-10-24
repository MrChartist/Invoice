import { Link } from 'react-router-dom';
import { Boxes, Users } from 'lucide-react';
import type { Period } from '../../lib/books';
import {
  costSourceLabel,
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

const slug = (p: Period) => `${p.start}_to_${p.end}`;
const pct = (m: number | null) => (m === null ? '—' : `${m.toFixed(1)}%`);
const signed = (n: number) => <span className={n < 0 ? styles.neg : styles.pos}>{money(n)}</span>;

function Basis({ excluded }: { excluded: number }) {
  return (
    <p className={styles.muted}>
      Sales are the taxable value (excl. GST). Cost: stock-tracked items at the inventory cost issued for that invoice;
      other goods at the average purchase cost of bills with the same name (and HSN); services and items never bought
      are not costed. A management estimate, not a statutory figure.
      {excluded > 0 && ` ${excluded} foreign-currency document${excluded === 1 ? '' : 's'} without an exchange rate left out.`}
    </p>
  );
}

export function ItemProfitTab({ rep, period }: { rep: ReturnType<typeof itemProfitability>; period: Period }) {
  const t = rep.totals;
  const cols: Column<ItemProfitRow>[] = [
    { id: 'name', label: 'Item', sort: (r) => r.name, cell: (r) => r.name, total: 'Total' },
    { id: 'hsn', label: 'HSN/SAC', sort: (r) => r.hsn, cell: (r) => <span className={surface.mono}>{r.hsn || '—'}</span> },
    { id: 'qty', label: 'Qty', numeric: true, sort: (r) => r.quantity, cell: (r) => `${r.quantity}${r.unit ? ` ${r.unit}` : ''}` },
    { id: 'rev', label: 'Sales (excl. GST)', numeric: true, sort: (r) => r.revenue, cell: (r) => money(r.revenue), total: money(t.revenue) },
    { id: 'cost', label: 'Cost', numeric: true, sort: (r) => r.cost, cell: (r) => money(r.cost), total: money(t.cost) },
    { id: 'profit', label: 'Profit', numeric: true, sort: (r) => r.profit, cell: (r) => signed(r.profit), total: money(t.profit) },
    { id: 'margin', label: 'Margin', numeric: true, sort: (r) => r.margin, cell: (r) => pct(r.margin), total: pct(t.margin) },
    { id: 'basis', label: 'Cost basis', sort: (r) => r.source, cell: (r) => <span className={r.source === 'none' ? styles.muted : undefined}>{costSourceLabel(r.source)}</span> },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Basis excluded={rep.excluded} />
        <ExportButton filename={`item-profitability-${slug(period)}.csv`} csv={() => itemProfitCsv(rep, period)} />
      </div>
      <div className={surface.card}>
        <SortableTable
          caption="Profitability by item"
          rows={rep.rows}
          columns={cols}
          rowKey={(r) => r.key}
          initialSort={{ id: 'profit', dir: 'desc' }}
          empty={
            <EmptyState
              icon={Boxes}
              title="No sales in this period"
              text="Items sold in the period, with their cost and margin, appear here."
              action={<Link to="/inventory" className={styles.link}>Track stock costs in Inventory</Link>}
            />
          }
        />
      </div>
    </div>
  );
}

export function PartyProfitTab({ rep, period }: { rep: ReturnType<typeof partyProfitability>; period: Period }) {
  const t = rep.totals;
  const cols: Column<PartyProfitRow>[] = [
    {
      id: 'name',
      label: 'Customer',
      sort: (r) => r.name,
      cell: (r) => <Link className={styles.link} to={`/receivables?tab=statements&party=${encodeURIComponent(r.partyKey)}`}>{r.name}</Link>,
      total: 'Total',
    },
    { id: 'docs', label: 'Docs', numeric: true, sort: (r) => r.docs, cell: (r) => r.docs },
    { id: 'rev', label: 'Sales (excl. GST)', numeric: true, sort: (r) => r.revenue, cell: (r) => money(r.revenue), total: money(t.revenue) },
    { id: 'cogs', label: 'Cost of goods', numeric: true, sort: (r) => r.cogs, cell: (r) => money(r.cogs), total: money(t.cogs) },
    { id: 'exp', label: 'Billable expenses', numeric: true, sort: (r) => r.expenses, cell: (r) => money(r.expenses), total: money(t.expenses) },
    { id: 'profit', label: 'Profit', numeric: true, sort: (r) => r.profit, cell: (r) => signed(r.profit), total: money(t.profit) },
    { id: 'margin', label: 'Margin', numeric: true, sort: (r) => r.margin, cell: (r) => pct(r.margin), total: pct(t.margin) },
    { id: 'unc', label: 'Not costed', numeric: true, sort: (r) => r.uncosted, cell: (r) => (r.uncosted ? money(r.uncosted) : '—'), total: money(t.uncosted) },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <Basis excluded={rep.excluded} />
        <ExportButton filename={`party-profitability-${slug(period)}.csv`} csv={() => partyProfitCsv(rep, period)} />
      </div>
      <p className={styles.muted}>Billable expenses are costs recorded against the client (Expenses → billable), whether or not re-billed yet.</p>
      <div className={surface.card}>
        <SortableTable
          caption="Profitability by customer"
          rows={rep.rows}
          columns={cols}
          rowKey={(r) => r.key}
          initialSort={{ id: 'profit', dir: 'desc' }}
          empty={<EmptyState icon={Users} title="No sales in this period" text="Each customer's sales, costs and margin appear here." />}
        />
      </div>
    </div>
  );
}
