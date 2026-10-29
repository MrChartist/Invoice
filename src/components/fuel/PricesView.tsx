/**
 * R21-A3 fuel prices: the board (price in force now per pump product), "Add price" from a date and time (with the
 * typed excise / VAT per litre of the oil company's build-up, for D's Rule 42 working) and "Copy yesterday". History
 * newest first. A sale takes the price in force at its moment (`priceAt`), snapshotted on the bill.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { stockDb } from '../../lib/inventory';
import { localDayOf, shiftDay } from '../../lib/dates';
import { copyYesterday, readPrices, savePrice } from '../../lib/fuel/fu-price';
import { priceAt } from '../../lib/fuel/fu-line';
import { readFuelSettings } from '../../lib/fuel/fu-settings';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Row, Sel } from './fu-ui';
import type { Done } from './FuelDesk';

export default function PricesView({ onDone }: { onDone: Done }) {
  useT();
  const day = localDayOf(new Date());
  const time = readFuelSettings().price_time ?? '06:00';
  const [d, setD] = useState<Record<string, string>>({ date: day, time });
  const [n, setN] = useState(0);
  const items = stockDb.items().filter((i) => i.fu);
  const rows = readPrices();
  const now = new Date().toTimeString().slice(0, 5);
  const act = (fn: () => unknown) => { try { const r = fn(); setN(n + 1); onDone(typeof r === 'number' ? fuT('copied', { n: r }) : fuT('saved')); } catch (e) { onDone((e as Error).message, true); } };
  const name = (id: string) => items.find((i) => i.id === id)?.name ?? '—';
  const num = (k: string) => (d[k] ? Number(d[k]) : undefined);
  return (
    <div data-fuel-prices key={n}>
      <Row>
        {items.map((i) => { const p = priceAt(rows, i.id, day, now); return <span key={i.id} className={controls.hint} data-fu-board>{i.name}: {p ? `₹${p.rsp}` : '—'}</span>; })}
        <button type="button" className={controls.btnOutline} onClick={() => act(() => copyYesterday(items.map((i) => i.id), day, shiftDay(day, -1), time))}>{fuT('copy')}</button>
      </Row>
      <Row>
        <Sel d={d} set={setD} k="item" label={fuT('product')} opts={items.map((i) => [i.id, i.name])} />
        <In d={d} set={setD} k="date" label={fuT('date')} type="date" />
        <In d={d} set={setD} k="time" label={fuT('time')} w="5rem" />
        <In d={d} set={setD} k="rsp" label={fuT('price')} type="number" w="6rem" />
        <In d={d} set={setD} k="excise" label={fuT('excise')} type="number" w="6rem" />
        <In d={d} set={setD} k="vat" label={fuT('vat')} type="number" w="6rem" />
        <button type="button" className={controls.btnPrimary} onClick={() => act(() => savePrice({ item_id: d.item ?? '', date: d.date ?? '', time: d.time ?? '', rsp: Number(d.rsp), ...(d.excise || d.vat ? { build: { excise: num('excise'), vat: num('vat') } } : {}) }))} data-fu-add-price>{fuT('addPrice')}</button>
      </Row>
      {rows.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{fuT('product')}</th><th>{fuT('date')}</th><th>{fuT('time')}</th><th>{fuT('price')}</th><th>{fuT('excise')}</th><th>{fuT('vat')}</th></tr></thead>
            <tbody>{[...rows].sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0, 30).map((p) => <tr key={p.id}><td>{name(p.item_id)}</td><td>{p.date}</td><td>{p.time}</td><td>{p.rsp}</td><td>{p.build?.excise ?? ''}</td><td>{p.build?.vat ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
