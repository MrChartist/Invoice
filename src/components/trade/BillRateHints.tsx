/**
 * TR-A1 bill modal hints (lazy; trade discounts or a trading pack on): per line, the supplier's special rate
 * (`party_rates`, purchase side) and the last rate this item was bought at from this supplier. Hints only — a tap
 * uses one; a typed rate is never changed.
 */
import { useMemo } from 'react';
import type { PurchaseLine, Vendor } from '../../types/purchases';
import { peekTable } from '../../lib/storage';
import { lastPurchaseRate, loadPartyRates, partyRateFor } from '../../lib/trade/tr-party-rates';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { aT } from '../../i18n/areas/trade-r8a';
import controls from '../../styles/controls.module.css';
import own from './trade.module.css';

export default function BillRateHints({ lines, vendor, date, onRate }: { lines: readonly PurchaseLine[]; vendor: Vendor; date: string; onRate: (lineId: string, rate: number) => void }) {
  useT();
  const purchases = useMemo(() => peekTable('purchases'), []);
  const rates = useMemo(() => loadPartyRates(), []);
  const hints = lines
    .filter((l) => l.name?.trim())
    .map((l) => ({ l, pr: partyRateFor(rates, 'purchase', vendor, { name: l.name }, date), last: lastPurchaseRate(purchases, vendor, l.name) }))
    .filter((h) => h.pr?.rate || h.last);
  if (!hints.length) return null;
  return (
    <div className={own.stack} data-bill-rate-hints>
      {hints.map(({ l, pr, last }) => (
        <div key={l.id} className={own.inline}>
          <strong>{l.name}</strong>
          {pr?.rate ? <button type="button" className={controls.btnGhost} onClick={() => onRate(l.id, pr.rate!)}>{aT('partyRate')}: {formatCurrency(pr.rate)}</button> : null}
          {last && <button type="button" className={controls.btnGhost} onClick={() => onRate(l.id, last.rate)} data-last-purchase>{aT('lastBought', { rate: formatCurrency(last.rate), date: last.date, no: last.number })}</button>}
        </div>
      ))}
    </div>
  );
}
