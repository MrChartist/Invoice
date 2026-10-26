/**
 * TR-B2 bill charges in the editor summary (lazy; commodity / agency pack), with the TR-B3 broker picker and the
 * TR-B1 weight slip. Charges are document lines flagged `charge_head_id`, recomputed whenever the goods lines change
 * (`useChargeLines`, shared with the bill modal). A new document starts with the heads marked "add automatically".
 */
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../../i18n';
import { tbT } from '../../i18n/areas/trade-r8b';
import { generateId, getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { InvoiceItem } from '../../types/invoice';
import { printWeightSlip, useChargeLines } from './tr-b-editor';
import BrokerPicker from './BrokerPicker';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

export function ChargeChips({ heads, on, toggle }: ReturnType<typeof useChargeLines>) {
  if (!heads.length) return <p className={controls.hint}>{tbT('noHeads')}</p>;
  return (
    <div className={own.row} data-charges>
      <span className={controls.label}>{tbT('charges')}</span>
      {heads.map((h) => (
        <label key={h.id} className={controls.check}>
          <input type="checkbox" checked={on.has(h.id)} onChange={() => toggle(h.id)} data-charge={h.name} /> {h.name}
        </label>
      ))}
    </div>
  );
}

const SALES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'QUOTATION', 'PROFORMA', 'SALES_ORDER', 'DELIVERY_CHALLAN']);

export default function ChargesStrip() {
  useT();
  const s = useInvoiceStore(useShallow((st) => ({ items: st.items, doc_type: st.doc_type, broker_id: st.broker_id, client: st.client, number: st.invoice_number, patch: st.patch })));
  const [isNew] = useState(() => { const id = useInvoiceStore.getState().id; return !getTable<{ id: string }>('invoices').some((i) => i?.id === id); });
  const ch = useChargeLines<InvoiceItem>(
    s.items,
    'sale',
    (items) => s.patch({ items }),
    (c, prev) => ({ ...(prev ?? { id: generateId(), discount_percent: 0 }), ...c, type: c.tax_rate && c.hsn.startsWith('99') ? 'Service' : 'Goods', amount: c.rate }) as InvoiceItem,
    isNew,
  );
  // A party's default broker fills an empty broker when the party is picked.
  const clientId = s.client?.id;
  useEffect(() => {
    if (!clientId || useInvoiceStore.getState().broker_id) return;
    const b = localDb.clients.getById(clientId)?.broker_id;
    if (b) s.patch({ broker_id: b });
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!SALES.has(s.doc_type)) return null;
  return (
    <div className={own.stack} data-r8b-summary>
      {s.doc_type !== 'DELIVERY_CHALLAN' && <ChargeChips {...ch} />}
      <BrokerPicker
        value={s.broker_id}
        onChange={(broker_id) => s.patch({ broker_id })}
        onRemember={clientId ? (b) => { const c = localDb.clients.getById(clientId); if (c) localDb.clients.upsert({ ...c, broker_id: b }); } : undefined}
      />
      {s.items.some((l) => l.wt) && (
        <button type="button" className={controls.btnOutline} onClick={() => printWeightSlip(s.number || '', s.client?.name ?? '', s.items)} data-weight-slip>{tbT('slip')}</button>
      )}
    </div>
  );
}
