/**
 * MF-C4 Garments → Karigars: piece-rate workers who are not on payroll (vendors with a rate card), their balance, the
 * weekly piece bill (KPB) from job cards, bundle coupons and CMT receipts, TDS 194C prompt, advances, bank file and slip.
 */
import { useMemo, useState } from 'react';
import type { MfgContext } from '../manufacturing/context';
import type { Vendor } from '../../types/purchases';
import type { MfKarigar, MfPieceLine } from '../../types/mfg-r13';
import { karigarBalance, karigarOf, karigars, pieceLines } from '../../lib/mfg/mf-karigar';
import { advanceLedgerId, advanceOutstanding, draftPieceBill, payAdvance, pieceUploadRows, savePieceBill, slipText } from '../../lib/mfg/mf-piece-bill';
import { loadCutPlans } from '../../lib/mfg/mf-cutplans';
import { loadCards } from '../../lib/mfg/mf-jobcards';
import { materialInDb } from '../../lib/job-work';
import { productionOrdersDb } from '../../lib/production/orders';
import { purchasesDb } from '../../lib/purchases';
import { vendorsDb } from '../../lib/vendors';
import { loadVouchers } from '../../lib/ledger/vouchers';
import { localDb } from '../../lib/localDb';
import { buildUploadFile } from '../../lib/bank-upload';
import { downloadText } from '../../lib/download';
import { num } from '../../lib/invoice-calc';
import { shiftDay } from '../../lib/dates';
import { gT } from '../../i18n/areas/mfg-r13c';
import { Btn, F, Grid, In, Sel } from './garments-ui';
import { n2, opts, row, run, stack, today } from './garments-util';

const KINDS = ['home', 'floor', 'fabricator'] as const;
const rateText = (k?: MfKarigar) => (k?.rates ?? []).map((r) => `${r.op}=${r.rate}`).join('; ');

