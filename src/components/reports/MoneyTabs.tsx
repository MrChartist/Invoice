import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Landmark, Receipt, ShoppingCart } from 'lucide-react';
import {
  expensesCsv,
  paymentModesCsv,
  profitCsv,
  taxRateCsv,
  type ExpenseCategoryRow,
  type ExpenseReport,
  type ExpenseVendorRow,
  type PaymentModeRow,
  type ProfitRow,
  type TaxRateRow,
  paymentModes,
  profitByItem,
  taxByRate,
} from '../../lib/sales-reports';
import type { Period } from '../../lib/books';
import { EmptyState } from '../ui/EmptyState';
import { ExportButton, Share } from './bits';
import { money } from './fmt';
import { NoSales } from './SalesTabs';
import { SortableTable, type Column } from './SortableTable';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './reports.module.css';

const slug = (p: Period) => `${p.start}_to_${p.end}`;

/* ── Tax collected by rate ─────────────────────────────────── */

export function TaxTab({ rep, period }: { rep: ReturnType<typeof taxByRate>; period: Period }) {
  const t = rep.totals;
  const cols: Column<TaxRateRow>[] = [
    { id: 'rate', label: 'Rate', sort: (r) => r.rate, cell: (r) => r.label, total: 'Total' },
    { id: 'taxable', label: 'Taxable value', numeric: true, sort: (r) => r.taxable, cell: (r) => money(r.taxable), total: money(t.taxable) },
    { id: 'cgst', label: 'CGST', numeric: true, sort: (r) => r.cgst, cell: (r) => money(r.cgst), total: money(t.cgst) },
    { id: 'sgst', label: 'SGST', numeric: true, sort: (r) => r.sgst, cell: (r) => money(r.sgst), total: money(t.sgst) },
    { id: 'igst', label: 'IGST', numeric: true, sort: (r) => r.igst, cell: (r) => money(r.igst), total: money(t.igst) },
    { id: 'cess', label: 'Cess', numeric: true, sort: (r) => r.cess, cell: (r) => money(r.cess), total: money(t.cess) },
    { id: 'tax', label: 'GST collected', numeric: true, sort: (r) => r.tax, cell: (r) => money(r.tax), total: money(t.tax) },
    { id: 'docs', label: 'Documents', numeric: true, sort: (r) => r.docs, cell: (r) => r.docs },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>
          By the GST slab actually charged on each line, net of credit notes. A working paper — your GSTR-1 / 3B figures live under GST reports; verify with your CA.
        </p>
        <ExportButton filename={`tax-by-rate-${slug(period)}.csv`} csv={() => taxRateCsv(rep, period)} />
      </div>
      <div className={surface.card}>
        <SortableTable caption="Tax collected by rate" rows={rep.rows} columns={cols} rowKey={(r) => String(r.rate)} initialSort={{ id: 'rate', dir: 'asc' }} empty={<NoSales />} />
      </div>
    </div>
  );
}

/* ── Payment-mode split ────────────────────────────────────── */

