/** AG-C1 Mill → Intake: gate entry and weighbridge slips (first / second weighing), the slip print, use, daily intake. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { WbsPartyKind, WbsReadings, WbsUse } from '../../types/agri-r12';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { cancelSlip, dailyIntake, deleteSlip, loadSlips, localStamp, openSlip, receiveForJob, recordTare, slipHtml } from '../../lib/agri/ag-weighbridge';
import { addPaddyLot, loadAgreements } from '../../lib/agri/ag-cmr';
import { B, printHtml, today } from '../transport/shared';
import { Num, Sel, Table, Txt } from './mill-ui';
import { T, n, opt, row, useRun, type Done } from './mill-kit';
import controls from '../../styles/controls.module.css';

const KINDS: readonly WbsPartyKind[] = ['farmer', 'trader', 'agency', 'other'];
const USES: readonly WbsUse[] = ['purchase', 'cmr', 'job', 'sale', 'other'];
const kg = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** Read the weighbridge indicator once (Web Serial, picked by the user); null when unsupported. */
async function readScale(): Promise<{ kg: number; stable: boolean } | null> {
  const s = await import('../../lib/scale-serial');
  if (!s.scaleSerialSupported()) return null;
  const f = await s.readScaleWeight();
  return f ? { kg: f.weight, stable: f.stable } : null;
}