export default function KarigarsView({ ctx }: { ctx: MfgContext }) {
  const vendors = useMemo(() => (void ctx.version, vendorsDb.all()), [ctx.version]);
  const list = karigars(vendors);
  const [edit, setEdit] = useState<{ id: string; kind: MfKarigar['kind']; rates: string; deduct: boolean } | null>(null);
  const [kid, setKid] = useState('');
  const [from, setFrom] = useState(shiftDay(today(), -6));
  const [to, setTo] = useState(today());
  const [lines, setLines] = useState<MfPieceLine[]>([]);
  const [tds, setTds] = useState(true);
  const [adv, setAdv] = useState('');
  const [advPay, setAdvPay] = useState('');
  const [slip, setSlip] = useState('');
  const k = vendors.find((v) => v.id === kid);
  const saveCard = () => edit && run(ctx, () => {
    const v = vendors.find((x) => x.id === edit.id)!;
    const rates = edit.rates.split(';').map((s) => s.split('=').map((x) => x.trim())).filter(([op, r]) => op && num(r) > 0).map(([op, r]) => ({ op, rate: num(r), from: (karigarOf(v)?.rates.find((x) => x.op === op && x.rate === num(r))?.from) ?? today() }));
    vendorsDb.save({ ...v, mf: { ...v.mf, karigar: { kind: edit.kind, rates: [...(karigarOf(v)?.rates ?? []).filter((x) => !rates.some((y) => y.op === x.op && y.from === x.from)), ...rates], ...(edit.deduct ? {} : { deduct_rejects: false }) } } });
  }, () => setEdit(null));
  const load = () => {
    if (!k) return;
    const orders = productionOrdersDb.all();
    setLines(pieceLines(k.id, karigarOf(k), { from, to }, {
      jobCards: loadCards(), plans: loadCutPlans(), cmtIns: materialInDb.all(),
      opName: (o, op) => orders.find((x) => x.id === o)?.mf?.ops?.find((y) => y.id === op)?.name ?? op,
      styleOfOrder: (o) => orders.find((x) => x.id === o)?.item_id,
    }));
  };
  const draft = () => k && draftPieceBill(k, lines, { date: to, period: { from, to }, ourState: localDb.settings.activeProfile()?.stateCode, tds, advance: num(adv), purchases: purchasesDb.all() });
  const [preview, note] = ((): [ReturnType<typeof draftPieceBill> | undefined, string] => {
    try {
      const p = lines.length ? draft() : undefined;
      return [p, p?.tds.note ?? ''];
    } catch (e) {
      return [undefined, (e as Error).message];
    }
  })();
  const save = () => k && run(ctx, () => {
    const d = draft()!;
    const b = savePieceBill(k, d);
    setSlip(slipText(k, b.bill_number, b.mf!.piece!, { total: b.total, tds: num(b.tds_amount), net: d.net }));
    const rows = pieceUploadRows([{ vendor: k, net: d.net }], b.bill_number);
    if (rows.length) {
      const f = buildUploadFile({ preset: 'generic', date: to, debitAccountNo: '', rows });
      downloadText(f.filename, f.text, 'text/csv');
    }
    return gT('billSaved', { number: b.bill_number });
  }, () => { setLines([]); setAdv(''); });
  const balance = (v: Vendor) => karigarBalance(v, purchasesDb.all(), loadVouchers(), advanceLedgerId());
  return (
    <section data-mfc-karigars>
      {ctx.canMasters && !edit && <div style={row}><F label={gT('makeKarigar')}><Sel v="" set={(id) => { const v = vendors.find((x) => x.id === id); setEdit({ id, kind: karigarOf(v)?.kind ?? 'home', rates: rateText(karigarOf(v)), deduct: karigarOf(v)?.deduct_rejects !== false }); }} o={opts(vendors)} data-mfc="k-pick" /></F></div>}
      {edit && (
        <div style={stack} data-mfc-k-form>
          <div style={row}>
            <F label={gT('kind')}><Sel v={edit.kind} set={(x) => setEdit({ ...edit, kind: x as MfKarigar['kind'] })} o={KINDS.map((x) => [x, gT(`k.${x}`)] as const)} /></F>
            <F label={gT('rates')}><In v={edit.rates} set={(x) => setEdit({ ...edit, rates: x })} placeholder="Stitching=38; Hemming=4" data-mfc="k-rates" /></F>
            <label><input type="checkbox" checked={edit.deduct} onChange={(e) => setEdit({ ...edit, deduct: e.target.checked })} /> {gT('deduct')}</label>
          </div>
          <div style={row}><Btn kind="btnPrimary" on={saveCard} data-mfc="k-save">{gT('save')}</Btn><Btn on={() => setEdit(null)}>{gT('cancel')}</Btn></div>
        </div>
      )}
      <Grid attr="karigars" head={[gT('karigar'), gT('kind'), gT('rates'), gT('billed'), gT('payable'), gT('advance')]} rows={list.map((v) => {
        const b = balance(v);
        return [v.name, gT(`k.${karigarOf(v)!.kind}`), rateText(karigarOf(v)), n2(b.billed), n2(b.payable), n2(b.advance)];
      })} />
      <h3>{gT('pieceBill')}</h3>
      <div style={row}>
        <F label={gT('karigar')}><Sel v={kid} set={(x) => { setKid(x); setLines([]); }} o={opts(list)} data-mfc="kb-karigar" /></F>
        <F label={gT('from')} w={160}><In type="date" v={from} set={setFrom} /></F>
        <F label={gT('to')} w={160}><In type="date" v={to} set={setTo} /></F>
        <Btn on={load} data-mfc="kb-load">{gT('loadPieces')}</Btn>
        <Btn on={() => setLines([...lines, { op: '', pieces: 0, rate: 0, amount: 0, source: 'typed' }])}>{gT('addLine')}</Btn>
      </div>
      {lines.map((l, i) => (
        <div key={i} style={row}>
          <F label={gT('op')} w={160}><In v={l.op} set={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, op: x } : y)))} /></F>
          <F label={gT('pieces')} w={100}><In v={String(l.pieces)} set={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, pieces: num(x) } : y)))} inputMode="numeric" data-mfc={`kb-pcs-${i}`} /></F>
          <F label={gT('rate')} w={100}><In v={String(l.rate)} set={(x) => setLines(lines.map((y, j) => (j === i ? { ...y, rate: num(x) } : y)))} inputMode="decimal" data-mfc={`kb-rate-${i}`} /></F>
          <span>{gT(`s.${l.source}`)} · ₹{n2(l.pieces * l.rate)}</span>
        </div>
      ))}
      {lines.length > 0 && k && (
        <div style={stack}>
          <div style={row}>
            <label><input type="checkbox" checked={tds} onChange={(e) => setTds(e.target.checked)} /> {gT('tds194c')}</label>
            <F label={gT('recover', { n: n2(advanceOutstanding(k)) })} w={180}><In v={adv} set={setAdv} inputMode="decimal" /></F>
          </div>
          <p data-mfc-kb-note>{preview ? gT('billPreview', { total: n2(preview.bill.total), gst: n2(preview.bill.cgst + preview.bill.sgst + preview.bill.igst), net: n2(preview.net) }) : ''} {note} {gT('minWage')}</p>
          {ctx.canBooks && <div style={row}><Btn kind="btnPrimary" on={save} disabled={!preview} data-mfc="kb-save">{gT('saveBill')}</Btn></div>}
        </div>
      )}
      {slip && k && <p><a href={`https://wa.me/${(k.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(slip)}`} target="_blank" rel="noreferrer">{gT('slip')}</a></p>}
      {k && ctx.canBooks && (
        <div style={row}>
          <F label={gT('advancePay')} w={160}><In v={advPay} set={setAdvPay} inputMode="decimal" data-mfc="k-adv" /></F>
          <Btn on={() => run(ctx, () => void payAdvance(k, { date: today(), amount: num(advPay) }), () => setAdvPay(''))}>{gT('payAdvance')}</Btn>
        </div>
      )}
    </section>
  );
}
