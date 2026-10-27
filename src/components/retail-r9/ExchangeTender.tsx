/**
 * RT-D3 (and RT-E3) POS tender row "Exchange": settles part of the bill by a URD voucher of the same customer — an
 * old device bought back, or (RT-E) old gold. Generic over `openVouchers` (`used_goods` or `old_metal`), so RT-E only
 * records its voucher; the receipt (`applyExchange`) is written after the bill is saved. Part of the devices desk chunk.
 */
import { RefreshCw } from 'lucide-react';
import type { PurchaseRecord } from '../../types/purchases';
import { rtdT } from '../../i18n/areas/retail-r9d';
import { formatCurrency } from '../../lib/utils';
import controls from '../../styles/controls.module.css';

export interface ExTender {
  purchaseId: string;
  amount: number;
  party: string;
}

export default function ExchangeTender({ value, vouchers, onChange }: { value: ExTender | null; vouchers: readonly { purchase: PurchaseRecord; left: number }[]; onChange: (v: ExTender | null) => void }) {
  if (!vouchers.length && !value) return null;
  return (
    <label className={controls.field} data-pos-exchange>
      <span className={controls.label}><RefreshCw size={14} aria-hidden="true" /> {rtdT('exTender')}</span>
      <select className={controls.select} value={value?.purchaseId ?? ''} onChange={(e) => {
        const v = vouchers.find((x) => x.purchase.id === e.target.value);
        onChange(v ? { purchaseId: v.purchase.id, amount: v.left, party: v.purchase.vendor_name } : null);
      }} data-pos-exchange-pick>
        <option value="">—</option>
        {vouchers.map((x) => <option key={x.purchase.id} value={x.purchase.id}>{`${x.purchase.bill_number} · ${x.purchase.vendor_name} · ${x.purchase.used_goods?.model ?? x.purchase.old_metal?.metal ?? ''} · ${formatCurrency(x.left)}`}</option>)}
      </select>
    </label>
  );
}
