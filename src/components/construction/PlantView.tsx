/** CN-D3 Works → Plant: equipment (own and hired), daily log sheets, monthly utilisation and fuel, hire in / hire out. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Vendor } from '../../types/purchases';
import type { HiredEquipment } from '../../types/construction-r11';
import { getTable } from '../../lib/storage';
import { godownsDb } from '../../lib/godowns';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { sitesOf } from '../../lib/construction/cn-subcon';
import { deleteHired, deleteLog, loadHired, loadLogs, machines, monthSummary, saveHired, saveLog, setEquipment } from '../../lib/construction/cn-plant';
import { bookHireIn, hireOutInvoice, hireProposal } from '../../lib/construction/cn-plant-hire';
import { B, fmtMoney, today, type Notify } from '../transport/shared';
import { Num, Sel, Table, Txt } from './site-ui';
import { T, monthOf, n, opt, row, useRun } from './site-kit';
import controls from '../../styles/controls.module.css';

export default function PlantView({ notify }: { notify: Notify }) {
  const [tick, run] = useRun(notify);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ assets: getTable<{ id: string; name: string }>('fixed_assets'), hired: loadHired(), list: machines(), logs: loadLogs(), vendors: getTable<Vendor>('vendors'), sites: sitesOf(godownsDb.stored()), purchases: purchasesDb.all(), clients: localDb.clients.getAll() }), [tick]);
  const [eq, setEq] = useState({ asset: '', kind: '', reg: '', internal: '', hire: '', fmin: '', fmax: '' });
  const [h, setH] = useState({ vendor: '', desc: '', rate: '', basis: 'hour', op: true, from: today() });
  const [l, setL] = useState({ date: today(), ref: '', site: '', worked: '', idle: '', bd: '', fuel: '', operator: '', sub: '' });
  const [month, setMonth] = useState(monthOf(today()));
  const [billNo, setBillNo] = useState<Record<string, string>>({});
  const [out, setOut] = useState({ sub: '', client: '' });
  const [made, setMade] = useState('');
  const name = (ref: string) => d.list.find((m) => m.ref === ref)?.name ?? ref;
  const sum = monthSummary(d.logs, month, d.list);
  return (
    <div data-sd-view="plant">
      <h4>{T('equipment')}</h4>
      <div style={row} data-sd-own>
        <Sel l={T('asset')} v={eq.asset} set={(x) => setEq({ ...eq, asset: x })} o={opt(d.assets, (a) => a.id, (a) => a.name)} n={200} />
        <Txt l={T('kind')} v={eq.kind} set={(x) => setEq({ ...eq, kind: x })} n={140} />
        <Txt l={T('regNo')} v={eq.reg} set={(x) => setEq({ ...eq, reg: x })} n={140} />
        <Num l={T('internalRate')} v={eq.internal} set={(x) => setEq({ ...eq, internal: x })} n={150} />
        <Num l={T('hireRate')} v={eq.hire} set={(x) => setEq({ ...eq, hire: x })} n={150} />
        <Num l={T('fuelMin')} v={eq.fmin} set={(x) => setEq({ ...eq, fmin: x })} />
        <Num l={T('fuelMax')} v={eq.fmax} set={(x) => setEq({ ...eq, fmax: x })} />
        <button type="button" className={B.o} onClick={() => run(() => setEquipment(eq.asset, { kind: eq.kind, reg_no: eq.reg || undefined, internal_rate: n(eq.internal), hire_rate: n(eq.hire), ...(eq.fmin ? { fuel_min: n(eq.fmin) } : {}), ...(eq.fmax ? { fuel_max: n(eq.fmax) } : {}) }))}>{T('markEquip')}</button>
      </div>
      <div style={row} data-sd-hired>
        <Sel l={T('hirer')} v={h.vendor} set={(x) => setH({ ...h, vendor: x })} o={opt(d.vendors, (v) => v.id, (v) => v.name)} n={200} d="h-vendor" />
        <Txt l={T('desc')} v={h.desc} set={(x) => setH({ ...h, desc: x })} n={180} d="h-desc" />
        <Num l={T('rate')} v={h.rate} set={(x) => setH({ ...h, rate: x })} d="h-rate" />
        <Sel l={T('basis')} v={h.basis} set={(x) => setH({ ...h, basis: x })} o={(['hour', 'day', 'month'] as const).map((k) => [k, T(`b.${k}`)] as const)} n={110} />
        <Txt l={T('from')} v={h.from} set={(x) => setH({ ...h, from: x })} type="date" n={160} />
        <label><input type="checkbox" checked={h.op} onChange={(e) => setH({ ...h, op: e.target.checked })} /> {T('withOp')}</label>
        <button type="button" className={B.o} onClick={() => run(() => { const v = d.vendors.find((x) => x.id === h.vendor); saveHired({ vendor_id: v?.id ?? '', vendor_name: v?.name ?? '', description: h.desc, rate: n(h.rate), basis: h.basis as HiredEquipment['basis'], with_operator: h.op, from: h.from }); })} data-sd-save-hired>{T('add')}</button>
      </div>
      <Table d="machines" head={[T('equipment'), T('internalRate'), T('hireRate'), '']} rows={d.list.map((m) => [m.name, m.own ? fmtMoney(m.internal) : '—', fmtMoney(m.hireOut), m.own ? <button key="x" type="button" className={B.gs} onClick={() => run(() => setEquipment(m.ref.slice(3), null))}>{T('unmark')}</button> : <button key="x" type="button" className={B.gs} onClick={() => run(() => deleteHired(m.ref.slice(5)))}>{T('del')}</button>])} />
      <h4>{T('logSheet')}</h4>
      <div style={row} data-sd-log>
        <Txt l={T('date')} v={l.date} set={(x) => setL({ ...l, date: x })} type="date" n={160} />
        <Sel l={T('equipment')} v={l.ref} set={(x) => setL({ ...l, ref: x })} o={opt(d.list, (m) => m.ref, (m) => m.name)} n={220} d="l-ref" />
        <Sel l={T('site')} v={l.site} set={(x) => setL({ ...l, site: x })} o={opt(d.sites, (s) => s.id, (s) => s.name)} n={180} d="l-site" />
        <Num l={T('worked')} v={l.worked} set={(x) => setL({ ...l, worked: x })} n={100} d="l-worked" />
        <Num l={T('idle')} v={l.idle} set={(x) => setL({ ...l, idle: x })} n={100} />
        <Num l={T('breakdown')} v={l.bd} set={(x) => setL({ ...l, bd: x })} n={110} />
        <Num l={T('fuel')} v={l.fuel} set={(x) => setL({ ...l, fuel: x })} n={110} />
        <Txt l={T('operator')} v={l.operator} set={(x) => setL({ ...l, operator: x })} n={140} />
        <Sel l={T('chargeTo')} v={l.sub} set={(x) => setL({ ...l, sub: x })} o={opt(d.vendors, (v) => v.id, (v) => v.name)} n={200} />
        <button type="button" className={B.p} onClick={() => run(() => T('logSaved', { n: saveLog({ date: l.date, equipment_ref: l.ref, site_id: l.site, hours_worked: n(l.worked), idle_hours: n(l.idle), breakdown_hours: n(l.bd), fuel_litres: n(l.fuel), operator: l.operator || undefined, sub_contractor_id: l.sub || undefined }).number }))} data-sd-save-log>{T('save')}</button>
      </div>
      <Txt l={T('month')} v={month} set={setMonth} type="month" n={150} />
      <Table d="summary" head={[T('equipment'), T('days'), T('worked'), T('idle'), T('breakdown'), T('util'), T('fuelHr')]} rows={sum.map((m) => [name(m.ref), m.days, m.worked, m.idle, m.breakdown, `${m.utilisation}%`, <span key="f" data-sd-fuel={m.fuelFlag ?? ''}>{m.fuelPerHour ?? '—'}{m.fuelFlag ? ` · ${T(`fuel.${m.fuelFlag}`)}` : ''}</span>])} />
      <Table d="logs" head={[T('logNo'), T('date'), T('equipment'), T('worked'), T('chargeTo'), '']} rows={d.logs.filter((x) => monthOf(x.date) === month).map((x) => [x.number, x.date, name(x.equipment_ref), x.hours_worked, x.sub_contractor_id ? `${d.vendors.find((v) => v.id === x.sub_contractor_id)?.name ?? ''}${x.recovered_in ? ` (${x.recovered_in})` : ''}` : T('ownSite'), !x.recovered_in && <button key="d" type="button" className={B.gs} onClick={() => run(() => deleteLog(x.id))}>{T('del')}</button>])} />
      <h4>{T('hireIn')}</h4>
      <Table d="hirein" head={[T('equipment'), T('qty'), T('amount'), T('tds'), '']} rows={d.hired.map((e) => {
        const p = hireProposal(e, month, d.logs, d.vendors.find((v) => v.id === e.vendor_id), d.purchases);
        return [`${e.description} — ${e.vendor_name}`, `${p.qty} ${T(`b.${e.basis}`)}`, fmtMoney(p.amount), p.tdsLabel, p.booked !== undefined ? T('booked', { n: p.booked || '—' }) : p.amount > 0 && <span key="b" style={row}><input className={controls.input} aria-label={T('billNo')} placeholder={T('billNo')} value={billNo[e.id] ?? ''} onChange={(ev) => setBillNo({ ...billNo, [e.id]: ev.target.value })} /><button type="button" className={B.os} onClick={() => run(() => { bookHireIn(e.id, month, billNo[e.id] ?? ''); })} data-sd-book-hire>{T('bookBill')}</button></span>];
      })} />
      <h4>{T('hireOut')}</h4>
      <div style={row}>
        <Sel l={T('chargeTo')} v={out.sub} set={(x) => setOut({ ...out, sub: x })} o={opt(d.vendors, (v) => v.id, (v) => v.name)} n={200} />
        <Sel l={T('client')} v={out.client} set={(x) => setOut({ ...out, client: x })} o={opt(d.clients, (c) => c.id ?? '', (c) => c.name)} n={200} />
        <button type="button" className={B.o} onClick={() => run(() => { const i = hireOutInvoice(out.sub, out.client, today()); setMade(i.id); return T('draftMade'); })}>{T('makeDraft')}</button>
        {made && <Link to={`/invoice/${made}`}>{T('openDraft')}</Link>}
      </div>
      <p className={controls.hint}>{T('plantNote')}</p>
    </div>
  );
}
