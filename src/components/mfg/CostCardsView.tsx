/** MF-D1 cost cards: recipe from the BOM, yield, cost per pack with packing, margins, what-if, saved versions; FSSAI. */
import { useMemo, useState } from 'react';
import { fdT } from '../../i18n/areas/mfg-r13d-food';
import { localDb } from '../../lib/localDb';
import { bomsDb } from '../../lib/manufacturing';
import { DB_PREFIX, getJson, getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { isPackOn } from '../../lib/industry-packs';
import { cardAt, cardCost, costCardsDb, latestPurchaseRates, linesFromBom, whatIf, type CostCard, type CostCardPack } from '../../lib/mfg/mf-costcards';
import { fssaiLicences, fssaiWarning } from '../../lib/mfg/mf-food';
import { NumberInput } from '../ui/NumberInput';
import type { MfgContext } from '../manufacturing/context';
import { Fld, Tbl } from './mfd-ui';
import { row, rs, run, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';

type Draft = Omit<CostCard, 'id'> & { id?: string };
const blank = (item_id = ''): Draft => ({ item_id, name: '', effective_from: todayInput(), lines: [], output_kg: 0, conversion_per_kg: 0, overhead_pct: 0, packs: [] });
const newPack = (): CostCardPack => ({ id: `p${Date.now()}`, label: '', pack_kg: 0, packing: [{ label: 'Packing', cost: 0 }], prices: {} });

export default function CostCardsView({ ctx }: { ctx: MfgContext }) {
  const cards = useMemo(() => { void ctx.version; return costCardsDb.all(); }, [ctx.version]);
  const boms = useMemo(() => bomsDb.all(), []);
  const made = ctx.items.filter((i) => boms.some((b) => b.item_id === i.id));
  const [d, setD] = useState<Draft>(() => blank());
  const today = todayInput();
  const cost = cardCost(d);
  const latest = useMemo(() => latestPurchaseRates(getTable('purchases'), ctx.items, today), [ctx.items, today]);
  const wi = d.lines.length ? whatIf({ ...d, id: '' }, latest) : null;
  const sender = localDb.settings.activeProfile();
  const warn = fssaiWarning(sender, isPackOn(localDb.settings.get(), 'foodmfg'));
  const lic = fssaiLicences(getJson<{ licences?: { kind: string; number: string; valid_to?: string }[] } | null>(`${DB_PREFIX}agri_settings`, null)?.licences, today); // R12 register, read only
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const pick = (id: string) => {
    const cur = cardAt(cards, id, today);
    setD(cur ? { ...cur } : { ...blank(id), name: ctx.items.find((i) => i.id === id)?.name ?? '' });
  };
  const fromBom = () => {
    const b = boms.find((x) => x.item_id === d.item_id && x.is_default) ?? boms.find((x) => x.item_id === d.item_id);
    if (b) set({ bom_id: b.id, lines: linesFromBom(b, ctx.items, d.effective_from || today), output_kg: d.output_kg || b.batch_qty });
  };
  const setPack = (i: number, p: Partial<CostCardPack>) => set({ packs: d.packs.map((x, n) => (n === i ? { ...x, ...p } : x)) });
  const num = (v: number, on: (n: number) => void, k: string) => <NumberInput className={controls.input} style={{ maxWidth: 110 }} value={v} onChange={on} data-mfd={k} />;
  return (
    <>
      {warn && <p className={controls.hint} role="status" data-fssai-warn>{warn}</p>}
      {lic.map((l) => <p key={l.number} className={controls.hint}>{l.expired ? fdT('fssaiExpired', { no: l.number }) : l.soon ? fdT('fssaiLic', { no: l.number, days: l.days ?? 0 }) : null}</p>)}
      <div style={row}>
        <Fld l={fdT('item')}>
          <select className={controls.select} value={d.item_id} onChange={(e) => pick(e.target.value)} data-mfd="card-item">
            <option value="">—</option>
            {made.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Fld>
        <Fld l={fdT('from')}><input type="date" className={controls.input} value={d.effective_from} onChange={(e) => set({ effective_from: e.target.value })} /></Fld>
        <button type="button" className={sm} disabled={!d.item_id} onClick={fromBom} data-mfd-b="bom">{fdT('loadBom')}</button>
        <Fld l={fdT('outputKg')}>{num(d.output_kg, (v) => set({ output_kg: v }), 'output')}</Fld>
        <Fld l={fdT('convKg')}>{num(d.conversion_per_kg, (v) => set({ conversion_per_kg: v }), 'conv')}</Fld>
        <Fld l={fdT('overhead')}>{num(d.overhead_pct, (v) => set({ overhead_pct: v }), 'oh')}</Fld>
      </div>
      <Tbl empty={fdT('none')} head={[fdT('ingredient'), fdT('qty'), fdT('rate'), fdT('latest')]} rows={d.lines.map((l, i) => [l.name, `${l.qty} ${l.unit ?? ''}`, num(l.rate, (v) => set({ lines: d.lines.map((x, n) => (n === i ? { ...x, rate: v } : x)) }), 'rate'), latest.get(l.item_id) ?? '—'])} />
      <Tbl empty="" head={[fdT('pack'), fdT('packKg'), fdT('packing'), fdT('distributor'), fdT('retailer'), fdT('mrp'), fdT('perPack'), fdT('margin')]} rows={d.packs.map((p, i) => {
        const c = cost.packs[i];
        return [
          <input key="l" className={controls.input} style={{ maxWidth: 90 }} value={p.label} onChange={(e) => setPack(i, { label: e.target.value })} data-mfd="pack-label" />,
          num(p.pack_kg, (v) => setPack(i, { pack_kg: v }), 'pack-kg'),
          num(p.packing.reduce((s, x) => s + x.cost, 0), (v) => setPack(i, { packing: [{ label: 'Packing', cost: v }] }), 'pack-cost'),
          ...(['distributor', 'retailer', 'mrp'] as const).map((k) => num(p.prices?.[k] ?? 0, (v) => setPack(i, { prices: { ...p.prices, [k]: v } }), `pack-${k}`)),
          <b key="c" data-mfd-perpack>{rs(c?.perPack ?? 0)}</b>,
          c?.margins.map((m) => `${rs(m.margin)} (${m.pct}%)`).join(' · ') ?? '',
        ];
      })} />
      <div style={row}>
        <button type="button" className={sm} onClick={() => set({ packs: [...d.packs, newPack()] })} data-mfd-b="pack">{fdT('addPack')}</button>
        <button type="button" className={controls.btnPrimary} disabled={!ctx.canMasters} onClick={() => run(ctx, () => { setD({ ...costCardsDb.save(d) }); return fdT('saved'); })} data-mfd-b="save-card">{fdT('save')}</button>
      </div>
      {d.lines.length > 0 && <p data-mfd-summary>{fdT('summary', { in: cost.inputWeight, y: cost.yieldPct, b: rs(cost.batchCost), k: rs(cost.perKg) })}{wi && wi.rows.length ? ` · ${fdT('whatIf', { b: rs(wi.current.batchCost) })}` : ''}</p>}
      <h3>{fdT('versions')}</h3>
      <Tbl empty={fdT('none')} head={[fdT('item'), fdT('from'), fdT('perPack'), '']} rows={cards.map((c) => [c.name, c.effective_from, cardCost(c).packs.map((p) => `${p.label} ${rs(p.perPack)}`).join(' · '), <span key="a"><button type="button" className={sm} onClick={() => setD({ ...c })}>{fdT('open')}</button> <button type="button" className={sm} disabled={!ctx.canMasters} onClick={() => run(ctx, () => { costCardsDb.remove(c.id); return fdT('deleted'); })}>{fdT('delete')}</button></span>])} />
    </>
  );
}
