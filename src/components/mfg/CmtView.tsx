/**
 * MF-C3 Garments → CMT: bundles out to a fabricator (Material Out by bundle), back by bundle (good / rejected / short,
 * scrap kept by him), the job-work e-Way JSON for returns (sub-type 6) and job worker → job worker, and the ITC-04 depth
 * (reconciliation by job worker, scrap at the job worker, challans with no movement). Working papers — verify with your CA.
 */
import { useMemo, useState } from 'react';
import type { MfgContext } from '../manufacturing/context';
import type { Vendor } from '../../types/purchases';
import { loadCutPlans, consumption } from '../../lib/mfg/mf-cutplans';
import { bundleId, livePieces } from '../../lib/mfg/mf-bundles';
import { cmtTag, receiveCmt, sendCmt, type BundleReceipt } from '../../lib/mfg/mf-cmt';
import { buildJwOnwardEway, buildJwReturnEway, JW_EWAY_CA } from '../../lib/mfg/mf-eway-jw';
import { itc04Extra } from '../../lib/mfg/mf-itc04-extra';
import { karigarOf, rateFor } from '../../lib/mfg/mf-karigar';
import { materialInDb, materialOutDb, principalDb } from '../../lib/job-work';
import { vendorsDb } from '../../lib/vendors';
import { DB_PREFIX, getJson, getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { stringifyEway } from '../../lib/eway';
import { downloadText } from '../../lib/download';
import { num } from '../../lib/invoice-calc';
import { gT } from '../../i18n/areas/mfg-r13c';
import { Btn, F, Grid, In, Sel } from './garments-ui';
import { n2, opts, row, run, stack, today } from './garments-util';

const sender = () => {
  const p = localDb.settings.activeProfile();
  return { name: p?.companyName ?? '', gstin: p?.companyGstin, address: p?.companyAddress, stateCode: p?.stateCode };
};
const quarterStart = (d: string) => `${d.slice(0, 5)}${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;

export default function CmtView({ ctx }: { ctx: MfgContext }) {
  const plans = useMemo(() => (void ctx.version, loadCutPlans()), [ctx.version]);
  const vendors = useMemo(() => (void ctx.version, vendorsDb.all()), [ctx.version]);
  const outs = useMemo(() => (void ctx.version, materialOutDb.all()), [ctx.version]);
  const ins = useMemo(() => (void ctx.version, materialInDb.all()), [ctx.version]);
  const [lot, setLot] = useState('');
  const [pick, setPick] = useState<number[]>([]);
  const [ven, setVen] = useState('');
  const [per, setPer] = useState('');
  const [process, setProcess] = useState('Stitching');
  const [recv, setRecv] = useState('');
  const [got, setGot] = useState<Record<number, { good: string; rej: string }>>({});
  const [rate, setRate] = useState('');
  const [scrap, setScrap] = useState('');
  const [from, setFrom] = useState(quarterStart(today()));
  const [to, setTo] = useState(today());
  const [onward, setOnward] = useState({ out: '', first: '' });
  const p = plans.find((x) => x.id === lot);
  const v = vendors.find((x) => x.id === ven);
  const perDefault = p ? consumption(p, 0).per_piece_m : 0;
  const cmtOuts = outs.filter((o) => o.lines.some((l) => cmtTag(l)?.lot));
  const [outId, lineId] = recv.split('|');
  const rOut = outs.find((o) => o.id === outId);
  const rTag = cmtTag(rOut?.lines.find((l) => l.id === lineId));
  const rPlan = plans.find((x) => x.number === rTag?.lot);
  const rBundles = (rPlan?.bundles ?? []).filter((b) => b.at.where === 'fabricator' && b.at.challan_id === outId);
  const send = () => v && run(ctx, () => gT('sent', { number: sendCmt(lot, pick, { date: today(), vendor: v, perPieceM: num(per) || perDefault, process }, ctx.items).number }), () => setPick([]));
  const receive = () => run(ctx, () => {
    const receipts: BundleReceipt[] = rBundles.map((b) => ({ no: b.no, good: num(got[b.no]?.good ?? livePieces(b)), rejected: num(got[b.no]?.rej) }));
    const k = karigarOf(vendors.find((x) => x.id === rOut?.vendor_id));
    const r = rate ? num(rate) : rateFor(k, { name: rOut?.process }, rPlan?.style_id, today()) ?? 0;
    const { inn, draft } = receiveCmt(outId, lineId, receipts, { date: today(), rate: r, scrapM: num(scrap) }, ctx.items);
    return gT('received', { number: inn.number, good: draft.good, short: draft.short.reduce((s, x) => s + x.pieces, 0) });
  }, () => { setRecv(''); setGot({}); setScrap(''); });
  const ewayReturn = (id: string) => run(ctx, () => {
    const m = principalDb.all().find((x) => x.id === id)!;
    const c = getTable<{ name: string; gstin?: string; address?: string; state_code?: string }>('clients').find((x) => x.name === m.party_name);
    const b = buildJwReturnEway(m, c, { sender: sender(), intraExempt: !!getJson<{ eway_jw_intra_exempt?: boolean } | null>(`${DB_PREFIX}mfg_settings`, null)?.eway_jw_intra_exempt });
    downloadText(`eway-${m.number.replace(/\W+/g, '-')}.json`, stringifyEway(b.payload), 'application/json');
    return `${b.required ? gT('ewayNeeded') : gT('ewayNotNeeded')} ${b.notes.join(' ')}`;
  });
  const ewayOnward = () => run(ctx, () => {
    const o = outs.find((x) => x.id === onward.out);
    const first = vendors.find((x) => x.id === onward.first);
    if (!o || !first) throw new Error(gT('pickBoth'));
    const b = buildJwOnwardEway(o, first, vendors.find((x) => x.id === o.vendor_id) as Vendor | undefined, ctx.items, { sender: sender() });
    downloadText(`eway-${o.number.replace(/\W+/g, '-')}-onward.json`, stringifyEway(b.payload), 'application/json');
    return b.notes.at(-1);
  });
  const x = useMemo(() => itc04Extra(outs, ins, from, to), [outs, ins, from, to]);
  return (
    <section data-mfc-cmt>
      <h3>{gT('cmtOut')}</h3>
      <div style={row}>
        <F label={gT('lot')}><Sel v={lot} set={(y) => { setLot(y); setPick([]); }} o={opts(plans.map((y) => ({ id: y.id, name: `${y.number} · ${y.colour}` })))} data-mfc="cmt-lot" /></F>
        <F label={gT('fabricator')}><Sel v={ven} set={setVen} o={opts(vendors)} data-mfc="cmt-vendor" /></F>
        <F label={gT('process')} w={140}><In v={process} set={setProcess} /></F>
        <F label={gT('perPiece')} w={120}><In v={per} set={setPer} placeholder={n2(perDefault)} inputMode="decimal" /></F>
        <Btn kind="btnPrimary" on={send} disabled={!pick.length || !v} data-mfc="cmt-send">{gT('send', { n: pick.length })}</Btn>
      </div>
      {p && <div style={row} data-mfc-pick>{(p.bundles ?? []).filter((b) => b.at.where === 'floor' && livePieces(b)).map((b) => (
        <label key={b.no}><input type="checkbox" checked={pick.includes(b.no)} onChange={(e) => setPick(e.target.checked ? [...pick, b.no] : pick.filter((n) => n !== b.no))} data-mfc-b={b.no} /> {b.no} {b.size} ({livePieces(b)})</label>
      ))}</div>}
      <h3>{gT('cmtIn')}</h3>
      <div style={stack}>
        <div style={row}>
          <F label={gT('challan')}><Sel v={recv} set={setRecv} o={[['', '—'], ...cmtOuts.flatMap((o) => o.lines.filter((l) => cmtTag(l)?.lot).map((l) => [`${o.id}|${l.id}`, `${o.number} · ${o.party_name} · ${cmtTag(l)?.pieces}`] as const))]} data-mfc="cmt-recv" /></F>
          <F label={gT('rate')} w={110}><In v={rate} set={setRate} inputMode="decimal" /></F>
          <F label={gT('scrapJw')} w={160}><In v={scrap} set={setScrap} inputMode="decimal" /></F>
        </div>
        {rBundles.map((b) => (
          <div key={b.no} style={row}>
            <span style={{ minWidth: 180 }}>{bundleId(rPlan!.number, b.no)} · {b.size} ({livePieces(b)})</span>
            <F label={gT('good')} w={90}><In v={got[b.no]?.good ?? String(livePieces(b))} set={(g) => setGot({ ...got, [b.no]: { good: g, rej: got[b.no]?.rej ?? '' } })} inputMode="numeric" data-mfc-good={b.no} /></F>
            <F label={gT('rejected')} w={90}><In v={got[b.no]?.rej ?? ''} set={(r) => setGot({ ...got, [b.no]: { good: got[b.no]?.good ?? String(livePieces(b)), rej: r } })} inputMode="numeric" /></F>
          </div>
        ))}
        {rBundles.length > 0 && <div style={row}><Btn kind="btnPrimary" on={receive} data-mfc="cmt-receive">{gT('receive')}</Btn></div>}
      </div>
      <h3>{gT('eway')}</h3>
      <p>{JW_EWAY_CA}</p>
      <Grid attr="jw-returns" head={[gT('challan'), gT('party'), '']} rows={principalDb.all().filter((m) => m.kind === 'return').map((m) => [`${m.number} · ${m.date}`, m.party_name, <Btn key="e" on={() => ewayReturn(m.id)} data-mfc-eway={m.number}>{gT('ewayReturn')}</Btn>])} />
      <div style={row}>
        <F label={gT('challan')}><Sel v={onward.out} set={(o) => setOnward({ ...onward, out: o })} o={opts(outs.map((o) => ({ id: o.id, name: `${o.number} · ${o.party_name}` })))} /></F>
        <F label={gT('dispatchFrom')}><Sel v={onward.first} set={(f) => setOnward({ ...onward, first: f })} o={opts(vendors)} /></F>
        <Btn on={ewayOnward}>{gT('ewayOnward')}</Btn>
      </div>
      <h3>{gT('itc04')}</h3>
      <div style={row}>
        <F label={gT('from')} w={160}><In type="date" v={from} set={setFrom} /></F>
        <F label={gT('to')} w={160}><In type="date" v={to} set={setTo} /></F>
        <span>{gT('scrapInPeriod', { q: x.scrapInPeriod })}</span>
      </div>
      <Grid attr="itc04-recon" head={[gT('party'), gT('sent0'), gT('back'), gT('balance'), gT('oldest'), gT('expired')]} rows={x.byParty.map((r) => [r.party, n2(r.sent), n2(r.back), n2(r.balance), r.oldest || '—', r.expired])} />
      {x.idle.length > 0 && <p data-mfc-idle>{gT('idle')}: {x.idle.map((r) => r.number).join(', ')}</p>}
    </section>
  );
}
