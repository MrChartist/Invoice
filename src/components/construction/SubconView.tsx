/** CN-D1 Works → Sub-contracts: work orders (back-to-back from the BOQ), measured sub-contractor bills, retention payable. */
import { useMemo, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import type { Vendor } from '../../types/purchases';
import type { SubDeductionRule } from '../../types/construction-r11';
import { generateId, getTable } from '../../lib/storage';
import { godownsDb } from '../../lib/godowns';
import { stockDb } from '../../lib/inventory';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { boqLines } from '../../lib/works/boq';
import { deleteWorkOrder, fromBoq, loadWorkOrders, saveWorkOrder, setWoStatus, sitesOf, woValue } from '../../lib/construction/cn-subcon';
import { cancelSubBill, loadSubBills, previousQty, releaseRetention, retentionPayable, saveSubBill, subBillHtml } from '../../lib/construction/cn-subcon-bill';
import { B, fmtMoney, printHtml, today, type Notify } from '../transport/shared';
import { Num, Sel, Table, Txt } from './site-ui';
import { T, n, opt, row, useRun } from './site-kit';
import controls from '../../styles/controls.module.css';

export default function SubconView({ boq, notify }: { boq?: InvoiceRecord; notify: Notify }) {
  const [tick, run] = useRun(notify);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ wos: loadWorkOrders(), bills: loadSubBills(), vendors: getTable<Vendor>('vendors'), sites: sitesOf(godownsDb.stored()), purchases: purchasesDb.all(), items: stockDb.items() }), [tick]);
  const lines = boq ? boqLines(boq) : [];
  const [f, setF] = useState({ vendor: '', site: '', date: today(), pct: '90', ret: '5', adv: '0', gst: '18', pick: [] as string[], desc: '', unit: 'cum', qty: '', rate: '' });
  const [woId, setWoId] = useState('');
  const wo = d.wos.find((w) => w.id === woId) ?? d.wos.find((w) => w.status === 'open');
  const [q, setQ] = useState<Record<string, { cum: string; mb: string }>>({});
  const [b, setB] = useState({ date: today(), item: '', mq: '', mr: '', hire: true });
  const [rel, setRel] = useState({ vendor: '', amount: '', method: 'Bank transfer' });
  const saveWo = () => run(() => {
    const v = d.vendors.find((x) => x.id === f.vendor);
    const picked = boq ? fromBoq(boq, f.pick.length ? f.pick : lines.map((l) => l.id), n(f.pct), {}, n(f.gst)) : [];
    const typed = f.desc.trim() && n(f.qty) > 0 ? [{ id: generateId(), ref: '', description: f.desc, unit: f.unit, qty: n(f.qty), rate: n(f.rate), sac: '9954', gst_rate: n(f.gst) }] : [];
    const deductions: SubDeductionRule[] = [{ kind: 'retention', rate: n(f.ret) }, { kind: 'advance_recovery', rate: n(f.adv) }];
    const site = d.sites.find((s) => s.id === f.site);
    const w = saveWorkOrder({ date: f.date, vendor_id: v?.id ?? '', vendor_name: v?.name ?? '', boq_id: boq?.id, site_id: site?.id, cost_centre_id: site?.cost_centre_id ?? boq?.boq_terms?.cost_centre_id, lines: [...picked, ...typed], deductions });
    setWoId(w.id);
    return T('woSaved', { n: w.number });
  });
  const prev = wo ? previousQty(wo.id, d.bills) : new Map<string, number>();
  const saveBill = () => run(() => {
    const it = d.items.find((x) => x.id === b.item);
    const out = saveSubBill(wo?.id ?? '', { date: b.date, qty: Object.entries(q).filter(([, x]) => x.cum !== '').map(([line_id, x]) => ({ line_id, cumulative: n(x.cum), mb_ref: x.mb })), material: n(b.mq) > 0 ? [{ item_id: it?.id, label: it?.name, qty: n(b.mq), rate: n(b.mr) }] : [], recoverHire: b.hire });
    setQ({});
    return T('billSaved', { n: out.measurement.number, x: fmtMoney(out.bill.cn_sub?.net ?? 0) });
  });
  const company = localDb.settings.activeProfile()?.companyName ?? '';
  const ret = retentionPayable(d.purchases);
  return (
    <div data-sd-view="subcon">
      <h4>{T('newWo')}</h4>
      <div style={row} data-sd-wo-form>
        <Sel l={T('sub')} v={f.vendor} set={(x) => setF({ ...f, vendor: x })} o={opt(d.vendors, (v) => v.id, (v) => v.name)} n={220} d="wo-vendor" />
        <Sel l={T('site')} v={f.site} set={(x) => setF({ ...f, site: x })} o={opt(d.sites, (s) => s.id, (s) => s.name)} n={200} />
        <Txt l={T('date')} v={f.date} set={(x) => setF({ ...f, date: x })} type="date" n={160} />
        {boq && <Num l={T('pct')} v={f.pct} set={(x) => setF({ ...f, pct: x })} d="wo-pct" />}
        <Num l={T('ret')} v={f.ret} set={(x) => setF({ ...f, ret: x })} d="wo-ret" />
        <Num l={T('adv')} v={f.adv} set={(x) => setF({ ...f, adv: x })} />
        <Num l={T('gst')} v={f.gst} set={(x) => setF({ ...f, gst: x })} n={90} />
      </div>
      {boq && <div style={row}>{lines.map((l) => <label key={l.id}><input type="checkbox" checked={!f.pick.length || f.pick.includes(l.id)} onChange={(e) => setF({ ...f, pick: e.target.checked ? [...f.pick, l.id] : (f.pick.length ? f.pick : lines.map((x) => x.id)).filter((x) => x !== l.id) })} /> {l.name}</label>)}</div>}
      <div style={row}>
        <Txt l={T('desc')} v={f.desc} set={(x) => setF({ ...f, desc: x })} n={240} d="wo-desc" />
        <Txt l={T('unit')} v={f.unit} set={(x) => setF({ ...f, unit: x })} n={80} />
        <Num l={T('qty')} v={f.qty} set={(x) => setF({ ...f, qty: x })} d="wo-qty" />
        <Num l={T('rate')} v={f.rate} set={(x) => setF({ ...f, rate: x })} d="wo-rate" />
        <button type="button" className={B.p} onClick={saveWo} data-sd-save-wo>{T('saveWo')}</button>
      </div>
      <Table d="wos" head={[T('wo'), T('sub'), T('value'), T('status'), '']} rows={d.wos.map((w) => [w.number, w.vendor_name, fmtMoney(woValue(w)), T(`st.${w.status}`), <span key="a" style={row}>
        <button type="button" className={B.os} onClick={() => setWoId(w.id)}>{T('measure')}</button>
        {w.status === 'open' && <button type="button" className={B.gs} onClick={() => run(() => setWoStatus(w.id, 'closed'))}>{T('close')}</button>}
        <button type="button" className={B.gs} onClick={() => run(() => deleteWorkOrder(w.id))}>{T('del')}</button></span>])} />
      {wo && <>
        <h4>{T('measureWo', { n: wo.number })}</h4>
        <Table d="measure" head={[T('desc'), T('rate'), T('prevQty'), T('cumQty'), T('mb')]} rows={wo.lines.map((l) => [`${l.ref} ${l.description} (${l.unit})`, l.rate, prev.get(l.id) ?? 0,
          <input key="c" className={controls.input} type="number" value={q[l.id]?.cum ?? ''} onChange={(e) => setQ({ ...q, [l.id]: { mb: q[l.id]?.mb ?? '', cum: e.target.value } })} data-sd-cum aria-label={T('cumQty')} />,
          <input key="m" className={controls.input} value={q[l.id]?.mb ?? ''} onChange={(e) => setQ({ ...q, [l.id]: { cum: q[l.id]?.cum ?? '', mb: e.target.value } })} aria-label={T('mb')} />])} />
        <div style={row} data-sd-bill-form>
          <Txt l={T('date')} v={b.date} set={(x) => setB({ ...b, date: x })} type="date" n={160} />
          <Sel l={T('matIssued')} v={b.item} set={(x) => setB({ ...b, item: x })} o={opt(d.items, (i) => i.id, (i) => i.name)} n={200} />
          <Num l={T('qty')} v={b.mq} set={(x) => setB({ ...b, mq: x })} />
          <Num l={T('recRate')} v={b.mr} set={(x) => setB({ ...b, mr: x })} />
          <label><input type="checkbox" checked={b.hire} onChange={(e) => setB({ ...b, hire: e.target.checked })} /> {T('hireRec')}</label>
          <button type="button" className={B.p} onClick={saveBill} data-sd-save-bill>{T('saveBill')}</button>
        </div>
      </>}
      <h4>{T('bills')}</h4>
      <Table d="bills" head={[T('scb'), T('date'), T('wo'), T('total'), T('tds'), T('deds'), T('net'), '']} rows={d.bills.map((m) => {
        const p = d.purchases.find((x) => x.id === m.purchase_id);
        const cn = p?.cn_sub;
        return [m.number, m.date, d.wos.find((w) => w.id === m.wo_id)?.number ?? '', p ? fmtMoney(p.total) : '—', fmtMoney(cn?.tds ?? 0), cn?.deductions?.map((x) => `${x.label}: ${fmtMoney(x.amount)}`).join('; ') ?? '', fmtMoney(cn?.net ?? 0),
          m.status === 'cancelled' ? T('st.cancelled') : <span key="a" style={row}>{p && <button type="button" className={B.os} onClick={() => printHtml(subBillHtml(p, company), m.number)}>{T('print')}</button>}<button type="button" className={B.gs} onClick={() => run(() => { cancelSubBill(m.id); })}>{T('cancel')}</button>{!p && <small>{T('billGone')}</small>}</span>];
      })} />
      <h4>{T('retPayable')}</h4>
      <Table d="retention" head={[T('sub'), T('held'), T('released'), T('due')]} rows={ret.map((r) => [r.vendor, fmtMoney(r.held), fmtMoney(r.released), fmtMoney(r.due)])} />
      {ret.some((r) => r.due > 0) && <div style={row}>
        <Sel l={T('sub')} v={rel.vendor} set={(x) => setRel({ ...rel, vendor: x })} o={opt(ret.filter((r) => r.due > 0), (r) => r.vendor, (r) => r.vendor)} n={200} />
        <Num l={T('amount')} v={rel.amount} set={(x) => setRel({ ...rel, amount: x })} />
        <Sel l={T('method')} v={rel.method} set={(x) => setRel({ ...rel, method: x })} o={[['Bank transfer', T('bank')], ['Cash', T('cash')]]} n={150} />
        <button type="button" className={B.o} onClick={() => run(() => T('released1', { n: releaseRetention(rel.vendor, n(rel.amount), today(), rel.method).number }))}>{T('release')}</button>
      </div>}
      <p className={controls.hint}>{T('subNote')}</p>
    </div>
  );
}
