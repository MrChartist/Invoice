/** CN-D2 Works → Labour: labour-contractor compliance and holds, the manpower supply bill, and the site muster. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Vendor } from '../../types/purchases';
import type { AttachmentRef } from '../../types/attachments';
import type { LabourCompliance, MusterDay } from '../../types/construction-r11';
import { getTable } from '../../lib/storage';
import { godownsDb } from '../../lib/godowns';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { attachFile } from '../../lib/attachment-upload';
import { sitesOf } from '../../lib/construction/cn-subcon';
import { complianceHtml, deleteCompliance, holdPct, labourBills, loadCompliance, manpowerBill, saveCompliance } from '../../lib/construction/cn-labour-compliance';
import { loadLabour, loadMuster, markDay, saveLabour, settleWeek, settlements, undoSettlement, wageSheet } from '../../lib/construction/cn-muster';
import { readConstructionSettings, saveConstructionSettings } from '../../lib/construction/cn-settings';
import { B, errText, fmtMoney, printHtml, today, type Notify } from '../transport/shared';
import { Num, Sel, T, Table, Txt, monthOf, n, opt, row, useRun } from './site-ui';
import controls from '../../styles/controls.module.css';

type Files = { pf?: AttachmentRef; esi?: AttachmentRef; reg?: AttachmentRef };

export default function LabourView({ notify }: { notify: Notify }) {
  const [tick, run] = useRun(notify);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ rows: loadCompliance(), vendors: getTable<Vendor>('vendors'), bills: labourBills(purchasesDb.all()), sites: sitesOf(godownsDb.stored()), labour: loadLabour(), days: loadMuster(), clients: localDb.clients.getAll() }), [tick]);
  const [c, setC] = useState({ vendor: '', month: monthOf(today()), head: '', wages: '', trrn: '', pfAmt: '', challan: '', esiAmt: '', lic: '', till: '', status: 'pending' });
  const [files, setFiles] = useState<Files>({});
  const [pct, setPct] = useState(String(readConstructionSettings().labour_withhold_pct ?? holdPct(today())));
  const [mp, setMp] = useState({ client: '', wages: '', stat: '', svc: '', date: today() });
  const [made, setMade] = useState<{ id: string; n: string } | null>(null);
  const upload = (k: keyof Files) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const ref = await attachFile(file);
      setFiles((f) => ({ ...f, [k]: ref }));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const saveC = () => run(() => {
    const v = d.vendors.find((x) => x.id === c.vendor);
    saveCompliance({ vendor_id: v?.id ?? '', vendor_name: v?.name ?? '', month: c.month, headcount: n(c.head), wages: n(c.wages), pf: { trrn: c.trrn, amount: n(c.pfAmt), ...(files.pf ? { file: files.pf } : {}) }, esi: { challan: c.challan, amount: n(c.esiAmt), ...(files.esi ? { file: files.esi } : {}) }, ...(files.reg ? { wage_register: files.reg } : {}), ...(c.lic ? { licence: { no: c.lic, valid_till: c.till } } : {}), status: c.status as LabourCompliance['status'] });
    setFiles({});
  });
  const company = localDb.settings.activeProfile()?.companyName ?? '';
  return (
    <div data-sd-view="labour">
      <h4>{T('compliance')}</h4>
      <div style={row} data-sd-compliance>
        <Sel l={T('contractor')} v={c.vendor} set={(x) => setC({ ...c, vendor: x })} o={opt(d.vendors, (v) => v.id, (v) => v.name)} n={200} d="lc-vendor" />
        <Txt l={T('month')} v={c.month} set={(x) => setC({ ...c, month: x })} type="month" n={150} />
        <Num l={T('headcount')} v={c.head} set={(x) => setC({ ...c, head: x })} n={100} />
        <Num l={T('wages')} v={c.wages} set={(x) => setC({ ...c, wages: x })} />
        <Txt l={T('trrn')} v={c.trrn} set={(x) => setC({ ...c, trrn: x })} n={160} d="lc-trrn" />
        <Num l={T('pfAmt')} v={c.pfAmt} set={(x) => setC({ ...c, pfAmt: x })} d="lc-pf" />
        <Txt l={T('esiChallan')} v={c.challan} set={(x) => setC({ ...c, challan: x })} n={160} d="lc-esi" />
        <Num l={T('esiAmt')} v={c.esiAmt} set={(x) => setC({ ...c, esiAmt: x })} />
        <Txt l={T('licence')} v={c.lic} set={(x) => setC({ ...c, lic: x })} n={140} />
        <Txt l={T('validTill')} v={c.till} set={(x) => setC({ ...c, till: x })} type="date" n={160} />
        <Sel l={T('status')} v={c.status} set={(x) => setC({ ...c, status: x })} o={(['pending', 'proved', 'waived'] as const).map((k) => [k, T(`lc.${k}`)] as const)} n={130} d="lc-status" />
        {(['pf', 'esi', 'reg'] as const).map((k) => <label key={k} className={controls.field}><span className={controls.label}>{T(`file.${k}`)}{files[k] ? ' ✓' : ''}</span><input type="file" accept="image/*,application/pdf" onChange={upload(k)} /></label>)}
        <button type="button" className={B.p} onClick={saveC} data-sd-save-lc>{T('save')}</button>
      </div>
      <Table d="compliance" head={[T('contractor'), T('month'), T('headcount'), T('pfAmt'), T('esiAmt'), T('status'), '']} rows={d.rows.map((r) => [r.vendor_name, r.month, r.headcount, fmtMoney(r.pf.amount ?? 0), fmtMoney(r.esi.amount ?? 0), T(`lc.${r.status}`), <span key="a" style={row}>
        <button type="button" className={B.os} onClick={() => printHtml(complianceHtml(d.rows, r.month, company), `labour-${r.month}`)}>{T('print')}</button>
        <button type="button" className={B.gs} onClick={() => run(() => deleteCompliance(r.id))}>{T('del')}</button></span>])} />
      <h4>{T('holds')}</h4>
      <div style={row}>
        <Num l={T('holdPct')} v={pct} set={setPct} n={140} />
        <button type="button" className={B.os} onClick={() => run(() => { saveConstructionSettings({ labour_withhold_pct: n(pct) }); })}>{T('save')}</button>
      </div>
      <Table d="holds" head={[T('bill'), T('contractor'), T('date'), T('balance'), T('hold'), T('payNow')]} rows={d.bills.map((b) => [b.bill.bill_number, b.bill.vendor_name, b.bill.date, fmtMoney(b.balance), b.hold > 0 ? <strong key="h" data-sd-hold>{fmtMoney(b.hold)} · {T(`lc.${b.status}`)}</strong> : '—', fmtMoney(b.payNow)])} />
      <h4>{T('manpower')}</h4>
      <div style={row} data-sd-manpower>
        <Sel l={T('client')} v={mp.client} set={(x) => setMp({ ...mp, client: x })} o={opt(d.clients, (x) => x.id ?? '', (x) => x.name)} n={200} />
        <Num l={T('wages')} v={mp.wages} set={(x) => setMp({ ...mp, wages: x })} />
        <Num l={T('statutory')} v={mp.stat} set={(x) => setMp({ ...mp, stat: x })} n={160} />
        <Num l={T('svcCharge')} v={mp.svc} set={(x) => setMp({ ...mp, svc: x })} />
        <Txt l={T('date')} v={mp.date} set={(x) => setMp({ ...mp, date: x })} type="date" n={160} />
        <button type="button" className={B.o} onClick={() => run(() => { const i = manpowerBill(mp.client, n(mp.wages), n(mp.stat), n(mp.svc), mp.date); setMade({ id: i.id, n: i.invoice_number }); return T('draftMade'); })}>{T('makeDraft')}</button>
        {made && <Link to={`/invoice/${made.id}`}>{T('openDraft')} {made.n}</Link>}
      </div>
      <p className={controls.hint}>{T('manpowerNote')}</p>
      <Muster d={d} run={run} />
    </div>
  );
}

type D = { sites: ReturnType<typeof sitesOf>; labour: ReturnType<typeof loadLabour>; days: MusterDay[] };
function Muster({ d, run }: { d: D; run: (fn: () => string | void) => void }) {
  const [site, setSite] = useState('');
  const s = d.sites.find((x) => x.id === site) ?? d.sites[0];
  const crew = d.labour.filter((l) => l.site_id === s?.id && l.active);
  const [w, setW] = useState({ name: '', trade: '', rate: '', ot: '', min: '', phone: '', idr: '' });
  const [day, setDay] = useState(today());
  const marked = d.days.find((x) => x.site_id === s?.id && x.date === day);
  const [att, setAtt] = useState<Record<string, { p: string; ot: string }>>({});
  const val = (id: string) => att[id] ?? { p: String(marked?.entries.find((e) => e.labour_id === id)?.present ?? 1), ot: String(marked?.entries.find((e) => e.labour_id === id)?.ot_hours ?? '') };
  const [wk, setWk] = useState({ from: today(), to: today(), method: 'Cash', adv: {} as Record<string, string> });
  const adv = Object.fromEntries(Object.entries(wk.adv).map(([k, v]) => [k, n(v)]));
  const sheet = s ? wageSheet(d.days, d.labour, s.id, wk.from, wk.to, adv, wk.method === 'Cash') : [];
  if (!s) return <p className={controls.hint}>{T('noSite')}</p>;
  return (
    <section data-sd-muster>
      <h4>{T('muster')}</h4>
      <Sel l={T('site')} v={s.id} set={setSite} o={opt(d.sites, (x) => x.id, (x) => x.name, false)} n={220} />
      <div style={row} data-sd-worker>
        <Txt l={T('name')} v={w.name} set={(x) => setW({ ...w, name: x })} n={180} d="w-name" />
        <Txt l={T('trade')} v={w.trade} set={(x) => setW({ ...w, trade: x })} n={140} />
        <Num l={T('dailyRate')} v={w.rate} set={(x) => setW({ ...w, rate: x })} d="w-rate" />
        <Num l={T('otRate')} v={w.ot} set={(x) => setW({ ...w, ot: x })} />
        <Num l={T('minWage')} v={w.min} set={(x) => setW({ ...w, min: x })} />
        <Txt l={T('phone')} v={w.phone} set={(x) => setW({ ...w, phone: x })} n={140} />
        <Txt l={T('idRef')} v={w.idr} set={(x) => setW({ ...w, idr: x })} n={140} />
        <button type="button" className={B.o} onClick={() => run(() => { saveLabour({ name: w.name, trade: w.trade, daily_rate: n(w.rate), ot_rate: n(w.ot), ...(n(w.min) ? { min_wage: n(w.min) } : {}), phone: w.phone || undefined, id_ref: w.idr || undefined, site_id: s.id }); setW({ ...w, name: '', phone: '', idr: '' }); })} data-sd-add-worker>{T('add')}</button>
      </div>
      <Txt l={T('date')} v={day} set={(x) => { setDay(x); setAtt({}); }} type="date" n={160} />
      <Table d="attendance" head={[T('name'), T('trade'), T('present'), T('otHours')]} rows={crew.map((l) => [l.name, l.trade, <select key="p" className={controls.select} value={val(l.id).p} onChange={(e) => setAtt({ ...att, [l.id]: { ...val(l.id), p: e.target.value } })} aria-label={T('present')}><option value="1">1</option><option value="0.5">½</option><option value="0">0</option></select>,
        <input key="o" className={controls.input} type="number" value={val(l.id).ot} onChange={(e) => setAtt({ ...att, [l.id]: { ...val(l.id), ot: e.target.value } })} aria-label={T('otHours')} />])} />
      {crew.length > 0 && <button type="button" className={B.p} disabled={!!marked?.mus_no} onClick={() => run(() => { markDay(s.id, day, crew.map((l) => ({ labour_id: l.id, present: n(val(l.id).p) as 0 | 0.5 | 1, ot_hours: n(val(l.id).ot) }))); setAtt({}); })} data-sd-mark>{marked?.mus_no ? T('settledIn', { n: marked.mus_no }) : T('saveDay')}</button>}
      <h4>{T('week')}</h4>
      <div style={row}>
        <Txt l={T('from')} v={wk.from} set={(x) => setWk({ ...wk, from: x })} type="date" n={160} />
        <Txt l={T('to')} v={wk.to} set={(x) => setWk({ ...wk, to: x })} type="date" n={160} />
        <Sel l={T('method')} v={wk.method} set={(x) => setWk({ ...wk, method: x })} o={[['Cash', T('cash')], ['Bank transfer', T('bank')]]} n={150} />
      </div>
      <Table d="wages" head={[T('name'), T('days'), T('otHours'), T('gross'), T('advance'), T('net'), '']} rows={sheet.map((r) => [r.labour.name, r.days, r.ot, fmtMoney(r.gross),
        <input key="a" className={controls.input} type="number" value={wk.adv[r.labour.id] ?? ''} onChange={(e) => setWk({ ...wk, adv: { ...wk.adv, [r.labour.id]: e.target.value } })} aria-label={T('advance')} />, fmtMoney(r.net),
        <small key="w" data-sd-warn>{[r.cashWarn && T('cashWarn'), r.minWageWarn && T('minWarn')].filter(Boolean).join(' ')}</small>])} />
      {sheet.length > 0 && <button type="button" className={B.p} onClick={() => run(() => T('settled', { n: settleWeek(s, wk.from, wk.to, { date: wk.to, method: wk.method, advances: adv }).number }))} data-sd-settle>{T('settle')}</button>}
      <Table d="settlements" head={[T('mus'), T('site'), '']} rows={settlements(d.days).map((x) => [x.number, d.sites.find((g) => g.id === x.site_id)?.name ?? '', <button key="u" type="button" className={B.gs} onClick={() => run(() => undoSettlement(x.number))}>{T('undo')}</button>])} />
      <p className={controls.hint}>{T('musterNote')}</p>
    </section>
  );
}
