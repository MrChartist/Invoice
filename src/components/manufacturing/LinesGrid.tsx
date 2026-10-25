import type { KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { StockItem } from '../../lib/inventory';
import type { BomOutputKind } from '../../types/manufacturing';
import { blankLine, type GridLine } from './context';
import type { Godown } from '../../types/stock';
import { mfgT } from '../../i18n/areas/manufacturing';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './manufacturing.module.css';


export interface GridOptions {
  /** Show the godown column (only once a second godown exists). */
  godowns?: Godown[];
  /** Show a batch column (some item tracks batches). */
  batch?: boolean;
  /** By-product / co-product / scrap columns. */
  outputs?: boolean;
  /** Scrap % column (BOM components). */
  scrapPct?: boolean;
  /** Value / unit and cost-share columns without a type (stock-journal destination). */
  valuation?: boolean;
  /** Prefix for accessible labels (e.g. "Component"). */
  label: string;
}


/**
 * Keyboard-first line grid shared by BOMs and vouchers: Tab moves across, Enter on a quantity adds
 * a line and focuses its item, every control has an accessible name.
 */
export function LinesGrid({ lines, items, onChange, opts }: {
  lines: GridLine[];
  items: StockItem[];
  onChange: (lines: GridLine[]) => void;
  opts: GridOptions;
}) {
  const multi = (opts.godowns?.length ?? 0) > 1;
  const patch = (id: string, change: Partial<GridLine>) => onChange(lines.map((l) => (l.id === id ? { ...l, ...change } : l)));
  const add = () => {
    const line = blankLine();
    onChange([...lines, line]);
    requestAnimationFrame(() => document.getElementById(`ln-${line.id}`)?.focus());
  };
  const onQtyKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      add();
    }
  };
  const byId = new Map(items.map((i) => [i.id, i]));
  const kinds: [BomOutputKind, string][] = [['by_product', mfgT('byProduct')], ['co_product', mfgT('coProduct')], ['scrap', mfgT('scrap')]];

  return (
    <div className={styles.wrap}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <th>{opts.label}</th>
            <th className={styles.num}>{mfgT('qty')}</th>
            {opts.scrapPct && <th className={styles.num}>{mfgT('scrapPct')}</th>}
            {opts.outputs && <th>{mfgT('kind')}</th>}
            {(opts.outputs || opts.valuation) && <th className={styles.num}>{mfgT('ratePerUnit')}</th>}
            {(opts.outputs || opts.valuation) && <th className={styles.num}>{mfgT('costPct')}</th>}
            {multi && <th>{mfgT('godown')}</th>}
            {opts.batch && <th>{mfgT('batch')}</th>}
            <th><span className={surface.srOnly}>{mfgT('actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const item = byId.get(l.item_id);
            const n = i + 1;
            const kind = l.kind ?? 'by_product';
            return (
              <tr key={l.id}>
                <td>
                  <select id={`ln-${l.id}`} className={controls.select} aria-label={`${opts.label} ${mfgT('lineItem', { n })}`} value={l.item_id} onChange={(e) => patch(l.id, { item_id: e.target.value })}>
                    <option value="">{mfgT('choose')}</option>
                    {items.map((it) => <option key={it.id} value={it.id}>{it.name}{it.unit ? ` (${it.unit})` : ''}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${opts.label} ${mfgT('lineQty', { n })}`}
                    value={String(l.qty ?? '')} onKeyDown={onQtyKey}
                    onChange={(e) => patch(l.id, { qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                  />
                </td>
                {opts.scrapPct && (
                  <td>
                    <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${opts.label} ${n} ${mfgT('scrapPct')}`}
                      value={l.scrap_pct ? String(l.scrap_pct) : ''} onChange={(e) => patch(l.id, { scrap_pct: Number(e.target.value) || undefined })} />
                  </td>
                )}
                {opts.outputs && (
                  <td>
                    <select className={controls.select} aria-label={`${opts.label} ${n} ${mfgT('kind')}`} value={kind}
                      onChange={(e) => patch(l.id, { kind: e.target.value as BomOutputKind })}>
                      {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </select>
                  </td>
                )}
                {(opts.outputs || opts.valuation) && (
                  <td>
                    <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${opts.label} ${n} ${mfgT('ratePerUnit')}`}
                      disabled={opts.outputs && kind === 'co_product'}
                      value={l.rate ? String(l.rate) : ''} onChange={(e) => patch(l.id, { rate: Number(e.target.value) || undefined })} />
                  </td>
                )}
                {(opts.outputs || opts.valuation) && (
                  <td>
                    <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${opts.label} ${n} ${mfgT('costPct')}`}
                      disabled={opts.outputs && kind !== 'co_product'}
                      value={l.cost_pct ? String(l.cost_pct) : ''} onChange={(e) => patch(l.id, { cost_pct: Number(e.target.value) || undefined })} />
                  </td>
                )}
                {multi && (
                  <td>
                    <select className={controls.select} aria-label={`${opts.label} ${n} ${mfgT('godown')}`} value={l.godown_id ?? ''}
                      onChange={(e) => patch(l.id, { godown_id: e.target.value || undefined })}>
                      <option value="">—</option>
                      {opts.godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </td>
                )}
                {opts.batch && (
                  <td>
                    {item?.track_batches ? (
                      <input className={controls.input} aria-label={`${opts.label} ${n} ${mfgT('batch')}`} value={l.batch_no ?? ''}
                        onChange={(e) => patch(l.id, { batch_no: e.target.value || undefined })} />
                    ) : <span className={styles.muted}>—</span>}
                  </td>
                )}
                <td>
                  <button type="button" className={controls.btnIcon} aria-label={`${opts.label} ${mfgT('removeLine', { n })}`} onClick={() => onChange(lines.filter((x) => x.id !== l.id))}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={add}>
        <Plus size={14} aria-hidden="true" /> {mfgT('addLine')} · {opts.label}
      </button>
    </div>
  );
}
