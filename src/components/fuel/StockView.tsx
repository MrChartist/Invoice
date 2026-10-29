/**
 * R21-C3 / C4 stock register: per tank per day opening dip + receipts − (meter − test) = book; next morning's dip =
 * physical; variation, month / year to date; the MDG band as a hint with its numbers; "Post loss / gain for the month"
 * (one Physical Stock voucher per tank per month, class "Normal loss — evaporation / handling", FU18) and the stock
 * summary's figure for the tank beside it. Licences & due dates (`fuel_settings.licences`, nozzles' W&M stamping, tank
 * calibration; days left, flagged within the alert days — the bell was cut at the C cap, PRD §3 cut 1).
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { fcT } from '../../i18n/areas/fuel-r21c';
import { localDayOf } from '../../lib/dates';
import { getTable } from '../../lib/storage';
import { readLogs } from '../../lib/fuel/fu-dips';
import { dueList, mdgBand, monthClose, registerRows } from '../../lib/fuel/fu-register';
import { fuItems, fuTanks, postedFor, postVariation, stockBook } from '../../lib/fuel/fu-stock-io';
import { readNozzles } from '../../lib/fuel/fu-tank';
import { readFuelSettings, saveFuelSettings } from '../../lib/fuel/fu-settings';
import type { FuelShift, FuLicence } from '../../types/fuel-r21';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Row, Sel } from './fu-ui';
import type { Done } from './FuelDesk';

const KINDS = ['peso', 'wm_du', 'fire', 'calibration', 'dealership', 'other'] as const;
const f = (v: number | null) => (v == null ? '-' : v.toFixed(3).replace(/\.?0+$/, ''));

export default function StockView({ onDone }: { onDone: Done }) {
  useT();
  const today = localDayOf(new Date());
  const [k, setK] = useState(0);
  const tanks = fuTanks();
  const [d, setD] = useState<Record<string, string>>({ tank: tanks[0]?.id ?? '', month: today.slice(0, 7), kind: 'peso' });
  const s = readFuelSettings();
  const tank = tanks.find((t) => t.id === d.tank);
  const nozzles = readNozzles();
  const end = `${d.month}-31` < today ? `${d.month}-31` : today;
  const rows = tank ? registerRows(tank.id, new Set(nozzles.filter((z) => z.tank_id === tank.id).map((z) => z.id)), readLogs(), getTable<FuelShift>('fuel_shifts'), end).filter((r) => r.day.startsWith(d.month)) : [];
  const close = monthClose(rows, d.month);
  const product = fuItems().find((i) => i.id === tank?.fu?.product_item_id);
  const band = close && mdgBand(product?.fu?.product, close, s.annual_kl);
  const posted = tank && postedFor(tank.id, d.month);
  const act = (fn: () => string) => { try { onDone(fn()); setK(k + 1); } catch (e) { onDone((e as Error).message, true); } };
  return (
    <div data-fuel-stock key={k}>
      <Row>
        <Sel d={d} set={setD} k="tank" label={fuT('tank')} opts={tanks.map((t) => [t.id, t.name])} />
        <In d={d} set={setD} k="month" label={fcT('month')} type="month" />
      </Row>
      {!rows.length ? <p className={controls.hint}>{fcT('noRows')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{fuT('date')}</th><th>{fcT('open')}</th><th>{fcT('receipts')}</th><th>{fcT('sales')}</th><th>{fuT('test')}</th><th>{fcT('book')}</th><th>{fcT('physical')}</th><th>{fuT('variation')}</th><th>{fcT('pct')}</th><th>{fcT('mtd')}</th><th>{fcT('ytd')}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.day} data-fu-reg={r.day}><td>{r.day}</td><td>{f(r.opening)}</td><td>{f(r.receipts)}</td><td>{f(r.sales)}</td><td>{f(r.test)}</td><td>{f(r.book)}</td><td>{f(r.physical)}</td><td>{f(r.variation)}</td><td>{r.pct ?? ''}</td><td>{f(r.mtd)}</td><td>{f(r.ytd)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {band && close && <p className={controls.hint} data-fu-band>{fcT('band', { r: band.rate, s: f(close.mtdSales), e: f(band.evap), b: f(band.band) })} {fcT(band.outside ? 'out' : 'in', { v: f(close.mtd) })}</p>}
      {tank && close && (
        <Row>
          <button type="button" className={controls.btnPrimary} onClick={() => act(() => fcT('posted', { n: postVariation(tank, d.month, close.day, close.physical!).number }))} data-fu-post>{fcT('post')}</button>
          <span className={controls.hint} data-fu-engine>{posted ? fcT('posted', { n: posted.number }) : ''} {fcT('engine', { q: f(stockBook(tank, close.day)) })}</span>
        </Row>
      )}
      <h3>{fcT('licH')}</h3>
      <Row>
        <Sel d={d} set={setD} k="kind" label={fuT('kind')} opts={KINDS.map((x) => [x, fcT(`lk.${x}`)])} />
        <In d={d} set={setD} k="ref" label={fcT('ref')} />
        <In d={d} set={setD} k="to" label={fcT('validTo')} type="date" />
        <button type="button" className={controls.btnPrimary} onClick={() => act(() => { if (!d.to) throw new Error(fcT('validTo')); saveFuelSettings({ licences: [...(s.licences ?? []), { kind: d.kind as FuLicence['kind'], ref: d.ref ?? '', valid_to: d.to }] }); return fuT('saved'); })} data-fu-add-licence>{fcT('addLic')}</button>
      </Row>
      <ul data-fu-dues>{dueList(today, { licences: s.licences ?? [], nozzles, tanks }).map((x) => <li key={x.k + x.name + x.till} className={x.soon ? controls.hint : undefined}>{x.soon ? '⚠ ' : ''}{x.k === 'lic' ? `${fcT(`lk.${x.kind ?? 'other'}`)} ${x.name}` : fcT(x.k, { n: x.name })} : {x.till} ({fcT('left', { n: x.left })}){x.i != null && <button type="button" className={controls.btnGhost} onClick={() => act(() => { saveFuelSettings({ licences: (s.licences ?? []).filter((_, j) => j !== x.i) }); return fuT('saved'); })}>{fuT('del')}</button>}</li>)}</ul>
    </div>
  );
}
