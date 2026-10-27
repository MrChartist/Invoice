/**
 * MF-C1 Garments → Cut plans (`CUT/FY…`, the lot): lays (plies × marker ratio, marker length), the ratio suggestion from
 * the order's sizes, fabric issued / end bits / cut waste through R4-A, consumption vs the style standard, the cut report.
 */
import { useMemo, useState } from 'react';
import type { MfgContext } from '../manufacturing/context';
import type { CutPlan } from '../../lib/mfg/mf-c-pending';
import { consumption, issueCutFabric, loadCutPlans, piecesTotal, removeCutPlan, returnEndBits, saveCutPlan, suggestLays, writeCutWaste } from '../../lib/mfg/mf-cutplans';
import { fabricFor, styleAxes, styleItems, styleOf } from '../../lib/mfg/mf-styles';
import { productionOrdersDb } from '../../lib/production/orders';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { num } from '../../lib/invoice-calc';
import { gT } from '../../i18n/areas/mfg-r13c';
import { Btn, F, Grid, In, n2, opts, parseRatio, ratioText, row, run, Sel, stack, today } from './garments-ui';

type Lay = { plies: string; ratio: string; len: string };
type D = { id?: string; date: string; style: string; colour: string; order: string; fabric: string; lays: Lay[]; issued: string; ends: string; kg: string; wasteItem: string; want: string; cap: string };
const blank = (): D => ({ date: today(), style: '', colour: '', order: '', fabric: '', lays: [{ plies: '', ratio: '', len: '' }], issued: '', ends: '', kg: '', wasteItem: '', want: '', cap: '6' });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export default function CutPlansView({ ctx }: { ctx: MfgContext }) {
  const plans = useMemo(() => (void ctx.version, loadCutPlans()), [ctx.version]);
  const styles = useMemo(() => styleItems(ctx.items), [ctx.items]);
  const name = (id?: string) => ctx.items.find((i) => i.id === id)?.name ?? '—';
  const [d, setD] = useState<D | null>(null);
  const [waste, setWaste] = useState<{ id: string; m: string; rate: string } | null>(null);
  const set = (p: Partial<D>) => setD((x) => (x ? { ...x, ...p } : x));
  const style = ctx.items.find((i) => i.id === d?.style);
  const orders = useMemo(() => productionOrdersDb.all().filter((o) => o.item_id === d?.style && o.status !== 'closed' && o.status !== 'cancelled'), [d?.style]);
  const pickColour = (colour: string) => {
    const o = orders.find((x) => x.id === d?.order) as { mf?: { grid?: { colour: string; qty: number[] }[] } } | undefined;
    const g = o?.mf?.grid?.find((r) => r.colour === colour);
    set({ colour, fabric: fabricFor(styleOf(style), colour)?.item_id ?? d?.fabric ?? '', ...(g && style ? { want: styleAxes(style).sizes.map((s, i) => `${s}${num(g.qty[i])}`).join(' ') } : {}) });
  };
  const suggest = () => d && set({ lays: suggestLays(parseRatio(d.want), num(d.cap) || 6).map((l) => ({ plies: String(l.plies), ratio: ratioText(l.marker_ratio), len: '' })) });
  const edit = (p: CutPlan) => setD({ id: p.id, date: p.date, style: p.style_id, colour: p.colour, order: p.order_id ?? '', fabric: p.fabric_item_id, lays: p.lays.map((l) => ({ plies: String(l.plies), ratio: ratioText(l.marker_ratio), len: String(l.marker_length_m) })), issued: String(p.fabric_issued_m || ''), ends: String(p.end_bits_m ?? ''), kg: String(p.cut_waste_kg ?? ''), wasteItem: p.waste_item_id ?? '', want: '', cap: '6' });
  const save = () => d && run(ctx, () => {
    const prev = d.id ? plans.find((p) => p.id === d.id) : undefined;
    const p = saveCutPlan({
      ...(prev ?? {}), id: d.id, date: d.date, style_id: d.style, colour: d.colour, ...(d.order ? { order_id: d.order } : {}), fabric_item_id: d.fabric,
      lays: d.lays.filter((l) => num(l.plies) > 0).map((l) => ({ plies: num(l.plies), marker_ratio: parseRatio(l.ratio), marker_length_m: num(l.len) })),
      fabric_issued_m: num(d.issued), ...(d.ends ? { end_bits_m: num(d.ends) } : {}), ...(d.kg ? { cut_waste_kg: num(d.kg) } : {}), ...(d.wasteItem ? { waste_item_id: d.wasteItem } : {}), cut: undefined,
    });
    return gT('cutSaved', { number: p.number });
  }, () => setD(null));
  const std = (p: CutPlan) => fabricFor(styleOf(ctx.items.find((i) => i.id === p.style_id)), p.colour)?.per_piece_m ?? 0;
  const print = (p: CutPlan) => {
    const c = consumption(p, std(p));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.number)}</title><style>body{font:12px sans-serif;margin:16px}td,th{border:1px solid #999;padding:4px}table{border-collapse:collapse}</style></head><body>
<h2>${esc(gT('cutReport'))} ${esc(p.number)}</h2><p>${esc(name(p.style_id))} · ${esc(p.colour)} · ${esc(p.date)}</p>
<table><tr><th>${esc(gT('plies'))}</th><th>${esc(gT('ratio'))}</th><th>${esc(gT('marker'))}</th></tr>${p.lays.map((l) => `<tr><td>${l.plies}</td><td>${esc(ratioText(l.marker_ratio))}</td><td>${l.marker_length_m}</td></tr>`).join('')}</table>
<p>${esc(gT('cutBySize'))}: ${esc(ratioText(p.cut))} = ${c.pieces}</p><p>${esc(gT('consumption'))}: ${c.per_piece_m} m (${esc(gT('standard'))} ${std(p)} m, ${c.variance_m} m / ${c.variance_pct}%) · ${esc(gT('endBits'))} ${num(p.end_bits_m)} m · ${esc(gT('wasteKg'))} ${num(p.cut_waste_kg)}</p>
<p style="margin-top:40px">${esc(gT('signature'))} ____________________</p></body></html>`;
    printHtmlDocument(html, (h) => downloadText(`${p.number.replace(/\W+/g, '-')}.html`, h, 'text/html'));
  };
  const axes = style ? styleAxes(style) : null;
  return (
    <section data-mfc-cutplans>
      {!d && <Btn kind="btnPrimary" on={() => setD(blank())} data-mfc="cut-new">{gT('newCut')}</Btn>}
      {d && (
        <div style={stack} data-mfc-cut-form>
          <div style={row}>
            <F label={gT('date')} w={160}><In type="date" v={d.date} set={(x) => set({ date: x })} /></F>
            <F label={gT('style')}><Sel v={d.style} set={(x) => set({ style: x, colour: '', order: '' })} o={opts(styles)} data-mfc="cut-style" /></F>
            <F label={gT('order')}><Sel v={d.order} set={(x) => set({ order: x })} o={[['', '—'], ...orders.map((o) => [o.id, `${o.number} · ${o.planned_qty}`] as const)]} data-mfc="cut-order" /></F>
            <F label={gT('colour')}><Sel v={d.colour} set={pickColour} o={[['', '—'], ...(axes?.colours ?? []).map((c) => [c, c] as const)]} data-mfc="cut-colour" /></F>
            <F label={gT('fabric')}><Sel v={d.fabric} set={(x) => set({ fabric: x })} o={opts(ctx.items.filter((i) => i.track_stock && !i.variant_of && !i.variant_axes?.length))} data-mfc="cut-fabric" /></F>
          </div>
          <div style={row}>
            <F label={gT('want')}><In v={d.want} set={(x) => set({ want: x })} placeholder="S60 M120 L120 XL60" data-mfc="cut-want" /></F>
            <F label={gT('cap')} w={120}><In v={d.cap} set={(x) => set({ cap: x })} inputMode="numeric" /></F>
            <Btn on={suggest} data-mfc="cut-suggest">{gT('suggest')}</Btn>
          </div>
          {d.lays.map((l, i) => (
            <div key={i} style={row}>
              <F label={gT('plies')} w={90}><In v={l.plies} set={(x) => set({ lays: d.lays.map((y, j) => (j === i ? { ...y, plies: x } : y)) })} inputMode="numeric" data-mfc={`lay-plies-${i}`} /></F>
              <F label={gT('ratio')}><In v={l.ratio} set={(x) => set({ lays: d.lays.map((y, j) => (j === i ? { ...y, ratio: x } : y)) })} placeholder="S1 M2 L2 XL1" data-mfc={`lay-ratio-${i}`} /></F>
              <F label={gT('marker')} w={120}><In v={l.len} set={(x) => set({ lays: d.lays.map((y, j) => (j === i ? { ...y, len: x } : y)) })} inputMode="decimal" data-mfc={`lay-len-${i}`} /></F>
            </div>
          ))}
          <div style={row}>
            <Btn on={() => set({ lays: [...d.lays, { plies: '', ratio: '', len: '' }] })}>{gT('addLay')}</Btn>
            <F label={gT('issued')} w={130}><In v={d.issued} set={(x) => set({ issued: x })} inputMode="decimal" data-mfc="cut-issued" /></F>
            <F label={gT('endBits')} w={130}><In v={d.ends} set={(x) => set({ ends: x })} inputMode="decimal" /></F>
            <F label={gT('wasteKg')} w={130}><In v={d.kg} set={(x) => set({ kg: x })} inputMode="decimal" /></F>
            <F label={gT('wasteItem')}><Sel v={d.wasteItem} set={(x) => set({ wasteItem: x })} o={opts(ctx.items.filter((i) => i.track_stock && !i.variant_of))} /></F>
          </div>
          <div style={row}><Btn kind="btnPrimary" on={save} data-mfc="cut-save">{gT('save')}</Btn><Btn on={() => setD(null)}>{gT('cancel')}</Btn></div>
        </div>
      )}
      {waste && (
        <div style={row} data-mfc-waste>
          <F label={gT('wasteM')} w={140}><In v={waste.m} set={(m) => setWaste({ ...waste, m })} inputMode="decimal" /></F>
          <F label={gT('wasteRate')} w={140}><In v={waste.rate} set={(rate) => setWaste({ ...waste, rate })} inputMode="decimal" /></F>
          <Btn kind="btnPrimary" on={() => run(ctx, () => void writeCutWaste(waste.id, { date: today(), waste_m: num(waste.m), rate: num(waste.rate) }, ctx.items, ctx.inputs), () => setWaste(null))}>{gT('wasteToStock')}</Btn>
          <Btn on={() => setWaste(null)}>{gT('cancel')}</Btn>
        </div>
      )}
      <Grid attr="cutplans" head={[gT('lot'), gT('style'), gT('cutBySize'), gT('consumption'), '']} rows={plans.slice().reverse().map((p) => {
        const c = consumption(p, std(p));
        return [
          `${p.number} · ${p.date}`, `${name(p.style_id)} · ${p.colour}`, `${ratioText(p.cut)} = ${piecesTotal(p.cut)}`,
          `${n2(c.per_piece_m)} m / ${std(p)} m (${c.variance_pct > 0 ? '+' : ''}${c.variance_pct}%)`,
          <span style={row} key="a">
            <Btn on={() => edit(p)}>{gT('edit')}</Btn>
            {p.order_id && !p.docs?.issue_id && ctx.canBooks && <Btn on={() => run(ctx, () => void issueCutFabric(p.id, { date: today() }, ctx.items, ctx.inputs))} data-mfc="cut-issue">{gT('issue')}</Btn>}
            {p.order_id && num(p.end_bits_m) > 0 && !p.docs?.return_id && ctx.canBooks && <Btn on={() => run(ctx, () => void returnEndBits(p.id, { date: today() }, ctx.inputs))}>{gT('returnEnds')}</Btn>}
            {p.order_id && num(p.cut_waste_kg) > 0 && !p.docs?.waste_id && ctx.canBooks && <Btn on={() => setWaste({ id: p.id, m: '', rate: '' })}>{gT('wasteToStock')}</Btn>}
            <Btn on={() => print(p)}>{gT('print')}</Btn>
            <Btn kind="btnDanger" on={() => run(ctx, () => void removeCutPlan(p.id))}>{gT('delete')}</Btn>
          </span>,
        ];
      })} />
    </section>
  );
}
