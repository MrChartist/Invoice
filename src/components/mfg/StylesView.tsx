/** MF-C1 Garments → Styles: a variant parent's fabric per piece (by colour), default ratio and textile class; the band memo. */
import { useMemo, useState } from 'react';
import type { MfgContext } from '../manufacturing/context';
import { gridParents, saveStyle, styleAxes, styleOf } from '../../lib/mfg/mf-styles';
import { bandMemo, TEXTILE_CLASSES } from '../../lib/mfg/mf-textile-tax';
import { num } from '../../lib/invoice-calc';
import { todayInput } from '../../lib/utils';
import { gT } from '../../i18n/areas/mfg-r13c';
import { Btn, F, Grid, In, Sel } from './garments-ui';
import { opts, parseRatio, ratioText, row, run, stack } from './garments-util';

type D = { id: string; fabric: string; per: string; map: string; ratio: string; cls: string };

export default function StylesView({ ctx }: { ctx: MfgContext }) {
  const parents = useMemo(() => gridParents(ctx.items), [ctx.items]);
  const fabrics = useMemo(() => ctx.items.filter((i) => i.track_stock && !i.variant_axes?.length), [ctx.items]);
  const [d, setD] = useState<D | null>(null);
  const set = (p: Partial<D>) => setD((x) => (x ? { ...x, ...p } : x));
  const open = (id: string) => {
    const it = ctx.items.find((i) => i.id === id);
    const s = styleOf(it);
    const f = s?.fabric_items[0];
    setD({ id, fabric: f?.item_id ?? '', per: f ? String(f.per_piece_m) : '', map: Object.entries(f?.colour_map ?? {}).map(([c, i]) => `${c}=${ctx.items.find((x) => x.id === i)?.name ?? i}`).join('; '), ratio: ratioText(s?.size_ratio_default), cls: (it as { mf_class?: string } | undefined)?.mf_class ?? 'garment' });
  };
  const save = () => d && run(ctx, () => {
    const map: Record<string, string> = {};
    for (const part of d.map.split(';')) {
      const [c, name] = part.split('=').map((x) => x.trim());
      const hit = name && fabrics.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (c && hit) map[c] = hit.id;
    }
    saveStyle(d.id, { ...styleOf(ctx.items.find((i) => i.id === d.id)), fabric_items: [{ item_id: d.fabric, per_piece_m: num(d.per), ...(Object.keys(map).length ? { colour_map: map } : {}) }], ...(d.ratio.trim() ? { size_ratio_default: parseRatio(d.ratio) } : {}) }, d.cls);
  }, () => setD(null));
  const day = todayInput();
  return (
    <section data-mfc-styles>
      {ctx.canMasters && !d && <div style={row}><F label={gT('style')}><Sel v="" set={open} o={opts(parents)} data-mfc="style-pick" /></F></div>}
      {d && (
        <div style={stack} data-mfc-style-form>
          <div style={row}>
            <F label={gT('fabric')}><Sel v={d.fabric} set={(x) => set({ fabric: x })} o={opts(fabrics)} data-mfc="style-fabric" /></F>
            <F label={gT('perPiece')} w={130}><In v={d.per} set={(x) => set({ per: x })} inputMode="decimal" data-mfc="style-per" /></F>
            <F label={gT('cls')}><Sel v={d.cls} set={(x) => set({ cls: x })} o={[['', '-'], ...TEXTILE_CLASSES.map((c) => [c, gT(`c.${c}`)] as const)]} /></F>
          </div>
          <div style={row}>
            <F label={gT('colourMap')}><In v={d.map} set={(x) => set({ map: x })} placeholder="Green=Green cambric" /></F>
            <F label={gT('ratio')} w={180}><In v={d.ratio} set={(x) => set({ ratio: x })} placeholder="S1 M2 L2 XL1" /></F>
          </div>
          <div style={row}><Btn kind="btnPrimary" on={save} data-mfc="style-save">{gT('save')}</Btn><Btn on={() => setD(null)}>{gT('cancel')}</Btn></div>
        </div>
      )}
      <Grid attr="styles" head={[gT('style'), gT('sizes'), gT('fabric'), gT('cls'), gT('band')]} rows={parents.map((p) => {
        const s = styleOf(p);
        const ax = styleAxes(p);
        const m = bandMemo(p, ctx.items, day);
        const f = s?.fabric_items[0];
        return [
          ctx.canMasters ? <Btn kind="btnGhost" on={() => open(p.id)}>{p.name}</Btn> : p.name,
          `${ax.sizes.join(' ')} × ${ax.colours.filter(Boolean).length || 1}`,
          f ? `${ctx.items.find((i) => i.id === f.item_id)?.name ?? '-'} · ${f.per_piece_m} m` : '-',
          (p as { mf_class?: string }).mf_class ? gT(`c.${(p as { mf_class?: string }).mf_class}` as 'c.garment') : '-',
          m.above.length ? gT('bandMemo', { sizes: m.above.join(', '), limit: m.limit, rate: m.rate }) : '-',
        ];
      })} />
    </section>
  );
}
