/**
 * AG-B4 dispatch to the union / plant: the tanker's milk (stock leaves the centre on save), the union's acknowledgement,
 * the bill (bill of supply at the buyer's chart), and the fat / SNF reconciliation by day or month with the tolerance
 * flag. Union payments are ordinary receipts against the bills (Receivables).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MilkDispatch, MilkKind, MilkShiftId, MilkUnit } from '../../types/agri-r12';
import { bT } from '../../i18n/areas/agri-r12b';
import { billDispatch, deleteDispatch, loadDispatches, saveDispatch } from '../../lib/agri/ag-dispatch';
import { milkReco } from '../../lib/agri/ag-milk-reco';
import { loadCards } from '../../lib/agri/ag-milk-cards';
import { loadShifts } from '../../lib/agri/ag-shifts';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import { todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { clientOpts, milkCentres, milkOpts, sm, useRun, wrap, type Done } from './dairy-kit';
import { CentrePick, F, N, Sel } from './dairy-ui';
import { DateField } from '../ui/DateField';

const blank = { date: todayInput(), shift: 'M' as MilkShiftId, buyer: '', milk: 'cow' as MilkKind, tanker: '', qty: 0, unit: 'L' as MilkUnit, fat: 0, snf: 0, temp: 0 };

function Ack({ d, run }: { d: MilkDispatch; run: (fn: () => string | void) => void }) {
  const [a, setA] = useState({ qty: d.received?.qty ?? d.sent.qty, fat: d.received?.fat ?? d.sent.fat, snf: d.received?.snf ?? d.sent.snf, ack: d.received?.ack_no ?? '', date: d.received?.date ?? d.date });
  return (
    <span className={controls.row} style={wrap}>
      <N l={bT('qty')} v={a.qty} set={(qty) => setA({ ...a, qty })} w={80} d="ack-qty" />
      <N l={bT('fat')} v={a.fat} set={(fat) => setA({ ...a, fat })} w={70} d="ack-fat" />
      <N l={bT('snf')} v={a.snf} set={(snf) => setA({ ...a, snf })} w={70} />
      <F l={bT('ackNo')} w={110}><input className={controls.input} value={a.ack} onChange={(e) => setA({ ...a, ack: e.target.value })} data-dairy="ack-no" /></F>
      <button type="button" className={sm} data-dairy="ack-save" onClick={() => run(() => { saveDispatch({ ...d, received: { qty: a.qty, fat: a.fat, snf: a.snf, ack_no: a.ack, date: a.date } }); return bT('saved'); })}>{bT('save')}</button>
    </span>
  );
}

export default function DispatchView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const [centre, setCentre] = useState(() => milkCentres()[0].id);
  const [f, setF] = useState(blank);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const [month, setMonth] = useState(todayInput().slice(0, 7));
  const [group, setGroup] = useState<'day' | 'month'>('day');
  const ms = readAgriSettings().milk ?? {};
  const [cfg, setCfg] = useState({ from: ms.invoice_from ?? 'received', tol: ms.tolerance_pct ?? 0, wa: !!ms.slip_wa });
  const centreId = centre;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => loadDispatches().filter((d) => d.centre_id === centreId).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)), [tick, centreId]);
  const reco = useMemo(() => milkReco({ shifts: loadShifts(), dispatches: list, cards: loadCards(), from: `${month}-01`, to: `${month}-31`, centreId, group, settings: readAgriSettings().milk }), [list, month, centreId, group]);
  const buyer = f.buyer || clientOpts()[0]?.[0] || '';
  return (
    <>
      <div className={controls.row} style={wrap}>
        <CentrePick v={centreId} set={setCentre} />
        <F l={bT('date')} w={160}><DateField className={controls.input} value={f.date} onChange={(e) => set({ date: e.target.value })} /></F>
        <Sel l={bT('shift')} v={f.shift} set={(shift) => set({ shift })} opts={[['M', 'M'], ['E', 'E']]} w={70} />
        <Sel l={bT('buyer')} v={buyer} set={(b) => set({ buyer: b })} opts={clientOpts()} w={200} d="buyer" />
        <Sel l={bT('milk')} v={f.milk} set={(milk) => set({ milk })} opts={milkOpts()} w={110} />
        <F l={bT('tanker')} w={130}><input className={controls.input} value={f.tanker} onChange={(e) => set({ tanker: e.target.value })} data-dairy="tanker" /></F>
        <N l={bT('qty')} v={f.qty} set={(qty) => set({ qty })} d="d-qty" />
        <Sel l={bT('unit')} v={f.unit} set={(unit) => set({ unit })} opts={[['L', 'L'], ['KG', 'kg']]} w={70} />
        <N l={bT('fat')} v={f.fat} set={(fat) => set({ fat })} w={70} d="d-fat" />
        <N l={bT('snf')} v={f.snf} set={(snf) => set({ snf })} w={70} d="d-snf" />
        <N l={bT('temp')} v={f.temp} set={(temp) => set({ temp })} w={70} />
        <button type="button" className={controls.btnPrimary} data-dairy="dispatch-save" onClick={() => run(() => {
          const d = saveDispatch({ date: f.date, shift: f.shift, centre_id: centreId, buyer_id: buyer, milk: f.milk, ...(f.tanker ? { tanker: f.tanker } : {}), sent: { qty: f.qty, unit: f.unit, fat: f.fat, snf: f.snf, ...(f.temp ? { temp: f.temp } : {}) } });
          setF({ ...blank, buyer, date: f.date });
          return bT('dispatchSaved', { no: d.number });
        })}>{bT('saveDispatch')}</button>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-dairy="dispatches">
          <thead><tr><th>{bT('number')}</th><th>{bT('date')}</th><th>{bT('buyer')}</th><th>{bT('sent')}</th><th>{bT('received')}</th><th /></tr></thead>
          <tbody>{list.map((d) => (
            <tr key={d.id}>
              <td>{d.number}</td><td>{d.date} {d.shift}</td><td>{d.buyer_name}{d.tanker ? ` · ${d.tanker}` : ''}</td><td>{d.sent.qty} {d.sent.unit} · {d.sent.fat} / {d.sent.snf}</td>
              <td>{d.invoice_id ? `${d.received?.qty ?? '-'} · ${d.received?.ack_no ?? ''}` : <Ack d={d} run={run} />}</td>
              <td>
                {d.invoice_id ? <Link className={sm} to={`/invoice/${d.invoice_id}`}>{bT('openBill')}</Link>
                  : <button type="button" className={sm} data-dairy="bill" onClick={() => run(() => bT('billed', { no: billDispatch(d.id).invoice_number }))}>{bT('bill')}</button>}
                {!d.invoice_id && <button type="button" className={sm} onClick={() => run(() => { deleteDispatch(d.id); return bT('deleted'); })}>{bT('delete')}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <h3 className={surface.cardHeadIcon}>{bT('recoTitle')}</h3>
      <div className={controls.row} style={wrap}>
        <F l={bT('month')} w={160}><DateField mode="month" className={controls.input} value={month} onChange={(e) => setMonth(e.target.value)} /></F>
        <Sel l={bT('groupBy')} v={group} set={setGroup} opts={[['day', bT('by.day')], ['month', bT('by.month')]]} />
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-dairy="reco">
          <thead><tr><th /><th className={surface.numeric}>{bT('collected')}</th><th className={surface.numeric}>{bT('sent')}</th><th className={surface.numeric}>{bT('received')}</th><th className={surface.numeric}>{bT('local')}</th><th className={surface.numeric}>{bT('gap')}</th><th className={surface.numeric}>{bT('shortFat')}</th></tr></thead>
          <tbody>{reco.map((r) => (
            <tr key={r.key} data-flag={r.flag || undefined}>
              <td>{r.key}{r.flag ? ' ⚠' : ''}</td>
              <td className={surface.numeric}>{r.collected.l} L · {r.collected.fat} / {r.collected.snf}</td><td className={surface.numeric}>{r.sent.l} L · {r.sent.fat} / {r.sent.snf}</td>
              <td className={surface.numeric}>{r.received.l} L · {r.received.fat} / {r.received.snf}</td><td className={surface.numeric}>{r.local}</td><td className={surface.numeric}>{r.gapL}</td>
              <td className={surface.numeric} data-dairy="short">{r.shortFat} ({r.shortPct}%)</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className={controls.hint}>{bT('recoHint')}</p>
      <div className={controls.row} style={wrap}>
        <Sel l={bT('billOn')} v={cfg.from} set={(from) => setCfg({ ...cfg, from })} opts={[['received', bT('received')], ['sent', bT('sent')]]} />
        <N l={bT('tolerance')} v={cfg.tol} set={(tol) => setCfg({ ...cfg, tol })} w={110} />
        <label className={controls.check}><input type="checkbox" checked={cfg.wa} onChange={(e) => setCfg({ ...cfg, wa: e.target.checked })} /> {bT('slipWa')}</label>
        <button type="button" className={sm} onClick={() => run(() => { saveAgriSettings({ milk: { ...readAgriSettings().milk, invoice_from: cfg.from, slip_wa: cfg.wa, ...(cfg.tol > 0 ? { tolerance_pct: cfg.tol } : {}) } }); return bT('saved'); })}>{bT('save')}</button>
      </div>
    </>
  );
}
