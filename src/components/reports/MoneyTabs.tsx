import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, Receipt, ShoppingCart } from 'lucide-react';
import {
  expensesCsv,
  paymentModesCsv,
  taxRateCsv,
  type ExpenseCategoryRow,
  type ExpenseReport,
  type ExpenseVendorRow,
  type PaymentModeRow,
  type TaxRateRow,
  paymentModes,
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
import { useT } from '../../i18n';
import { repT } from '../../i18n/areas/reports';
import { methodLabel } from '../../i18n/labels';

const slug = (p: Period) => `${p.start}_to_${p.end}`;

/* ── Tax collected by rate ─────────────────────────────────── */

export function TaxTab({ rep, period }: { rep: ReturnType<typeof taxByRate>; period: Period }) {
  useT();
  const t = rep.totals;
  const cols: Column<TaxRateRow>[] = [
    { id: 'rate', label: repT('colRate'), sort: (r) => r.rate, cell: (r) => r.label, total: repT('total') },
    { id: 'taxable', label: repT('colTaxableValue'), numeric: true, sort: (r) => r.taxable, cell: (r) => money(r.taxable), total: money(t.taxable) },
    { id: 'cgst', label: 'CGST', numeric: true, sort: (r) => r.cgst, cell: (r) => money(r.cgst), total: money(t.cgst) },
    { id: 'sgst', label: 'SGST', numeric: true, sort: (r) => r.sgst, cell: (r) => money(r.sgst), total: money(t.sgst) },
    { id: 'igst', label: 'IGST', numeric: true, sort: (r) => r.igst, cell: (r) => money(r.igst), total: money(t.igst) },
    { id: 'cess', label: repT('colCess'), numeric: true, sort: (r) => r.cess, cell: (r) => money(r.cess), total: money(t.cess) },
    { id: 'tax', label: repT('colGstCollected'), numeric: true, sort: (r) => r.tax, cell: (r) => money(r.tax), total: money(t.tax) },
    { id: 'docs', label: repT('colDocuments'), numeric: true, sort: (r) => r.docs, cell: (r) => r.docs },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>
          {repT('taxNote')}
        </p>
        <ExportButton filename={`tax-by-rate-${slug(period)}.csv`} csv={() => taxRateCsv(rep, period)} />
      </div>
      <div className={surface.card}>
        <SortableTable caption={repT('capTax')} rows={rep.rows} columns={cols} rowKey={(r) => String(r.rate)} initialSort={{ id: 'rate', dir: 'asc' }} empty={<NoSales />} />
      </div>
    </div>
  );
}

/* ── Payment-mode split ────────────────────────────────────── */

export function PaymentsTab({ rep, period }: { rep: ReturnType<typeof paymentModes>; period: Period }) {
  useT();
  const cols: Column<PaymentModeRow>[] = [
    { id: 'method', label: repT('colMode'), sort: (r) => r.method, cell: (r) => methodLabel(r.method), total: repT('total') },
    { id: 'count', label: repT('colReceipts'), numeric: true, sort: (r) => r.count, cell: (r) => r.count, total: rep.count },
    { id: 'amount', label: repT('colAmount'), numeric: true, sort: (r) => r.amount, cell: (r) => money(r.amount), total: money(rep.total) },
    { id: 'share', label: repT('colShare'), numeric: true, sort: (r) => r.share, cell: (r) => <Share value={r.share} />, total: '100%' },
  ];
  const max = Math.max(...rep.rows.map((r) => r.amount), 1);
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>{repT('paymentsNote')}</p>
        <ExportButton filename={`payment-modes-${slug(period)}.csv`} csv={() => paymentModesCsv(rep, period)} />
      </div>
      {rep.rows.length === 0 ? (
        <div className={surface.card}>
          <EmptyState icon={Landmark} title={repT('noPaymentsTitle')} text={repT('noPaymentsText')} />
        </div>
      ) : (
        <>
          <div className={surface.card}>
            <ul className={styles.barList} aria-label={repT('paymentsAria')}>
              {rep.rows.map((r) => (
                <li key={r.method} className={styles.barItem}>
                  <div className={styles.barMeta}>
                    <span className={styles.barName}>{methodLabel(r.method)}</span>
                    <span className={styles.barVal}>₹{money(r.amount)} · {r.share.toFixed(1)}%</span>
                  </div>
                  <div className={styles.barTrack} aria-hidden="true"><div className={styles.barFill} style={{ width: `${(r.amount / max) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          </div>
          <div className={surface.card}>
            <SortableTable caption={repT('capPayments')} rows={rep.rows} columns={cols} rowKey={(r) => r.method} initialSort={{ id: 'amount', dir: 'desc' }} />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Expenses by category / vendor ─────────────────────────── */

export function ExpensesTab({ rep, period }: { rep: ExpenseReport; period: Period }) {
  useT();
  const [by, setBy] = useState<'category' | 'vendor'>('category');
  const t = rep.totals;

  const catCols: Column<ExpenseCategoryRow>[] = [
    { id: 'cat', label: repT('colCategory'), sort: (r) => r.category, cell: (r) => r.category, total: repT('total') },
    { id: 'type', label: repT('colType'), sort: (r) => (r.direct ? 'Direct' : 'Indirect'), cell: (r) => (r.direct ? repT('direct') : repT('indirect')), total: '' },
    { id: 'count', label: repT('colBills'), numeric: true, sort: (r) => r.count, cell: (r) => r.count, total: t.count },
    { id: 'taxable', label: repT('colTaxable'), numeric: true, sort: (r) => r.taxable, cell: (r) => money(r.taxable), total: money(t.taxable) },
    { id: 'gst', label: repT('colGst'), numeric: true, sort: (r) => r.gst, cell: (r) => money(r.gst), total: money(t.gst) },
    { id: 'itc', label: repT('colItc'), numeric: true, sort: (r) => r.itc, cell: (r) => money(r.itc), total: money(t.itc) },
    { id: 'cost', label: repT('colCostPl'), numeric: true, sort: (r) => r.cost, cell: (r) => money(r.cost), total: money(t.cost) },
    { id: 'share', label: repT('colShare'), numeric: true, sort: (r) => r.share, cell: (r) => <Share value={r.share} />, total: '100%' },
  ];
  const venCols: Column<ExpenseVendorRow>[] = [
    { id: 'vendor', label: repT('colVendor'), sort: (r) => r.vendor, cell: (r) => r.vendor, total: repT('total') },
    { id: 'count', label: repT('colBills'), numeric: true, sort: (r) => r.count, cell: (r) => r.count, total: t.count },
    { id: 'taxable', label: repT('colTaxable'), numeric: true, sort: (r) => r.taxable, cell: (r) => money(r.taxable), total: money(t.taxable) },
    { id: 'gst', label: repT('colGst'), numeric: true, sort: (r) => r.gst, cell: (r) => money(r.gst), total: money(t.gst) },
    { id: 'itc', label: repT('colItc'), numeric: true, sort: (r) => r.itc, cell: (r) => money(r.itc), total: money(t.itc) },
    { id: 'cost', label: repT('colCostPl'), numeric: true, sort: (r) => r.cost, cell: (r) => money(r.cost), total: money(t.cost) },
    { id: 'share', label: repT('colShare'), numeric: true, sort: (r) => r.share, cell: (r) => <Share value={r.share} />, total: '100%' },
  ];
  const empty = (
    <EmptyState
      icon={ShoppingCart}
      title={repT('noExpensesTitle')}
      text={repT('noExpensesText')}
      action={<Link to="/expenses" className={controls.btnPrimary}><Receipt size={16} /> {repT('openExpenses')}</Link>}
    />
  );
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={controls.segment} role="group" aria-label={repT('groupBy')}>
          {(['category', 'vendor'] as const).map((g) => (
            <button key={g} type="button" aria-pressed={by === g} className={by === g ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setBy(g)}>
              {g === 'category' ? repT('byCategory') : repT('byVendor')}
            </button>
          ))}
        </div>
        <ExportButton filename={`expenses-by-${by}-${slug(period)}.csv`} csv={() => expensesCsv(rep, by, period)} />
      </div>
      <p className={styles.muted}>{repT('costNote')}</p>
      <div className={surface.card}>
        {by === 'category' ? (
          <SortableTable caption={repT('capExpCategory')} rows={rep.categories} columns={catCols} rowKey={(r) => r.key} initialSort={{ id: 'cost', dir: 'desc' }} empty={empty} />
        ) : (
          <SortableTable caption={repT('capExpVendor')} rows={rep.vendors} columns={venCols} rowKey={(r) => r.vendor} initialSort={{ id: 'cost', dir: 'desc' }} empty={empty} />
        )}
      </div>
    </div>
  );
}
