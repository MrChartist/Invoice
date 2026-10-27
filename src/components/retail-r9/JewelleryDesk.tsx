/**
 * RT-E Jewellery desk (Inventory → Jewellery, pack `jewellery`) and its host parts — ONE lazy chunk: views *Rates*
 * (today's board, Copy yesterday), *Tags* (pieces as serials, bulk entry, stock by purity, tag labels), *Old gold*
 * (URD vouchers, exchange against a bill, cash / bank payout) and *Karigar* (fine-weight account). Host parts:
 * `JewelLineRow` (editor line), `EditorJewel` (PAN / Form 60 and HUID notes in the editor), `PosJewel` (tag box, cash /
 * PAN guard at the counter). Working papers — verify with your CA (RT14, RT16–RT22).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, Landmark, Scale, Tags } from 'lucide-react';
import { useT } from '../../i18n';
import { rteT } from '../../i18n/areas/retail-r9e';
import type { InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { JewelLine, Metal, MakingBasis, KarigarLine, SaleKyc } from '../../types/retail-r9';
import { METALS, PURITIES, fineness, lastBoard, loadRates, purityLabel, rateFor, ratesOn, saveRates } from '../../lib/retail/rt-jewel-rates';
import { addTags, deleteTag, ensureJewelItem, loadTags, parseBulk, tagJewel, tagLabels, tagSummary, tagsInStock, type TagInput } from '../../lib/retail/rt-jewel-tags';
import { applyJewel, huidWarning, jewelAmount, jwHolds, netWeight } from '../../lib/retail/rt-jewel-line';
import { cashPaidToday, oldGoldValue, oldGoldVouchers, recordOldGold } from '../../lib/retail/rt-old-gold';
import { cashPaymentIssue, kycGate, liveSaleGuards, maskPan, type Guard } from '../../lib/retail/rt-cash-guard';
import { applyExchange } from '../../lib/retail/rt-buyback'; // RT-D3: the shared exchange receipt
import { deleteKarigarMove, karigarLedger, karigarLine, loadKarigarMoves, recordKarigar } from '../../lib/retail/rt-karigar';
import { labelSheetHtml, layoutById } from '../../lib/label-sheet';
import { printHtmlDocument } from '../../lib/voucher-print';
import { stockDb } from '../../lib/inventory';
import { loadTracking, saveGates } from '../../lib/stock-tracking';
import { vendorsDb } from '../../lib/vendors';
import { paymentsDb, purchasesDb } from '../../lib/purchases';
import { can } from '../../lib/access';
import { audit } from '../../lib/audit';
import { generateId, getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { formatCurrency, todayInput } from '../../lib/utils';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useShallow } from 'zustand/react/shallow';
import { downloadTextFile } from '../receivables/exportUtils';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

type Done = (msg: string, error?: boolean) => void;
const VIEWS = [['rates', Scale], ['tags', Tags], ['oldgold', Landmark], ['karigar', Calculator]] as const;
const sm = `${controls.btnOutline} ${controls.btnSm}`;
const ghost = `${controls.btnGhost} ${controls.btnSm}`;
const row = { flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;
const g3 = (x: number) => num(x).toFixed(3);

const F = ({ l, w, children }: { l: string; w?: number; children: ReactNode }) => <label className={controls.field} style={w ? { maxWidth: w } : undefined}><span className={controls.label}>{l}</span>{children}</label>;
const N = ({ l, v, set, w = 110, d }: { l: string; v: number; set: (n: number) => void; w?: number; d?: string }) => <F l={l} w={w}><NumberInput className={controls.input} value={v} onChange={set} data-jw={d} /></F>;
const PuritySelect = ({ metal, value, set }: { metal: Metal; value: string; set: (p: string) => void }) => (
  <F l={rteT('purity')} w={120}><select className={controls.select} value={value} onChange={(e) => set(e.target.value)} data-jw="purity">{PURITIES[metal].map(([k]) => <option key={k} value={k}>{purityLabel(metal, k)}</option>)}</select></F>
);
const MetalSelect = ({ value, set }: { value: Metal; set: (m: Metal) => void }) => (
  <F l={rteT('metal')} w={110}><select className={controls.select} value={value} onChange={(e) => set(e.target.value as Metal)}>{METALS.map((m) => <option key={m} value={m}>{rteT(`m.${m}`)}</option>)}</select></F>
);
const Making = ({ v, set }: { v: { basis: MakingBasis; value: number }; set: (m: { basis: MakingBasis; value: number }) => void }) => (
  <F l={rteT('making')} w={190}><span className={controls.row}>
    <NumberInput className={controls.input} value={v.value} onChange={(value) => set({ ...v, value })} data-jw="making" />
    <select className={controls.select} value={v.basis} onChange={(e) => set({ ...v, basis: e.target.value as MakingBasis })}>{(['per_gram', 'percent', 'fixed'] as const).map((b) => <option key={b} value={b}>{rteT(`mk.${b}`)}</option>)}</select>
  </span></F>
);
const useRun = (onDone: Done) => {
  const [tick, setTick] = useState(0);
  const run = (fn: () => string) => {
    try {
      onDone(fn());
      setTick((t) => t + 1);
    } catch (e) {
      onDone((e as Error).message, true);
    }
  };
  return [tick, run] as const;
};

export default function JewelleryDesk({ view, onDone }: { view?: string; onDone: Done }) {
  useT();
  const v = VIEWS.some(([id]) => id === view) ? view : 'rates';
  return (
    <section className={surface.card} data-jewellery-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment}>
          {VIEWS.map(([id, Icon]) => <Link key={id} to={`/inventory?tab=jewellery&view=${id}`} className={id === v ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn}><Icon size={14} aria-hidden="true" /> {rteT(`view.${id}`)}</Link>)}
        </span>
      </div>
      <div className={surface.cardBody}>
        {v === 'tags' ? <TagsView onDone={onDone} /> : v === 'oldgold' ? <OldGoldView onDone={onDone} /> : v === 'karigar' ? <KarigarView onDone={onDone} /> : <RatesView onDone={onDone} />}
        <p className={controls.hint}>{rteT('workingPaper')}</p>
      </div>
    </section>
  );
}

/* ── RT-E1 rates ── */

