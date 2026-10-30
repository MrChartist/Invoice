/**
 * TR-C1: the editor line's agency lot picker (agency pack only). Picking a lot makes the line an agency line: it names
 * the arrival (`arrival_id`), leaves from the consignment godown, takes the lot's item / unit / HSN when blank, and
 * marks the document `agency: true`. The line is the principal's goods: our stock engine never counts it.
 */
import { useMemo } from 'react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { getTable } from '../../lib/storage';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { agencySales, loadArrivals, lotBalances, lotShortage } from '../../lib/trade/tr-arrivals';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import controls from '../../styles/controls.module.css';

export default function LotPicker({ item, index }: { item: InvoiceItem; index: number }) {
  useT();
  const docId = useInvoiceStore((s) => s.id);
  const { lots, others } = useMemo(() => {
    const sales = agencySales(getTable<InvoiceRecord>('invoices').filter((i) => i.id !== docId));
    return { lots: lotBalances(loadArrivals().filter((a) => a.status !== 'cancelled'), sales), others: sales };
  }, [docId]);
  if (!lots.length && !item.arrival_id) return null;
  const pick = (id: string) => {
    const st = useInvoiceStore.getState();
    const lot = lots.find((l) => l.arrival.id === id)?.arrival;
    if (!lot) {
      st.patchItem(item.id, { arrival_id: undefined, godown_id: undefined });
    } else {
      st.patchItem(item.id, {
        arrival_id: lot.id,
        godown_id: lot.godown_id,
        ...(item.name.trim() ? {} : { name: lot.item_name }),
        ...(item.unit ? {} : { unit: lot.unit }),
        ...(item.hsn || !lot.hsn ? {} : { hsn: lot.hsn }),
      });
    }
    useInvoiceStore.setState({ agency: useInvoiceStore.getState().items.some((l) => l.arrival_id) || undefined });
  };
  const lot = lots.find((l) => l.arrival.id === item.arrival_id)?.arrival;
  const short = item.arrival_id ? lotShortage(lot, others, Number(item.quantity) || 0) : '';
  return (
    <div>
      <select className={controls.ghost} value={item.arrival_id ?? ''} onChange={(e) => pick(e.target.value)} aria-label={`${trT('lot')} ${index + 1}`} data-lot-picker={index}>
        <option value="">{trT('lot')}: -</option>
        {lots.filter((l) => l.balance > 0 || l.arrival.id === item.arrival_id).map((l) => (
          <option key={l.arrival.id} value={l.arrival.id}>{`${l.arrival.lot_no} · ${l.arrival.principal_name} · ${l.arrival.item_name} (${l.balance} ${l.arrival.unit})`}</option>
        ))}
      </select>
      {short && <small role="alert">{short}</small>}
    </div>
  );
}
