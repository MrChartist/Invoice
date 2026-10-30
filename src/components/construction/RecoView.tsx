/** CN-D4 Works → Reconciliation: cement / steel statement per site (band, client issue, recovery), terms, CSV and print. */
import { useMemo, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { godownsDb } from '../../lib/godowns';
import { stockDb } from '../../lib/inventory';
import { localDb } from '../../lib/localDb';
import { loadCoefficients, siteGodowns } from '../../lib/works/sites';
import { loadMeasurements } from '../../lib/works/measurements';
import { addIssue, materialReco, recoCsvRows, recoHtml, recoTables, removeIssue, saveTerms, starters } from '../../lib/construction/cn-reco';
import { B, csvDownload, printHtml, today, type Notify } from '../transport/shared';
import { Num, Sel, Table, Txt } from './site-ui';
import { T, n, opt, row, useRun } from './site-kit';
import controls from '../../styles/controls.module.css';

export default function RecoView({ boq, notify }: { boq: InvoiceRecord; notify: Notify }) {
  const [tick, run] = useRun(notify);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sites = useMemo(() => siteGodowns(godownsDb.stored(), boq.id), [tick, boq.id]);
  const items = useMemo(() => stockDb.items(), []);
  const [siteId, setSiteId] = useState('');
  const site = sites.find((s) => s.id === siteId) ?? sites[0];
  const [p, setP] = useState({ from: `${today().slice(0, 4)}-04-01`, to: today() });
  const [t, setT] = useState({ item: '', lo: '', hi: '', rate: '', penal: '' });
  const [x, setX] = useState({ date: today(), item: '', qty: '', mode: 'free', rate: '', ref: '' });
  const rows = useMemo(() => (site ? materialReco({ site, period: { start: p.from, end: p.to }, ...recoTables(), measurements: loadMeasurements(boq.id), coefficients: loadCoefficients(boq.id), bills: localDb.invoices.getAll() }) : []), [site, p, boq.id, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  if (!site) return <p className={controls.hint}>{T('noSite')}</p>;
  const io = opt(items, (i) => i.id, (i) => i.name);
  return (
    <div data-sd-view="reco">
      <div style={row}>
        <Sel l={T('site')} v={site.id} set={setSiteId} o={opt(sites, (s) => s.id, (s) => s.name, false)} n={220} />
        <Txt l={T('from')} v={p.from} set={(v) => setP({ ...p, from: v })} type="date" n={160} />
        <Txt l={T('to')} v={p.to} set={(v) => setP({ ...p, to: v })} type="date" n={160} />
        <button type="button" className={B.os} onClick={() => csvDownload(`reco_${site.name}_${p.to}.csv`, recoCsvRows(rows, name))}>CSV</button>
        <button type="button" className={B.os} onClick={() => printHtml(recoHtml(rows, name, { site: site.name, from: p.from, to: p.to, company: localDb.settings.activeProfile()?.companyName ?? '' }), `reco_${site.name}`)}>{T('print')}</button>
      </div>
      <Table d="reco" head={[T('material'), T('opening'), T('own'), T('free'), T('recIssue'), T('theo'), T('actual'), T('var'), T('band'), T('beyond'), T('recRate'), T('recovery'), T('closing')]} rows={rows.map((r) => [name(r.itemId), r.opening, r.own, r.clientFree, r.clientRecovery, r.theoretical, r.actual, r.variancePct === null ? '-' : `${r.variancePct}%`, `−${r.lo}% / +${r.hi}%`, r.excess, r.recoveryRate, r.recovery, r.closing])} />
      <h4>{T('terms')}</h4>
      <div style={row} data-sd-terms>
        <Sel l={T('material')} v={t.item} set={(v) => setT({ ...t, item: v })} o={io} n={200} />
        <Num l={T('bandLo')} v={t.lo} set={(v) => setT({ ...t, lo: v })} n={100} />
        <Num l={T('bandHi')} v={t.hi} set={(v) => setT({ ...t, hi: v })} n={100} />
        <Num l={T('issueRate')} v={t.rate} set={(v) => setT({ ...t, rate: v })} />
        <Num l={T('penal')} v={t.penal} set={(v) => setT({ ...t, penal: v })} n={100} />
        <button type="button" className={B.o} onClick={() => run(() => saveTerms(site.id, t.item, { lo: t.lo === '' ? undefined : n(t.lo), hi: t.hi === '' ? undefined : n(t.hi), issue_rate: t.rate === '' ? undefined : n(t.rate), penal: t.penal === '' ? undefined : n(t.penal) }))}>{T('save')}</button>
      </div>
      <h4>{T('clientIssue')}</h4>
      <div style={row} data-sd-issue>
        <Txt l={T('date')} v={x.date} set={(v) => setX({ ...x, date: v })} type="date" n={160} />
        <Sel l={T('material')} v={x.item} set={(v) => setX({ ...x, item: v })} o={io} n={200} d="i-item" />
        <Num l={T('qty')} v={x.qty} set={(v) => setX({ ...x, qty: v })} d="i-qty" />
        <Sel l={T('mode')} v={x.mode} set={(v) => setX({ ...x, mode: v })} o={[['free', T('free')], ['recovery', T('recIssue')]]} n={160} />
        {x.mode === 'recovery' && <Num l={T('issueRate')} v={x.rate} set={(v) => setX({ ...x, rate: v })} />}
        <Txt l={T('ref')} v={x.ref} set={(v) => setX({ ...x, ref: v })} n={140} />
        <button type="button" className={B.p} onClick={() => run(() => addIssue(site.id, { date: x.date, item_id: x.item, qty: n(x.qty), mode: x.mode as 'free' | 'recovery', rate: n(x.rate), ref: x.ref || undefined }))} data-sd-add-issue>{T('add')}</button>
      </div>
      <Table d="issues" head={[T('date'), T('material'), T('qty'), T('mode'), T('issueRate'), '']} rows={(site.cn_reco?.issues ?? []).map((i) => [i.date, name(i.item_id), i.qty, T(i.mode === 'free' ? 'free' : 'recIssue'), i.rate ?? '-', <button key="d" type="button" className={B.gs} onClick={() => run(() => removeIssue(site.id, i.id))}>{T('del')}</button>])} />
      <h4>{T('starters')}</h4>
      <Table d="starters" head={[T('work'), T('unit'), T('material'), T('perUnit')]} rows={starters(p.to).map((s) => [s.work, s.unit, s.material, s.qty])} />
      <p className={controls.hint}>{T('recoNote')}</p>
    </div>
  );
}
