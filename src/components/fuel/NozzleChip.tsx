/**
 * R21-A3 POS fuel strip (mounted by the POS only with the `fuel` pack on, lazily). For each bill line whose item is a
 * pump product (`StockItem.fu`): the nozzle chip (that product's nozzles; one nozzle is picked for you) and a ₹ box —
 * "₹500" sells 500 / price litres (three decimals; the amount stays exact, FU8), else the typed litres at the price in
 * force at this moment (`priceAt`). Non-GST products take the R10 non-GST column. Reports the `fu` snapshot and the
 * document patch (Bill of Supply / Rule 46A title) and the errors that stop the save: no price in force, or a mixed bill
 * to a GSTIN buyer (bill the two parts separately, FU4). No POS layout change for anyone else.
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { getTable } from '../../lib/storage';
import type { StockItem } from '../../lib/inventory';
import { fuDocPatch, fuelLine, nozzleLabel, priceAt, tankOf } from '../../lib/fuel/fu-line';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { FuelNozzle, FuelPrice, FuLine } from '../../types/fuel-r21';
import controls from '../../styles/controls.module.css';

export interface PosFuel { patch: Partial<InvoiceRecord>; errors: string[] }
const sig = (l: InvoiceItem) => `${l.quantity}|${l.rate}|${l.tax_rate}|${l.sv?.exempt ?? ''}|${l.godown_id ?? ''}`;

export default function NozzleChip({ record, setItems, onChange }: { record: InvoiceRecord; setItems: Dispatch<SetStateAction<InvoiceItem[]>>; onChange: (v: PosFuel | null) => void }) {
  useT();
  const [items, nozzles, prices] = useMemo(() => [getTable<StockItem>('stock_items').filter((i) => i.fu), getTable<FuelNozzle>('fuel_nozzles').filter((n) => n.active), getTable<FuelPrice>('fuel_prices')] as const, []);
  const [pick, setPick] = useState<Record<string, { nz?: string; amt?: string }>>({});
  const day = record.issue_date;
  const now = new Date().toTimeString().slice(0, 5);
  const errors: string[] = [];
  const lines: Record<string, FuLine> = {};
  const want = new Map<string, InvoiceItem>();
  const rows = record.items.flatMap((l) => {
    const it = items.find((i) => i.name.trim().toLowerCase() === l.name.trim().toLowerCase());
    if (!it?.fu) return [];
    const price = priceAt(prices, it.id, day, now);
    const noz = nozzles.filter((n) => n.item_id === it.id);
    const p = pick[l.id] ?? {};
    if (!price) errors.push(fuT('noPrice', { name: it.name, at: `${day} ${now}` }));
    else {
      const out = fuelLine(l, { product: it.fu.product, unit: it.fu.unit, price, nozzle: noz.find((n) => n.id === (p.nz ?? (noz.length === 1 ? noz[0].id : ''))), amount: Number(p.amt) || undefined, day, tank: tankOf(it.id, undefined, noz) });
      lines[l.id] = out.fu;
      want.set(l.id, out.line);
    }
    return [{ l, it, noz, p }];
  });
  const { patch, split } = fuDocPatch(record, lines);
  if (split) errors.push(fuT('split'));
  const stale = record.items.some((l) => want.has(l.id) && sig(want.get(l.id)!) !== sig(l));
  useEffect(() => {
    if (stale) setItems((cur) => cur.map((l) => want.get(l.id) ?? l));
  });
  const key = JSON.stringify([patch, errors]);
  useEffect(() => {
    onChange(Object.keys(lines).length || errors.length ? { patch, errors } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!rows.length) return null;
  const set = (id: string, v: { nz?: string; amt?: string }) => setPick({ ...pick, [id]: { ...pick[id], ...v } });
  return (
    <div data-fu-pos>
      {rows.map(({ l, it, noz, p }) => (
        <div key={l.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <strong>{it.name}</strong>
          <select className={controls.select} aria-label={fuT('nozzle')} value={lines[l.id]?.nozzle_id ?? ''} onChange={(e) => set(l.id, { nz: e.target.value })} data-fu-nozzle>
            <option value="">{fuT('nozzle')}</option>
            {noz.map((n) => <option key={n.id} value={n.id}>{nozzleLabel(n)}</option>)}
          </select>
          <input className={controls.input} style={{ width: '6rem' }} type="number" min={0} step="any" placeholder={fuT('amount')} aria-label={fuT('amount')} value={p.amt ?? ''} onChange={(e) => set(l.id, { amt: e.target.value })} data-fu-amount />
          {lines[l.id] && <span className={controls.hint} data-fu-litres>{fuT('line', { l: lines[l.id].litres.toFixed(3), u: lines[l.id].unit === 'KG' ? 'kg' : 'L', rsp: lines[l.id].rsp ?? '', at: lines[l.id].at ?? '' })}</span>}
        </div>
      ))}
      {errors.map((m) => <p key={m} className={controls.hint} role="alert">{m}</p>)}
    </div>
  );
}
