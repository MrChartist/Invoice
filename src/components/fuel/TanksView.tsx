/**
 * R21-A2 tanks and nozzles. "Add tank" creates an ordinary godown with `Godown.fu` (product, capacity, calibration chart
 * typed or pasted as "mm, litres" rows; CNG cascades have no chart) and marks the product's stock item (`StockItem.fu`).
 * Nozzles: DU no., nozzle no., tank (its product), opening totaliser, W&M stamping due. Deletes go to the recycle bin.
 * (Chart import from a CSV / XLSX file was cut at the R21-A cap, PRD §3 cut 2: paste the sheet's two columns instead.)
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { GODOWNS_TABLE, godownsDb } from '../../lib/godowns';
import { blankStockItem, stockDb } from '../../lib/inventory';
import { setTable } from '../../lib/storage';
import { chartIssue, parseChart, readNozzles, removeNozzle, saveNozzle } from '../../lib/fuel/fu-tank';
import { nozzleLabel } from '../../lib/fuel/fu-line';
import type { FuProduct } from '../../types/fuel-r21';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Row, Sel } from './fu-ui';
import type { Done } from './FuelDesk';

const KINDS: FuProduct[] = ['ms', 'hsd', 'ms_branded', 'hsd_branded', 'cng', 'auto_lpg'];

export default function TanksView({ onDone }: { onDone: Done }) {
  useT();
  const [n, setN] = useState(0);
  const [t, setT] = useState<Record<string, string>>({ kind: 'ms' });
  const [z, setZ] = useState<Record<string, string>>({});
  const tanks = godownsDb.stored().filter((g) => g.fu);
  const items = stockDb.items();
  const nozzles = readNozzles();
  const name = (id: string) => items.find((i) => i.id === id)?.name ?? '—';
  const act = (fn: () => void) => { try { fn(); setN(n + 1); onDone(fuT('saved')); } catch (e) { onDone((e as Error).message, true); } };
  const addTank = () => act(() => {
    const kind = (t.kind || 'ms') as FuProduct;
    // No product picked: the stock item named after the kind ("Petrol (MS)"), created when missing.
    const item = items.find((i) => i.id === t.item) ?? items.find((i) => i.name === fuT(`p.${kind}`)) ?? blankStockItem({ name: fuT(`p.${kind}`), unit: kind === 'cng' ? 'KG' : 'LTR' });
    const chart = parseChart(t.chart ?? '');
    const bad = !(Number(t.cap) > 0) ? 'Type the tank capacity.' : chartIssue(chart);
    if (bad) throw new Error(bad);
    const g = godownsDb.save({ name: t.name ?? '' });
    setTable(GODOWNS_TABLE, godownsDb.stored().map((x) => (x.id === g.id ? { ...x, fu: { product_item_id: item.id, capacity_l: Number(t.cap), chart, ...(t.due ? { calibration_due: t.due } : {}) } } : x)));
    stockDb.saveItem({ ...item, fu: { product: kind, unit: kind === 'cng' ? 'KG' : 'L' } });
    setT({ kind: 'ms' });
  });
  return (
    <div data-fuel-tanks key={n}>
      <Row>
        <In d={t} set={setT} k="name" label={fuT('tank')} />
        <Sel d={t} set={setT} k="item" label={fuT('product')} opts={items.map((i) => [i.id, i.name])} />
        <Sel d={t} set={setT} k="kind" label={fuT('kind')} opts={KINDS.map((k) => [k, fuT(`p.${k}`)])} />
        <In d={t} set={setT} k="cap" label={fuT('capacity')} type="number" w="6rem" />
        <In d={t} set={setT} k="due" label={fuT('calDue')} type="date" />
      </Row>
      <label className={controls.field}><span className={controls.label}>{fuT('chart')}</span><textarea className={controls.input} rows={3} value={t.chart ?? ''} onChange={(e) => setT({ ...t, chart: e.target.value })} data-fu-field="chart" /></label>
      <Row><button type="button" className={controls.btnPrimary} onClick={addTank} data-fu-add-tank>{fuT('addTank')}</button></Row>
      {!tanks.length ? <p className={controls.hint}>{fuT('noTanks')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{fuT('tank')}</th><th>{fuT('product')}</th><th>{fuT('capacity')}</th><th>{fuT('chart').split(':')[0]}</th><th>{fuT('calDue')}</th></tr></thead>
            <tbody>{tanks.map((g) => <tr key={g.id}><td>{g.name}</td><td>{name(g.fu!.product_item_id)}</td><td>{g.fu!.capacity_l}</td><td>{g.fu!.chart.length}</td><td>{g.fu!.calibration_due ?? ''}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <h3>{fuT('nozzle')}</h3>
      <Row>
        <In d={z} set={setZ} k="du" label={fuT('du')} w="4rem" />
        <In d={z} set={setZ} k="no" label={fuT('nozzleNo')} w="4rem" />
        <Sel d={z} set={setZ} k="tank" label={fuT('tank')} opts={tanks.map((g) => [g.id, g.name])} />
        <In d={z} set={setZ} k="tot" label={fuT('totaliser')} type="number" />
        <In d={z} set={setZ} k="wm" label={fuT('wmDue')} type="date" />
        <button type="button" className={controls.btnPrimary} onClick={() => act(() => { saveNozzle({ du_no: z.du ?? '', nozzle_no: z.no ?? '', tank_id: z.tank ?? '', totaliser_start: Number(z.tot || 0), ...(z.wm ? { wm_due: z.wm } : {}) }, tanks); setZ({}); })} data-fu-add-nozzle>{fuT('addNozzle')}</button>
      </Row>
      {nozzles.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{fuT('nozzle')}</th><th>{fuT('tank')}</th><th>{fuT('product')}</th><th>{fuT('totaliser')}</th><th>{fuT('wmDue')}</th><th /></tr></thead>
            <tbody>{nozzles.map((x) => <tr key={x.id}><td>{nozzleLabel(x)}</td><td>{tanks.find((g) => g.id === x.tank_id)?.name ?? '—'}</td><td>{name(x.item_id)}</td><td>{x.totaliser_start}</td><td>{x.wm_due ?? ''}</td><td><button type="button" className={controls.btnGhost} onClick={() => act(() => removeNozzle(x.id))}>{fuT('del')}</button></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
