/** MF-B3 Shop → Scrap: the scrap register (made / on job cards / sold / in stock) and a scrap sale with TCS / GST TDS prompts. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InvoiceRecord } from '../../types/invoice';
import type { MfgContext } from '../manufacturing/context';
import { money } from '../manufacturing/context';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { computeStock } from '../../lib/inventory';
import { patchItem } from '../../lib/mfg/mf-b-db';
import { readMfgSettings } from '../../lib/mfg/mf-settings';
import { makeScrapSale, scrapItemIds, scrapRate, scrapRegister, scrapSaleDraft, type ScrapSaleLine } from '../../lib/mfg/mf-scrap';
import { SCRAP_CLASSES, scrapClassRate, TCS_SCOPE_NOTE } from '../../lib/mfg/mf-scrap-tax';
import { shT as S } from '../../i18n/areas/mfg-r13b-shop';
import { B, today } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import { Num, Sel, Table, Txt } from './mfb-ui';
import { attempt, fmt, n, opt, row, useRun, type Done } from './mfb-util';

type L = { item: string; gross: string; tare: string; net: string; rate: string };
const blank = (): L => ({ item: '', gross: '', tare: '', net: '', rate: '' });

export default function ScrapView({ ctx, done }: { ctx: MfgContext; done: Done }) {
  const [tick, run] = useRun(done, S('saved'));
  const d = useMemo(() => {
    const docs = { items: ctx.items, mfg: getTable<never>('manufacturing_vouchers'), journals: getTable<never>('stock_journals'), cards: getTable<never>('job_cards'), invoices: localDb.invoices.getAll(), scrapItemId: readMfgSettings().scrap_item_id };
    const ids = scrapItemIds(docs);
    return { rows: scrapRegister(docs), ids, stock: new Map(computeStock(ctx.inputs).filter((p) => ids.has(p.item.id)).map((p) => [p.item.id, p.qty])), clients: localDb.clients.getAll() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ctx.version]);
  const [f, setF] = useState({ date: today(), client: '', name: '', declaration: '' });
  const [lines, setLines] = useState<L[]>([blank()]);
  const [cls, setCls] = useState({ item: '', cls: '' });
  const [made, setMade] = useState<InvoiceRecord | null>(null);
  const item = (id: string) => ctx.items.find((i) => i.id === id);
  const scrapItems = ctx.items.filter((i) => d.ids.has(i.id));
  const net = (l: L) => (l.net !== '' ? n(l.net) : Math.max(n(l.gross) - n(l.tare), 0));
  const saleLines: ScrapSaleLine[] = lines.filter((l) => l.item).map((l) => ({ item_id: l.item, net_kg: net(l), rate: n(l.rate) || scrapRate(item(l.item)), gross_kg: n(l.gross) || undefined, tare_kg: n(l.tare) || undefined }));
  const preview: InvoiceRecord | null = saleLines.some((l) => l.net_kg > 0) ? attempt(() => scrapSaleDraft({ date: f.date, client_id: f.client || undefined, client_name: f.name, declaration: f.declaration, lines: saleLines }, ctx.items), null) : null;
  const setL = (i: number, p: Partial<L>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div data-mfb-view="scrap">
      <h4>{S('register')}</h4>
      <Table d="scrap-register" empty={S('noScrap')} head={[S('month'), S('item'), S('made'), S('onCards'), S('sold'), S('inStock'), S('valueAtRate'), S('avgRealised')]} rows={d.rows.map((r) => [
        r.month, item(r.item_id)?.name ?? '—', fmt(r.made), fmt(r.pending), fmt(r.sold), fmt(d.stock.get(r.item_id) ?? 0),
        money(r.made * scrapRate(item(r.item_id))), r.sold > 0 ? money(r.sold_value / r.sold) : '—',
      ])} />

      <h4>{S('sellScrap')}</h4>
      <div style={row}>
        <Txt l={S('date')} type="date" v={f.date} set={(x) => setF({ ...f, date: x })} x={150} />
        <Sel l={S('customer')} v={f.client} set={(x) => setF({ ...f, client: x })} o={opt(d.clients, (c) => c.id ?? '', (c) => c.name)} x={200} d="scrap-client" />
        {!f.client && <Txt l={S('buyerName')} v={f.name} set={(x) => setF({ ...f, name: x })} x={180} d="scrap-name" />}
        <Txt l={S('declaration')} v={f.declaration} set={(x) => setF({ ...f, declaration: x })} x={260} d="scrap-declaration" />
      </div>
      {lines.map((l, i) => (
        <div key={i} style={row}>
          <Sel l={S('item')} v={l.item} set={(x) => setL(i, { item: x })} o={opt(scrapItems, (x) => x.id, (x) => x.name)} x={190} d="scrap-item" />
          <Num l={S('grossKg')} v={l.gross} set={(x) => setL(i, { gross: x })} x={100} />
          <Num l={S('tareKg')} v={l.tare} set={(x) => setL(i, { tare: x })} x={100} />
          <Num l={S('netKg')} v={l.net === '' && (l.gross || l.tare) ? String(net(l)) : l.net} set={(x) => setL(i, { net: x })} x={100} d="scrap-net" />
          <Num l={S('rate')} v={l.rate} set={(x) => setL(i, { rate: x })} x={90} d="scrap-rate" />
          {i === lines.length - 1 && <button type="button" className={B.os} onClick={() => setLines([...lines, blank()])}>{S('addLine')}</button>}
        </div>
      ))}
      {preview && (
        <div data-mfb-scrap-preview>
          <p className={controls.hint} data-mfb-tcs={preview.tcs_enabled ? 'on' : 'off'}>{preview.tcs_enabled ? S('tcsOn', { label: preview.tcs_label ?? '' }) : S('tcsOff')}</p>
          {preview.mf?.scrap?.gst_tds && <p className={controls.hint} data-mfb-gst-tds>{S('gstTds')}</p>}
          <p className={controls.hint}>{TCS_SCOPE_NOTE}</p>
        </div>
      )}
      <div style={row}>
        <button type="button" className={B.p} data-mfb-scrap-sale onClick={() => run(() => { const r = makeScrapSale({ date: f.date, client_id: f.client || undefined, client_name: f.name, declaration: f.declaration, lines: saleLines }, ctx.items); setMade(r); setLines([blank()]); return S('scrapInvoice'); })}>{S('makeInvoice')}</button>
        {made && <Link to={`/invoice/${made.id}`} data-mfb-open-invoice>{S('open')}</Link>}
      </div>

      <h4>{S('scrapClass')}</h4>
      <div style={row}>
        <Sel l={S('item')} v={cls.item} set={(x) => setCls({ item: x, cls: item(x)?.mf_scrap_class ?? '' })} o={opt(ctx.items, (x) => x.id, (x) => x.name)} x={200} d="class-item" />
        <Sel l={S('class')} v={cls.cls} set={(x) => setCls({ ...cls, cls: x })} o={[['', '—'], ...SCRAP_CLASSES.map((c) => [c, S(`sc.${c}`)] as const)]} x={200} d="class-value" />
        {cls.cls && <span className={controls.hint}>{(() => { const r = scrapClassRate(cls.cls as never, f.date); return r.rate === null ? S('noRate') : S('classRate', { rate: r.rate, hsn: r.hsn }); })()}</span>}
        <button type="button" className={B.ps} data-mfb-save-class disabled={!cls.item} onClick={() => run(() => { patchItem(cls.item, { mf_scrap_class: cls.cls || undefined }); })}>{S('save')}</button>
      </div>
    </div>
  );
}
