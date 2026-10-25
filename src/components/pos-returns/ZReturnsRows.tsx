import type { ZReport } from '../../lib/pos';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { returnsT } from '../../i18n/areas/extras';
import surface from '../../styles/surface.module.css';
import styles from '../pos/pos.module.css';

/** Z report rows for the day's returns (WP-9): credit notes, refunds by tender, exchange, net. */
export function ZReturnsRows({ z }: { z: ZReport }) {
  useT();
  const r = z.returns;
  if (!r?.count && !z.exchangeIn) return null;
  const row = (label: string, value: number, key?: string, strong = false) => (
    <tr className={strong ? styles.strong : undefined}>
      <th scope="row">{label}</th>
      <td className={surface.numeric} data-z={key}>{formatCurrency(value)}</td>
    </tr>
  );
  return (
    <>
      {z.exchangeIn ? row(returnsT('zExchangeIn'), z.exchangeIn, 'exchange-in') : null}
      {r.count ? (
        <>
          <tr><th scope="row">{returnsT('zReturns')}</th><td className={surface.numeric} data-z="returns">{r.count} · {r.numbers.join(', ')}</td></tr>
          {row(returnsT('zReturnsValue'), -r.value, 'returns-value')}
          {r.refunds.cash ? row(returnsT('zRefundCash'), -r.refunds.cash, 'refund-cash') : null}
          {r.refunds.upi ? row(returnsT('zRefundUpi'), -r.refunds.upi, 'refund-upi') : null}
          {r.refunds.card ? row(returnsT('zRefundCard'), -r.refunds.card, 'refund-card') : null}
          {r.exchanged ? row(returnsT('zExchanged'), r.exchanged) : null}
          {r.onAccount ? row(returnsT('zOnAccount'), r.onAccount) : null}
          {row(returnsT('zNetAfter'), z.netAfterReturns, 'net-after', true)}
        </>
      ) : null}
    </>
  );
}
