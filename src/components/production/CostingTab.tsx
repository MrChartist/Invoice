import { useMemo, useState } from 'react';
import { Download, Scale } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { getTable } from '../../lib/storage';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { computeStock, computeStockDetailed } from '../../lib/inventory';
import { productionOrdersDb } from '../../lib/production/orders';
import { costingRows, orderCost, soMargins, varianceTone, type CostingContext, type OrderCost } from '../../lib/production/costing';
import type { InvoiceRecord } from '../../types/invoice';
import type { ManufacturingVoucher, StockJournal } from '../../types/manufacturing';
import { useT } from '../../i18n';
import { pT } from '../../i18n/areas/production-r4';
import { money, qtyText, type MfgContext } from '../manufacturing/context';
import { OrderCostCard } from './OrderCostCard';
import { StatusBadge } from './StatusBadge';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';
import styles from './production.module.css';

const toneClass = (amount: number) => {
  const t = varianceTone(amount);
  return t === 'adverse' ? styles.adverse : t === 'favourable' ? styles.favourable : undefined;
};

/** /manufacturing?tab=costing — standard vs actual per production order, variances, yield, sales-order margin (R4-A2). */
export function CostingTab({ ctx }: { ctx: MfgContext }) {
  useT();
  const [openId, setOpenId] = useState('');
  const costing = useMemo((): { costs: OrderCost[]; context: CostingContext } => {
    void ctx.version;
    const wac = new Map<string, Map<string, number>>();
    const context: CostingContext = {
      items: ctx.items,
      mfg: getTable<ManufacturingVoucher>('manufacturing_vouchers'),
      journals: getTable<StockJournal>('stock_journals'),
      computation: computeStockDetailed(ctx.inputs),
      wacOn: (id, day) => {
        let m = wac.get(day);
        if (!m) wac.set(day, (m = new Map(computeStock({ ...ctx.inputs, asOf: day }).map((p) => [p.item.id, p.avgCost]))));
        return m.get(id) ?? 0;
      },
    };
    const orders = productionOrdersDb.all().filter((o) => o.status !== 'cancelled' && o.materials?.length);
    return { costs: orders.map((o) => orderCost(o, context)).sort((a, b) => b.order.date.localeCompare(a.order.date)), context };
  }, [ctx.version, ctx.items, ctx.inputs]);
  const margins = useMemo(() => soMargins(costing.costs, getTable<InvoiceRecord>('invoices'), getTable('doc_links')), [costing]);
  const name = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';
  const open = costing.costs.find((c) => c.order.id === openId);
  const rows = () => costingRows(costing.costs, name);
  const xlsx = async () => {
    const { downloadXlsx } = await import('../../lib/xlsx');
    const so = [['Sales order', 'Customer', 'Revenue (₹)', 'Cost (₹)', 'Margin (₹)', 'Margin %'], ...margins.map((m) => [m.so.invoice_number, m.so.client?.name ?? '', m.revenue, m.cost, m.margin, m.margin_pct ?? ''])];
    await downloadXlsx('order-costing.xlsx', [{ name: 'Order costing', rows: rows() }, { name: 'SO margin', rows: so }]);
  };

  return (
    <>
      <div className={mfg.bar}>
        <span className={mfg.muted}>{pT('costingIntro')}</span>
        <span className={styles.actions}>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!costing.costs.length} onClick={() => downloadText('order-costing.csv', toCsv(rows()), 'text/csv')}><Download size={14} aria-hidden="true" /> CSV</button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!costing.costs.length} onClick={() => void xlsx()}><Download size={14} aria-hidden="true" /> Excel</button>
        </span>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-testid="costing-table">
          <thead>
            <tr>
              <th>{pT('number')}</th><th>{pT('item')}</th><th>{pT('status')}</th><th className={mfg.num}>{pT('output')}</th><th className={mfg.num}>{pT('yieldPct')}</th>
              <th className={mfg.num}>{pT('standard')}</th><th className={mfg.num}>{pT('stdForOutput')}</th><th className={mfg.num}>{pT('actual')}</th><th className={mfg.num}>{pT('variance')}</th>
              <th><span className={surface.srOnly}>{pT('open')}</span></th>
            </tr>
          </thead>
          <tbody>
            {costing.costs.map((c) => (
              <tr key={c.order.id}>
                <td className={surface.mono}>{c.order.number}</td>
                <td>{name(c.order.item_id)}</td>
                <td><StatusBadge status={c.order.status} /></td>
                <td className={mfg.num}>{qtyText(c.output)} / {qtyText(c.planned)}</td>
                <td className={mfg.num}>{c.yield_pct}%</td>
                <td className={mfg.num}>{money(c.standard)}</td>
                <td className={mfg.num}>{money(c.standard_for_output)}</td>
                <td className={mfg.num}>{money(c.actual)}</td>
                <td className={cn(mfg.num, toneClass(c.variance))}>{money(c.variance)}</td>
                <td className={surface.rowActions}><button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setOpenId(c.order.id === openId ? '' : c.order.id)}><Scale size={14} aria-hidden="true" /> {pT('drill')} <span className={surface.srOnly}>{c.order.number}</span></button></td>
              </tr>
            ))}
            {costing.costs.length === 0 && <tr><td colSpan={10} className={mfg.muted}>{pT('noCosting')}</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <OrderCostCard cost={open} name={name} />}

      <p className={mfg.section} style={{ margin: '1.25rem 0 0.5rem' }}>{pT('soMargin')}</p>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{pT('salesOrder')}</th><th>{pT('date')}</th><th>{pT('customer')}</th><th className={mfg.num}>{pT('revenue')}</th><th className={mfg.num}>{pT('cost')}</th><th className={mfg.num}>{pT('margin')}</th><th className={mfg.num}>%</th></tr></thead>
          <tbody>
            {margins.map((m) => (
              <tr key={m.so.id}>
                <td className={surface.mono}>{m.so.invoice_number}</td>
                <td>{m.so.issue_date ? formatDate(m.so.issue_date) : '-'}</td>
                <td>{m.so.client?.name ?? '-'}</td>
                <td className={mfg.num}>{money(m.revenue)}</td>
                <td className={mfg.num}>{money(m.cost)}</td>
                <td className={cn(mfg.num, m.margin < 0 ? styles.adverse : undefined)}>{money(m.margin)}</td>
                <td className={mfg.num}>{m.margin_pct === null ? '-' : `${m.margin_pct}%`}</td>
              </tr>
            ))}
            {margins.length === 0 && <tr><td colSpan={7} className={mfg.muted}>{pT('noSoMargin')}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className={mfg.muted} style={{ marginTop: '0.75rem' }}>{pT('costingCa')}</p>
    </>
  );
}
