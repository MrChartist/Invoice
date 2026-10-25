import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BarChart3, FilePlus2, Package, Trophy } from 'lucide-react';
import {
  concentration,
  customersCsv,
  itemsCsv,
  monthlyCsv,
  salesByItem,
  salesByMonth,
  topCustomersCsv,
  type CustomerReport,
  type CustomerRow,
  type ItemGrouping,
  type ItemRow,
  type MonthRow,
  type SalesDoc,
} from '../../lib/sales-reports';
import type { Period } from '../../lib/books';
import { formatDate, formatQuantity } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { Delta, ExportButton, InvoiceLink, Share } from './bits';
import { money } from './fmt';
import { MonthlyChart } from './MonthlyChart';
import { SortableTable, type Column } from './SortableTable';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './reports.module.css';
import { useT } from '../../i18n';
import { repT } from '../../i18n/areas/reports';
import { plural } from '../../i18n/areas/plural';

export function NoSales() {
  useT();
  return (
    <EmptyState
      icon={BarChart3}
      title={repT('noSalesTitle')}
      text={repT('noSalesText')}
      action={
        <Link to="/invoice" className={controls.btnPrimary}>
          <FilePlus2 size={16} /> {repT('newInvoice')}
        </Link>
      }
    />
  );
}

const slug = (p: Period) => `${p.start}_to_${p.end}`;

/* ── Sales by customer ─────────────────────────────────────── */

export function CustomersTab({ report, period }: { report: CustomerReport; period: Period }) {
  useT();
  const { totals } = report;
  const cols: Column<CustomerRow>[] = [
    {
      id: 'name', label: repT('colCustomer'), sort: (r) => r.name, total: repT('total'),
      cell: (r) => (
        <>
          <Link to={`/receivables?tab=statements&party=${encodeURIComponent(r.partyKey)}`} className={styles.link}>{r.name}</Link>
          {r.creditNotes > 0 && <span className={styles.dim}>{plural(repT, 'cnNettedOne', 'cnNettedMany', r.creditNotes)}</span>}
        </>
      ),
    },
    { id: 'count', label: repT('colInvoices'), numeric: true, sort: (r) => r.count, cell: (r) => r.count, total: totals.count },
    { id: 'taxable', label: repT('colTaxable'), numeric: true, sort: (r) => r.taxable, cell: (r) => money(r.taxable), total: money(totals.taxable) },
    { id: 'tax', label: repT('colGstCess'), numeric: true, sort: (r) => r.tax, cell: (r) => money(r.tax), total: money(totals.tax) },
    { id: 'total', label: repT('colTotal'), numeric: true, sort: (r) => r.total, cell: (r) => money(r.total), total: money(totals.total) },
    { id: 'avg', label: repT('colAvgInvoice'), numeric: true, sort: (r) => r.avg, cell: (r) => (r.count ? money(r.avg) : '—') },
    { id: 'share', label: repT('colShare'), numeric: true, sort: (r) => r.share, cell: (r) => <Share value={r.share} />, total: '100%' },
    {
      id: 'last', label: repT('colLastInvoice'), sort: (r) => r.lastDate,
      cell: (r) => (r.lastDate ? <InvoiceLink id={r.lastId}>{formatDate(r.lastDate)}</InvoiceLink> : '—'),
    },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>{repT('customersNote')}</p>
        <ExportButton filename={`sales-by-customer-${slug(period)}.csv`} csv={() => customersCsv(report, period)} />
      </div>
      <div className={surface.card}>
        <SortableTable
          caption={repT('capCustomers')}
          rows={report.rows}
          columns={cols}
          rowKey={(r) => r.key}
          initialSort={{ id: 'total', dir: 'desc' }}
          empty={<NoSales />}
        />
      </div>
    </div>
  );
}

/* ── Sales by item / HSN ───────────────────────────────────── */