export function PaymentsTab({ rep, period }: { rep: ReturnType<typeof paymentModes>; period: Period }) {
  const cols: Column<PaymentModeRow>[] = [
    { id: 'method', label: 'Mode', sort: (r) => r.method, cell: (r) => r.method, total: 'Total' },
    { id: 'count', label: 'Receipts', numeric: true, sort: (r) => r.count, cell: (r) => r.count, total: rep.count },
    { id: 'amount', label: 'Amount', numeric: true, sort: (r) => r.amount, cell: (r) => money(r.amount), total: money(rep.total) },
    { id: 'share', label: 'Share', numeric: true, sort: (r) => r.share, cell: (r) => <Share value={r.share} />, total: '100%' },
  ];
  const max = Math.max(...rep.rows.map((r) => r.amount), 1);
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>Money received in the period, by how the customer paid. Cash payments never appear on a bank statement.</p>
        <ExportButton filename={`payment-modes-${slug(period)}.csv`} csv={() => paymentModesCsv(rep, period)} />
      </div>
      {rep.rows.length === 0 ? (
        <div className={surface.card}>
          <EmptyState icon={Landmark} title="No payments received in this period" text="Record payments on an invoice and they are split by mode here." />
        </div>
      ) : (
        <>
          <div className={surface.card}>
            <ul className={styles.barList} aria-label="Share of money received by mode">
              {rep.rows.map((r) => (
                <li key={r.method} className={styles.barItem}>
                  <div className={styles.barMeta}>
                    <span className={styles.barName}>{r.method}</span>
                    <span className={styles.barVal}>₹{money(r.amount)} · {r.share.toFixed(1)}%</span>
                  </div>
                  <div className={styles.barTrack} aria-hidden="true"><div className={styles.barFill} style={{ width: `${(r.amount / max) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </div>
          <div className={surface.card}>
            <SortableTable caption="Payment modes" rows={rep.rows} columns={cols} rowKey={(r) => r.method} initialSort={{ id: 'amount', dir: 'desc' }} />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Expenses by category / vendor ─────────────────────────── */

export function ExpensesTab({ rep, period }: { rep: ExpenseReport; period: Period }) {
  const [by, setBy] = useState<'category' | 'vendor'>('category');
  const t = rep.totals;

  const catCols: Column<ExpenseCategoryRow>[] = [
    { id: 'cat', label: 'Category', sort: (r) => r.category, cell: (r) => r.category, total: 'Total' },
    { id: 'type', label: 'Type', sort: (r) => (r.direct ? 'Direct' : 'Indirect'), cell: (r) => (r.direct ? 'Direct' : 'Indirect'), total: '' },
    { id: 'count', label: 'Bills', numeric: true, sort: (r) => r.count, cell: (r) => r.count, total: t.count },
    { id: 'taxable', label: 'Taxable', numeric: true, sort: (r) => r.taxable, cell: (r) => money(r.taxable), total: money(t.taxable) },
    { id: 'gst', label: 'GST', numeric: true, sort: (r) => r.gst, cell: (r) => money(r.gst), total: money(t.gst) },
    { id: 'itc', label: 'ITC claimed', numeric: true, sort: (r) => r.itc, cell: (r) => money(r.itc), total: money(t.itc) },
    { id: 'cost', label: 'Cost to P&L', numeric: true, sort: (r) => r.cost, cell: (r) => money(r.cost), total: money(t.cost) },
    { id: 'share', label: 'Share', numeric: true, sort: (r) => r.share, cell: (r) => <Share value={r.share} />, total: '100%' },
  ];
  const venCols: Column<ExpenseVendorRow>[] = [
    { id: 'vendor', label: 'Vendor', sort: (r) => r.vendor, cell: (r) => r.vendor, total: 'Total' },
    { id: 'count', label: 'Bills', numeric: true, sort: (r) => r.count, cell: (r) => r.count, total: t.count },
    { id: 'taxable', label: 'Taxable', numeric: true, sort: (r) => r.taxable, cell: (r) => money(r.taxable), total: money(t.taxable) },
    { id: 'gst', label: 'GST', numeric: true, sort: (r) => r.gst, cell: (r) => money(r.gst), total: money(t.gst) },
    { id: 'itc', label: 'ITC claimed', numeric: true, sort: (r) => r.itc, cell: (r) => money(r.itc), total: money(t.itc) },
    { id: 'cost', label: 'Cost to P&L', numeric: true, sort: (r) => r.cost, cell: (r) => money(r.cost), total: money(t.cost) },
    { id: 'share', label: 'Share', numeric: true, sort: (r) => r.share, cell: (r) => <Share value={r.share} />, total: '100%' },
  ];
  const empty = (
    <EmptyState
      icon={ShoppingCart}
      title="No purchases or expenses in this period"
      text="Bills and quick expenses recorded under Expenses appear here. Draft and cancelled bills are never counted."
      action={<Link to="/expenses" className={controls.btnPrimary}><Receipt size={16} /> Open Expenses</Link>}
    />
  );
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={controls.segment} role="group" aria-label="Group by">
          {(['category', 'vendor'] as const).map((g) => (
            <button key={g} type="button" aria-pressed={by === g} className={by === g ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setBy(g)}>
              {g === 'category' ? 'By category' : 'By vendor'}
            </button>
          ))}
        </div>
        <ExportButton filename={`expenses-by-${by}-${slug(period)}.csv`} csv={() => expensesCsv(rep, by, period)} />
      </div>
      <p className={styles.muted}>Cost = taxable value plus any GST that cannot be claimed as input credit — the same figure Books deducts in the P&amp;L.</p>
      <div className={surface.card}>
        {by === 'category' ? (
          <SortableTable caption="Expenses by category" rows={rep.categories} columns={catCols} rowKey={(r) => r.key} initialSort={{ id: 'cost', dir: 'desc' }} empty={empty} />
        ) : (
          <SortableTable caption="Expenses by vendor" rows={rep.vendors} columns={venCols} rowKey={(r) => r.vendor} initialSort={{ id: 'cost', dir: 'desc' }} empty={empty} />
        )}
      </div>
    </div>
  );
}

/* ── Profitability by item ─────────────────────────────────── */

export function ProfitTab({ rep, period, hasStock }: { rep: ReturnType<typeof profitByItem>; period: Period; hasStock: boolean }) {
  const t = rep.totals;
  const rows = useMemo(() => rep.rows, [rep]);
  const cols: Column<ProfitRow>[] = [
    { id: 'name', label: 'Item', sort: (r) => r.name, cell: (r) => r.name, total: 'Total' },
    { id: 'qty', label: 'Qty sold', numeric: true, sort: (r) => r.quantity, cell: (r) => r.quantity },
    { id: 'rev', label: 'Sales (excl. GST)', numeric: true, sort: (r) => r.revenue, cell: (r) => money(r.revenue), total: money(t.revenue) },
    { id: 'cogs', label: 'Cost of goods', numeric: true, sort: (r) => r.cogs, cell: (r) => money(r.cogs), total: money(t.cogs) },
    { id: 'profit', label: 'Profit', numeric: true, sort: (r) => r.profit, cell: (r) => <span className={r.profit < 0 ? styles.neg : styles.pos}>{money(r.profit)}</span>, total: money(t.profit) },
    { id: 'margin', label: 'Margin', numeric: true, sort: (r) => r.margin, cell: (r) => `${r.margin.toFixed(1)}%`, total: `${t.margin.toFixed(1)}%` },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>
          Only items with stock tracking switched on in Inventory have a cost. Cost comes from the stock ledger (weighted average or FIFO, as chosen there).
        </p>
        <ExportButton filename={`item-profitability-${slug(period)}.csv`} csv={() => profitCsv(rep, period)} />
      </div>
      <div className={surface.card}>
        <SortableTable
          caption="Profitability by item"
          rows={rows}
          columns={cols}
          rowKey={(r) => r.name}
          initialSort={{ id: 'profit', dir: 'desc' }}
          empty={
            <EmptyState
              icon={Boxes}
              title={hasStock ? 'No tracked items were sold in this period' : 'No stock-tracked items yet'}
              text={hasStock ? 'Sales of tracked items in the period, with their cost of goods, appear here.' : 'Turn on stock tracking for an item under Inventory and its margin shows up here.'}
              action={<Link to="/inventory" className={controls.btnPrimary}><Boxes size={16} /> Open Inventory</Link>}
            />
          }
        />
      </div>
    </div>
  );
}
