/** MF-B5 Press → Estimates (presses, estimate by break → quotations) and Paper (ups / sheets / kg calculator, paper by GSM). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { PrintEstimate, PrintFinish } from '../../types/mfg-r13';
import type { MfgContext } from '../manufacturing/context';
import { money } from '../manufacturing/context';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { computeStock } from '../../lib/inventory';
import { PRINT_CLASSES, estimateBreaks, loadEstimates, loadPresses, makePrintQuotations, printClassRate, removeEstimate, saveEstimate, savePress } from '../../lib/mfg/mf-estimates';
import { DEFAULT_MARGINS, netSheets, paperKg, reams, upsOn } from '../../lib/mfg/mf-paper';
import { prT as P } from '../../i18n/areas/mfg-r13b-press';
import { B, today } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import { Num, Sel, Table, Txt } from './mfb-ui';
import { attempt, fmt, n, opt, row, useRun, type Done } from './mfb-util';

const BASES: readonly PrintFinish['basis'][] = ['sqin', 'sheet', 'piece', 'lot'];
type Fin = { name: string; basis: PrintFinish['basis']; rate: string };

export default function EstimatesView({ ctx, done }: { ctx: MfgContext; done: Done }) {
  const [tick, run] = useRun(done, P('saved'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ presses: loadPresses(), estimates: loadEstimates(), clients: localDb.clients.getAll() }), [tick, ctx.version]);
  const [p, setP] = useState({ name: '', w: '', h: '', colours: '4', iph: '', mrMin: '', mrSheets: '', rate: '', min: '' });
  const [f, setF] = useState({ job: '', client: '', item: '', w: '', h: '', breaks: '5000, 10000', front: '4', back: '0', varnish: false, press: '', sw: '', sh: '', gsm: '', paper: '', prate: '', plate: '', waste: '2', outside: '', margin: '15', cls: 'cartons_4819' });
  const [fins, setFins] = useState<Fin[]>([{ name: '', basis: 'sheet', rate: '' }]);
  const set = (k: keyof typeof f) => (x: string) => setF({ ...f, [k]: x });
  const input: Omit<PrintEstimate, 'id' | 'number' | 'status'> = {
    date: today(), job: f.job, ...(f.client ? { client_id: f.client } : {}), ...(f.item ? { item_id: f.item } : {}), size: { w: n(f.w), h: n(f.h) }, breaks: f.breaks.split(/[\s,]+/).map(Number).filter((x) => x > 0),
    colours_front: n(f.front), colours_back: n(f.back), varnish_plate: f.varnish, ...(f.press ? { press_id: f.press } : {}), sheet: { w: n(f.sw), h: n(f.sh) }, margins: DEFAULT_MARGINS, gsm: n(f.gsm),
    ...(f.paper ? { stock_item_id: f.paper } : {}), paper_rate: n(f.prate), plate_rate: n(f.plate), running_waste_pct: n(f.waste), finishing: fins.filter((x) => x.name.trim()).map((x) => ({ ...x, rate: n(x.rate) })), outside: n(f.outside), margin_pct: n(f.margin),
  };
  const preview = n(f.w) && n(f.sw) && n(f.gsm) ? attempt(() => estimateBreaks(input, d.presses.find((x) => x.id === f.press)), []) : [];
  const cr = printClassRate(f.cls as never, today());
  return (
    <div data-mfb-view="estimates">
      {can('settings.manage') && (
        <>
          <h4>{P('presses')}</h4>
          <div style={row}>
            <Txt l={P('press')} v={p.name} set={(x) => setP({ ...p, name: x })} x={150} d="press-name" />
            <Num l={P('maxW')} v={p.w} set={(x) => setP({ ...p, w: x })} x={90} d="press-w" />
            <Num l={P('maxH')} v={p.h} set={(x) => setP({ ...p, h: x })} x={90} d="press-h" />
            <Num l={P('colours')} v={p.colours} set={(x) => setP({ ...p, colours: x })} x={80} />
            <Num l={P('iph')} v={p.iph} set={(x) => setP({ ...p, iph: x })} x={100} />
            <Num l={P('mrMin')} v={p.mrMin} set={(x) => setP({ ...p, mrMin: x })} x={100} />
            <Num l={P('mrSheets')} v={p.mrSheets} set={(x) => setP({ ...p, mrSheets: x })} x={100} d="press-mr" />
            <Num l={P('rate1000')} v={p.rate} set={(x) => setP({ ...p, rate: x })} x={100} d="press-rate" />
            <Num l={P('minCharge')} v={p.min} set={(x) => setP({ ...p, min: x })} x={100} />
            <button type="button" className={B.p} data-mfb-save-press onClick={() => run(() => { savePress({ name: p.name, max_sheet: { w: n(p.w), h: n(p.h) }, colours: n(p.colours), impressions_per_hour: n(p.iph), make_ready_min: n(p.mrMin), make_ready_sheets: n(p.mrSheets), rate_per_1000_imp: n(p.rate), min_charge: n(p.min) }); setP({ ...p, name: '' }); })}>{P('add')}</button>
          </div>
        </>
      )}
      <h4>{P('newEstimate')}</h4>
      <div style={row}>
        <Txt l={P('job')} v={f.job} set={set('job')} x={220} d="est-job" />
        <Sel l={P('customer')} v={f.client} set={set('client')} o={opt(d.clients, (c) => c.id ?? '', (c) => c.name)} x={180} />
        <Sel l={P('product')} v={f.item} set={set('item')} o={opt(ctx.items, (i) => i.id, (i) => i.name)} x={170} d="est-item" />
        <Num l={P('sizeW')} v={f.w} set={set('w')} x={90} d="est-w" />
        <Num l={P('sizeH')} v={f.h} set={set('h')} x={90} d="est-h" />
        <Txt l={P('breaks')} v={f.breaks} set={set('breaks')} x={140} d="est-breaks" />
        <Num l={P('front')} v={f.front} set={set('front')} x={80} d="est-front" />
        <Num l={P('back')} v={f.back} set={set('back')} x={80} />
        <label className={controls.label}><input type="checkbox" checked={f.varnish} onChange={(e) => setF({ ...f, varnish: e.target.checked })} /> {P('varnish')}</label>
      </div>
      <div style={row}>
        <Sel l={P('press')} v={f.press} set={set('press')} o={opt(d.presses, (x) => x.id, (x) => x.name)} x={170} d="est-press" />
        <Num l={P('sheetW')} v={f.sw} set={set('sw')} x={90} d="est-sw" />
        <Num l={P('sheetH')} v={f.sh} set={set('sh')} x={90} d="est-sh" />
        <Num l={P('gsm')} v={f.gsm} set={set('gsm')} x={80} d="est-gsm" />
        <Sel l={P('paperItem')} v={f.paper} set={set('paper')} o={opt(ctx.items, (i) => i.id, (i) => i.name)} x={170} d="est-paper" />
        <Num l={P('paperRate')} v={f.prate} set={set('prate')} x={100} d="est-prate" />
        <Num l={P('plateRate')} v={f.plate} set={set('plate')} x={90} />
        <Num l={P('runWaste')} v={f.waste} set={set('waste')} x={90} />
        <Num l={P('outside')} v={f.outside} set={set('outside')} x={90} />
        <Num l={P('margin')} v={f.margin} set={set('margin')} x={80} />
      </div>
      {fins.map((x, i) => (
        <div key={i} style={row}>
          <Txt l={P('finishing')} v={x.name} set={(v) => setFins(fins.map((y, j) => (j === i ? { ...y, name: v } : y)))} x={160} />
          <Sel l={P('basis')} v={x.basis} set={(v) => setFins(fins.map((y, j) => (j === i ? { ...y, basis: v as PrintFinish['basis'] } : y)))} o={BASES.map((b) => [b, P(`b.${b}`)] as const)} x={130} />
          <Num l={P('rate')} v={x.rate} set={(v) => setFins(fins.map((y, j) => (j === i ? { ...y, rate: v } : y)))} x={90} />
          {i === fins.length - 1 && <button type="button" className={B.os} onClick={() => setFins([...fins, { name: '', basis: 'sheet', rate: '' }])}>{P('addFinish')}</button>}
        </div>
      ))}
      <Table d="est-preview" empty={P('fillSize')} head={[P('qty'), P('ups'), P('sheets'), P('kg'), P('plates'), P('impressions'), P('pressCost'), P('total'), P('perPc')]} rows={preview.map((b) => [
        b.qty, b.ups, `${fmt(b.net_sheets)} + ${fmt(b.waste_sheets)} = ${fmt(b.sheets)}`, fmt(b.kg), b.plates, fmt(b.impressions), money(b.press), money(b.total), <strong key="p" data-mfb-per-pc>{money(b.per_piece)}</strong>,
      ])} />
      <div style={row}>
        <Sel l={P('gstClass')} v={f.cls} set={set('cls')} o={PRINT_CLASSES.map((c) => [c, P(`pc.${c}`)] as const)} x={260} />
        <span className={controls.hint} data-mfb-print-class>{cr.rate === null ? P('productRate') : P('classRate', { rate: cr.rate, hsn: cr.hsn })}</span>
      </div>
      <button type="button" className={B.p} data-mfb-save-estimate onClick={() => run(() => { const e = saveEstimate(input); return P('estimateSaved', { n: e.number }); })}>{P('save')}</button>

      <h4>{P('estimates')}</h4>
      <Table d="estimates" empty={P('none')} head={[P('number'), P('job'), P('perPc'), P('status'), '']} rows={d.estimates.map((e) => [
        e.number, e.job, estimateBreaks(e).map((b) => `${b.qty} @ ${money(b.per_piece)}`).join(' · '), P(`es.${e.status}`),
        <span key="a" style={row}>
          <button type="button" className={B.ps} data-mfb-print-quotation onClick={() => run(() => P('quotationsMade', { n: makePrintQuotations(e.id, ctx.items).length }))}>{P('makeQuotation')}</button>
          {(e.quote_ids ?? []).slice(-1).map((id) => <Link key={id} to={`/invoice/${id}`}>{P('open')}</Link>)}
          <button type="button" className={B.gs} onClick={() => run(() => { removeEstimate(e.id); })}>{P('del')}</button>
        </span>,
      ])} />
    </div>
  );
}

/** Press → Paper: ups / sheets / kg / reams for a job, and the paper items the estimates use, by GSM, with stock. */
export function PaperView({ ctx }: { ctx: MfgContext }) {
  const [c, setC] = useState({ sw: '762', sh: '508', w: '', h: '', qty: '', gsm: '300', waste: '2' });
  const set = (k: keyof typeof c) => (x: string) => setC({ ...c, [k]: x });
  const u = upsOn({ w: n(c.sw), h: n(c.sh) }, { w: n(c.w), h: n(c.h) });
  const net = netSheets(n(c.qty), u.ups);
  const sheets = net + Math.ceil((net * n(c.waste)) / 100);
  const byGsm = useMemo(() => {
    const stock = new Map(computeStock(ctx.inputs).map((p) => [p.item.id, p]));
    const m = new Map<string, { gsm: number; item: string; kg: number }>();
    for (const e of loadEstimates()) {
      if (!e.stock_item_id) continue;
      const k = `${e.gsm}|${e.stock_item_id}`;
      const r = m.get(k) ?? { gsm: e.gsm, item: e.stock_item_id, kg: 0 };
      if (e.status !== 'lost') r.kg += estimateBreaks(e)[0]?.kg ?? 0;
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => a.gsm - b.gsm).map((r) => ({ ...r, name: stock.get(r.item)?.item.name ?? '-', unit: stock.get(r.item)?.item.unit ?? '', qty: stock.get(r.item)?.qty ?? 0 }));
  }, [ctx.inputs]);
  return (
    <div data-mfb-view="paper">
      <div style={row}>
        <Num l={P('sheetW')} v={c.sw} set={set('sw')} x={90} />
        <Num l={P('sheetH')} v={c.sh} set={set('sh')} x={90} />
        <Num l={P('sizeW')} v={c.w} set={set('w')} x={90} d="paper-w" />
        <Num l={P('sizeH')} v={c.h} set={set('h')} x={90} d="paper-h" />
        <Num l={P('qty')} v={c.qty} set={set('qty')} x={100} d="paper-qty" />
        <Num l={P('gsm')} v={c.gsm} set={set('gsm')} x={80} />
        <Num l={P('runWaste')} v={c.waste} set={set('waste')} x={90} />
      </div>
      <p className={controls.hint} data-mfb-paper-result>{P('paperResult', { ups: u.ups, turned: u.rotated ? P('turned') : '', sheets: fmt(sheets), kg: fmt(paperKg(sheets, { w: n(c.sw), h: n(c.sh) }, n(c.gsm))), reams: fmt(reams(sheets)) })}</p>
      <h4>{P('byGsm')}</h4>
      <Table d="paper-gsm" empty={P('none')} head={[P('gsm'), P('paperItem'), P('estimatedKg'), P('inStock')]} rows={byGsm.map((r) => [r.gsm, r.name, fmt(r.kg), `${fmt(r.qty)} ${r.unit}`])} />
    </div>
  );
}
