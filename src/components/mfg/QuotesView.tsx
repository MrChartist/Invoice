/** MF-B2 Shop → Quotes: weight-based job quote (blank shape → kg, hours × rate, outside work, scrap credit) → quotations. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { JobQuote, MfShape } from '../../types/mfg-r13';
import type { MfgContext } from '../manufacturing/context';
import { localDb } from '../../lib/localDb';
import { currentRev, loadDrawings } from '../../lib/mfg/mf-drawings';
import { densities } from '../../lib/mfg/mf-weight';
import { loadQuotes, makeQuotations, markWon, quoteBreaks, removeQuote, saveQuote } from '../../lib/mfg/mf-quotes';
import { shT as S } from '../../i18n/areas/mfg-r13b-shop';
import { B, today } from '../transport/shared';
import { money } from '../manufacturing/context';
import { Num, Sel, Table, Txt, fmt, n, opt, row, useRun, type Done } from './mfb-ui';

const SHAPES: readonly MfShape['kind'][] = ['plate', 'round', 'tube', 'ring', 'section'];
const DIMS: Record<MfShape['kind'], readonly Exclude<keyof MfShape, 'kind'>[]> = { plate: ['l', 'w', 't'], round: ['d', 'l'], tube: ['od', 'id', 'l'], ring: ['od', 'id', 't'], section: ['kg_per_m', 'l'] };
type Op = { name: string; hours: string; setup: string; rate: string };

export default function QuotesView({ ctx, done }: { ctx: MfgContext; done: Done }) {
  const [tick, run] = useRun(done, S('saved'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ quotes: loadQuotes(), drawings: loadDrawings(), clients: localDb.clients.getAll() }), [tick, ctx.version]);
  const dens = densities(today());
  const [f, setF] = useState({ part: '', client: '', item: '', drawing: '', material: 'MS', density: String(dens.MS), shape: 'plate' as MfShape['kind'], net: '', mrate: '', srate: '', outName: '', outBasis: 'kg', outRate: '', packing: '', freight: '', oh: '10', margin: '15', breaks: '100, 500' });
  const [dims, setDims] = useState<Record<string, string>>({});
  const [ops, setOps] = useState<Op[]>([{ name: '', hours: '', setup: '', rate: '' }]);
  const [won, setWon] = useState<Record<string, string>>({});
  const dw = d.drawings.find((x) => x.id === f.drawing);
  const input: Omit<JobQuote, 'id' | 'status'> = {
    date: today(), part: f.part || dw?.title || '', ...(f.client ? { client_id: f.client } : {}), ...(f.item ? { item_id: f.item } : {}), ...(dw ? { drawing_id: dw.id, rev: currentRev(dw)?.rev } : {}),
    material: f.material, density: n(f.density), blank: { kind: f.shape, ...Object.fromEntries(DIMS[f.shape].map((k) => [k, n(dims[k])])) }, ...(n(f.net) > 0 ? { net_kg: n(f.net) } : {}),
    material_rate: n(f.mrate), scrap_rate: n(f.srate), ops: ops.filter((o) => o.name.trim()).map((o) => ({ name: o.name, hours: n(o.hours), setup_h: n(o.setup), rate: n(o.rate) })),
    outside: f.outName.trim() ? [{ name: f.outName, basis: f.outBasis as 'kg' | 'piece', rate: n(f.outRate) }] : [], packing: n(f.packing), freight: n(f.freight),
    overhead_pct: n(f.oh), margin_pct: n(f.margin), breaks: f.breaks.split(/[\s,]+/).map(Number).filter((x) => x > 0),
  };
  const preview = input.breaks.length ? quoteBreaks(input) : [];
  const set = (k: keyof typeof f) => (x: string) => setF({ ...f, [k]: x });
  return (
    <div data-mfb-view="quotes">
      <h4>{S('newQuote')}</h4>
      <div style={row}>
        <Sel l={S('drawingNo')} v={f.drawing} set={set('drawing')} o={opt(d.drawings, (x) => x.id, (x) => x.number)} x={150} />
        <Txt l={S('part')} v={f.part} set={set('part')} x={180} d="q-part" />
        <Sel l={S('customer')} v={f.client} set={set('client')} o={opt(d.clients, (c) => c.id ?? '', (c) => c.name)} x={180} />
        <Sel l={S('item')} v={f.item} set={set('item')} o={opt(ctx.items, (i) => i.id, (i) => i.name)} x={170} />
      </div>
      <div style={row}>
        <Sel l={S('material')} v={f.material} set={(x) => setF({ ...f, material: x, density: String(dens[x] ?? f.density) })} o={Object.keys(dens).map((k) => [k, k] as const)} x={110} />
        <Num l={S('density')} v={f.density} set={set('density')} x={100} />
        <Sel l={S('shape')} v={f.shape} set={(x) => setF({ ...f, shape: x as MfShape['kind'] })} o={SHAPES.map((k) => [k, S(`sh.${k}`)] as const)} x={140} d="q-shape" />
        {DIMS[f.shape].map((k) => <Num key={k} l={S(`dim.${k}`)} v={dims[k] ?? ''} set={(x) => setDims({ ...dims, [k]: x })} x={95} d={`q-${k}`} />)}
        <Num l={S('netKg')} v={f.net} set={set('net')} x={100} d="q-net" />
        <Num l={S('matRate')} v={f.mrate} set={set('mrate')} x={110} d="q-mrate" />
        <Num l={S('scrapRate')} v={f.srate} set={set('srate')} x={110} d="q-srate" />
      </div>
      {ops.map((o, i) => (
        <div key={i} style={row}>
          <Txt l={S('operation')} v={o.name} set={(x) => setOps(ops.map((y, j) => (j === i ? { ...y, name: x } : y)))} x={160} d="q-op" />
          <Num l={S('hoursPc')} v={o.hours} set={(x) => setOps(ops.map((y, j) => (j === i ? { ...y, hours: x } : y)))} x={100} d="q-hours" />
          <Num l={S('setupH')} v={o.setup} set={(x) => setOps(ops.map((y, j) => (j === i ? { ...y, setup: x } : y)))} x={100} />
          <Num l={S('rateHr')} v={o.rate} set={(x) => setOps(ops.map((y, j) => (j === i ? { ...y, rate: x } : y)))} x={100} d="q-rate" />
          {i === ops.length - 1 && <button type="button" className={B.os} onClick={() => setOps([...ops, { name: '', hours: '', setup: '', rate: '' }])}>{S('addOp')}</button>}
        </div>
      ))}
      <div style={row}>
        <Txt l={S('outside')} v={f.outName} set={set('outName')} x={150} />
        <Sel l={S('basis')} v={f.outBasis} set={set('outBasis')} o={[['kg', S('perKg')], ['piece', S('perPc')]]} x={110} />
        <Num l={S('rate')} v={f.outRate} set={set('outRate')} x={90} />
        <Num l={S('packing')} v={f.packing} set={set('packing')} x={90} />
        <Num l={S('freight')} v={f.freight} set={set('freight')} x={90} />
        <Num l={S('overhead')} v={f.oh} set={set('oh')} x={90} />
        <Num l={S('margin')} v={f.margin} set={set('margin')} x={90} />
        <Txt l={S('breaks')} v={f.breaks} set={set('breaks')} x={130} d="q-breaks" />
      </div>
      <Table d="quote-preview" empty={S('none')} head={[S('qty'), S('kg'), S('material'), S('conversion'), S('scrapCredit'), S('cost'), S('pricePc')]} rows={preview.map((b) => [
        b.qty, `${fmt(b.gross_kg)} / ${fmt(b.net_kg)} / ${fmt(b.scrap_kg)}`, money(b.material), money(b.conversion + b.setup + b.outside + b.extras), money(b.scrap_credit), money(b.cost), <strong key="p" data-mfb-price>{money(b.price)}</strong>,
      ])} />
      <button type="button" className={B.p} data-mfb-save-quote onClick={() => run(() => { saveQuote(input); })}>{S('save')}</button>

      <h4>{S('quotes')}</h4>
      <Table d="quotes" empty={S('none')} head={[S('date'), S('part'), S('breaks'), S('status'), '']} rows={d.quotes.map((q) => [
        q.date, q.part, quoteBreaks(q).map((b) => `${b.qty} @ ${money(b.price)}`).join(' · '), S(`qs.${q.status}`),
        <span key="a" style={row}>
          <button type="button" className={B.ps} data-mfb-make-quotation onClick={() => run(() => {
            const docs = makeQuotations(q.id, ctx.items, d.drawings.find((x) => x.id === q.drawing_id)?.number);
            return S('quotationsMade', { n: docs.length });
          })}>{S('makeQuotation')}</button>
          {(q.quote_ids ?? []).slice(-1).map((id) => <Link key={id} to={`/invoice/${id}`}>{S('open')}</Link>)}
          <select aria-label={S('materialItem')} value={won[q.id] ?? ''} onChange={(e) => setWon({ ...won, [q.id]: e.target.value })}>{opt(ctx.items, (i) => i.id, (i) => i.name).map(([k, s]) => <option key={k} value={k}>{s}</option>)}</select>
          <button type="button" className={B.gs} onClick={() => run(() => { markWon(q.id, won[q.id] || undefined); return S('won'); })}>{S('markWon')}</button>
          <button type="button" className={B.gs} onClick={() => run(() => { removeQuote(q.id); })}>{S('del')}</button>
        </span>,
      ])} />
    </div>
  );
}
