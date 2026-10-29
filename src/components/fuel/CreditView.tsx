/**
 * R21-D1 credit slips: the slip book (slip no. unique, the price in force fills the amount), vehicle limits per customer
 * (a warning, with the party credit limit from `credit-limit.ts`), and "Bill slips" — one Bill of Supply per customer
 * (+ a tax invoice for other items) with the vehicle-wise annexure, in one write. Undo = cancel the bills.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { dT } from '../../i18n/areas/fuel-r21d';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import type { FuelPrice } from '../../types/fuel-r21';
import { stockDb } from '../../lib/inventory';
import { localDayOf } from '../../lib/dates';
import { creditCheck } from '../../lib/credit-limit';
import { readSlips, removeSlip, saveSlip, unbilledSlips, vehicleWarning } from '../../lib/fuel/fu-slips';
import { priceAt } from '../../lib/fuel/fu-line';
import { billSlips } from '../../lib/fuel/fu-recv-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Row, Sel } from './fu-ui';
import type { Done } from './FuelDesk';

export default function CreditView({ onDone }: { onDone: Done }) {
  useT();
  const day = localDayOf(new Date());
  const [d, setD] = useState<Record<string, string>>({ date: day, through: day });
  const [n, setN] = useState(0);
  const clients = localDb.clients.getAll();
  const items = stockDb.items();
  const docs = localDb.invoices.getAll();
  const open = unbilledSlips(readSlips(), docs);
  const c = clients.find((x) => x.id === d.client);
  const name = (id: string, l: { id?: string; name: string }[]) => l.find((x) => x.id === id)?.name ?? '—';
  const act = (fn: () => string | void) => { try { const m = fn(); setN(n + 1); onDone(m || fuT('saved')); } catch (e) { onDone((e as Error).message, true); } };
  const p = d.item ? priceAt(getTable<FuelPrice>('fuel_prices'), d.item, d.date ?? day, '23:59') : null;
  const amount = d.amount || (p && d.litres ? (Number(d.litres) * p.rsp).toFixed(2) : '');
  const add = () => act(() => {
    const s = saveSlip({ slip_no: d.slip ?? '', date: d.date ?? '', client_id: d.client ?? '', vehicle_no: d.vehicle ?? '', driver: d.driver || undefined, item_id: d.item ?? '', litres: Number(d.litres), amount: Number(amount) });
    const owed = open.filter((x) => x.client_id === s.client_id).reduce((t, x) => t + x.amount, s.amount);
    setD({ ...d, slip: '', litres: '', amount: '' });
    return [vehicleWarning(s, c, readSlips()), ...creditCheck({ client: c, draft: { total: owed }, invoices: docs, today: day }).warnings].filter(Boolean).join(' ');
  });
  const addVehicle = () => act(() => {
    if (!c || !d.vno) throw new Error(dT('vehicle'));
    localDb.clients.upsert({ ...c, fu: { ...c.fu, vehicles: [...(c.fu?.vehicles ?? []).filter((v) => v.no !== d.vno.toUpperCase()), { no: d.vno.toUpperCase(), ...(Number(d.ll) > 0 ? { limit_l: Number(d.ll) } : {}), ...(Number(d.la) > 0 ? { limit_amount: Number(d.la) } : {}) }] } });
  });
  return (
    <div data-fuel-credit key={n}>
      <Row>
        <In d={d} set={setD} k="slip" label={dT('slipNo')} w="6rem" />
        <In d={d} set={setD} k="date" label={dT('day')} type="date" />
        <Sel d={d} set={setD} k="client" label={dT('customer')} opts={clients.map((x) => [x.id ?? '', x.name])} />
        <In d={d} set={setD} k="vehicle" label={dT('vehicle')} w="7rem" />
        <In d={d} set={setD} k="driver" label={dT('driver')} w="7rem" />
        <Sel d={d} set={setD} k="item" label={fuT('product')} opts={items.map((i) => [i.id, i.name])} />
        <In d={d} set={setD} k="litres" label={fuT('litres')} type="number" w="6rem" />
        <label className={controls.field}><span className={controls.label}>{dT('amount')}</span><input className={controls.input} style={{ width: '7rem' }} type="number" step="any" value={amount} onChange={(e) => setD({ ...d, amount: e.target.value })} data-fu-field="amount" /></label>
        <button type="button" className={controls.btnPrimary} onClick={add} data-fu-add-slip>{dT('addSlip')}</button>
      </Row>
      {c && (
        <Row>
          <span className={controls.hint}>{(c.fu?.vehicles ?? []).map((v) => `${v.no}${v.limit_l ? ` ≤ ${v.limit_l} L` : ''}${v.limit_amount ? ` ≤ ₹${v.limit_amount}` : ''}`).join(' · ')}</span>
          <In d={d} set={setD} k="vno" label={dT('vehicle')} w="7rem" />
          <In d={d} set={setD} k="ll" label={dT('limitL')} type="number" w="6rem" />
          <In d={d} set={setD} k="la" label={dT('limitA')} type="number" w="6rem" />
          <button type="button" className={controls.btnOutline} onClick={addVehicle}>{dT('addVehicle')}</button>
        </Row>
      )}
      <Row>
        <In d={d} set={setD} k="through" label={dT('through')} type="date" />
        <button type="button" className={controls.btnPrimary} onClick={() => act(() => dT('billed', { n: billSlips(d.through ?? day).length }))} data-fu-bill-slips>{dT('bill')}</button>
        <span className={controls.hint}>{dT('unbilled', { n: open.length, a: open.reduce((t, x) => t + x.amount, 0).toFixed(2) })}</span>
      </Row>
      {open.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{dT('slipNo')}</th><th>{dT('day')}</th><th>{dT('customer')}</th><th>{dT('vehicle')}</th><th>{fuT('product')}</th><th>{fuT('litres')}</th><th>{dT('amount')}</th><th /></tr></thead>
            <tbody>{open.slice(-50).reverse().map((s) => <tr key={s.id}><td>{s.slip_no}</td><td>{s.date}</td><td>{name(s.client_id, clients as { id?: string; name: string }[])}</td><td>{s.vehicle_no}</td><td>{name(s.item_id, items)}</td><td>{s.litres.toFixed(3)}</td><td>{s.amount.toFixed(2)}</td><td><button type="button" className={controls.btnOutline} onClick={() => act(() => removeSlip(s.id))}>{fuT('del')}</button></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
