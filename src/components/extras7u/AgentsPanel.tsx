/**
 * Sales agents & commission (7U) — Dashboard → Business tiles. Agent master, statement per period
 * (CSV) and the commission payable journal.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Download, Plus, Save, Trash2 } from 'lucide-react';
import { useCan } from '../../hooks/useCan';
import {
  agentsDb, commissionCsv, commissionStatement, deleteCommissionPosting, liveCommissionData, loadCommissionPostings, postCommission, type SalesAgent,
} from '../../lib/sales-commission';
import { getTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import { getIndianFY } from '../../lib/invoice-number';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { x7T } from '../../i18n/areas/extras-7u';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from './x7u.module.css';

type Notify = (m: string, tone?: 'success' | 'error' | 'info') => void;
const blank = (): SalesAgent => ({ id: '', name: '', rate: 0, basis: 'invoice', group_rates: [] });

export function AgentsPanel({ notify, icon }: { notify: Notify; icon?: ReactNode }) {
  useT();
  const { can } = useCan();
  const [tick, setTick] = useState(0);
  const agents = useMemo(() => agentsDb.all(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const postings = useMemo(() => loadCommissionPostings(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => getTable<{ id: string; name: string }>('stock_groups'), []);
  const [form, setForm] = useState<SalesAgent>(blank);
  const today = todayInput();
  const [agentId, setAgentId] = useState('');
  const [from, setFrom] = useState(() => `${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [tds194h, setTds194h] = useState(false); // R8-B (§8 Q18): opt-in 194H on the salesman posting
  const agent = agents.find((a) => a.id === (agentId || agents[0]?.id));
  const st = useMemo(() => (agent ? commissionStatement(agent, { from, to }, liveCommissionData()) : null), [agent, from, to, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      notify(ok);
      setTick((t) => t + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const setRate = (i: number, patch: Partial<{ group_id: string; rate: number }>) =>
    setForm({ ...form, group_rates: (form.group_rates ?? []).map((g, k) => (k === i ? { ...g, ...patch } : g)) });

  return (
    <section className={surface.card} aria-label={x7T('agentsTitle')} data-x7u="agents">
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{icon} {x7T('agentsTitle')}</span><span className={controls.hint}>{x7T('agentCount', { n: String(agents.length) })}</span></div>
      <div className={cn(surface.cardBody, own.form)}>
        {agents.length > 0 && (
          <ul className={own.list}>
            {agents.map((a) => (
              <li key={a.id} className={own.item}>
                <button type="button" className={controls.btnGhost} onClick={() => setForm({ ...a, group_rates: a.group_rates ?? [] })}>{a.name}{a.active === false ? ` (${x7T('inactive')})` : ''}</button>
                <span>{a.rate}% · {a.basis === 'receipt' ? x7T('onReceipt') : x7T('onInvoice')}{a.group_rates?.length ? ` · ${x7T('groupRatesN', { n: String(a.group_rates.length) })}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
        {can('master.edit') && (
          <div className={own.box}>
            <p className={own.sub}>{form.id ? x7T('editAgent') : x7T('newAgent')}</p>
            <div className={own.row}>
              <label className={controls.field}><span className={controls.label}>{x7T('name')}</span>
                <input className={controls.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>{x7T('phone')}</span>
                <input className={controls.input} value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>PAN</span>
                <input className={controls.input} maxLength={10} value={form.pan ?? ''} onChange={(e) => setForm({ ...form, pan: e.target.value.toUpperCase() })} /></label>
              <label className={controls.field}><span className={controls.label}>{x7T('flatRate')}</span>
                <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={String(form.rate)} onChange={(e) => setForm({ ...form, rate: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} /></label>
              <label className={controls.field}><span className={controls.label}>{x7T('basis')}</span>
                <select className={controls.select} value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value === 'receipt' ? 'receipt' : 'invoice' })}>
                  <option value="invoice">{x7T('onInvoice')}</option>
                  <option value="receipt">{x7T('onReceipt')}</option>
                </select></label>
            </div>
            {(form.group_rates ?? []).map((g, i) => (
              <div key={i} className={own.row}>
                <label className={controls.field}><span className={controls.label}>{x7T('stockGroup')}</span>
                  <select className={controls.select} value={g.group_id} onChange={(e) => setRate(i, { group_id: e.target.value })}>
                    <option value="">—</option>
                    {groups.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select></label>
                <label className={controls.field}><span className={controls.label}>%</span>
                  <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={String(g.rate)} onChange={(e) => setRate(i, { rate: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 })} /></label>
                <button type="button" className={controls.btnGhost} onClick={() => setForm({ ...form, group_rates: (form.group_rates ?? []).filter((_, k) => k !== i) })}>{x7T('remove')}</button>
              </div>
            ))}
            <div className={own.tools}>
              {groups.length > 0 && <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setForm({ ...form, group_rates: [...(form.group_rates ?? []), { group_id: '', rate: 0 }] })}><Plus size={14} /> {x7T('addGroupRate')}</button>}
              {form.id && (
                <label className={controls.check}><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> {x7T('active')}</label>
              )}
              <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => run(() => { agentsDb.save(form); setForm(blank()); }, x7T('agentSaved'))}><Save size={14} /> {x7T('save')}</button>
              {form.id && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setForm(blank())}>{x7T('cancel')}</button>}
              {form.id && <button type="button" className={cn(controls.btnDanger, controls.btnSm)} onClick={() => run(() => { agentsDb.remove(form.id); setForm(blank()); }, x7T('agentDeleted'))}><Trash2 size={14} /></button>}
            </div>
          </div>
        )}
        {agent && st && (
          <>
            <p className={own.sub}>{x7T('statement')}</p>
            <div className={own.row}>
              <label className={controls.field}><span className={controls.label}>{x7T('agent')}</span>
                <select className={controls.select} value={agent.id} onChange={(e) => setAgentId(e.target.value)}>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select></label>
              <label className={controls.field}><span className={controls.label}>{x7T('from')}</span>
                <input className={controls.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className={controls.field}><span className={controls.label}>{x7T('to')}</span>
                <input className={controls.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
            {st.lines.length === 0 ? <p className={own.muted}>{x7T('noCommission')}</p> : (
              <ul className={own.list} data-commission-total={st.total}>
                {st.lines.slice(0, 50).map((l, i) => (
                  <li key={`${l.invoice_id}-${i}`} className={own.item}><span>{formatDate(l.date)} · {l.number} · {l.party}</span><strong className={own.num}>{formatCurrency(l.earned)}</strong></li>
                ))}
                <li className={own.item}><span>{x7T('total')}</span><strong className={own.num}>{formatCurrency(st.total)}</strong></li>
              </ul>
            )}
            <p className={own.muted}>{x7T('tdsNote')}</p>
            <label className={controls.check}><input type="checkbox" checked={tds194h} onChange={(e) => setTds194h(e.target.checked)} /> {x7T('tds194h')}</label>
            <div className={own.tools}>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => downloadText(`commission-${agent.name}-${from}-${to}.csv`, commissionCsv(agent, { from, to }, st), 'text/csv')} disabled={!st.lines.length}><Download size={14} /> CSV</button>
              {can('books.edit') && <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} disabled={!(st.total > 0)} onClick={() => run(() => { postCommission(agent.id, { from, to }, to > today ? today : to, { tds194h }); }, x7T('posted'))}>{x7T('postJournal')}</button>}
            </div>
            {postings.filter((p) => p.agent_id === agent.id).length > 0 && (
              <ul className={own.list}>
                {postings.filter((p) => p.agent_id === agent.id).map((p) => (
                  <li key={p.id} className={own.item}>
                    <span>{p.voucher_number} · {formatDate(p.from)} – {formatDate(p.to)}</span>
                    <strong className={own.num}>{formatCurrency(p.amount)}</strong>
                    {can('books.edit') && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => deleteCommissionPosting(p.id), x7T('postingDeleted'))}>{x7T('undo')}</button>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <p className={own.muted}>{x7T('agentHelp', { fy: getIndianFY(today).label })}</p>
      </div>
    </section>
  );
}
