/** MF-A2 Floor → Routings: operations per item (work centre, set-up, run time or rate, batch size, inspection, piece rate); CSV in / out. */
import { useMemo, useState } from 'react';
import type { Routing, RoutingOp } from '../../types/mfg-r13';
import type { MfgContext } from '../manufacturing/context';
import { loadCentres } from '../../lib/mfg/mf-centres';
import { loadRoutings, opsForQty, removeRouting, routingsCsv, routingsFromCsv, saveRouting, standardConversion } from '../../lib/mfg/mf-routings';
import { generateId } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { downloadText } from '../../lib/download';
import { fT } from '../../i18n/areas/mfg-r13a';
import controls from '../../styles/controls.module.css';
import { F, Grid, In, Sel } from './floor-ui';
import { fmt, row } from './floor-util';

const blankOp = (seq: number, centre = ''): RoutingOp => ({ id: generateId(), seq, name: '', work_centre_id: centre, setup_min: 0 });
const n = (s: string) => (s.trim() === '' ? undefined : num(s));
const s = (x: number | undefined) => (x === undefined ? '' : String(x));

export default function RoutingsView({ ctx }: { ctx: MfgContext }) {
  const [v, setV] = useState(0);
  const all = useMemo(() => (void v, loadRoutings()), [v]);
  const centres = useMemo(() => loadCentres().filter((c) => c.active), []);
  const items = ctx.items.filter((i) => i.track_stock);
  const [d, setD] = useState<(Omit<Routing, 'id'> & { id?: string }) | null>(null);
  const name = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';
  const setOp = (i: number, p: Partial<RoutingOp>) => setD((x) => (x ? { ...x, ops: x.ops.map((o, k) => (k === i ? { ...o, ...p } : o)) } : x));
  const done = (m: string) => {
    setV((x) => x + 1);
    ctx.changed(m);
  };
  const save = () => {
    if (!d) return;
    try {
      const r = saveRouting(d);
      setD(null);
      done(fT('routingSaved', { name: r.name }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    const text = /\.xlsx$/i.test(f.name) ? await (await import('../../lib/xlsx')).xlsxToCsv(await f.arrayBuffer()) : await f.text();
    const { routings, errors } = routingsFromCsv(text, (nm) => items.find((i) => i.name.toLowerCase() === nm.trim().toLowerCase())?.id, centres);
    try {
      for (const r of routings) saveRouting(r);
      done(fT('imported', { n: routings.length }) + (errors.length ? ` ${errors.slice(0, 3).join(' ')}` : ''));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  return (
    <section data-mf-routings>
      <div style={row}>
        {ctx.canMasters && !d && <button type="button" className={controls.btnPrimary} onClick={() => setD({ item_id: items[0]?.id ?? '', name: 'Standard', is_default: true, ops: [blankOp(10, centres[0]?.id)] })} disabled={!centres.length} data-mf-routing-new>{fT('newRouting')}</button>}
        <button type="button" className={controls.btnOutline} onClick={() => downloadText('routings.csv', routingsCsv(all, name, centres), 'text/csv')} disabled={!all.length}>{fT('exportCsv')}</button>
        {ctx.canMasters && <label className={controls.btnOutline}>{fT('importCsv')}<input type="file" accept=".csv,.xlsx" hidden onChange={(e) => void importCsv(e.target.files?.[0])} /></label>}
      </div>
      {!centres.length && <p className={controls.hint}>{fT('needCentres')}</p>}
      {d && (
        <div data-mf-routing-form style={{ display: 'grid', gap: '0.5rem', margin: '0.75rem 0' }}>
          <div style={row}>
            <F label={fT('item')}><Sel v={d.item_id} set={(x) => setD({ ...d, item_id: x })} o={items.map((i) => [i.id, i.name] as const)} data-mf="r-item" /></F>
            <F label={fT('name')}><In v={d.name} set={(x) => setD({ ...d, name: x })} /></F>
            <F label={fT('revision')} w={100}><In v={d.revision ?? ''} set={(x) => setD({ ...d, revision: x || undefined })} /></F>
            <label className={controls.check}><input type="checkbox" checked={d.is_default} onChange={(e) => setD({ ...d, is_default: e.target.checked })} /> {fT('isDefault')}</label>
            <label className={controls.check}><input type="checkbox" checked={!!d.allow_out_of_sequence} onChange={(e) => setD({ ...d, allow_out_of_sequence: e.target.checked || undefined })} /> {fT('oos')}</label>
          </div>
          <Grid attr="ops" head={[fT('seq'), fT('operation'), fT('centre'), fT('setupMin'), fT('runMin'), fT('perHour'), fT('batch'), fT('pieceRate'), fT('inspect'), '']} rows={d.ops.map((o, i) => [
            <In key="q" v={String(o.seq)} set={(x) => setOp(i, { seq: Math.round(num(x)) })} inputMode="numeric" style={{ width: 56 }} />,
            <In key="n" v={o.name} set={(x) => setOp(i, { name: x })} data-mf={`op-name-${i}`} />,
            <Sel key="c" v={o.work_centre_id} set={(x) => setOp(i, { work_centre_id: x })} o={[['', '—'], ...centres.map((c) => [c.id, c.name] as const)]} data-mf={`op-centre-${i}`} />,
            <In key="s" v={String(o.setup_min)} set={(x) => setOp(i, { setup_min: num(x) })} inputMode="decimal" style={{ width: 64 }} />,
            <In key="r" v={s(o.run_min_per_unit)} set={(x) => setOp(i, { run_min_per_unit: n(x) })} inputMode="decimal" style={{ width: 64 }} data-mf={`op-run-${i}`} />,
            <In key="u" v={s(o.run_units_per_hour)} set={(x) => setOp(i, { run_units_per_hour: n(x) })} inputMode="decimal" style={{ width: 64 }} />,
            <In key="b" v={s(o.batch_size)} set={(x) => setOp(i, { batch_size: n(x) })} inputMode="numeric" style={{ width: 64 }} />,
            <In key="p" v={s(o.piece_rate)} set={(x) => setOp(i, { piece_rate: n(x) })} inputMode="decimal" style={{ width: 64 }} />,
            <input key="i" type="checkbox" checked={!!o.inspection} onChange={(e) => setOp(i, { inspection: e.target.checked || undefined })} aria-label={fT('inspect')} />,
            <button key="x" type="button" className={controls.btnDanger} onClick={() => setD({ ...d, ops: d.ops.filter((_, k) => k !== i) })} aria-label={fT('delete')}>×</button>,
          ])} />
          <p className={controls.hint}>{fT('runHint')} · {fT('stdConv', { qty: 100, amount: fmt(standardConversion(opsForQty(d, 100, centres), 100)) })}</p>
          <div style={row}>
            <button type="button" className={controls.btnOutline} onClick={() => setD({ ...d, ops: [...d.ops, blankOp((d.ops.at(-1)?.seq ?? 0) + 10, centres[0]?.id)] })} data-mf="op-add">{fT('addOp')}</button>
            <button type="button" className={controls.btnPrimary} onClick={save} data-mf="r-save">{fT('save')}</button>
            <button type="button" className={controls.btnOutline} onClick={() => setD(null)}>{fT('cancel')}</button>
          </div>
        </div>
      )}
      <Grid attr="routings" head={[fT('item'), fT('name'), fT('operation'), fT('stdConvShort'), '']} rows={all.map((r) => [
        name(r.item_id), `${r.name}${r.revision ? ` (${r.revision})` : ''}${r.is_default ? ` · ${fT('isDefault')}` : ''}`,
        r.ops.map((o) => `${o.seq} ${o.name}`).join(' → '),
        `₹${fmt(standardConversion(opsForQty(r, 100, centres), 100))}`,
        ctx.canMasters ? <span style={row}><button type="button" className={controls.btnOutline} onClick={() => setD(r)}>{fT('edit')}</button><button type="button" className={controls.btnDanger} onClick={() => { removeRouting(r.id); done(fT('deleted')); }}>{fT('delete')}</button></span> : null,
      ])} />
    </section>
  );
}
