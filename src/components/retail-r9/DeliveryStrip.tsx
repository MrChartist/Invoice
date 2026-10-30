/**
 * RT-A3 / A2 / A4 lazy strips (one chunk):
 *  - default: the editor summary's "Home delivery" strip (store-connected; shown with Settings → Items → Retail checks
 *    "Home delivery" on, or on a document that already carries a delivery);
 *  - `PosRetailStrip`: the POS customer card's retail row — the live MRP guard message, the delivery switch and fields,
 *    and "Add to short book" for what the search did not find.
 * The delivery snapshot is a normal record field (`delivery`); a charge is a normal line at the goods' rate (G5 / RT6).
 */
import { useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { useT } from '../../i18n';
import { rtaT } from '../../i18n/areas/retail-r9a';
import { generateId, getTable } from '../../lib/storage';
import { num, round2 } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { MRP_TAG, liveMrpIssues } from '../../lib/stock-tracking';
import { RT_TABLES } from '../../lib/retail/rt-shared';
import { addShortBook } from '../../lib/retail/rt-short-book';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { DeliveryInfo, DeliveryRider } from '../../types/retail-r9';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

const riders = (): DeliveryRider[] => getTable<DeliveryRider>(RT_TABLES.deliveryRiders).filter((r) => r?.active !== false);

/** The delivery charge as a normal line at the rate and HSN of the highest-value goods line. */
function chargeLine(items: readonly InvoiceItem[], charge: number): InvoiceItem | undefined {
  if (!(num(charge) > 0)) return undefined;
  const main = [...items].filter((i) => i.name.trim() && i.name !== 'Delivery charge').sort((a, b) => num(b.quantity) * num(b.rate) - num(a.quantity) * num(a.rate))[0];
  return { id: generateId(), name: 'Delivery charge', description: '', type: 'Service', hsn: main?.hsn ?? '', unit: 'OTH', quantity: 1, rate: round2(num(charge)), tax_rate: num(main?.tax_rate), discount_percent: 0, amount: round2(num(charge)) };
}

/** Controlled delivery fields (address, phone, slot, rider, charge, COD). */
export function DeliveryFields({ value, onChange, onCharge }: { value: DeliveryInfo; onChange: (d: DeliveryInfo) => void; onCharge?: (amount: number) => void }) {
  useT();
  const list = useMemo(() => riders(), []);
  const [charge, setCharge] = useState(value.charge ?? 0);
  const set = (p: Partial<DeliveryInfo>) => onChange({ ...value, ...p });
  return (
    <div className={controls.field} data-delivery-fields>
      <input className={controls.input} placeholder={rtaT('address')} aria-label={rtaT('address')} value={value.address} onChange={(e) => set({ address: e.target.value })} data-delivery-address />
      <div className={controls.row} style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        <input className={controls.input} inputMode="tel" placeholder={rtaT('phone')} aria-label={rtaT('phone')} value={value.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} />
        <input className={controls.input} placeholder={rtaT('slot')} aria-label={rtaT('slot')} value={value.slot ?? ''} onChange={(e) => set({ slot: e.target.value })} />
        <SelectField className={controls.select} aria-label={rtaT('rider')} value={value.rider_id ?? ''} onChange={(e) => set({ rider_id: e.target.value || undefined })} data-delivery-rider>
          <option value="">{list.length ? rtaT('rider') : rtaT('noRider')}</option>
          {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </SelectField>
      </div>
      <div className={controls.row} style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label className={controls.check}><input type="checkbox" checked={!!value.cod} onChange={(e) => set({ cod: e.target.checked || undefined })} data-delivery-cod /> {rtaT('cod')}</label>
        {onCharge && (
          <>
            <NumberInput className={controls.input} style={{ maxWidth: 110 }} value={charge} onChange={setCharge} aria-label={rtaT('charge')} placeholder={rtaT('charge')} />
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} disabled={!(charge > 0)} onClick={() => { set({ charge }); onCharge(charge); }}>+ {rtaT('charge')}</button>
          </>
        )}
      </div>
    </div>
  );
}

/** Editor summary strip (sales documents). */
export default function DeliveryStrip() {
  useT();
  const s = useInvoiceStore(useShallow((st) => pick(st, ['delivery', 'items', 'patch', 'doc_type', 'client'])));
  if (s.doc_type === 'CREDIT_NOTE' || s.doc_type === 'DEBIT_NOTE') return null;
  const on = !!s.delivery;
  return (
    <div data-delivery-strip>
      <label className={controls.check}>
        <input type="checkbox" checked={on} onChange={(e) => s.patch({ delivery: e.target.checked ? { address: s.client?.address ?? '', phone: s.client?.phone, status: 'new' } : undefined })} />
        <Truck size={14} aria-hidden="true" /> {rtaT('deliveryOn')}
      </label>
      {on && s.delivery && (
        <DeliveryFields
          value={s.delivery}
          onChange={(d) => s.patch({ delivery: d })}
          onCharge={(amount) => {
            const line = chargeLine(s.items, amount);
            if (line) s.patch({ items: [...s.items.filter((i) => i.name !== 'Delivery charge'), line] });
          }}
        />
      )}
    </div>
  );
}

/** POS retail row: live MRP check, the delivery switch, and the short book for what the search did not find. */
export function PosRetailStrip({ record, query, delivery, onDelivery, onAddLine, deliveryOn, shortBookOn, notify }: {
  record: InvoiceRecord;
  query: string;
  delivery: DeliveryInfo | null;
  onDelivery: (d: DeliveryInfo | null) => void;
  onAddLine: (line: InvoiceItem) => void;
  deliveryOn: boolean;
  shortBookOn: boolean;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
}) {
  useT();
  const mrp = useMemo(
    () => (record.items.length ? liveMrpIssues({ doc_type: record.doc_type, status: 'Sent', issue_date: record.issue_date, items: record.items, discount_type: record.discount_type, discount_rate: record.discount_rate, price_includes_tax: record.price_includes_tax }) : null),
    [record],
  );
  const msgs = mrp ? [...mrp.errors, ...mrp.confirm, ...mrp.warnings].map((m) => m.replace(MRP_TAG, '').trim()) : [];
  const q = query.trim();
  const addShort = () => {
    try {
      const row = addShortBook({ date: todayInput(), name: q, customer: record.client?.name, phone: record.client?.phone });
      notify(rtaT('sbAdded', { name: row.name }), 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  return (
    <div data-pos-retail>
      {msgs.length > 0 && <ul role="status" data-pos-mrp>{msgs.map((m) => <li key={m}>{m}</li>)}</ul>}
      {shortBookOn && q.length > 1 && (
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={addShort} data-pos-shortbook>{rtaT('sbFromSearch', { q })}</button>
      )}
      {deliveryOn && (
        <>
          <label className={controls.check}>
            <input type="checkbox" checked={!!delivery} onChange={(e) => onDelivery(e.target.checked ? { address: record.client?.address ?? '', phone: record.client?.phone, status: 'packed' } : null)} data-pos-delivery />
            <Truck size={14} aria-hidden="true" /> {rtaT('deliveryOn')}
          </label>
          {delivery && (
            <DeliveryFields
              value={delivery}
              onChange={onDelivery}
              onCharge={(amount) => {
                const line = chargeLine(record.items, amount);
                if (line) onAddLine(line);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
