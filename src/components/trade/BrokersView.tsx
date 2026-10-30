/**
 * Distribution → Brokers (TR-B3; commodity / agency pack): broker master (a `sales_agents` row of kind broker),
 * brokerage statement per period, the payable journal with TDS u/s 194H, and undo. Working paper (TR12, T15).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { tbT } from '../../i18n/areas/trade-r8b';
import { getTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import { formatCurrency, todayInput } from '../../lib/utils';
import type { SalesAgent } from '../../lib/sales-commission';
import { brokerageCsv, brokerageStatement, loadBrokeragePostings, loadBrokers } from '../../lib/trade/tr-brokers';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

type Done = (msg: string, error?: boolean) => void;
const F = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>
);
const blank = (): SalesAgent => ({ id: '', name: '', rate: 0, basis: 'invoice', kind: 'broker', brokerage_basis: 'percent', brokerage_rate: 0 });
const BASES = ['percent', 'per_package', 'per_qtl', 'per_unit'] as const;

export default function BrokersTab({ onDone }: { onDone: Done }) {
  useT();
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState<SalesAgent>(blank);
  const today = todayInput();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [pick, setPick] = useState('');
  // Saving and posting load the books modules on click (tr-brokers-post.ts), so this screen's chunk stays light.
  const run = (fn: (m: typeof import('../../lib/trade/tr-brokers-post')) => string) => {
    void import('../../lib/trade/tr-brokers-post').then((m) => {
      try {
        onDone(fn(m));
        setTick((x) => x + 1);
      } catch (e) {
        onDone((e as Error).message, true);
      }
    });
  };
  const brokers = useMemo(() => { void tick; return loadBrokers(); }, [tick]);
  const postings = useMemo(() => { void tick; return loadBrokeragePostings(); }, [tick]);
  const vendors = useMemo(() => getTable<{ id: string; name: string }>('vendors'), []);
  const broker = brokers.find((b) => b.id === (pick || brokers[0]?.id));
  const st = useMemo(() => (broker ? brokerageStatement(broker, { from, to }, { invoices: getTable<InvoiceRecord>('invoices'), purchases: getTable('purchases') }) : null), [broker, from, to]);
  const set = (p: Partial<SalesAgent>) => setForm((f) => ({ ...f, ...p }));
  return (
    <div className={own.stack} data-brokers-tab>
      <h3>{tbT('broker')}</h3>
      <div className={own.row}>
        {brokers.map((b) => (
          <button key={b.id} type="button" className={controls.btnGhost} onClick={() => setForm({ ...b })}>
            {b.name} · {b.brokerage_rate} {tbT(`basis.${b.brokerage_basis ?? 'percent'}`)}{b.paid_by === 'other_party' ? ` · ${tbT('paidBy.other_party')}` : ''}
          </button>
        ))}
      </div>
      <div className={own.row} data-broker-form>
        <F label={tbT('name')}><input className={controls.input} value={form.name} onChange={(e) => set({ name: e.target.value })} data-broker-name /></F>
        <F label="PAN"><input className={controls.input} value={form.pan ?? ''} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} /></F>
        <F label={tbT('basis')}><SelectField className={controls.select} value={form.brokerage_basis} onChange={(e) => set({ brokerage_basis: e.target.value as SalesAgent['brokerage_basis'] })} data-broker-basis>{BASES.map((x) => <option key={x} value={x}>{tbT(`basis.${x}`)}</option>)}</SelectField></F>
        <F label={tbT('rate')}><input type="number" min={0} step="0.01" className={controls.input} value={form.brokerage_rate ?? ''} onChange={(e) => set({ brokerage_rate: Number(e.target.value) })} data-broker-rate /></F>
        <F label={tbT('paidBy')}><SelectField className={controls.select} value={form.paid_by ?? 'us'} onChange={(e) => set({ paid_by: e.target.value as 'us' })}>{(['us', 'other_party'] as const).map((x) => <option key={x} value={x}>{tbT(`paidBy.${x}`)}</option>)}</SelectField></F>
        <F label={tbT('payee')}><SelectField className={controls.select} value={form.vendor_id ?? ''} onChange={(e) => set({ vendor_id: e.target.value || undefined })}><option value="">{tbT('none')}</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</SelectField></F>
        <button type="button" className={controls.btnPrimary} onClick={() => run((m) => { m.saveBroker(form); setForm(blank()); return tbT('done'); })} data-broker-save>{tbT('save')}</button>
        {form.id && <button type="button" className={controls.btnOutline} onClick={() => setForm(blank())}>+ {tbT('broker')}</button>}
      </div>
      {broker && st && (
        <>
          <div className={own.row}>
            <F label={tbT('broker')}><SelectField className={controls.select} value={broker.id} onChange={(e) => setPick(e.target.value)}>{brokers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</SelectField></F>
            <F label={tbT('from')}><DateField className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></F>
            <F label={tbT('to')}><DateField className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></F>
          </div>
          {st.lines.length === 0 ? <p className={own.muted}>{tbT('noRows')}</p> : (
            <div className={own.tableWrap}>
              <table className={own.table} data-brokerage={st.total || st.memoTotal}>
                <thead><tr><th>{tbT('side')}</th><th>{tbT('docs')}</th><th className={own.num}>{tbT('base')}</th><th className={own.num}>{tbT('amount')}</th></tr></thead>
                <tbody>
                  {st.lines.map((l) => <tr key={`${l.side}${l.id}`}><td>{tbT(`side.${l.side}`)}</td><td>{l.date} · {l.number} · {l.party}</td><td className={own.num}>{l.base}</td><td className={own.num}>{formatCurrency(l.brokerage)}</td></tr>)}
                  <tr><td /><td>{tbT('amount')}</td><td /><td className={own.num}><b>{formatCurrency(st.total || st.memoTotal)}</b></td></tr>
                </tbody>
              </table>
            </div>
          )}
          {st.memoTotal > 0 && <p className={own.notice}>{tbT('memo')}</p>}
          <div className={own.row}>
            <button type="button" className={controls.btnOutline} disabled={!st.lines.length} onClick={() => downloadText(`brokerage-${broker.name}-${from}-${to}.csv`, brokerageCsv(broker, { from, to }, st), 'text/csv')}>CSV</button>
            <button type="button" className={controls.btnPrimary} disabled={!(st.total > 0)} onClick={() => run((m) => { m.postBrokerage(broker, { from, to }, to > today ? today : to, brokerageStatement(broker, { from, to }, { invoices: getTable<InvoiceRecord>('invoices'), purchases: getTable('purchases') })); return tbT('done'); })} data-broker-post>{tbT('post')}</button>
          </div>
          {postings.filter((p) => p.broker_id === broker.id).map((p) => (
            <p key={p.id} className={own.row}>
              {p.voucher_number} · {p.from} – {p.to} · {formatCurrency(p.amount)}{p.tds ? ` · ${tbT('tds', { amount: formatCurrency(p.tds) })}` : ''}
              <button type="button" className={controls.btnGhost} onClick={() => run((m) => { m.deleteBrokeragePosting(p.id); return tbT('done'); })}>{tbT('undo')}</button>
            </p>
          ))}
        </>
      )}
      <p className={own.muted}>{tbT('tdsNote')}</p>
    </div>
  );
}
