/**
 * AG-A3 Farm → Vouchers: the farmer purchase voucher (`FPV/FY…`) — weighing (bags, gross, tare, dhalta), quality
 * readings against the commodity's cut table, R8 charge heads (paid by us / recovered from the farmer), the declaration
 * and the 194Q hint; the list with print, pay (Rule 6DD(e) note for cash to a farmer) and delete.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { agT } from '../../i18n/areas/agri-r12a';
import { DB_PREFIX, getJson, getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { localDb } from '../../lib/localDb';
import { paymentsDb, purchasesDb } from '../../lib/purchases';
import { chargeAmount, chargeBase, headsFor, loadHeads } from '../../lib/trade/tr-charges';
import { blankWeight } from '../../lib/trade/tr-weight';
import { cashPaymentIssue } from '../../lib/retail/rt-cash-guard';
import { loadFarmers } from '../../lib/agri/ag-farmers';
import { loadQualityTables } from '../../lib/agri/ag-quality';
import { farmerVouchers, fyPurchasesOf, saveVoucher, voucherWorking, type VoucherInput } from '../../lib/agri/ag-vouchers';
import { prompt194q } from '../../lib/agri/ag-tax';
import { voucherHtml } from '../../lib/agri/ag-print';
import type { AgVoucherCharge } from '../../types/agri-r12';
import controls from '../../styles/controls.module.css';
import { F, Grid, In } from './agri-ui';
import { money, useRun, wrap, type Done } from './agri-util';

const n = (s: string) => Number(s) || 0;

export default function VouchersView({ onDone }: { onDone: Done }) {
  useT();
  const { tick, run } = useRun(onDone);
  /* eslint-disable react-hooks/exhaustive-deps */
  const farmers = useMemo(() => loadFarmers(), [tick]);
  const tables = useMemo(() => loadQualityTables(), [tick]);
  const heads = useMemo(() => headsFor(loadHeads(), 'purchase'), [tick]);
  const vouchers = useMemo(() => farmerVouchers(getTable('purchases')), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const [fid, setFid] = useState('');
  const [date, setDate] = useState(todayInput());
  const [table, setTable] = useState('');
  const [item, setItem] = useState('');
  const [hsn, setHsn] = useState('');
  const [unit, setUnit] = useState('QTL');
  const [bags, setBags] = useState('');
  const [gross, setGross] = useState('');
  const [tare, setTare] = useState('');
  const [rate, setRate] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [read, setRead] = useState<Record<string, string>>({});
  const [by, setBy] = useState<Record<string, '' | 'us' | 'farmer'>>({});
  const [accept, setAccept] = useState(false);
  const [pay, setPay] = useState<{ id: string; amount: string; method: string } | null>(null);
  const qt = tables.find((t) => t.id === table);
  const vendor = farmers.find((x) => x.id === fid);
  const wt = { ...blankWeight(), packages: n(bags), gross: n(gross), tare_per_package: n(tare) };
  const goods: VoucherInput | null = vendor ? { vendor, date, commodity: qt?.commodity, item: { name: item || qt?.commodity || '', hsn, unit }, wt, rate: n(rate), params: qt?.params, readings: Object.fromEntries(Object.entries(read).map(([k, v]) => [k, v === '' ? undefined : n(v)])), vehicle } : null;
  const pre = goods && n(gross) > 0 ? voucherWorking(goods) : null;
  // Charge bases from the accepted goods (value, bags, net quintals) — R8 heads, no preset rate.
  const base = { ...chargeBase([]), value: pre?.goods ?? 0, bags: n(bags), qtl: (pre?.quality.accepted_kg ?? 0) / 100, qty: pre?.qty ?? 0 };
  const charges: AgVoucherCharge[] = heads.filter((h) => by[h.id]).map((h) => ({ head_id: h.id, name: h.name, by: by[h.id] as 'us' | 'farmer', amount: chargeAmount(h, base).amount }));
  const input: VoucherInput | null = goods && { ...goods, charges };
  const w = input && pre ? voucherWorking(input) : null;
  const q194 = w && vendor ? prompt194q(date, fyPurchasesOf(vendor.id, date, getTable('purchases')) + w.value, getJson<{ turnover_by_fy?: Record<string, number> }>(`${DB_PREFIX}tds_settings`, {})?.turnover_by_fy) : '';
  const profile = localDb.settings.activeProfile();
  const print = (id: string) => {
    const b = purchasesDb.get(id);
    if (!b) return;
    const fm = farmers.find((x) => x.id === b.vendor_id);
    const html = voucherHtml(b, { name: profile?.companyName ?? '', address: profile?.companyAddress, gstin: profile?.companyGstin }, fm?.ag);
    printHtmlDocument(html, (h) => downloadText(`${b.bill_number.replace(/\W+/g, '-')}.html`, h, 'text/html'));
  };
  const payBill = pay && purchasesDb.get(pay.id);
  const cashToday = payBill ? paymentsDb.all().filter((p) => p.date === todayInput() && p.method.toLowerCase() === 'cash' && purchasesDb.get(p.purchase_id)?.vendor_id === payBill.vendor_id).reduce((s, p) => s + p.amount, 0) : 0;
  const cashNote = payBill && pay.method === 'Cash' ? cashPaymentIssue(cashToday + n(pay.amount), todayInput(), farmers.find((x) => x.id === payBill.vendor_id) ?? { principal_kind: 'registered' }) : '';
  return (
    <div data-ag-vouchers>
      <div style={wrap}>
        <F label={agT('farmer')}><select className={controls.select} value={fid} onChange={(e) => setFid(e.target.value)} data-ag-v-farmer><option value="">—</option>{farmers.map((x) => <option key={x.id} value={x.id}>{x.ag.code} · {x.name}</option>)}</select></F>
        <F label={agT('date')}><In v={date} set={setDate} type="date" /></F>
        <F label={agT('commodity')}><select className={controls.select} value={table} onChange={(e) => setTable(e.target.value)} data-ag-v-table><option value="">—</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.commodity}</option>)}</select></F>
        <F label={agT('produce')}><In v={item} set={setItem} data-ag-v-item /></F>
        <F label="HSN"><In v={hsn} set={setHsn} w={90} /></F>
        <F label={agT('unit')}><select className={controls.select} value={unit} onChange={(e) => setUnit(e.target.value)}><option>QTL</option><option>KG</option></select></F>
        <F label={agT('bags')}><In v={bags} set={setBags} type="number" w={80} data-ag-v-bags /></F>
        <F label={agT('grossKg')}><In v={gross} set={setGross} type="number" w={100} data-ag-v-gross /></F>
        <F label={agT('tareBag')}><In v={tare} set={setTare} type="number" w={80} data-ag-v-tare /></F>
        <F label={agT('ratePer', { unit })}><In v={rate} set={setRate} type="number" w={100} data-ag-v-rate /></F>
        <F label={agT('vehicle')}><In v={vehicle} set={setVehicle} w={110} /></F>
        {qt?.params.map((p) => <F key={p.key + (p.label ?? '')} label={`${p.label ?? agT(`q.${p.key}`)} %`}><In v={read[p.label ?? p.key] ?? ''} set={(v) => setRead({ ...read, [p.label ?? p.key]: v })} type="number" w={80} data-ag-v-reading={p.key} /></F>)}
      </div>
      {heads.length > 0 && (
        <div style={wrap}>{heads.map((h) => <F key={h.id} label={h.name}><select className={controls.select} value={by[h.id] ?? ''} onChange={(e) => setBy({ ...by, [h.id]: e.target.value as 'us' })}><option value="">—</option><option value="us">{agT('paidByUs')}</option><option value="farmer">{agT('recovered')}</option></select></F>)}</div>
      )}
      {w && (
        <div data-ag-v-working>
          <p>{agT('working', { net: w.netKg, cut: w.quality.cut_kg, acc: w.quality.accepted_kg, qty: w.qty, unit, value: money(w.value) })}</p>
          {w.quality.rows.map((r) => <p key={r.key + (r.label ?? '')} className={controls.hint} data-ag-cut-row>{`${r.label ?? agT(`q.${r.key}`)} ${r.reading}% (${agT('norm')} ${r.norm}%) → ${r.cut_pct}%${r.cut_kg ? ` = ${r.cut_kg} kg` : r.cut_rs ? ` = ${money(r.cut_rs)}` : ''}${r.reject ? ` · ${agT('reject')}` : ''}`}</p>)}
          {w.declaration && <p data-ag-declaration>{w.declaration}</p>}
          {q194 && <p className={controls.hint} role="alert">{q194}</p>}
          {w.quality.reject && <label className={controls.check}><input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} /> {agT('acceptAnyway')}</label>}
        </div>
      )}
      <button type="button" className={controls.btnPrimary} disabled={!input} onClick={() => run(() => { const b = saveVoucher(input!, { acceptReject: accept }); setGross(''); setBags(''); setRead({}); return agT('voucherSaved', { no: b.bill_number }); })} data-ag-save-voucher>{agT('saveVoucher')}</button>
      <Grid attr="vouchers" head={[agT('number'), agT('date'), agT('farmer'), agT('produce'), agT('total'), agT('paid'), '']} rows={vouchers.map((b) => [b.bill_number, b.date, b.vendor_name, b.lines[0]?.name ?? '', money(b.total), money(b.amount_paid), (
        <span key="a" style={{ display: 'flex', gap: 4 }}>
          <button type="button" className={controls.btnGhost} onClick={() => print(b.id)} data-ag-print-voucher>{agT('print')}</button>
          <button type="button" className={controls.btnGhost} onClick={() => setPay({ id: b.id, amount: String(Math.max(b.total - b.amount_paid, 0)), method: 'Cash' })} data-ag-pay>{agT('pay')}</button>
          <button type="button" className={controls.btnGhost} onClick={() => run(() => { purchasesDb.remove(b.id); return agT('deleted'); })}>{agT('delete')}</button>
        </span>
      )])} />
      {pay && payBill && (
        <div style={wrap} data-ag-pay-form>
          <F label={agT('amount')}><In v={pay.amount} set={(v) => setPay({ ...pay, amount: v })} type="number" w={110} data-ag-pay-amount /></F>
          <F label={agT('method')}><select className={controls.select} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}><option>Cash</option><option>Bank transfer</option><option>UPI</option></select></F>
          <button type="button" className={controls.btnPrimary} onClick={() => run(() => { paymentsDb.record(pay.id, { amount: n(pay.amount), date: todayInput(), method: pay.method }); setPay(null); return agT('paidOk'); })} data-ag-pay-save>{agT('pay')}</button>
          {cashNote && <p className={controls.hint} role="note" data-ag-cash-note>{cashNote}</p>}
        </div>
      )}
    </div>
  );
}
