/**
 * MF-C2 Garments → Bundles: generate a lot's bundles, scan a bundle ticket (camera / USB scanner) to record an operation
 * (good = its pieces unless edited; rejects leave it with a reason), lot status, report finished bundles as output, print
 * the tickets (QR + tear-off coupons per operation).
 */
import { useMemo, useState } from 'react';
import type { MfgContext } from '../manufacturing/context';
import { loadCutPlans } from '../../lib/mfg/mf-cutplans';
import { bundleId, livePieces, lotStatus, reportFinished, saveBundles, scanStep, DEFAULT_BUNDLE_SIZE } from '../../lib/mfg/mf-bundles';
import { styleAxes } from '../../lib/mfg/mf-styles';
import { karigars } from '../../lib/mfg/mf-karigar';
import { vendorsDb } from '../../lib/vendors';
import { num } from '../../lib/invoice-calc';
import { ScanField } from '../scan/ScanField';
import BundleTickets from './BundleTickets';
import { gT } from '../../i18n/areas/mfg-r13c';
import { Btn, F, Grid, In, Sel } from './garments-ui';
import { opts, ratioText, row, run, stack, today } from './garments-util';


export default function BundlesView({ ctx }: { ctx: MfgContext }) {
  const plans = useMemo(() => (void ctx.version, loadCutPlans()), [ctx.version]);
  const workers = useMemo(() => karigars(vendorsDb.all()), []);
  const [lot, setLot] = useState(plans.at(-1)?.id ?? '');
  const [size, setSize] = useState(String(DEFAULT_BUNDLE_SIZE));
  const [shade, setShade] = useState('');
  const [op, setOp] = useState('');
  const [by, setBy] = useState('');
  const [rej, setRej] = useState('');
  const [reason, setReason] = useState('');
  const [last, setLast] = useState(false);
  const [tickets, setTickets] = useState(false);
  const p = plans.find((x) => x.id === lot);
  const st = p ? lotStatus(p) : null;
  const order = (id: string) => styleAxes(ctx.items.find((i) => i.id === id) ?? {}).sizes;
  const onCode = (code: string) => {
    try {
      const r = scanStep(code, { date: today(), op: op.trim() || undefined, ...(by ? { by } : {}), ...(num(rej) ? { rejected: num(rej), reason } : {}), last });
      setRej('');
      setLot(r.plan.id);
      ctx.changed(gT('scanned', { id: bundleId(r.plan.number, r.bundle.no), good: r.bundle.history.at(-1)?.good ?? 0 }));
      return { ok: true, message: gT('scanned', { id: bundleId(r.plan.number, r.bundle.no), good: r.bundle.history.at(-1)?.good ?? 0 }) };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  };
  return (
    <section data-mfc-bundles>
      <div style={row}>
        <F label={gT('lot')}><Sel v={lot} set={setLot} o={opts(plans.map((x) => ({ id: x.id, name: `${x.number} · ${x.colour}` })))} data-mfc="b-lot" /></F>
        {p && !p.bundles?.some((b) => b.history.length) && <>
          <F label={gT('bundleSize')} w={110}><In v={size} set={setSize} inputMode="numeric" /></F>
          <F label={gT('shade')} w={110}><In v={shade} set={setShade} /></F>
          <Btn kind="btnPrimary" on={() => run(ctx, () => void saveBundles(p.id, num(size), order(p.style_id), shade.trim() || undefined))} data-mfc="b-make">{gT('makeBundles')}</Btn>
        </>}
        {p?.bundles?.length ? <Btn on={() => setTickets(true)} data-mfc="b-tickets">{gT('tickets')}</Btn> : null}
      </div>
      <div style={stack}>
        <div style={row}>
          <F label={gT('op')} w={160}><In v={op} set={setOp} placeholder="Stitching" data-mfc="b-op" /></F>
          <F label={gT('by')}><Sel v={by} set={setBy} o={opts(workers)} /></F>
          <F label={gT('rejected')} w={100}><In v={rej} set={setRej} inputMode="numeric" /></F>
          {num(rej) > 0 && <F label={gT('reason')} w={140}><In v={reason} set={setReason} /></F>}
          <label><input type="checkbox" checked={last} onChange={(e) => setLast(e.target.checked)} /> {gT('lastOp')}</label>
        </div>
        <ScanField id="mfc-scan" label={gT('scan')} onCode={onCode} placeholder="CUT/FY26-27/0001/1" />
      </div>
      {p && st && <>
        <p data-mfc-status>{gT('status', { cut: st.cut, finished: Object.values(st.finishedBySize).reduce((a, q) => a + q, 0), rejected: st.rejected, open: st.open })} · {gT('wip')}: {ratioText(st.wipBySize) || '—'} · {Object.entries(st.byPlace).map(([k, q]) => `${gT(`w.${k}` as 'w.floor')} ${q}`).join(' · ')}</p>
        {ctx.canBooks && p.order_id && Object.keys(st.finishedBySize).length > 0 && <Btn on={() => run(ctx, () => gT('reported', { n: reportFinished(p.id, today(), ctx.items, ctx.inputs).length }))} data-mfc="b-report">{gT('reportFinished')}</Btn>}
        <Grid attr="bundles" head={[gT('bundle'), gT('size'), gT('pieces'), gT('where'), gT('lastStep')]} rows={(p.bundles ?? []).map((b) => [
          bundleId(p.number, b.no), `${b.size} ${b.colour}${b.shade ? ` · ${b.shade}` : ''}`, `${livePieces(b)}${b.rejected ? ` (−${b.rejected})` : ''}`,
          `${gT(`w.${b.at.where}` as 'w.floor')}${b.at.op ? ` · ${b.at.op}` : ''}`, b.history.at(-1) ? `${b.history.at(-1)!.date} ${b.history.at(-1)!.op ?? ''}` : '—',
        ])} />
      </>}
      {tickets && p && <BundleTickets plan={p} styleName={ctx.items.find((i) => i.id === p.style_id)?.name ?? ''} onClose={() => setTickets(false)} />}
    </section>
  );
}
