import { cn } from '../../lib/utils';
import { varianceTone, type OrderCost } from '../../lib/production/costing';
import { pT } from '../../i18n/areas/production-r4';
import { money, qtyText } from '../manufacturing/context';
import mfg from '../manufacturing/manufacturing.module.css';
import styles from './production.module.css';

const tone = (n: number) => {
  const t = varianceTone(n);
  return t === 'adverse' ? styles.adverse : t === 'favourable' ? styles.favourable : undefined;
};
const word = (n: number) => {
  const t = varianceTone(n);
  return t === 'nil' ? '' : ` (${pT(t === 'adverse' ? 'adverse' : 'favourable')})`;
};

/** Drill-down of one order's costing: summary, the variance split and component rows. */
export function OrderCostCard({ cost, name }: { cost: OrderCost; name: (id: string) => string }) {
  const cells: [string, string, number?][] = [
    [pT('stdUnit'), money(cost.std_unit)],
    [pT('standard'), money(cost.standard)],
    [pT('stdForOutput'), money(cost.standard_for_output)],
    [pT('actual'), money(cost.actual)],
    [pT('unitCost'), money(cost.unit_cost)],
    [pT('priceVar'), `${money(cost.price)}${word(cost.price)}`, cost.price],
    [pT('usageVar'), `${money(cost.usage)}${word(cost.usage)}`, cost.usage],
    [pT('yieldVar'), cost.closed ? `${money(cost.yield)}${word(cost.yield)}` : pT('whenClosed'), cost.yield],
    [pT('conversionVar'), `${money(cost.conversion)}${word(cost.conversion)}`, cost.conversion],
    [pT('byProductCredit'), money(-cost.by_products)],
  ];
  return (
    <section className={styles.detail} aria-label={`${pT('costing')} ${cost.order.number}`}>
      <h3 className={styles.detailTitle}>{cost.order.number} · {name(cost.order.item_id)}</h3>
      <div className={mfg.summary}>
        {cells.map(([k, v, n]) => <div key={k} className={mfg.cell}><span>{k}</span><strong className={n === undefined ? undefined : tone(n)}>{v}</strong></div>)}
      </div>
      <div className={mfg.wrap}>
        <table className={mfg.grid}>
          <thead>
            <tr>
              <th>{pT('material')}</th><th className={mfg.num}>{pT('stdRate')}</th><th className={mfg.num}>{pT('stdQty')}</th><th className={mfg.num}>{pT('actualQty')}</th>
              <th className={mfg.num}>{pT('actualRate')}</th><th className={mfg.num}>{pT('priceVar')}</th><th className={mfg.num}>{pT('usageVar')}</th><th className={mfg.num}>{pT('yieldVar')}</th>
            </tr>
          </thead>
          <tbody>
            {cost.components.map((c) => (
              <tr key={c.item_id}>
                <td>{name(c.item_id)}{c.no_standard ? ` · ${pT('noStandard')}` : ''}</td>
                <td className={mfg.num}>{money(c.std_rate)}</td>
                <td className={mfg.num}>{qtyText(c.std_qty_for_output)}</td>
                <td className={mfg.num}>{qtyText(c.actual_qty)}</td>
                <td className={mfg.num}>{money(c.actual_rate)}</td>
                <td className={cn(mfg.num, tone(c.price))}>{money(c.price)}</td>
                <td className={cn(mfg.num, tone(c.usage))}>{money(c.usage)}</td>
                <td className={cn(mfg.num, tone(c.yield))}>{money(c.yield)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={mfg.muted}>{pT('varianceNote')}{cost.written_off ? ` ${pT('writtenOffNote', { amount: money(cost.written_off) })}` : ''}</p>
    </section>
  );
}