export default function IntakeView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const [day, setDay] = useState(today());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ slips: loadSlips(), vendors: getTable<{ id: string; name: string }>('vendors'), clients: localDb.clients.getAll(), agreements: loadAgreements().filter((a) => a.status === 'open') }), [tick]);
  const [f, setF] = useState({ vehicle: '', kind: 'farmer' as WbsPartyKind, party: '', name: '', commodity: 'Paddy', gross: '', bags: '', moisture: '', foreign: '', damaged: '', use: 'purchase' as WbsUse });
  const [tare, setTare] = useState<Record<string, string>>({});
  const [cmr, setCmr] = useState<Record<string, string>>({});
  const [job, setJob] = useState<Record<string, string>>({});
  const parties = f.kind === 'agency' ? d.clients.map((c) => ({ id: c.id ?? '', name: c.name })) : d.vendors;
  const scale = (set: (v: string) => void) => void readScale().then((r) => {
    if (!r) return onDone(T('noScale'), true);
    set(String(r.kg));
    onDone(T(r.stable ? 'scaleRead' : 'scaleUnstable', { kg: kg(r.kg) }), !r.stable);
  }).catch((e: Error) => onDone(e.message, true));
  const readings = (): WbsReadings => Object.fromEntries((['moisture', 'foreign', 'damaged'] as const).filter((k) => f[k] !== '').map((k) => [k, n(f[k])]));
  const now = localStamp();
  const report = dailyIntake(d.slips, day, now);
  const done = d.slips.filter((s) => s.date === day && s.status !== 'open');
  const name = (s: { party_name?: string }) => s.party_name || '—';
  const business = () => { const p = localDb.settings.activeProfile(); return { name: p?.companyName, address: p?.companyAddress }; };
  return (
    <div data-ml-view="intake">
      <h4>{T('firstWeighing')}</h4>
      <div style={row}>
        <Txt l={T('vehicle')} v={f.vehicle} set={(x) => setF({ ...f, vehicle: x })} x={150} d="vehicle" />
        <Sel l={T('partyKind')} v={f.kind} set={(x) => setF({ ...f, kind: x as WbsPartyKind, party: '' })} o={KINDS.map((k) => [k, T(`pk.${k}`)] as const)} x={130} />
        <Sel l={T('party')} v={f.party} set={(x) => setF({ ...f, party: x })} o={opt(parties, (p) => p.id, (p) => p.name)} x={200} />
        {!f.party && <Txt l={T('partyName')} v={f.name} set={(x) => setF({ ...f, name: x })} x={180} d="party-name" />}
        <Txt l={T('commodity')} v={f.commodity} set={(x) => setF({ ...f, commodity: x })} x={150} d="commodity" />
        <Num l={T('gross')} v={f.gross} set={(x) => setF({ ...f, gross: x })} x={150} d="gross" />
        <button type="button" className={B.gs} onClick={() => scale((x) => setF((p) => ({ ...p, gross: x })))}>{T('readScale')}</button>
        <Num l={T('bags')} v={f.bags} set={(x) => setF({ ...f, bags: x })} x={90} />
        <Num l={T('moisture')} v={f.moisture} set={(x) => setF({ ...f, moisture: x })} x={110} d="moisture" />
        <Num l={T('foreign')} v={f.foreign} set={(x) => setF({ ...f, foreign: x })} x={130} />
        <Num l={T('damaged')} v={f.damaged} set={(x) => setF({ ...f, damaged: x })} x={110} />
        <Sel l={T('use')} v={f.use} set={(x) => setF({ ...f, use: x as WbsUse })} o={USES.map((u) => [u, T(`u.${u}`)] as const)} x={150} />
        <button type="button" className={B.p} data-ml-open-slip onClick={() => run(() => {
          const p = parties.find((x) => x.id === f.party);
          const s = openSlip({ date: day, vehicle: f.vehicle, party_kind: f.kind, party_id: p?.id || undefined, party_name: p?.name ?? f.name, commodity: f.commodity, gross_kg: n(f.gross), bags: n(f.bags), readings: readings(), use: f.use });
          setF({ ...f, vehicle: '', gross: '', bags: '', moisture: '', foreign: '', damaged: '' });
          return T('slipOpened', { n: s.number });
        })}>{T('openSlip')}</button>
      </div>

      <h4>{T('openSlips')}</h4>
      <Table d="open" head={[T('slip'), T('vehicle'), T('party'), T('commodity'), T('gross'), T('since'), T('tare'), '']} rows={report.open.map(({ slip: s, hours, stale }) => [
        s.number, s.vehicle, name(s), s.commodity, kg(s.gross_kg),
        <span key="h" data-ml-stale={stale ? '1' : undefined}>{T('hours', { n: hours })}{stale ? ` · ${T('stale')}` : ''}</span>,
        <span key="t" style={row}><input className={controls.input} style={{ maxWidth: 110 }} type="number" aria-label={T('tare')} value={tare[s.id] ?? ''} onChange={(e) => setTare({ ...tare, [s.id]: e.target.value })} data-ml="tare" /><button type="button" className={B.gs} onClick={() => scale((x) => setTare((p) => ({ ...p, [s.id]: x })))}>{T('readScale')}</button></span>,
        <span key="a" style={row}>
          <button type="button" className={B.ps} data-ml-tare onClick={() => run(() => { const r = recordTare(s.id, n(tare[s.id] ?? '')); return T('slipDone', { n: r.number, kg: kg(r.net_kg) }); })}>{T('secondWeighing')}</button>
          <button type="button" className={B.gs} onClick={() => run(() => { deleteSlip(s.id); })}>{T('del')}</button>
        </span>,
      ])} />

      <div style={row}><h4>{T('doneSlips')}</h4><Txt l={T('date')} v={day} set={setDay} type="date" x={170} /></div>
      <Table d="done" head={[T('slip'), T('vehicle'), T('party'), T('commodity'), T('net'), T('moisture'), T('used'), '']} rows={done.map((s) => [
        s.number, s.vehicle, name(s), s.commodity, kg(s.net_kg), s.readings?.moisture ?? '—',
        s.status === 'cancelled' ? `${T('cancelled')}${s.cancel_reason ? ` (${s.cancel_reason})` : ''}` : s.ref_id ? T(`u.${s.use}`) : '—',
        <span key="a" style={row}>
          <button type="button" className={B.gs} onClick={() => printHtml(slipHtml(s, business()), s.number)}>{T('print')}</button>
          {s.status === 'done' && !s.ref_id && <>
            <Link className={B.os} to={`/inventory?tab=farm&view=vouchers&wbs=${s.id}`} data-ml-voucher>{T('makeVoucher')}</Link>
            {d.agreements.length > 0 && <><select className={controls.select} style={{ maxWidth: 170 }} aria-label={T('forCmr')} value={cmr[s.id] ?? ''} onChange={(e) => setCmr({ ...cmr, [s.id]: e.target.value })}>{opt(d.agreements, (a) => a.id, (a) => `${a.agency_name} · ${a.season}`).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              <button type="button" className={B.os} disabled={!cmr[s.id]} onClick={() => run(() => { addPaddyLot(cmr[s.id], { date: s.date, wbs_id: s.id }); return T('lotAdded'); })}>{T('forCmr')}</button></>}
            <input className={controls.input} style={{ maxWidth: 150 }} placeholder={T('principal')} aria-label={T('principal')} value={job[s.id] ?? name(s)} onChange={(e) => setJob({ ...job, [s.id]: e.target.value })} />
            <button type="button" className={B.os} onClick={() => run(() => T('jobReceived', { n: receiveForJob(s.id, { name: job[s.id] ?? s.party_name ?? '' }).jwpNumber }))}>{T('forJob')}</button>
            <button type="button" className={B.gs} onClick={() => run(() => { const r = window.prompt(T('reason')); if (r) cancelSlip(s.id, r); })}>{T('cancel')}</button>
          </>}
        </span>,
      ])} />

      <h4>{T('intakeReport')}</h4>
      <p className={controls.hint} data-ml-intake={report.net_kg}>
        {T('net')}: {kg(report.net_kg)}{report.avg_moisture !== null ? ` · ${T('avgMoisture', { pct: report.avg_moisture })}` : ''}{report.stale ? ` · ${T('staleCount', { n: report.stale })}` : ''}
      </p>
      {([['byCommodity', report.byCommodity, (k: string) => k], ['byParty', report.byParty, (k: string) => T(`pk.${k as WbsPartyKind}`)], ['byUse', report.byUse, (k: string) => T(`u.${k as WbsUse}`)]] as const).map(([h, rows, label]) => (
        <Table key={h} d={h} head={[T(h), T('slips'), T('net'), T('moisture')]} rows={rows.map((g) => [label(g.key), g.slips, kg(g.net_kg), g.avg_moisture ?? '—'])} />
      ))}
      <p className={controls.hint}>{T('intakeNote')}</p>
    </div>
  );
}
