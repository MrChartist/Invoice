import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { stockDb, type StockItem } from '../../lib/inventory';
import type { TrackingMap } from '../../lib/stock-tracking';
import { cleanAxes, combinations, generateVariants, variantsOf, type VariantAxis } from '../../lib/variants';
import { withBatchBin } from '../../lib/bins';
import { generateId, getTable } from '../../lib/storage';
import type { Bom } from '../../types/manufacturing';
import { useT } from '../../i18n';
import { skT } from '../../i18n/areas/stock-depth';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';

type Section = 'variants' | 'kits' | 'bins';

/** 8.85 / 8.86 / 8.84: item variants, kits, bin / rack locations and salts. */
export default function DepthTab({ items, tracking, onChanged }: { items: StockItem[]; tracking: TrackingMap; onChanged: (msg: string, error?: boolean) => void }) {
  useT();
  const [section, setSection] = useState<Section>('variants');
  const [parentId, setParentId] = useState('');
  const [axes, setAxes] = useState<{ name: string; values: string }[]>([{ name: '', values: '' }]);
  const [withBarcodes, setWithBarcodes] = useState(true);
  const [q, setQ] = useState('');
  const boms = useMemo(() => getTable<Bom>('boms'), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const parents = items.filter((i) => !i.variant_of && !i.kit);
  const parent = items.find((i) => i.id === parentId);
  const parsed: VariantAxis[] = cleanAxes(axes.map((a) => ({ name: a.name, values: a.values.split(',') })));
  const count = combinations(parsed).length;

  const pickParent = (id: string) => {
    setParentId(id);
    const p = items.find((i) => i.id === id);
    setAxes(p?.variant_axes?.length ? p.variant_axes.map((a) => ({ name: a.name, values: a.values.join(', ') })) : [{ name: '', values: '' }]);
  };

  const run = (fn: () => string) => {
    try {
      onChanged(fn());
    } catch (err) {
      onChanged((err as Error).message, true);
    }
  };

  const saveItem = (item: StockItem, patch: Partial<StockItem>) => run(() => {
    const next: StockItem = { ...item, ...patch };
    for (const k of Object.keys(patch) as (keyof StockItem)[]) if (patch[k] === '' || patch[k] === undefined) delete next[k];
    stockDb.saveItem(next);
    return skT('saved');
  });

  const filtered = items.filter((i) => !q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className={own.stack} data-depth-tab>
      <div className={controls.segment} role="tablist" aria-label={skT('depth')}>
        {(['variants', 'kits', 'bins'] as Section[]).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={section === s} className={section === s ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setSection(s)}>
            {skT(s === 'variants' ? 'variants' : s === 'kits' ? 'kits' : 'binsSalts')}
          </button>
        ))}
      </div>

      {section === 'variants' && (
        <div className={own.stack}>
          <p className={own.muted}>{skT('variantsIntro')}</p>
          <label className={controls.field}><span className={controls.label}>{skT('parentItem')}</span>
            <select className={controls.select} value={parentId} onChange={(e) => pickParent(e.target.value)} data-variant-parent>
              <option value="">{skT('choose')}</option>
              {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></label>
          {parent && (
            <>
              {axes.map((a, i) => (
                <div key={i} className={own.row}>
                  <label className={controls.field}><span className={controls.label}>{skT('attribute')}</span>
                    <input className={controls.input} value={a.name} placeholder={skT('attributePh')} onChange={(e) => setAxes(axes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
                  <label className={controls.field}><span className={controls.label}>{skT('values')}</span>
                    <input className={controls.input} value={a.values} placeholder={skT('valuesPh')} onChange={(e) => setAxes(axes.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} /></label>
                  <button type="button" className={controls.btnIcon} aria-label={skT('removeAttr')} onClick={() => setAxes(axes.length > 1 ? axes.filter((_, j) => j !== i) : [{ name: '', values: '' }])}><Trash2 size={14} /></button>
                </div>
              ))}
              <div className={own.row}>
                {axes.length < 3 && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setAxes([...axes, { name: '', values: '' }])}><Plus size={14} aria-hidden="true" /> {skT('addAttr')}</button>}
                <label className={controls.check}><input type="checkbox" checked={withBarcodes} onChange={(e) => setWithBarcodes(e.target.checked)} /> {skT('withBarcodes')}</label>
                <button type="button" className={controls.btnPrimary} disabled={!count} onClick={() => run(() => {
                  const plan = generateVariants(parent.id, parsed, { withBarcodes, newId: generateId });
                  return skT('generated', { n: plan.create.length, kept: plan.existing.length });
                })} data-variant-generate><Wand2 size={14} aria-hidden="true" /> {skT('generate', { n: count })}</button>
              </div>
              {variantsOf(parent.id, items).length > 0 && (
                <div className={own.tableWrap}>
                  <table className={own.table}>
                    <thead><tr><th>{skT('item')}</th><th>SKU</th><th>{skT('barcode')}</th></tr></thead>
                    <tbody>{variantsOf(parent.id, items).map((v) => <tr key={v.id} data-variant-row><td>{v.name}</td><td>{v.sku}</td><td>{v.barcode}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {section === 'kits' && (
        <div className={own.stack}>
          <p className={own.muted}>{skT('kitsIntro')} <Link to="/manufacturing">{skT('openBoms')}</Link></p>
          <div className={own.tableWrap}>
            <table className={own.table}>
              <thead><tr><th>{skT('item')}</th><th>{skT('kit')}</th><th>{skT('components')}</th></tr></thead>
              <tbody>
                {items.filter((i) => !i.variant_of).map((i) => {
                  const mine = boms.filter((b) => b.item_id === i.id);
                  const bom = mine.find((b) => b.is_default) ?? mine[0];
                  return (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td><input type="checkbox" aria-label={skT('kitFor', { name: i.name })} checked={!!i.kit} onChange={(e) => saveItem(i, e.target.checked ? { kit: true, track_stock: false } : { kit: undefined })} data-kit-toggle={i.name} /></td>
                      <td className={own.muted}>{bom ? skT('componentsN', { n: bom.components.length, bom: bom.name }) : i.kit ? skT('noBom') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === 'bins' && (
        <div className={own.stack}>
          <p className={own.muted}>{skT('binsIntro')}</p>
          <input type="search" className={controls.input} value={q} placeholder={skT('searchItems')} onChange={(e) => setQ(e.target.value)} aria-label={skT('searchItems')} />
          <div className={own.tableWrap}>
            <table className={own.table}>
              <thead><tr><th>{skT('item')}</th><th>{skT('bin')}</th><th>{skT('salt')}</th><th>{skT('batchBins')}</th></tr></thead>
              <tbody>
                {filtered.slice(0, 200).map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td><input className={controls.input} defaultValue={i.location ?? ''} aria-label={skT('binFor', { name: i.name })} onBlur={(e) => e.target.value.trim() !== (i.location ?? '') && saveItem(i, { location: e.target.value.trim() })} /></td>
                    <td><input className={controls.input} defaultValue={i.salt ?? ''} aria-label={skT('saltFor', { name: i.name })} onBlur={(e) => e.target.value.trim() !== (i.salt ?? '') && saveItem(i, { salt: e.target.value.trim() })} data-salt-input={i.name} /></td>
                    <td>
                      {i.track_batches ? (tracking.get(i.id)?.batches ?? []).filter((b) => b.batch && b.qty > 0).map((b) => (
                        <label key={b.batch} className={own.row}>
                          <span className={own.chip}>{b.batch}</span>
                          <input className={controls.input} defaultValue={i.batch_bins?.[b.batch.toUpperCase()] ?? ''} aria-label={skT('batchBinFor', { batch: b.batch })} onBlur={(e) => {
                            if (e.target.value.trim() === (i.batch_bins?.[b.batch.toUpperCase()] ?? '')) return;
                            run(() => {
                              stockDb.saveItem(withBatchBin(i, b.batch, e.target.value));
                              return skT('saved');
                            });
                          }} />
                        </label>
                      )) : <span className={own.muted}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