type Grid = Record<string, { sale: number; buy: number }>;
const KEYS = METALS.flatMap((m) => PURITIES[m].map(([p]) => [m, p] as const));

function RatesView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const [day, setDay] = useState(todayInput());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rates = useMemo(() => loadRates(), [tick]);
  const board = (rows: { metal: Metal; purity: string; sale: number; buy: number }[]): Grid => Object.fromEntries(rows.map((r) => [`${r.metal}:${r.purity}`, { sale: r.sale, buy: r.buy }]));
  const [grid, setGrid] = useState<Grid>(() => board([...ratesOn(rates, day).values()]));
  useEffect(() => setGrid(board([...ratesOn(loadRates(), day).values()])), [day]); // eslint-disable-line react-hooks/set-state-in-effect
  const set = (k: string, f: 'sale' | 'buy', n: number) => setGrid({ ...grid, [k]: { ...(grid[k] ?? { sale: 0, buy: 0 }), [f]: n } });
  const save = () => run(() => rteT('ratesSaved', { n: saveRates(day, KEYS.map(([metal, purity]) => ({ metal, purity, ...(grid[`${metal}:${purity}`] ?? { sale: 0, buy: 0 }) }))).length, day }));
  return (
    <>
      <h3 className={surface.cardHeadIcon}><Scale size={16} aria-hidden="true" /> {rteT('ratesTitle')}</h3>
      <p className={surface.sectionNote}>{rteT('ratesHint')}</p>
      <div className={controls.row} style={row}>
        <F l={rteT('date')} w={170}><input type="date" className={controls.input} value={day} onChange={(e) => setDay(e.target.value)} /></F>
        <button type="button" className={sm} onClick={() => setGrid(board(lastBoard(rates, day)))}>{rteT('copyYesterday')}</button>
        <button type="button" className={controls.btnPrimary} onClick={save} data-rates-save>{rteT('save')}</button>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{rteT('metal')}</th><th>{rteT('purity')}</th><th className={surface.numeric}>{rteT('sale')}</th><th className={surface.numeric}>{rteT('buy')}</th></tr></thead>
          <tbody>
            {KEYS.map(([m, p]) => {
              const k = `${m}:${p}`;
              return (
                <tr key={k}>
                  <td>{rteT(`m.${m}`)}</td><td>{purityLabel(m, p)}</td>
                  <td className={surface.numeric}><NumberInput className={controls.input} value={grid[k]?.sale ?? 0} onChange={(n) => set(k, 'sale', n)} aria-label={`${k} ${rteT('sale')}`} data-rate-sale={k} /></td>
                  <td className={surface.numeric}><NumberInput className={controls.input} value={grid[k]?.buy ?? 0} onChange={(n) => set(k, 'buy', n)} aria-label={`${k} ${rteT('buy')}`} data-rate-buy={k} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── RT-E1 tags ── */

const BLANK_TAG = { item: '', metal: 'gold' as Metal, purity: '22K', gross_wt: 0, stone_wt: 0, stone_value: 0, wastage_pct: 0, making: { basis: 'per_gram' as MakingBasis, value: 0 }, hallmark_charge: 0, huid: '', design_no: '', bulk: '' };

function TagsView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const [f, setF] = useState(BLANK_TAG);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => { const tr = loadTracking(); return { tr, stock: tagsInStock(loadTags(), tr), items: stockDb.items().filter((i) => i.jewel) }; }, [tick]);
  const summary = tagSummary(data.stock);
  const save = () => run(() => {
    const item = ensureJewelItem(f.item.trim() || rteT('defaultItem'));
    const base: TagInput = { item_id: item.id, metal: f.metal, purity: f.purity, gross_wt: f.gross_wt, stone_wt: f.stone_wt, stone_value: f.stone_value, wastage_pct: f.wastage_pct, making: f.making, hallmark_charge: f.hallmark_charge, huid: f.huid, design_no: f.design_no };
    const rows = f.bulk.trim() ? parseBulk(f.bulk).map((b) => ({ ...base, ...b, purity: b.purity ?? f.purity })) : [base];
    // Stock value of a piece: its metal at the day's buy rate of its purity + its stones (cost; edit by a stock journal).
    const rates = loadRates();
    const made = addTags(rows, { date: todayInput(), toStock: true, cost: (t) => t.net_wt * (rateFor(rates, t.metal, t.purity, todayInput())?.buy ?? 0) + t.stone_value });
    setF({ ...f, gross_wt: 0, stone_wt: 0, huid: '', bulk: '' });
    return rteT('tagsSaved', { n: made.length, first: made[0]?.tag ?? '' });
  });
  const print = () => printHtmlDocument(labelSheetHtml(tagLabels(data.stock), { layout: layoutById('jewel-tag'), price: 'none' }), (h) => downloadTextFile('Tags.html', h));
  const s = <K extends keyof typeof BLANK_TAG>(k: K) => (v: (typeof BLANK_TAG)[K]) => setF({ ...f, [k]: v });
  return (
    <>
      <h3 className={surface.cardHeadIcon}><Tags size={16} aria-hidden="true" /> {rteT('tagsTitle')}</h3>
      <p className={surface.sectionNote}>{rteT('tagsHint')}</p>
      <div className={controls.row} style={row} data-tag-form>
        <F l={rteT('item')}><input className={controls.input} list="jw-items" value={f.item} placeholder={rteT('defaultItem')} onChange={(e) => s('item')(e.target.value)} data-jw="item" /></F>
        <datalist id="jw-items">{data.items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
        <MetalSelect value={f.metal} set={(metal) => setF({ ...f, metal, purity: PURITIES[metal][metal === 'gold' ? 2 : 1][0] })} />
        <PuritySelect metal={f.metal} value={f.purity} set={s('purity')} />
        <N l={rteT('gross')} v={f.gross_wt} set={s('gross_wt')} d="gross" />
        <N l={rteT('stoneWt')} v={f.stone_wt} set={s('stone_wt')} d="stone" />
        <span className={controls.hint}>{rteT('net')} {g3(netWeight(f.gross_wt, f.stone_wt))} g</span>
        <N l={rteT('stoneValue')} v={f.stone_value} set={s('stone_value')} d="stones" />
        <N l={rteT('wastage')} v={f.wastage_pct} set={s('wastage_pct')} w={90} d="wastage" />
        <Making v={f.making} set={s('making')} />
        <N l={rteT('hallmark')} v={f.hallmark_charge} set={s('hallmark_charge')} w={90} d="hallmark" />
        <F l="HUID" w={110}><input className={controls.input} value={f.huid} maxLength={6} onChange={(e) => s('huid')(e.target.value.toUpperCase())} data-jw="huid" /></F>
        <F l={rteT('design')} w={110}><input className={controls.input} value={f.design_no} onChange={(e) => s('design_no')(e.target.value)} /></F>
      </div>
      <F l={rteT('bulk')}><textarea className={controls.input} rows={2} value={f.bulk} placeholder="6.420, 0.380, 22K, AB12CD" onChange={(e) => s('bulk')(e.target.value)} /></F>
      <p><button type="button" className={controls.btnPrimary} disabled={!(f.gross_wt > 0) && !f.bulk.trim()} onClick={save} data-tag-save>{rteT('addTags')}</button></p>
      {summary.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-tag-summary>
            <thead><tr><th>{rteT('purity')}</th><th className={surface.numeric}>{rteT('pieces')}</th><th className={surface.numeric}>{rteT('net')}</th><th className={surface.numeric}>{rteT('fine')}</th></tr></thead>
            <tbody>{summary.map((r) => <tr key={r.metal + r.purity}><td>{rteT(`m.${r.metal}`)} {r.label}</td><td className={surface.numeric}>{r.pieces}</td><td className={surface.numeric}>{g3(r.net)}</td><td className={surface.numeric}>{g3(r.fine)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {data.stock.length === 0 ? <p className={controls.hint}>{rteT('noTags')}</p> : (
        <>
          <button type="button" className={sm} onClick={print}>{rteT('printTags')}</button>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{rteT('tag')}</th><th>{rteT('item')}</th><th>{rteT('purity')}</th><th className={surface.numeric}>{rteT('gross')}</th><th className={surface.numeric}>{rteT('net')}</th><th>HUID</th><th /></tr></thead>
              <tbody>
                {data.stock.map((t) => (
                  <tr key={t.id} data-tag-row={t.tag}>
                    <td className={surface.mono}>{t.tag}</td><td>{t.item_name}</td><td>{purityLabel(t.metal, t.purity)}</td>
                    <td className={surface.numeric}>{g3(t.gross_wt)}</td><td className={surface.numeric}>{g3(t.net_wt)}</td>
                    <td>{t.huid ?? (t.metal === 'gold' ? <small style={{ color: 'var(--warning)' }}>{rteT('noHuid')}</small> : '—')}</td>
                    <td><button type="button" className={ghost} onClick={() => window.confirm(rteT('confirmDel', { tag: t.tag })) && run(() => (deleteTag(t.id, data.tr), `${t.tag} ✓`))}>{rteT('del')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/* ── RT-E3 old gold ── */

const BLANK_OG = { name: '', phone: '', pan: '', form60: false, metal: 'gold' as Metal, gross: 0, stone: 0, purity_pct: 0, melt_pct: 0, rate: 0, basis: 'fine' as 'fine' | 'purity', test: '', bill: '' };

function OldGoldView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const day = todayInput();
  const [f, setF] = useState(BLANK_OG);
  const s = <K extends keyof typeof BLANK_OG>(k: K) => (v: (typeof BLANK_OG)[K]) => setF({ ...f, [k]: v });
  // Buy rate of the day: 24K (fine basis) for gold, 999 for silver; the purity basis takes the nearest karat.
  const dayRate = (m: Metal) => rateFor(loadRates(), m, m === 'gold' ? '24K' : PURITIES[m][0][0], day)?.buy ?? 0;
  const rate = f.rate || dayRate(f.metal);
  const v = oldGoldValue({ gross: f.gross, stone: f.stone, purity_pct: f.purity_pct, melt_pct: f.melt_pct, rate, basis: f.basis });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => oldGoldVouchers(purchasesDb.all(), getTable<Payment>('transactions')), [tick]);
  const findBill = (no: string) => getTable<InvoiceRecord>('invoices').find((i) => i?.invoice_number?.toUpperCase() === no.trim().toUpperCase());
  const save = () => run(() => {
    const inv = f.bill.trim() ? findBill(f.bill) : undefined;
    if (f.bill.trim() && !inv) throw new Error(rteT('noBill', { number: f.bill }));
    const p = recordOldGold({ date: day, customer: { name: f.name, phone: f.phone, pan: f.pan || undefined, ...(f.form60 ? { form: '60' as const } : {}) }, metal: f.metal, gross: f.gross, stone: f.stone, purity_pct: f.purity_pct, melt_pct: f.melt_pct, rate, basis: f.basis, test_method: f.test || undefined });
    if (inv) applyExchange(inv.id, p.id);
    setF(BLANK_OG);
    return rteT('ogSaved', { number: p.bill_number, value: formatCurrency(p.total) }) + (inv ? ` ${rteT('ogSettled', { bill: inv.invoice_number })}` : '');
  });
  const settle = (id: string) => {
    const no = window.prompt(rteT('billNo'));
    if (!no) return;
    run(() => {
      const inv = findBill(no);
      if (!inv) throw new Error(rteT('noBill', { number: no }));
      applyExchange(inv.id, id);
      return rteT('ogSettled', { bill: inv.invoice_number });
    });
  };
  const pay = (id: string, cash: boolean) => run(() => {
    const p = purchasesDb.get(id)!;
    const open = num(p.total) - num(p.amount_paid);
    const warn = cash ? cashPaymentIssue(cashPaidToday(p.vendor_id, day) + open, day) : '';
    if (warn && !window.confirm(warn)) return rteT('cancelled');
    paymentsDb.record(id, { amount: open, date: day, method: cash ? 'Cash' : 'Bank transfer' });
    return rteT('ogPaid', { number: p.bill_number }) + (warn ? ` ${warn}` : '');
  });
  return (
    <>
      <h3 className={surface.cardHeadIcon}><Landmark size={16} aria-hidden="true" /> {rteT('ogTitle')}</h3>
      <p className={surface.sectionNote}>{rteT('ogHint')}</p>
      <div className={controls.row} style={row} data-og-form>
        <F l={rteT('customer')}><input className={controls.input} value={f.name} onChange={(e) => s('name')(e.target.value)} data-og="name" /></F>
        <F l={rteT('phone')} w={140}><input className={controls.input} inputMode="tel" value={f.phone} onChange={(e) => s('phone')(e.target.value)} /></F>
        <MetalSelect value={f.metal} set={s('metal')} />
        <N l={rteT('gross')} v={f.gross} set={s('gross')} d="og-gross" />
        <N l={rteT('stoneWt')} v={f.stone} set={s('stone')} />
        <N l={rteT('touch')} v={f.purity_pct} set={s('purity_pct')} w={90} d="og-touch" />
        <N l={rteT('melt')} v={f.melt_pct} set={s('melt_pct')} w={90} d="og-melt" />
        <N l={rteT('buyRate')} v={rate} set={s('rate')} d="og-rate" />
        <F l={rteT('basis')} w={150}><select className={controls.select} value={f.basis} onChange={(e) => s('basis')(e.target.value as 'fine' | 'purity')}><option value="fine">{rteT('basisFine')}</option><option value="purity">{rteT('basisPurity')}</option></select></F>
        <F l={rteT('test')} w={130}><input className={controls.input} value={f.test} placeholder={rteT('testPh')} onChange={(e) => s('test')(e.target.value)} /></F>
        <F l="PAN" w={130}><input className={controls.input} value={f.pan} maxLength={10} onChange={(e) => s('pan')(e.target.value.toUpperCase())} /></F>
        <label className={controls.hint}><input type="checkbox" checked={f.form60} onChange={(e) => s('form60')(e.target.checked)} /> {rteT('form60')}</label>
        <F l={rteT('againstBill')} w={170}><input className={controls.input} value={f.bill} onChange={(e) => s('bill')(e.target.value)} data-og="bill" /></F>
      </div>
      <p className={controls.hint} data-og-value>{rteT('ogPreview', { net: g3(v.net), fine: g3(v.fine), value: formatCurrency(v.value) })}</p>
      <button type="button" className={controls.btnPrimary} disabled={!f.name.trim() || !(v.value > 0)} onClick={save} data-og-save>{rteT('ogSave')}</button>
      {list.length === 0 ? <p className={controls.hint}>{rteT('ogEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>#</th><th>{rteT('customer')}</th><th className={surface.numeric}>{rteT('fine')}</th><th className={surface.numeric}>₹</th><th className={surface.numeric}>{rteT('exchanged')}</th><th className={surface.numeric}>{rteT('open')}</th><th /></tr></thead>
            <tbody>
              {list.slice(0, 200).map((p) => (
                <tr key={p.id} data-og-row={p.bill_number}>
                  <td>{p.bill_number}<br /><small>{p.date}</small></td>
                  <td>{p.vendor_name}{p.old_metal?.kyc?.pan ? <><br /><small>PAN {maskPan(p.old_metal.kyc.pan)}</small></> : null}</td>
                  <td className={surface.numeric}>{g3(p.old_metal!.fine_wt)}<br /><small>{g3(p.old_metal!.gross_wt)} g @ {p.old_metal!.purity_pct}%</small></td>
                  <td className={surface.numeric}>{formatCurrency(p.total)}</td>
                  <td className={surface.numeric}>{p.exchanged ? formatCurrency(p.exchanged) : '—'}</td>
                  <td className={surface.numeric}>{formatCurrency(p.open)}</td>
                  <td style={{ textAlign: 'right' }}>{p.open > 0.004 && <>
                    <button type="button" className={sm} onClick={() => settle(p.id)} data-og-settle>{rteT('settle')}</button>
                    <button type="button" className={ghost} onClick={() => pay(p.id, true)}>{rteT('payCash')}</button>
                    <button type="button" className={ghost} onClick={() => pay(p.id, false)}>{rteT('payBank')}</button>
                  </>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ── RT-E4 karigar ── */

const BLANK_K = { karigar: '', kind: 'issue' as 'issue' | 'receipt' | 'return_metal', item: '', metal: 'gold' as Metal, purity: '24K', gross: 0, net: 0, touch: 0, pieces: 0, wastage: 0, basis: 'per_gram' as 'per_gram' | 'per_piece', labour: 0, consume: '', tags: '' };

function KarigarView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const day = todayInput();
  const [f, setF] = useState(BLANK_K);
  const s = <K extends keyof typeof BLANK_K>(k: K) => (v: (typeof BLANK_K)[K]) => setF({ ...f, [k]: v });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ moves: loadKarigarMoves(), vendors: vendorsDb.all(), items: stockDb.items() }), [tick]);
  const ledger = karigarLedger(d.moves, day);
  const touch = f.touch || fineness(f.metal, f.purity) / 10;
  const save = () => run(() => {
    const k = d.vendors.find((x) => x.id === f.karigar);
    if (!k) throw new Error(rteT('pickKarigar'));
    if (!k.karigar) vendorsDb.save({ ...k, karigar: true });
    const item = d.items.find((i) => i.name.toLowerCase() === f.item.trim().toLowerCase());
    const line: KarigarLine = karigarLine({ item_id: item?.id, item_name: f.item.trim() || rteT(`m.${f.metal}`), metal: f.metal, purity: f.purity, gross_wt: f.gross, net_wt: f.net, touch_pct: touch, ...(f.pieces ? { pieces: f.pieces } : {}) });
    const tags = f.kind === 'receipt' && f.tags.trim() && item ? parseBulk(f.tags).map((b) => ({ item_id: item.id, metal: f.metal, purity: b.purity ?? f.purity, gross_wt: b.gross_wt, stone_wt: b.stone_wt, huid: b.huid })) : undefined;
    const m = recordKarigar({ date: day, karigar: k, kind: f.kind, lines: [line], ...(f.kind === 'receipt' ? { wastage_pct: f.wastage, labour: { basis: f.basis, rate: f.labour }, consume_item_id: f.consume || undefined, tags } : {}) });
    setF({ ...BLANK_K, karigar: f.karigar });
    return rteT('kSaved', { number: m.number }) + (m.labour ? ` ${rteT('kLabour', { amount: formatCurrency(m.labour.amount) })}` : '');
  });
  return (
    <>
      <h3 className={surface.cardHeadIcon}><Calculator size={16} aria-hidden="true" /> {rteT('kTitle')}</h3>
      <p className={surface.sectionNote}>{rteT('kHint')}</p>
      <div className={controls.row} style={row} data-k-form>
        <F l={rteT('karigar')}><select className={controls.select} value={f.karigar} onChange={(e) => s('karigar')(e.target.value)} data-k="karigar"><option value="">—</option>{[...d.vendors].sort((a, b) => Number(!!b.karigar) - Number(!!a.karigar)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></F>
        <F l={rteT('kind')} w={150}><select className={controls.select} value={f.kind} onChange={(e) => s('kind')(e.target.value as typeof f.kind)} data-k="kind">{(['issue', 'receipt', 'return_metal'] as const).map((k) => <option key={k} value={k}>{rteT(`k.${k}`)}</option>)}</select></F>
        <F l={rteT('item')}><input className={controls.input} list="jw-k-items" value={f.item} onChange={(e) => s('item')(e.target.value)} data-k="item" /></F>
        <datalist id="jw-k-items">{d.items.map((i) => <option key={i.id} value={i.name} />)}</datalist>
        <MetalSelect value={f.metal} set={s('metal')} />
        <PuritySelect metal={f.metal} value={f.purity} set={s('purity')} />
        <N l={rteT('gross')} v={f.gross} set={s('gross')} d="k-gross" />
        <N l={rteT('net')} v={f.net} set={s('net')} d="k-net" />
        <N l={rteT('touch')} v={touch} set={s('touch')} w={90} d="k-touch" />
        {f.kind === 'receipt' && <>
          <N l={rteT('pieces')} v={f.pieces} set={s('pieces')} w={80} />
          <N l={rteT('wastageAllowed')} v={f.wastage} set={s('wastage')} w={110} d="k-wastage" />
          <N l={rteT('labourRate')} v={f.labour} set={s('labour')} d="k-labour" />
          <F l={rteT('basis')} w={130}><select className={controls.select} value={f.basis} onChange={(e) => s('basis')(e.target.value as typeof f.basis)}><option value="per_gram">{rteT('mk.per_gram')}</option><option value="per_piece">{rteT('perPiece')}</option></select></F>
          <F l={rteT('consume')}><select className={controls.select} value={f.consume} onChange={(e) => s('consume')(e.target.value)}><option value="">—</option>{d.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></F>
          <F l={rteT('bulk')}><textarea className={controls.input} rows={1} value={f.tags} placeholder="6.420, 0.380, 22K, AB12CD" onChange={(e) => s('tags')(e.target.value)} /></F>
        </>}
        <button type="button" className={controls.btnPrimary} disabled={!f.karigar || !(f.gross > 0 || f.net > 0)} onClick={save} data-k-save>{rteT('save')}</button>
      </div>
      {ledger.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-k-ledger>
            <thead><tr><th>{rteT('karigar')}</th><th className={surface.numeric}>{rteT('k.issue')}</th><th className={surface.numeric}>{rteT('k.receipt')}</th><th className={surface.numeric}>{rteT('wastageAllowed')}</th><th className={surface.numeric}>{rteT('k.return_metal')}</th><th className={surface.numeric}>{rteT('balance')}</th><th className={surface.numeric}>{rteT('days')}</th></tr></thead>
            <tbody>{ledger.map((l) => <tr key={l.karigar_id} data-k-row={l.name}><td>{l.name}</td><td className={surface.numeric}>{g3(l.issued)}</td><td className={surface.numeric}>{g3(l.received)}</td><td className={surface.numeric}>{g3(l.wastage)}</td><td className={surface.numeric}>{g3(l.returned)}</td><td className={surface.numeric}><strong>{g3(l.balance)}</strong></td><td className={surface.numeric}>{l.days || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <p className={controls.hint}>{rteT('itc04')}</p>
      {d.moves.length > 0 && (
        <ul className={controls.hint}>
          {[...d.moves].reverse().slice(0, 50).map((m) => (
            <li key={m.id}>{m.number} · {m.date} · {m.karigar_name} · {rteT(`k.${m.kind}`)} · {g3(m.lines.reduce((x, l) => x + l.fine_wt, 0))} g {rteT('fine')}{m.wastage_fine ? ` · ${rteT('wastageAllowed')} ${g3(m.wastage_fine)}` : ''}{m.labour ? ` · ${formatCurrency(m.labour.amount)}` : ''}{' '}
              <button type="button" className={ghost} onClick={() => window.confirm(rteT('confirmDel', { tag: m.number })) && run(() => (deleteKarigarMove(m.id), `${m.number} ✓`))}>{rteT('del')}</button></li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ── RT-E2 editor line ── */

const jewelItem = (name: string) => stockDb.items().find((i) => i.jewel && i.name.trim().toLowerCase() === name.trim().toLowerCase());

const noRate = (jw: JewelLine, date: string) => rteT('noRate', { metal: rteT(`m.${jw.metal}`), purity: jw.purity, date });
/** The breakdown of a line at the rate of `date` (override = an owner-typed rate on a day with no board rate). */
function priced(jw: JewelLine, date: string, typed?: number): { jw: JewelLine; error: string } {
  if (jw.rate_locked || jw.job_work) return { jw, error: '' };
  const r = rateFor(loadRates(), jw.metal, jw.purity, date);
  if (r) return { jw: { ...jw, rate: r.sale, override: undefined }, error: '' };
  if (typed && typed > 0 && can('settings.manage')) return { jw: { ...jw, rate: typed, override: true }, error: '' };
  return { jw, error: noRate(jw, date) };
}
/** Editor save gate (RT-E1): a jewellery line with no board rate on the bill date (not locked, job work or owner-typed). */
const rateGate = (rec: Pick<InvoiceRecord, 'issue_date' | 'items'>): string[] =>
  rec.items.filter((l) => l.jw && !l.jw.rate_locked && !l.jw.job_work && !l.jw.override && !rateFor(loadRates(), l.jw.metal, l.jw.purity, rec.issue_date)).map((l) => `${l.name}: ${noRate(l.jw!, rec.issue_date)}`);

/** Editor sub-row of a jewellery line: tag or loose weight, purity, wastage, making, stones, hallmarking. */
export function JewelLineRow({ item, date }: { item: InvoiceItem; date: string }) {
  useT();
  const patch = useInvoiceStore.getState().patchItem;
  const jwTag = item.jw?.tag;
  const stock = useMemo(() => (jwTag || jewelItem(item.name) ? tagsInStock(loadTags(), loadTracking()).filter((t) => t.item_name.toLowerCase() === item.name.trim().toLowerCase() || t.tag === jwTag) : []), [item.name, jwTag]);
  const [typed, setTyped] = useState(0);
  const apply = (jw: JewelLine, rate = typed) => {
    const p = priced(jw, date, rate);
    if (p.jw.override && !jw.override) audit.record({ entity: 'item', entity_id: item.id, action: 'override', summary: `Metal rate typed for ${item.name}: ₹${p.jw.rate}/g on ${date} (no ${jw.metal} ${jw.purity} rate on the board)` });
    patch(item.id, applyJewel(item, p.jw, date));
  };
  useEffect(() => {
    if (item.jw && !jwHolds(item)) patch(item.id, { jw: undefined }); // a typed amount / quantity makes the line manual
    else if (item.jw && !item.jw.rate_locked && !item.jw.override) {
      const p = priced(item.jw, date);
      if (p.jw.rate !== item.jw.rate) patch(item.id, applyJewel(item, p.jw, date));
    }
  }, [item.quantity, item.rate, date]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item.jw && !jewelItem(item.name)) return null;
  const jw: JewelLine = item.jw ?? { metal: 'gold', purity: '22K', gross_wt: 0, stone_wt: 0, net_wt: 0, rate: 0, wastage_pct: 0, making: { basis: 'per_gram', value: 0 }, stone_value: 0, hallmark_charge: 0 };
  const set = (p: Partial<JewelLine>) => { const n = { ...jw, ...p }; apply({ ...n, net_wt: netWeight(n.gross_wt, n.stone_wt) }); };
  const a = jewelAmount(jw);
  const err = jw.override ? '' : rateGate({ issue_date: date, items: [{ ...item, jw }] }).length ? noRate(jw, date) : '';
  const warn = huidWarning({ name: item.name, jw }, date);
  return (
    <div className={controls.row} style={{ ...row, fontSize: '0.85em' }} data-jewel-row>
      <F l={rteT('tag')} w={130}><select className={controls.select} value={jw.tag ?? ''} data-jw="tag" onChange={(e) => {
        const t = stock.find((x) => x.tag === e.target.value);
        if (t) apply(tagJewel(t, jw.rate));
        else set({ tag: undefined });
      }}><option value="">{rteT('loose')}</option>{stock.map((t) => <option key={t.id} value={t.tag}>{t.tag} · {g3(t.net_wt)} g</option>)}</select></F>
      {!jw.tag && <><MetalSelect value={jw.metal} set={(metal) => set({ metal, purity: PURITIES[metal][metal === 'gold' ? 2 : 1][0] })} /><PuritySelect metal={jw.metal} value={jw.purity} set={(purity) => set({ purity })} /><N l={rteT('gross')} v={jw.gross_wt} set={(gross_wt) => set({ gross_wt })} w={90} d="line-gross" /><N l={rteT('stoneWt')} v={jw.stone_wt} set={(stone_wt) => set({ stone_wt })} w={90} /></>}
      <N l={rteT('wastage')} v={jw.wastage_pct} set={(wastage_pct) => set({ wastage_pct })} w={80} />
      <Making v={jw.making} set={(making) => set({ making })} />
      <N l={rteT('stoneValue')} v={jw.stone_value} set={(stone_value) => set({ stone_value })} w={100} />
      <N l={rteT('hallmark')} v={jw.hallmark_charge} set={(hallmark_charge) => set({ hallmark_charge })} w={80} />
      <label className={controls.hint}><input type="checkbox" checked={!!jw.job_work} onChange={(e) => set({ job_work: e.target.checked || undefined })} /> {rteT('jobWork')}</label>
      <label className={controls.hint}><input type="checkbox" checked={!!jw.rate_locked} onChange={(e) => set({ rate_locked: e.target.checked || undefined })} /> {rteT('rateLocked')}</label>
      {(err || jw.override) && can('settings.manage') && <N l={rteT('typeRate')} v={typed} set={(n) => { setTyped(n); apply(jw, n); }} d="line-rate" />}
      <span className={controls.hint} data-jw-amount>{g3(jw.net_wt)} g × ₹{jw.rate}{jw.override ? ` (${rteT('typed')})` : ''} = {formatCurrency(a.metal)} + {formatCurrency(a.wastage)} + {formatCurrency(a.making)} → <strong>{formatCurrency(a.total)}</strong></span>
      {(err || warn) && <span className={controls.hint} style={{ color: err ? 'var(--loss)' : 'var(--warning)' }} role="status" data-jw-error>{err || warn}</span>}
    </div>
  );
}

/* ── RT-E3 guards: editor and POS ── */

function KycFields({ kyc, set }: { kyc?: SaleKyc; set: (k: SaleKyc | undefined) => void }) {
  return (
    <span className={controls.row} style={row} data-kyc>
      <F l="PAN" w={130}><input className={controls.input} value={kyc?.pan ?? ''} maxLength={10} onChange={(e) => set({ ...kyc, pan: e.target.value.toUpperCase() || undefined })} data-kyc-pan /></F>
      <F l={rteT('declaration')} w={160}><select className={controls.select} value={kyc?.form ?? ''} onChange={(e) => set({ ...kyc, form: (e.target.value || undefined) as SaleKyc['form'] })}><option value="">—</option><option value="60">Form 60</option><option value="97">Form 97</option></select></F>
    </span>
  );
}
const GuardList = ({ list }: { list: readonly (Guard | string)[] }) => <>{list.map((g, i) => { const x = typeof g === 'string' ? { level: 'warn', message: g } : g; return <p key={i} className={controls.hint} style={{ color: x.level === 'error' ? 'var(--loss)' : 'var(--warning)' }} role="status" data-guard={x.level}>{x.message}</p>; })}</>;

/** Editor: PAN / Form 60 / 97 on a big sale and the HUID warnings; while mounted, `kycGate` is an editor save gate. */
export function EditorJewel() {
  useT();
  useEffect(() => {
    saveGates.add(kycGate).add(rateGate);
    return () => void (saveGates.delete(kycGate), saveGates.delete(rateGate));
  }, []);
  const st = useInvoiceStore(useShallow((s) => ({ total: s.total, kyc: s.kyc, issue_date: s.issue_date, items: s.items, client: s.client, id: s.id })));
  const guards = liveSaleGuards(st as unknown as InvoiceRecord, 0);
  const huid = st.items.map((l) => huidWarning(l, st.issue_date)).filter(Boolean);
  if (!guards.length && !huid.length && !st.kyc) return null;
  return <div data-editor-jewel><KycFields kyc={st.kyc} set={(kyc) => useInvoiceStore.getState().patch({ kyc })} /><GuardList list={[...guards, ...huid]} /></div>;
}

/** POS: tag box (scan a tag → the priced line), PAN / Form 60 and the PMLA note (269ST is RT-D's counter guard when the cash guard is on); reports blocking errors. */
export function PosJewel({ record, cash, setItems, onChange }: { record: InvoiceRecord; cash: number; setItems: (fn: (cur: InvoiceItem[]) => InvoiceItem[]) => void; onChange: (v: { kyc?: SaleKyc; errors: string[] } | null) => void }) {
  useT();
  const [kyc, setKyc] = useState<SaleKyc | undefined>();
  const [tag, setTag] = useState('');
  const [msg, setMsg] = useState('');
  const guards = useMemo(() => liveSaleGuards({ ...record, kyc }, cash), [record, kyc, cash]);
  const huid = record.items.map((l) => huidWarning(l, record.issue_date)).filter(Boolean);
  const errors = guards.filter((g) => g.level === 'error').map((g) => g.message);
  const key = errors.join('|');
  useEffect(() => onChange(kyc || errors.length ? { kyc, errors } : null), [kyc, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = () => {
    const t = loadTags().find((x) => x.tag.toUpperCase() === tag.trim().toUpperCase());
    if (!t) return setMsg(rteT('noTag', { tag }));
    if (record.items.some((l) => l.jw?.tag === t.tag)) return setMsg(rteT('tagOnBill', { tag: t.tag }));
    const p = priced(tagJewel(t, 0), record.issue_date);
    if (p.error) return setMsg(p.error);
    const base: InvoiceItem = { id: generateId(), name: t.item_name, type: 'Goods', hsn: stockDb.items().find((i) => i.id === t.item_id)?.hsn || '7113', unit: 'PCS', quantity: 1, rate: 0, tax_rate: 3, discount_percent: 0, amount: 0 };
    setItems((cur) => [...cur, applyJewel(base, p.jw, record.issue_date)]);
    setTag('');
    setMsg('');
  };
  return (
    <div className={controls.hint} data-pos-jewel>
      <span className={controls.row} style={row}>
        <F l={rteT('scanTag')} w={160}><input className={controls.input} value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} data-pos-tag /></F>
        <button type="button" className={sm} onClick={add}>{rteT('addTag')}</button>
      </span>
      {msg && <p role="status" style={{ color: 'var(--loss)' }}>{msg}</p>}
      {(kyc || guards.some((g) => /PAN/.test(g.message))) && <KycFields kyc={kyc} set={setKyc} />}
      <GuardList list={[...guards, ...huid]} />
    </div>
  );
}
