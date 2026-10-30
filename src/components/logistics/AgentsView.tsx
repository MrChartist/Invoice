/**
 * R19-D1 agents view (`&view=agents`): overseas agents (a client + vendor pair) with their open balance in the
 * currency; "Add agent"; for the chosen agent "Debit agent" (our note, export of services — LUT when one covers the day)
 * and "Agent's bill" (import of services, reverse charge, booked in ₹) by job; the statement by month; a pasted agent
 * statement matched by job / house bill with the differences; "Settle by netting" (R15-A markers, the bill's rate as the
 * realised rate) with the FEMA hint. The net receipt / payment goes through Receivables / Purchases (FX gain / loss).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { lgdT } from '../../i18n/areas/logistics-r19d';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { AGENT_KINDS, agentStatement, lgAgents, matchStatement, NOTE_KINDS, type AgentKind, type NoteKind } from '../../lib/logistics/lg-agents';
import { issueAgentNote, saveAgent, saveAgentBill, settleAgent } from '../../lib/logistics/lg-d-save';
import { loadJobs } from '../../lib/logistics/lg-save';
import { readLogisticsSettings } from '../../lib/logistics/lg-settings';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Pick, type LgViewProps } from './lg-ui';
import { numIn, row } from './lg-form';
import { draftBase, fxOn, lutOnDay, syncNettedPaid } from './lg-d-seam';

const list = (key: 'agentKinds' | 'noteKinds', ids: readonly string[], id: string) => lgdT(key).split(',')[ids.indexOf(id)] ?? id;

export default function AgentsView({ notify }: LgViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState('');
  const [add, setAdd] = useState<{ name: string; kind: AgentKind; foreign: boolean; country: string }>({ name: '', kind: 'agent', foreign: true, country: '' });
  const [f, setF] = useState<{ job: string; kind: NoteKind; amount?: number; cur: string; rate?: number; date: string; bill: string }>(() => ({ job: '', kind: 'profit_share', cur: readLogisticsSettings().default_currency ?? 'USD', date: todayInput(), bill: '' }));
  const [period, setPeriod] = useState('');
  const [paste, setPaste] = useState('');
  const [net, setNet] = useState<{ amount?: number; rcm: boolean }>({ rcm: false });
  const d = useMemo(() => { void tick; const clients = localDb.clients.getAll(); return { agents: lgAgents(getTable<Vendor>('vendors'), clients), inv: localDb.invoices.getAll(), pur: getTable<PurchaseRecord>('purchases'), jobs: loadJobs() }; }, [tick]);
  const act = (fn: () => unknown, msg = lgT('saved')) => { try { fn(); setTick((t) => t + 1); notify(msg); } catch (e) { notify((e as Error).message, 'error'); } };
  const a = d.agents.find((x) => x.vendor.id === sel);
  const st = a && agentStatement(a, d.inv, d.pur, period || undefined);
  const job = d.jobs.find((j) => j.id === f.job);
  const rate = f.rate ?? fxOn(f.cur, f.date);
  const rows = paste.split('\n').map((l) => l.split(',')).filter((c) => c[0]?.trim() && Number.isFinite(Number(c[1]))).map((c) => ({ ref: c[0], amount: Number(c[1]) }));
  const m = st && rows.length ? matchStatement(rows, st, d.jobs) : null;
  const periods = [...new Set([...d.inv.filter((i) => i.lg?.agent).map((i) => i.issue_date.slice(0, 7)), ...d.pur.filter((b) => b.lg?.fx).map((b) => b.date.slice(0, 7))])].sort().reverse();
  const n2 = (v: number) => v.toFixed(2);
  return (
    <>
      <div style={row}>
        <In label={lgT('name')} value={add.name} onChange={(v) => setAdd({ ...add, name: v })} attr="agent-name" />
        <Pick label={lgT('kind')} value={add.kind} ids={AGENT_KINDS} name={(x) => list('agentKinds', AGENT_KINDS, x)} onChange={(v) => setAdd({ ...add, kind: v as AgentKind })} />
        <In label={lgdT('country')} value={add.country} onChange={(v) => setAdd({ ...add, country: v.toUpperCase().slice(0, 2) })} />
        <label className={controls.check}><input type="checkbox" checked={add.foreign} onChange={(e) => setAdd({ ...add, foreign: e.target.checked })} /> {lgdT('foreign')}</label>
        <button type="button" className={controls.btnOutline} onClick={() => act(() => { const v = saveAgent(add); setSel(v.id); setAdd({ ...add, name: '' }); })} data-lg-add-agent>{lgdT('addAgent')}</button>
      </div>
      {d.agents.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{lgT('agent')}</th><th>{lgT('kind')}</th><th>{lgdT('ours')}</th><th>{lgdT('theirs')}</th><th>{lgdT('net')}</th><th /></tr></thead>
            <tbody>{d.agents.map((x) => { const s = agentStatement(x, d.inv, d.pur); return (
              <tr key={x.vendor.id} data-lg-agent={x.vendor.name}><td>{x.vendor.name}</td><td>{list('agentKinds', AGENT_KINDS, x.vendor.lg!.kind)}</td><td>{n2(s.ours)}</td><td>{n2(s.theirs)}</td><td>{n2(s.net)}</td>
                <td><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setSel(x.vendor.id)}>{lgT('open')}</button></td></tr>); })}</tbody>
          </table>
        </div>
      ) : null}
      {a && st && (
        <section data-lg-agent-desk>
          <h3>{a.vendor.name}</h3>
          <div style={row}>
            <Pick label={lgT('job')} value={f.job} ids={d.jobs.map((j) => j.id)} name={(x) => d.jobs.find((j) => j.id === x)?.number ?? x} blank="-" onChange={(v) => setF({ ...f, job: v })} attr="agent-job" />
            <Pick label={lgT('kind')} value={f.kind} ids={NOTE_KINDS} name={(x) => list('noteKinds', NOTE_KINDS, x)} onChange={(v) => setF({ ...f, kind: v as NoteKind })} />
            <In label={lgdT('amount')} type="number" value={f.amount} onChange={(v) => setF({ ...f, amount: numIn(v) })} attr="agent-amount" />
            <In label={lgT('currency')} value={f.cur} onChange={(v) => setF({ ...f, cur: v.toUpperCase().slice(0, 3) })} />
            <In label={lgT('rate')} type="number" value={rate} onChange={(v) => setF({ ...f, rate: numIn(v) })} attr="agent-rate" />
            <In label={lgT('date')} type="date" value={f.date} onChange={(v) => setF({ ...f, date: v })} />
            <In label={lgdT('billNo')} value={f.bill} onChange={(v) => setF({ ...f, bill: v })} attr="agent-bill-no" />
          </div>
          <div style={row}>
            <button type="button" className={controls.btnPrimary} onClick={() => act(() => issueAgentNote({ agent: a, job, kind: f.kind, amount: f.amount ?? 0, currency: f.cur, rate: rate ?? 0, lut: a.vendor.lg?.foreign ? lutOnDay(f.date) : null }, f.date, draftBase()))} data-lg-debit-agent>{lgdT('debit')}</button>
            <button type="button" className={controls.btnOutline} onClick={() => act(() => { if (!job) throw new Error(lgT('eNoJob')); saveAgentBill({ agent: a, job, bill_no: f.bill, date: f.date, amount: f.amount ?? 0, currency: f.cur, rate: rate ?? 0 }); })} data-lg-agent-bill>{lgdT('agentBill')}</button>
          </div>
          <p className={controls.hint}>{lgdT('hNote')}</p>
          <div style={row}><Pick label={lgdT('period')} value={period} ids={periods} name={(x) => x} blank={lgT('all')} onChange={setPeriod} /></div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{lgdT('doc')}</th><th>{lgT('date')}</th><th>{lgT('job')}</th><th>{lgdT('ours')}</th><th>{lgdT('theirs')}</th></tr></thead>
              <tbody>
                {st.notes.map((x) => <tr key={x.id}><td>{x.number}</td><td>{x.date}</td><td>{d.jobs.find((j) => j.id === x.job_id)?.number}</td><td>{n2(x.open)} {x.cur}</td><td /></tr>)}
                {st.bills.map((x) => <tr key={x.id}><td>{x.number}</td><td>{x.date}</td><td>{d.jobs.find((j) => j.id === x.job_id)?.number}</td><td /><td>{n2(x.open)} {x.cur}</td></tr>)}
              </tbody>
              <tfoot><tr><th colSpan={3}>{lgdT('net')}</th><td data-lg-agent-net colSpan={2}>{n2(st.net)}</td></tr></tfoot>
            </table>
          </div>
          <label className={controls.field}><span className={controls.label}>{lgdT('paste')}</span><textarea className={controls.textarea} rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="JOB/FY26-27/0001,-90" /></label>
          {m && (m.diff.length ? <ul>{m.diff.map((x) => <li key={x.ref}>{lgdT('diff', { r: x.ref, o: n2(x.ours), t: n2(x.theirs) })}</li>)}</ul> : null)}
          <div style={row}>
            <In label={lgdT('amount')} type="number" value={net.amount ?? Math.min(st.ours, st.theirs)} onChange={(v) => setNet({ ...net, amount: numIn(v) })} attr="agent-settle" />
            <label className={controls.check}><input type="checkbox" checked={net.rcm} onChange={(e) => setNet({ ...net, rcm: e.target.checked })} data-lg-rcm-paid /> {lgdT('rcmPaid')}</label>
            <button type="button" className={controls.btnPrimary} onClick={() => act(() => settleAgent(a, { amount: net.amount ?? Math.min(st.ours, st.theirs), date: todayInput(), rcmPaid: net.rcm }, syncNettedPaid))} data-lg-settle>{lgdT('settle')}</button>
          </div>
          <p className={controls.hint}>{lgdT('hFema')}</p>
        </section>
      )}
    </>
  );
}