export function ItemsTab({ docs, period }: { docs: readonly SalesDoc[]; period: Period }) {
  useT();
  const [by, setBy] = useState<ItemGrouping>('item');
  const rep = useMemo(() => salesByItem(docs, period, by), [docs, period, by]);
  const cols: Column<ItemRow>[] = [
    { id: 'name', label: by === 'hsn' ? repT('colHsn') : repT('colItem'), sort: (r) => r.name, cell: (r) => r.name, total: repT('total') },
    ...(by === 'item' ? [{ id: 'hsn', label: repT('colHsn'), sort: (r: ItemRow) => r.hsn, cell: (r: ItemRow) => r.hsn || '—' } as Column<ItemRow>] : []),
    { id: 'qty', label: repT('colQty'), numeric: true, sort: (r) => r.quantity, cell: (r) => `${formatQuantity(r.quantity)}${by === 'item' && r.unit ? ` ${r.unit.toLowerCase()}` : ''}`, total: formatQuantity(rep.totals.quantity) },
    { id: 'taxable', label: repT('colTaxable'), numeric: true, sort: (r) => r.taxable, cell: (r) => money(r.taxable), total: money(rep.totals.taxable) },
    { id: 'tax', label: repT('colGstCess'), numeric: true, sort: (r) => r.tax, cell: (r) => money(r.tax), total: money(rep.totals.tax) },
    { id: 'avg', label: repT('colAvgRate'), numeric: true, sort: (r) => r.avgRate, cell: (r) => (r.quantity > 0 ? money(r.avgRate) : '—') },
    { id: 'docs', label: repT('colInvoices'), numeric: true, sort: (r) => r.docs, cell: (r) => r.docs },
    { id: 'share', label: repT('colShare'), numeric: true, sort: (r) => r.share, cell: (r) => <Share value={r.share} />, total: '100%' },
  ];
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={controls.segment} role="group" aria-label={repT('groupBy')}>
          {(['item', 'hsn'] as const).map((g) => (
            <button key={g} type="button" aria-pressed={by === g} className={by === g ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setBy(g)}>
              {g === 'item' ? repT('byItem') : repT('byHsn')}
            </button>
          ))}
        </div>
        <ExportButton filename={`sales-by-${by}-${slug(period)}.csv`} csv={() => itemsCsv(rep, by, period)} />
      </div>
      <div className={surface.card}>
        <SortableTable
          caption={repT('capItems')}
          rows={rep.rows}
          columns={cols}
          rowKey={(r) => r.key}
          initialSort={{ id: 'taxable', dir: 'desc' }}
          empty={<EmptyState icon={Package} title={repT('noItemsTitle')} text={repT('noItemsText')} />}
        />
      </div>
    </div>
  );
}

/* ── Sales by month + year on year ─────────────────────────── */

export function MonthlyTab({ docs, period }: { docs: readonly SalesDoc[]; period: Period }) {
  useT();
  const [metric, setMetric] = useState<'taxable' | 'total'>('taxable');
  const rep = useMemo(() => salesByMonth(docs, period), [docs, period]);
  const hasAny = rep.totals.taxable !== 0 || rep.totals.prevTaxable !== 0 || rep.totals.count > 0;
  const cur = (r: MonthRow) => (metric === 'taxable' ? r.taxable : r.total);
  const prev = (r: MonthRow) => (metric === 'taxable' ? r.prevTaxable : r.prevTotal);
  const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
  const t = rep.totals;

  const cols: Column<MonthRow>[] = [
    { id: 'm', label: repT('colMonth'), sort: (r) => r.month, cell: (r) => r.label, total: repT('total') },
    { id: 'count', label: repT('colInvoices'), numeric: true, sort: (r) => r.count, cell: (r) => r.count, total: t.count },
    { id: 'cur', label: metric === 'taxable' ? repT('colTaxable') : repT('colBilled'), numeric: true, sort: cur, cell: (r) => money(cur(r)), total: money(metric === 'taxable' ? t.taxable : t.total) },
    { id: 'prev', label: repT('colLastYear'), numeric: true, sort: prev, cell: (r) => money(prev(r)), total: money(metric === 'taxable' ? t.prevTaxable : t.prevTotal) },
    { id: 'chg', label: repT('colChange'), numeric: true, sort: (r) => r.future ? null : pct(cur(r), prev(r)), cell: (r) => <Delta value={r.future ? null : pct(cur(r), prev(r))} />, total: <Delta value={metric === 'taxable' ? t.change : t.changeTotal} /> },
  ];

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <div className={controls.segment} role="group" aria-label={repT('measure')}>
          <button type="button" aria-pressed={metric === 'taxable'} className={metric === 'taxable' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setMetric('taxable')}>{repT('exclGst')}</button>
          <button type="button" aria-pressed={metric === 'total'} className={metric === 'total' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setMetric('total')}>{repT('inclGst')}</button>
        </div>
        <ExportButton filename={`sales-by-month-${slug(period)}.csv`} csv={() => monthlyCsv(rep)} />
      </div>
      {!hasAny ? (
        <div className={surface.card}><NoSales /></div>
      ) : (
        <>
          <p className={styles.muted}>
            {repT('comparedWith', { start: formatDate(rep.prevPeriod.start), end: formatDate(rep.prevPeriod.end) })}
          </p>
          <div className={surface.card}>
            <div className={surface.cardHead}>{repT('monthlySales')}</div>
            <MonthlyChart rows={rep.rows} metric={metric} />
          </div>
          <div className={surface.card}>
            <SortableTable caption={repT('capMonthly')} rows={rep.rows} columns={cols} rowKey={(r) => r.month} initialSort={{ id: 'm', dir: 'asc' }} />
          </div>
        </>
      )}
    </div>
  );
}

