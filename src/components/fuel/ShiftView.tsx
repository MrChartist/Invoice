/**
 * R21-B shift view: open a shift (attendants and the nozzles they hold; openings carried), type closing readings, test
 * litres, the reading at a mid-shift price change and the collections by mode; close it; see each attendant's expected
 * amount and short / excess; "Day close" posts the day's closed shifts (one Bill of Supply per shift, receipts by mode;
 * an excess is a note to post in Books); a shortage is recovered in cash or written off; "Undo day close" cancels the shift's bill.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { fbT } from '../../i18n/areas/fuel-r21b';
import { localDayOf, shiftDay } from '../../lib/dates';
import { pickableBankAccounts } from '../../lib/bank-accounts';
import { nozzleLabel } from '../../lib/fuel/fu-line';
import { MODES } from '../../lib/fuel/fu-settle';
import { openShift, readShifts, removeShift, saveShift } from '../../lib/fuel/fu-dayclose';
import { dayClose, fuCfg, fuData, planOf, settleShort, shiftBill, undoShift } from '../../lib/fuel/fu-issue-io';
import type { FuCollection, FuelNozzle, FuelShift, FuReading } from '../../types/fuel-r21';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Row, Sel } from './fu-ui';
import type { Done } from './FuelDesk';

type D = Record<string, string>;
const C = ({ d, set, k, w = '6.5rem' }: { d: D; set: (d: D) => void; k: string; w?: string }) => <input className={controls.input} style={{ width: w }} value={d[k] ?? ''} onChange={(e) => set({ ...d, [k]: e.target.value })} data-fu-cell={k} />;
const nums = (v?: string) => (v ?? '').split(/[\s,;]+/).filter(Boolean).map(Number);

function Card({ s, nozzles, act }: { s: FuelShift; nozzles: FuelNozzle[]; act: (fn: () => unknown) => void }) {
  const [d, set] = useState<D>(() => ({
    at: new Date().toTimeString().slice(0, 5),
    ...Object.fromEntries(s.readings.flatMap((r) => [[`o:${r.nozzle_id}`, String(r.opening)], [`c:${r.nozzle_id}`, r.closing === undefined ? '' : String(r.closing)], [`t:${r.nozzle_id}`, String(r.test_l)], [`p:${r.nozzle_id}`, (r.splits ?? []).join(' ')], [`r:${r.nozzle_id}`, r.reason ?? '']])),
    ...Object.fromEntries(s.collections.map((c) => [`m:${c.attendant}:${c.mode}`, String(c.amount)])),
  }));
  const live = s.status !== 'posted';
  const lab = (id: string) => ((n) => (n ? nozzleLabel(n) : id))(nozzles.find((n) => n.id === id));
  const readings = (): FuReading[] => s.readings.map((r) => {
    const k = r.nozzle_id;
    const c = d[`c:${k}`]?.trim();
    return { ...r, opening: Number(d[`o:${k}`]), test_l: Number(d[`t:${k}`] || 0), ...(c ? { closing: Number(c) } : { closing: undefined }), ...(nums(d[`p:${k}`]).length ? { splits: nums(d[`p:${k}`]) } : { splits: undefined }), ...(d[`r:${k}`]?.trim() ? { reason: d[`r:${k}`].trim() } : { reason: undefined }) };
  });
  const collections = (): FuCollection[] => s.attendants.flatMap((_, i) => MODES.map((mode) => ({ attendant: i, mode, amount: Number(d[`m:${i}:${mode}`] || 0) })));
  const save = (close?: boolean) => act(() => saveShift(s.id, { readings: readings(), collections: collections() }, nozzles, close ? `${d.at < s.opened_at.slice(11) ? shiftDay(s.date, 1) : s.date} ${d.at}` : undefined));
  let plan: ReturnType<typeof planOf> | null = null;
  let err = '';
  if (s.status !== 'open') try { plan = planOf(s); } catch (e) { err = (e as Error).message; }
  const bill = s.status === 'posted' ? shiftBill(s.id) : undefined;
  const who = (id: string) => s.attendants.find((a) => a.nozzle_ids.includes(id))?.name ?? '';
  return (
    <div className={surface.card} style={{ marginBottom: '1rem' }} data-fu-shift={s.shift_no}>
      <h3>{fuT('shift')} {s.shift_no} · {s.opened_at.slice(11)}{s.closed_at ? `–${s.closed_at.slice(11)}` : ''} · {fbT(`s.${s.status}`)}{bill ? ` · ${fbT('posted', { no: bill.invoice_number })}` : ''}</h3>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{fuT('nozzle')}</th><th>{fbT('heldBy')}</th><th>{fbT('opening')}</th><th>{fbT('closing')}</th><th>{fuT('test')}</th><th>{fbT('split')}</th><th>{fbT('reason')}</th><th>{fbT('sold')}</th><th>{fbT('value')}</th></tr></thead>
          <tbody>{s.readings.map((r) => { const k = r.nozzle_id; const x = plan?.sales.find((y) => y.nozzle_id === k); return (
            <tr key={k}><td>{lab(k)}</td><td>{who(k)}</td>{(['o', 'c', 't', 'p', 'r'] as const).map((f) => <td key={f}>{live ? <C d={d} set={set} k={`${f}:${k}`} w={f === 't' ? '4rem' : '6.5rem'} /> : d[`${f}:${k}`]}</td>)}<td>{x?.litres ?? ''}</td><td>{x?.value ?? ''}</td></tr>
          ); })}</tbody>
        </table>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{fuT('attendant')}</th>{MODES.map((m) => <th key={m}>{fbT(`m.${m}`)}</th>)}<th>{fbT('expected')}</th><th>{fbT('collected')}</th><th>{fbT('diff')}</th><th /></tr></thead>
          <tbody>{s.attendants.map((a, i) => { const p = plan?.people[i]; const done = s.settled?.find((x) => x.attendant === i); return (
            <tr key={i}><td>{a.name}</td>{MODES.map((m) => <td key={m}>{live ? <C d={d} set={set} k={`m:${i}:${m}`} w="5.5rem" /> : d[`m:${i}:${m}`] ?? ''}</td>)}<td>{p?.expected ?? ''}</td><td>{p?.collected ?? ''}</td><td data-fu-diff={i}>{p?.diff ?? ''}</td>
              <td>{bill && p && p.diff < -0.004 && (done ? fbT(done.how === 'cash' ? 'recover' : 'writeOff') : <><button type="button" className={controls.btnGhost} onClick={() => act(() => settleShort(s.id, i, 'cash'))}>{fbT('recover')}</button><button type="button" className={controls.btnGhost} onClick={() => act(() => settleShort(s.id, i, 'write_off'))}>{fbT('writeOff')}</button></>)}</td></tr>
          ); })}</tbody>
        </table>
      </div>
      {err && <p className={controls.error}>{err}</p>}
      {plan && <p className={controls.hint} data-fu-counter>{fbT('counter')}: {plan.lines.map((l) => `${l.litres} L · ₹${l.amount}`).join('; ') || '-'}{Object.values(plan.excess).some(Boolean) && ` · ${fbT('excess', { v: Object.values(plan.excess).reduce((a, x) => a + (x ?? 0), 0) })}`}</p>}
      <Row>
        {live && <button type="button" className={controls.btnOutline} onClick={() => save()} data-fu-shift-save>{fbT('save')}</button>}
        {s.status === 'open' && <><In d={d} set={set} k="at" label={fbT('closeAt')} w="5rem" /><button type="button" className={controls.btnPrimary} onClick={() => save(true)} data-fu-shift-close>{fbT('close')}</button><button type="button" className={controls.btnGhost} onClick={() => act(() => removeShift(s.id))}>{fuT('del')}</button></>}
        {s.status === 'posted' && <button type="button" className={controls.btnGhost} onClick={() => act(() => undoShift(s.id))} data-fu-undo>{fbT('undo')}</button>}
      </Row>
    </div>
  );
}

export default function ShiftView({ onDone }: { onDone: Done }) {
  useT();
  const [n, setN] = useState(0);
  const cfg = fuCfg();
  const [d, set] = useState<D>({ day: localDayOf(new Date()), no: '1', start: cfg.shift_starts?.[0] ?? '06:00' });
  const nozzles = fuData().nozzles.filter((z) => z.active);
  const shifts = readShifts().filter((s) => s.date === d.day).sort((a, b) => a.shift_no - b.shift_no);
  const banks = pickableBankAccounts('payout');
  const act = (fn: () => unknown) => { try { fn(); setN(n + 1); onDone(fbT('done')); } catch (e) { onDone((e as Error).message, true); } };
  const names = (d.atts ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const open = () => act(() => {
    openShift({ date: d.day, shift_no: Number(d.no), start: d.start, test_l: cfg.test_litres ?? 5, attendants: names.map((name) => ({ name, nozzle_ids: nozzles.filter((z) => (d[`a:${z.id}`] || names[0]) === name).map((z) => z.id) })) }, nozzles);
  });
  return (
    <div data-fuel-shift key={n}>
      <Row>
        <In d={d} set={set} k="day" label={fuT('date')} type="date" />
        <Sel d={d} set={set} k="no" label={fbT('no')} opts={Array.from({ length: cfg.shift_count ?? 2 }, (_, i) => [String(i + 1), String(i + 1)] as const)} />
        <In d={d} set={set} k="start" label={fbT('start')} w="5rem" />
        <In d={d} set={set} k="atts" label={fbT('atts')} w="14rem" />
      </Row>
      {names.length > 1 && <Row>{nozzles.map((z) => <Sel key={z.id} d={d} set={set} k={`a:${z.id}`} label={`${fuT('nozzle')} ${nozzleLabel(z)}`} opts={names.map((x) => [x, x] as const)} />)}</Row>}
      <Row><button type="button" className={controls.btnPrimary} onClick={open} data-fu-shift-open>{fbT('open')}</button></Row>
      {!shifts.length && <p className={controls.hint}>{fbT('noShifts')}</p>}
      {shifts.map((s) => <Card key={s.id} s={s} nozzles={nozzles} act={act} />)}
      {shifts.some((s) => s.status === 'closed') && (
        <Row>
          <Sel d={d} set={set} k="upi" label={fbT('upi')} opts={banks.map((b) => [b.id, b.name] as const)} />
          <button type="button" className={controls.btnPrimary} onClick={() => act(() => dayClose(d.day, { upiBank: d.upi }))} data-fu-day-close>{fbT('dayClose')}</button>
        </Row>
      )}
    </div>
  );
}
