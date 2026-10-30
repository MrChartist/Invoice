/**
 * R21-C1 / C2 dips & density: the morning dip per tank (litres from the chart; water dip shown and deducted unless the
 * chart is product-only, FU16), the morning density at 15 °C per tank or nozzle, the tank-lorry receipt against the OMC
 * bill (one dip pair and one invoice row per receipt — compartments cut at the C cap; invoice vs observed density ± 3.0 kg/m³, short receipt → a debit-note suggestion, never posted),
 * the morning checklist (missing items listed, never a block) and the density register (MDG Annexure 1 columns).
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { fcT } from '../../i18n/areas/fuel-r21c';
import { localDayOf } from '../../lib/dates';
import { getTable } from '../../lib/storage';
import { morningChecklist, readLogs, saveLog } from '../../lib/fuel/fu-dips';
import { debitFor, densityTol, receiptCheck } from '../../lib/fuel/fu-receipt';
import { fuItems, fuTanks, omcBills } from '../../lib/fuel/fu-stock-io';
import { readNozzles } from '../../lib/fuel/fu-tank';
import { nozzleLabel } from '../../lib/fuel/fu-line';
import { readFuelSettings } from '../../lib/fuel/fu-settings';
import type { FuelShift, FuelTankLog } from '../../types/fuel-r21';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Row, Sel } from './fu-ui';
import type { Done } from './FuelDesk';

type C = Record<string, string>;
const n = (s?: string) => (s ? Number(s) : undefined);

export default function DipsView({ onDone }: { onDone: Done }) {
  useT();
  const day = localDayOf(new Date());
  const [k, setK] = useState(0);
  const [d, setD] = useState<C>({ date: day });
  const tanks = fuTanks();
  const items = fuItems();
  const nozzles = readNozzles();
  const logs = readLogs();
  const sub = readFuelSettings().dip_water !== 'show';
  const tol = densityTol(d.date || day);
  const tank = tanks.find((t) => t.id === d.tank);
  const item = items.find((i) => i.id === tank?.fu?.product_item_id);
  const bills = item ? omcBills(item).slice(0, 20) : [];
  const name = (id?: string) => items.find((i) => i.id === id)?.name ?? '-';
  const where = (l: FuelTankLog) => tanks.find((t) => t.id === l.tank_id)?.name ?? nozzles.filter((z) => z.id === l.nozzle_id).map(nozzleLabel)[0] ?? '-';
  const save = (input: Omit<FuelTankLog, 'id'>) => {
    try {
      const r = saveLog(input, tank, sub);
      const c = r.kind === 'receipt' ? receiptCheck(r, tol) : null;
      const bill = bills.find((b) => b.id === r.purchase_id);
      setK(k + 1);
      onDone([fuT('saved'), c && fcT('recv', { i: c.invoice_l, r: c.received_l ?? '-' }), c && debitFor(c.short_l, bill?.rate ?? 0) ? fcT('short', { l: c.short_l!, a: debitFor(c.short_l, bill!.rate) }) : '', c?.flags.length ? fcT('flag', { t: tol }) : ''].filter(Boolean).join(' '), !!c?.flags.length);
    } catch (e) { onDone((e as Error).message, true); }
  };
  const base = { date: d.date, ...(d.time ? { time: d.time } : {}), tank_id: d.tank };
  const miss = morningChecklist(d.date || day, { tanks, nozzles, logs, shifts: getTable<FuelShift>('fuel_shifts'), itemName: name, label: nozzleLabel });
  const reg = logs.filter((l) => l.kind === 'density' || l.compartments?.some((c) => c.observed_density)).sort((a, b) => `${b.date}${b.time ?? ''}`.localeCompare(`${a.date}${a.time ?? ''}`)).slice(0, 40);
  return (
    <div data-fuel-dips key={k}>
      <Row>
        <In d={d} set={setD} k="date" label={fuT('date')} type="date" />
        <In d={d} set={setD} k="time" label={fcT('time')} type="time" w="6rem" />
        <Sel d={d} set={setD} k="tank" label={fuT('tank')} opts={tanks.map((t) => [t.id, t.name])} />
      </Row>
      <Row>
        {tank?.fu?.chart.length === 0 ? <In d={d} set={setD} k="stock" label={fcT('stock')} type="number" /> : <><In d={d} set={setD} k="mm" label={fuT('dip')} type="number" w="6rem" /><In d={d} set={setD} k="water" label={fcT('water')} type="number" w="6rem" /></>}
        <button type="button" className={controls.btnPrimary} onClick={() => save({ ...base, kind: 'dip', mm: n(d.mm), water_mm: n(d.water), litres: n(d.stock) })} data-fu-add-dip>{fcT('addDip')}</button>
      </Row>
      <h3>{fcT('densH')}</h3>
      <Row>
        <Sel d={d} set={setD} k="noz" label={fuT('nozzle')} opts={nozzles.map((z) => [z.id, nozzleLabel(z)])} />
        <In d={d} set={setD} k="dens" label="kg/m³" type="number" w="6rem" />
        <button type="button" className={controls.btnPrimary} onClick={() => save({ date: d.date, ...(d.time ? { time: d.time } : {}), kind: 'density', ...(d.noz ? { nozzle_id: d.noz } : { tank_id: d.tank }), density_15: n(d.dens) })} data-fu-add-density>{fcT('addDens')}</button>
      </Row>
      <h3>{fcT('rcpH')}</h3>
      <Row>
        <Sel d={d} set={setD} k="bill" label={fcT('bill')} opts={bills.map((b) => [b.id, `${b.number} · ${b.date} · ${b.litres} L`])} />
        <In d={d} set={setD} k="before" label={fcT('before')} type="number" w="6rem" />
        <In d={d} set={setD} k="after" label={fcT('after')} type="number" w="6rem" />
        <In d={d} set={setD} k="sold" label={fcT('sold')} type="number" w="6rem" />
      </Row>
      <Row>
        <In d={d} set={setD} k="l" label={fcT('invL')} type="number" w="6rem" />
        <In d={d} set={setD} k="id" label={fcT('invD')} type="number" w="6rem" />
        <In d={d} set={setD} k="od" label={fcT('obsD')} type="number" w="6rem" />
        <button type="button" className={controls.btnPrimary} onClick={() => save({ ...base, kind: 'receipt', ...(d.bill ? { purchase_id: d.bill } : {}), before_mm: n(d.before), after_mm: n(d.after), sold_l: n(d.sold), compartments: [{ invoice_l: Number(d.l) || 0, invoice_density: n(d.id), observed_density: n(d.od) }] })} data-fu-add-receipt>{fcT('addRcp')}</button>
      </Row>
      <h3>{fcT('chk')}</h3>
      <ul data-fu-checklist>{miss.length ? miss.map((m) => <li key={m.k + m.name}>{fcT(`m.${m.k}`, { n: m.name })}</li>) : <li>{fcT('chkOk')}</li>}</ul>
      {reg.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table} aria-label={fcT('densH')}>
            <thead><tr><th>{fuT('date')}</th><th>{fcT('time')}</th><th>{fcT('where')}</th><th>{fuT('product')}</th><th>{fcT('invD')}</th><th>{fcT('obsD')}</th><th>{fcT('diff')}</th></tr></thead>
            <tbody>{reg.flatMap((l) => (l.kind === 'density' ? [{ o: l.density_15 }] : (l.compartments ?? []).map((c) => ({ i: c.invoice_density, o: c.observed_density }))).map((r: { i?: number; o?: number }, j) => {
              const diff = r.i && r.o ? Math.round((r.o - r.i) * 10) / 10 : null;
              return <tr key={l.id + j} data-fu-flag={diff != null && Math.abs(diff) > tol ? '' : undefined}><td>{l.date}</td><td>{l.time ?? ''}</td><td>{where(l)}</td><td>{name(tanks.find((t) => t.id === l.tank_id)?.fu?.product_item_id ?? nozzles.find((z) => z.id === l.nozzle_id)?.item_id)}</td><td>{r.i ?? ''}</td><td>{r.o ?? ''}</td><td>{diff == null ? '' : `${diff}${Math.abs(diff) > tol ? ' ⚠' : ''}`}</td></tr>;
            }))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
