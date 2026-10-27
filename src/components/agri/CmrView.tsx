/** AG-C3 Mill → Custom milling: CMR agreements, paddy lots, deliveries, the account, milling-charges bill; job milling. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CmrAgreement } from '../../types/agri-r12';
import { localDb } from '../../lib/localDb';
import { addDelivery, addPaddyLot, cmrAccount, defaultOutturn, deleteAgreement, jobMillingInvoice, jobMillingRate, loadAgreements, millingChargesInvoice, pdsTest, removeDelivery, removePaddyLot, saveAgreement } from '../../lib/agri/ag-cmr';
import { B, fmtMoney, today } from '../transport/shared';
import { Num, Sel, Table, Txt } from './mill-ui';
import { T, n, opt, row, useRun, type Done } from './mill-kit';
import controls from '../../styles/controls.module.css';

const blank = { id: '', agency: '', season: '', kind: 'raw' as CmrAgreement['kind'], outturn: '', rate: '', recBasis: 'per_qtl_paddy', rec: '', due: '' };

export default function CmrView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ list: loadAgreements(), clients: localDb.clients.getAll() }), [tick]);
  const [f, setF] = useState(blank);
  const [sel, setSel] = useState('');
  const [lot, setLot] = useState({ date: today(), qty: '' });
  const [dl, setDl] = useState({ date: today(), qty: '', lot: '', ack: '', fort: false });
  const [bill, setBill] = useState({ date: today(), qty: '', goods: '' });
  const [jm, setJm] = useState({ client: '', qty: '', rate: '', process: '', reg: true, tax: '' });
  const [made, setMade] = useState('');
  const a = d.list.find((x) => x.id === sel);
  const acc = a ? cmrAccount(a, today()) : null;
  const service = n(bill.qty) * (a?.milling_rate ?? 0);
  const test = pdsTest(n(bill.goods), service + n(bill.goods));
  const edit = (x: CmrAgreement) => setF({ id: x.id, agency: x.agency_id, season: x.season, kind: x.kind, outturn: String(x.outturn_pct), rate: String(x.milling_rate ?? ''), recBasis: x.byproduct_recovery?.basis ?? 'per_qtl_paddy', rec: String(x.byproduct_recovery?.rate ?? ''), due: x.due_by ?? '' });
  return (
    <div data-ml-view="cmr">
      <h4>{f.id ? T('agreements') : T('newAgreement')}</h4>
      <div style={row}>
        <Sel l={T('agency')} v={f.agency} set={(x) => setF({ ...f, agency: x })} o={opt(d.clients, (c) => c.id ?? '', (c) => c.name)} x={220} d="agency" />
        <Txt l={T('season')} v={f.season} set={(x) => setF({ ...f, season: x })} x={160} d="season" />
        <Sel l={T('kind')} v={f.kind} set={(x) => setF({ ...f, kind: x as CmrAgreement['kind'] })} o={[['raw', T('k.raw')], ['parboiled', T('k.parboiled')]]} x={140} />
        <Num l={T('outturnPct')} v={f.outturn} set={(x) => setF({ ...f, outturn: x })} x={190} d="outturn" />
        <Num l={T('millingRate')} v={f.rate} set={(x) => setF({ ...f, rate: x })} x={190} d="milling-rate" />
        <Num l={T('recovery')} v={f.rec} set={(x) => setF({ ...f, rec: x })} />
        <Sel l="" v={f.recBasis} set={(x) => setF({ ...f, recBasis: x })} o={[['per_qtl_paddy', T('rb.per_qtl_paddy')], ['lump', T('rb.lump')]]} x={150} />
        <Txt l={T('dueBy')} v={f.due} set={(x) => setF({ ...f, due: x })} type="date" x={170} />
        <button type="button" className={B.p} data-ml-save-agreement onClick={() => run(() => {
          const s = saveAgreement({ ...(f.id ? { id: f.id } : {}), agency_id: f.agency, season: f.season, kind: f.kind, ...(f.outturn !== '' ? { outturn_pct: n(f.outturn) } : {}), milling_rate: n(f.rate), ...(n(f.rec) > 0 ? { byproduct_recovery: { basis: f.recBasis as 'lump', rate: n(f.rec) } } : {}), ...(f.due ? { due_by: f.due } : {}) }, today());
          setSel(s.id);
          setF(blank);
          return T('agreementSaved');
        })}>{T('save')}</button>
      </div>
      {!f.outturn && <p className={controls.hint}>{T('outturnPct')}: {defaultOutturn(f.kind)}%</p>}
      <Table d="agreements" head={[T('agency'), T('season'), T('kind'), T('outturn'), T('riceDue'), T('delivered'), T('status'), '']} rows={d.list.map((x) => {
        const c = cmrAccount(x, today());
        return [x.agency_name, x.season, T(`k.${x.kind}`), x.outturn_pct, c.due, c.delivered, x.status, <span key="a" style={row}>
          <button type="button" className={B.gs} onClick={() => setSel(x.id)} data-ml-open-agreement>{T('open')}</button>
          <button type="button" className={B.gs} onClick={() => edit(x)}>{T('save')}…</button>
          <button type="button" className={B.gs} onClick={() => run(() => { saveAgreement({ id: x.id, agency_id: x.agency_id, season: x.season, kind: x.kind, outturn_pct: x.outturn_pct, milling_rate: x.milling_rate, byproduct_recovery: x.byproduct_recovery, due_by: x.due_by, bg_id: x.bg_id, status: x.status === 'open' ? 'closed' : 'open' }, today()); })}>{T(x.status === 'open' ? 'closeAgreement' : 'reopen')}</button>
          {!x.paddy_lots.length && !x.deliveries.length && <button type="button" className={B.gs} onClick={() => run(() => { deleteAgreement(x.id); })}>{T('del')}</button>}
        </span>];
      })} />

      {a && acc && (
        <section data-ml-account={acc.balance}>
          <h4>{T('account')} — {a.agency_name} · {a.season}</h4>
          <Table d="account" head={[T('paddy'), T('riceDue'), T('delivered'), T('balance'), T('complete'), T('daysLeft'), T('byproductDue'), T('chargesEarned')]} rows={[[
            acc.paddy, acc.due, acc.delivered, <strong key="b">{acc.balance}</strong>, `${acc.pct}%`, acc.daysLeft === null ? '—' : `${acc.daysLeft}${acc.overdue ? ` · ${T('overdue')}` : ''}`, fmtMoney(acc.byproductDue), fmtMoney(acc.chargesEarned),
          ]]} />
          <div style={row}>
            <Txt l={T('date')} v={lot.date} set={(x) => setLot({ ...lot, date: x })} type="date" x={170} />
            <Num l={T('receivePaddy')} v={lot.qty} set={(x) => setLot({ ...lot, qty: x })} x={170} d="paddy-qty" />
            <button type="button" className={B.o} data-ml-add-lot onClick={() => run(() => { addPaddyLot(a.id, { date: lot.date, qty: n(lot.qty) }); setLot({ ...lot, qty: '' }); return T('lotAdded'); })}>{T('add')}</button>
          </div>
          <Table d="lots" head={[T('date'), T('qtl'), 'JWP', '']} rows={a.paddy_lots.map((l) => [l.date, l.qty, l.wbs_id ? T('slip') : '—', <button key="x" type="button" className={B.gs} onClick={() => run(() => { removePaddyLot(a.id, l.id, today()); })}>{T('del')}</button>])} />
          <div style={row}>
            <Txt l={T('date')} v={dl.date} set={(x) => setDl({ ...dl, date: x })} type="date" x={170} />
            <Num l={`${T('deliver')} (${T('qtl')})`} v={dl.qty} set={(x) => setDl({ ...dl, qty: x })} x={170} d="deliver-qty" />
            <Txt l={T('lotNo')} v={dl.lot} set={(x) => setDl({ ...dl, lot: x })} x={120} d="lot-no" />
            <Txt l={T('ackNo')} v={dl.ack} set={(x) => setDl({ ...dl, ack: x })} x={120} />
            <label className={controls.check}><input type="checkbox" checked={dl.fort} onChange={(e) => setDl({ ...dl, fort: e.target.checked })} /> {T('fortified')}</label>
            <button type="button" className={B.o} data-ml-deliver onClick={() => run(() => { const r = addDelivery(a.id, { date: dl.date, qty: n(dl.qty), lot_no: dl.lot, ack_no: dl.ack, fortified: dl.fort }); setDl({ ...dl, qty: '', lot: '', ack: '' }); return T('deliverySaved', { n: r.number }); })}>{T('deliver')}</button>
          </div>
          <Table d="deliveries" head={['CMR', T('date'), T('qtl'), T('lotNo'), T('ackNo'), '']} rows={a.deliveries.map((x) => [x.number, x.date, x.qty, x.lot_no, x.ack_no ?? '—', <button key="x" type="button" className={B.gs} onClick={() => run(() => { removeDelivery(a.id, x.id); })}>{T('del')}</button>])} />
          <h4>{T('chargesInvoice')}</h4>
          <div style={row}>
            <Txt l={T('date')} v={bill.date} set={(x) => setBill({ ...bill, date: x })} type="date" x={170} />
            <Num l={`${T('qty')} (${T('qtl')})`} v={bill.qty} set={(x) => setBill({ ...bill, qty: x })} d="bill-qty" />
            <Num l={T('goodsValue')} v={bill.goods} set={(x) => setBill({ ...bill, goods: x })} x={260} d="goods" />
            <span>{T('serviceValue')}: {fmtMoney(service)}</span>
            <button type="button" className={B.p} data-ml-bill onClick={() => run(() => { const r = millingChargesInvoice(a.id, { date: bill.date, qty: n(bill.qty), goods_value: n(bill.goods) }); setMade(r.invoice.id); return T('draftMade', { n: r.invoice.invoice_number || '—' }); })}>{T('makeDraft')}</button>
            {made && <Link to={`/invoice/${made}`}>{T('openDraft')}</Link>}
          </div>
          {service > 0 && <p className={controls.hint} data-ml-pds={test.exempt ? 'exempt' : '5'}>{T(test.exempt ? 'pdsExempt' : 'pdsTaxable', { pct: test.goodsPct, limit: test.limit })}</p>}
        </section>
      )}
      <p className={controls.hint}>{T('cmrNote')}</p>

      <h4>{T('jobMilling')}</h4>
      <div style={row}>
        <Sel l={T('principal')} v={jm.client} set={(x) => setJm({ ...jm, client: x })} o={opt(d.clients, (c) => c.id ?? '', (c) => c.name)} x={220} />
        <Txt l={T('process')} v={jm.process} set={(x) => setJm({ ...jm, process: x })} x={160} />
        <Num l={T('qty')} v={jm.qty} set={(x) => setJm({ ...jm, qty: x })} x={100} />
        <Num l={T('rate')} v={jm.rate} set={(x) => setJm({ ...jm, rate: x })} x={100} />
        <label className={controls.check}><input type="checkbox" checked={jm.reg} onChange={(e) => setJm({ ...jm, reg: e.target.checked })} /> {T('registered')}</label>
        <Num l={T('taxRate')} v={jm.tax} set={(x) => setJm({ ...jm, tax: x })} x={90} />
        <button type="button" className={B.o} onClick={() => run(() => { const inv = jobMillingInvoice({ client_id: jm.client, date: today(), qty: n(jm.qty), rate: n(jm.rate), process: jm.process, registered: jm.reg, ...(jm.tax !== '' ? { tax_rate: n(jm.tax) } : {}) }); setMade(inv.id); return T('draftMade', { n: inv.invoice_number || '—' }); })}>{T('makeDraft')}</button>
      </div>
      <p className={controls.hint}>{T('jobRateHint')} {jm.reg ? `(${jobMillingRate(true).rate}%)` : ''}</p>
    </div>
  );
}