/* ── Top customers + concentration ─────────────────────────── */

export function TopCustomersTab({ report, period }: { report: CustomerReport; period: Period }) {
  useT();
  const c = useMemo(() => concentration(report, 10), [report]);
  if (c.customers === 0) return <div className={surface.card}><NoSales /></div>;
  const max = Math.max(...c.top.map((r) => r.taxable), 1);
  const level = { high: repT('levelHigh'), moderate: repT('levelModerate'), healthy: repT('levelHealthy'), none: '' }[c.level];

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <p className={styles.muted}>{repT('rankedNote')}</p>
        <ExportButton filename={`top-customers-${slug(period)}.csv`} csv={() => topCustomersCsv(c)} />
      </div>
      {c.warning && (
        <div className={c.level === 'high' ? styles.noticeDanger : styles.noticeWarn} role="alert">
          <AlertTriangle size={16} className={c.level === 'high' ? styles.noticeIconDanger : styles.noticeIcon} aria-hidden="true" />
          <span><strong>{level}.</strong> {c.warning}</span>
        </div>
      )}
      <div className={styles.kpis}>
        <div className={styles.kpi}><div className={styles.kpiLabel}>{repT('kpiCustomers')}</div><div className={styles.kpiValue}>{c.customers}</div></div>
        <div className={styles.kpi}><div className={styles.kpiLabel}>{repT('kpiTop1')}</div><div className={styles.kpiValue}>{c.top1Share.toFixed(1)}%</div></div>
        <div className={styles.kpi}><div className={styles.kpiLabel}>{repT('kpiTop3')}</div><div className={styles.kpiValue}>{c.top3Share.toFixed(1)}%</div></div>
        <div className={styles.kpi}><div className={styles.kpiLabel}>{repT('kpiTop5')}</div><div className={styles.kpiValue}>{c.top5Share.toFixed(1)}%</div></div>
      </div>
      <div className={surface.card}>
        <div className={surface.cardHead}><span className={surface.cardHeadIcon}><Trophy size={16} /> {repT('topCustomers')}</span></div>
        <ol className={styles.barList} aria-label={repT('topCustomersAria')}>
          {c.top.map((r, i) => (
            <li key={r.key} className={styles.barItem}>
              <div className={styles.barMeta}>
                <span className={styles.barName}>
                  {i + 1}. <Link to={`/receivables?tab=statements&party=${encodeURIComponent(r.partyKey)}`} className={styles.link}>{r.name}</Link>
                </span>
                <span className={styles.barVal}>
                  ₹{money(r.taxable)} · {r.share.toFixed(1)}% <span className={styles.muted}>{repT('cumulative', { pct: r.cumulativeShare.toFixed(1) })}</span>
                </span>
              </div>
              <div className={styles.barTrack} aria-hidden="true"><div className={i < 3 ? styles.barFill : styles.barFillAlt} style={{ width: `${(r.taxable / max) * 100}%` }} /></div>
            </li>
          ))}
        </ol>
      </div>
      <p className={styles.muted}>
        {repT('concentrationNote')}
      </p>
    </div>
  );
}
