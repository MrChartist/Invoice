import { useMemo } from 'react';
import { Truck } from 'lucide-react';
import { fillRates, inTransitRows, loadRequestDocs, transferRequestsDb, transitValueBy } from '../../lib/retail/transfer-requests';
import { branchOfGodown } from '../../lib/branch-transfer';
import { loadBranches } from '../../lib/branch';
import { cn, formatCurrency, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import { costIndex, nameOfGodown, type TransferCtx } from './transfer-context';
import surface from '../../styles/surface.module.css';
import css from './retail-r4.module.css';

/**
 * Goods in transit (R4-B4): per request and item with their age, value at cost per receiving store / branch, and the
 * fill rate per store (received ÷ requested, last 90 days). Goods in transit are the company's and count in closing stock.
 */
export default function InTransitTab({ ctx }: { ctx: TransferCtx }) {
  useT();
  const today = todayInput();
  const data = useMemo(() => {
    const docs = loadRequestDocs();
    const requests = transferRequestsDb.all();
    const rows = inTransitRows(requests, docs, costIndex(ctx.inputs), today);
    return { rows, byStore: transitValueBy(rows), fill: fillRates(requests, docs, today) };
  }, [ctx.inputs, today]);
  const branches = useMemo(() => loadBranches(), []);
  const itemName = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? sT('item');
  const total = data.rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className={css.stack}>
      <div className={css.stats}>
        <div className={css.stat}><span className={css.statLabel}><Truck size={12} aria-hidden="true" /> {sT('valueInTransit')}</span><span className={css.statValue} data-trq-transit-value>{formatCurrency(total)}</span></div>
        {[...data.byStore].map(([g, v]) => (
          <div key={g} className={css.stat}>
            <span className={css.statLabel}>{nameOfGodown(ctx, g)}{branchOfGodown(g, branches, ctx.godowns) ? ` · ${branchOfGodown(g, branches, ctx.godowns)!.name}` : ''}</span>
            <span className={css.statValue}>{formatCurrency(v)}</span>
          </div>
        ))}
      </div>
      <div className={css.wrap}>
        <table className={surface.table} data-trq-transit>
          <thead><tr><th>{sT('number')}</th><th>{sT('fromTo')}</th><th>{sT('item')}</th><th className={css.num}>{sT('qty')}</th><th className={css.num}>{sT('valueAtCost')}</th><th className={css.num}>{sT('ageDays')}</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={`${r.request.id}|${r.item_id}`}>
                <td className={css.mono}>{r.request.number}</td>
                <td>{nameOfGodown(ctx, r.request.from_godown)} → {nameOfGodown(ctx, r.request.to_godown)}</td>
                <td>{itemName(r.item_id)}</td>
                <td className={css.num}>{r.qty}</td>
                <td className={css.num}>{formatCurrency(r.value)}</td>
                <td className={cn(css.num, r.age > 3 && css.warn)}>{r.age}</td>
              </tr>
            ))}
            {!data.rows.length && <tr><td colSpan={6} className={css.muted}>{sT('nothingInTransit')}</td></tr>}
          </tbody>
        </table>
      </div>
      {data.fill.length > 0 && (
        <div className={css.wrap}>
          <table className={surface.table}>
            <thead><tr><th>{sT('store')}</th><th className={css.num}>{sT('requestedQty')}</th><th className={css.num}>{sT('receivedQty')}</th><th className={css.num}>{sT('fillRate')}</th></tr></thead>
            <tbody>{data.fill.map((f) => (
              <tr key={f.godown}><td>{nameOfGodown(ctx, f.godown)}</td><td className={css.num}>{f.requested}</td><td className={css.num}>{f.received}</td><td className={css.num}>{f.rate}%</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <p className={css.note}>{sT('transitNote')}</p>
    </div>
  );
}
