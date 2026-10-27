/** MF-B4 Moulding → EPR: kg supplied by category and brand owner, recycled content of the month's runs, CSV; item / client EPR fields. */
import { useMemo, useState } from 'react';
import type { MfgContext } from '../manufacturing/context';
import { localDb } from '../../lib/localDb';
import { requireAccess } from '../../lib/access';
import { downloadText } from '../../lib/download';
import { patchItem } from '../../lib/mfg/mf-b-db';
import { eprCsv, eprSupplied, recycledShare } from '../../lib/mfg/mf-epr';
import { loadRuns } from '../../lib/mfg/mf-runs';
import { moT as M } from '../../i18n/areas/mfg-r13b-mould';
import { B, today } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import { Num, Sel, Table, Txt, fmt, n, opt, row, useRun, type Done } from './mfb-ui';

const CATS = ['I', 'II', 'III', 'IV'] as const;

export default function EprView({ ctx, done }: { ctx: MfgContext; done: Done }) {
  const [tick, run] = useRun(done, M('saved'));
  const [from, setFrom] = useState(today().slice(0, 7));
  const [to, setTo] = useState(today().slice(0, 7));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ clients: localDb.clients.getAll(), invoices: localDb.invoices.getAll(), runs: loadRuns() }), [tick, ctx.version]);
  const rows = eprSupplied(d.invoices, ctx.items, d.clients, from, to);
  const rec = recycledShare(d.runs, ctx.items, to);
  const [it, setIt] = useState({ id: '', cat: '', kg: '', max: '', pcr: false });
  const [cl, setCl] = useState({ id: '', epr: '' });
  return (
    <div data-mfb-view="epr">
      <div style={row}>
        <Txt l={M('from')} type="month" v={from} set={setFrom} x={150} />
        <Txt l={M('to')} type="month" v={to} set={setTo} x={150} />
        <button type="button" className={B.os} data-mfb-epr-csv onClick={() => downloadText(`epr-${from}-${to}.csv`, eprCsv(rows), 'text/csv')}>{M('csv')}</button>
      </div>
      <Table d="epr" empty={M('noEpr')} head={[M('month'), M('category'), M('customer'), M('eprNo'), M('kgSupplied')]} rows={rows.map((r) => [r.month, r.category, r.client, r.epr_no || '—', fmt(r.kg)])} />
      <p className={controls.hint} data-mfb-recycled>{M('recycled', { month: to, pcr: fmt(rec.pcr_kg), input: fmt(rec.input_kg), pct: rec.pct })}</p>

      <h4>{M('itemEpr')}</h4>
      <div style={row}>
        <Sel l={M('item')} v={it.id} set={(x) => { const s = ctx.items.find((i) => i.id === x); setIt({ id: x, cat: s?.mf_epr ?? '', kg: String(s?.mf_unit_kg ?? ''), max: String(s?.mf_max_regrind_pct ?? ''), pcr: !!s?.mf_pcr }); }} o={opt(ctx.items, (i) => i.id, (i) => i.name)} x={200} d="epr-item" />
        <Sel l={M('category')} v={it.cat} set={(x) => setIt({ ...it, cat: x })} o={[['', '—'], ...CATS.map((c) => [c, M(`cat.${c}`)] as const)]} x={170} d="epr-cat" />
        <Num l={M('unitKg')} v={it.kg} set={(x) => setIt({ ...it, kg: x })} x={100} />
        <Num l={M('maxRegrind')} v={it.max} set={(x) => setIt({ ...it, max: x })} x={110} />
        <label className={controls.label}><input type="checkbox" checked={it.pcr} onChange={(e) => setIt({ ...it, pcr: e.target.checked })} /> {M('pcr')}</label>
        <button type="button" className={B.ps} disabled={!it.id} data-mfb-save-epr-item onClick={() => run(() => { patchItem(it.id, { mf_epr: it.cat || undefined, mf_unit_kg: n(it.kg) || undefined, mf_max_regrind_pct: n(it.max) || undefined, mf_pcr: it.pcr || undefined }); })}>{M('save')}</button>
      </div>
      <h4>{M('clientEpr')}</h4>
      <div style={row}>
        <Sel l={M('customer')} v={cl.id} set={(x) => setCl({ id: x, epr: d.clients.find((c) => c.id === x)?.mf?.epr_no ?? '' })} o={opt(d.clients, (c) => c.id ?? '', (c) => c.name)} x={200} />
        <Txt l={M('eprNo')} v={cl.epr} set={(x) => setCl({ ...cl, epr: x })} x={200} />
        <button type="button" className={B.ps} disabled={!cl.id} onClick={() => run(() => { requireAccess('master.edit'); const c = d.clients.find((x) => x.id === cl.id)!; localDb.clients.upsert({ ...c, mf: { ...c.mf, epr_no: cl.epr.trim() || undefined } }); })}>{M('save')}</button>
      </div>
    </div>
  );
}
