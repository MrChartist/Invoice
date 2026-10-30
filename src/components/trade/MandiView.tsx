/**
 * Distribution → Mandi (TR-B2; commodity / agency pack): bill-charge heads (no preset rates, §8 Q6) and the market fee
 * register per period (sales and purchase sides, CSV), with what is payable to the mandi. Working paper (TR6, TR7).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { tbT } from '../../i18n/areas/trade-r8b';
import { getTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import { formatCurrency, todayInput } from '../../lib/utils';
import { addUsualHeads, chargeRegister, loadHeads, registerCsv, registerSummary, removeHead, saveHead } from '../../lib/trade/tr-charges';
import type { ChargeHead } from '../../types/trade-r8';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

type Done = (msg: string, error?: boolean) => void;
const F = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>
);
const blank = (): Partial<ChargeHead> & { name: string } => ({ name: '', side: 'both', basis: 'percent', rate: 0, gst: 'in_value' });
const SIDES = ['sale', 'purchase', 'both'] as const;
const BASES = ['percent', 'per_package', 'per_qtl', 'per_unit', 'fixed'] as const;
const GSTS = ['in_value', 'own_rate', 'outside'] as const;

export default function MandiTab({ onDone }: { onDone: Done }) {
  useT();
  const [tick, setTick] = useState(0);
  const [form, setForm] = useState(blank);
  const today = todayInput();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const run = (fn: () => string) => {
    try {
      onDone(fn());
      setTick((x) => x + 1);
    } catch (e) {
      onDone((e as Error).message, true);
    }
  };
  const heads = useMemo(() => { void tick; return loadHeads(); }, [tick]);
  const rows = useMemo(() => chargeRegister({ from, to }, { invoices: getTable<InvoiceRecord>('invoices'), purchases: getTable('purchases'), heads }), [from, to, heads]);
  const sum = registerSummary(rows, heads);
  const set = (p: Partial<ChargeHead>) => setForm((f) => ({ ...f, ...p }));
  return (
    <div className={own.stack} data-mandi-tab>
      <h3>{tbT('charges')}</h3>
      {heads.length > 0 && (
        <div className={own.tableWrap}>
          <table className={own.table}>
            <thead><tr><th>{tbT('name')}</th><th>{tbT('side')}</th><th>{tbT('basis')}</th><th className={own.num}>{tbT('rate')}</th><th>GST</th><th /></tr></thead>
            <tbody>
              {heads.map((h) => (
                <tr key={h.id} data-head={h.name}>
                  <td>{h.name}{h.auto ? ' ·A' : ''}{h.payable ? ' ·M' : ''}</td>
                  <td>{tbT(`side.${h.side}`)}</td>
                  <td>{tbT(`basis.${h.basis}`)}</td>
                  <td className={own.num}>{h.rate}</td>
                  <td>{tbT(`gst.${h.gst}`)}{h.gst === 'own_rate' ? ` ${h.sac} @ ${h.gst_rate}%` : ''}</td>
                  <td>
                    <button type="button" className={controls.btnGhost} onClick={() => setForm({ ...h })}>{tbT('edit')}</button>
                    <button type="button" className={controls.btnGhost} onClick={() => run(() => { removeHead(h.id); return tbT('done'); })}>{tbT('remove')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={own.row} data-head-form>
        <F label={tbT('name')}><input className={controls.input} value={form.name} onChange={(e) => set({ name: e.target.value })} data-head-name /></F>
        <F label={tbT('side')}><SelectField className={controls.select} value={form.side} onChange={(e) => set({ side: e.target.value as ChargeHead['side'] })}>{SIDES.map((x) => <option key={x} value={x}>{tbT(`side.${x}`)}</option>)}</SelectField></F>
        <F label={tbT('basis')}><SelectField className={controls.select} value={form.basis} onChange={(e) => set({ basis: e.target.value as ChargeHead['basis'] })} data-head-basis>{BASES.map((x) => <option key={x} value={x}>{tbT(`basis.${x}`)}</option>)}</SelectField></F>
        <F label={tbT('rate')}><input type="number" min={0} step="0.01" className={controls.input} value={form.rate ?? ''} onChange={(e) => set({ rate: Number(e.target.value) })} data-head-rate /></F>
        <F label="GST"><SelectField className={controls.select} value={form.gst} onChange={(e) => set({ gst: e.target.value as ChargeHead['gst'] })}>{GSTS.map((x) => <option key={x} value={x}>{tbT(`gst.${x}`)}</option>)}</SelectField></F>
        {form.gst === 'own_rate' && <F label="SAC"><input className={controls.input} value={form.sac ?? ''} onChange={(e) => set({ sac: e.target.value.replace(/\D/g, '') })} /></F>}
        {form.gst === 'own_rate' && <F label="GST %"><input type="number" min={0} className={controls.input} value={form.gst_rate ?? ''} onChange={(e) => set({ gst_rate: Number(e.target.value) })} /></F>}
        <label className={controls.check}><input type="checkbox" checked={!!form.payable} onChange={(e) => set({ payable: e.target.checked })} /> {tbT('payable')} (M)</label>
        <label className={controls.check}><input type="checkbox" checked={!!form.auto} onChange={(e) => set({ auto: e.target.checked })} data-head-auto /> {tbT('auto')} (A)</label>
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => { saveHead(form); setForm(blank()); return tbT('done'); })} data-head-save>{tbT('save')}</button>
        <button type="button" className={controls.btnOutline} onClick={() => run(() => tbT('added', { n: addUsualHeads() }))}>{tbT('addUsual')}</button>
      </div>
      <h3>{tbT('register')}</h3>
      <div className={own.row}>
        <F label={tbT('from')}><DateField className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></F>
        <F label={tbT('to')}><DateField className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></F>
        <button type="button" className={controls.btnOutline} disabled={!rows.length} onClick={() => downloadText(`market-fee-register-${from}-${to}.csv`, registerCsv(rows, { from, to }), 'text/csv')}>CSV</button>
      </div>
      {rows.length === 0 ? <p className={own.muted}>{tbT('noRows')}</p> : (
        <div className={own.tableWrap}>
          <table className={own.table} data-mandi-register>
            <thead><tr><th>{tbT('name')}</th><th>{tbT('side')}</th><th className={own.num}>{tbT('docs')}</th><th className={own.num}>{tbT('base')}</th><th className={own.num}>{tbT('amount')}</th></tr></thead>
            <tbody>
              {sum.heads.map((h) => (
                <tr key={`${h.head}|${h.side}`}><td>{h.head}</td><td>{tbT(`side.${h.side as 'sale'}`)}</td><td className={own.num}>{h.docs}</td><td className={own.num}>{h.base}</td><td className={own.num}>{formatCurrency(h.amount)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={own.notice} data-mandi-payable>{tbT('payableTotal', { amount: formatCurrency(sum.payable) })}</p>
      <p className={own.muted}>{tbT('caNote')}</p>
    </div>
  );
}
