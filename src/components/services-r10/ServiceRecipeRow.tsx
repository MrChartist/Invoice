/**
 * PENDING #21 (SV-C4): "Products used per service" on the stock-item form — lazy, shown with a services pack (salon,
 * fitness, clinic, workshop) or when the item already is a kit. The lines become the item's default BOM and the item a
 * kit (`sv-recipe-form.ts`), written when the form saves.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { mcT } from '../../i18n/areas/services-r10c';
import type { StockItem } from '../../lib/inventory';
import { getTable } from '../../lib/storage';
import { recipeOf, recipeProblem, saveRecipe, type RecipeLine } from '../../lib/services/sv-recipe-form';
import controls from '../../styles/controls.module.css';

export interface RecipeState { lines: RecipeLine[]; problem: string; commit: (itemId: string) => void }

export default function ServiceRecipeRow({ item, onChange }: { item: StockItem; onChange: (s: RecipeState) => void }) {
  useT();
  const products = useMemo(() => getTable<StockItem>('stock_items').filter((i) => i.id !== item.id && i.track_stock && !i.kit), [item.id]);
  const [lines, setLines] = useState<{ item_id: string; qty: string }[]>(() => recipeOf(item.id).map((l) => ({ item_id: l.item_id, qty: String(l.qty) })));
  const put = (next: { item_id: string; qty: string }[]) => {
    setLines(next);
    const clean = next.map((l) => ({ item_id: l.item_id, qty: Number(l.qty) }));
    onChange({ lines: clean, problem: recipeProblem(clean, item.id), commit: (id) => saveRecipe(id, clean) });
  };
  const unit = (id: string) => products.find((p) => p.id === id)?.unit ?? '';
  return (
    <fieldset className={controls.field} data-sv-recipe>
      <span className={controls.label}>{mcT('recipeRow')}</span>
      {lines.map((l, n) => (
        <div key={n} className={controls.row}>
          <select className={controls.select} value={l.item_id} onChange={(e) => put(lines.map((x, i) => (i === n ? { ...x, item_id: e.target.value } : x)))} aria-label={`${mcT('product')} ${n + 1}`} data-sv-recipe-product={n}>
            <option value="">-</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={l.qty} onChange={(e) => put(lines.map((x, i) => (i === n ? { ...x, qty: e.target.value } : x)))} aria-label={`${mcT('recipeQty')} ${n + 1}`} data-sv-recipe-qty={n} />
          <span className={controls.hint}>{unit(l.item_id)}</span>
          <button type="button" className={controls.btnGhost} onClick={() => put(lines.filter((_, i) => i !== n))}>{mcT('del')}</button>
        </div>
      ))}
      <button type="button" className={controls.btnOutline} onClick={() => put([...lines, { item_id: '', qty: '' }])} data-sv-recipe-add>{mcT('recipeAdd')}</button>
      <span className={controls.hint}>{mcT('recipeHint')}</span>
    </fieldset>
  );
}
