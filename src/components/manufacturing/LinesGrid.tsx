import { useMemo, useState, type KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { StockItem } from '../../lib/inventory';
import { cleanAltUnits, lineUnitPatch, roundTypedQty, unitChoices, type UnitMaster } from '../../lib/units';
import type { BomOutputKind } from '../../types/manufacturing';
import { blankLine, type GridLine } from './context';
import type { Godown } from '../../types/stock';
import { mfgT } from '../../i18n/areas/manufacturing';
import { s7T } from '../../i18n/areas/inventory-7s';
import { SerialCell } from './SerialCell';
import { stockDb } from '../../lib/inventory';
import { godownsDb } from '../../lib/godowns';
import { useCreateOnTheFly } from '../masters/useCreateOnTheFly';
import { isAltC } from '../masters/useMasterKeys';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './manufacturing.module.css';
import { SelectField } from '../ui/SelectField';


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
  /**
   * 7M: units master. When given, a line of an item with alternate units can be typed in one (unit + unit_factor
   * snapshot) and typed quantities round to the unit's decimal places.
   */
  units?: readonly UnitMaster[];
  /**
   * 7S: serial-tracked items list their serials — `out` lines take serials in stock (with "Fill from stock" from
   * `serialPool`), `in` lines bring new ones.
   */
  serials?: 'out' | 'in';
  serialPool?: (itemId: string, godown: string | undefined) => string[];
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
  // 7S (7.84): Alt+C on the item / godown pickers creates the master on the fly (Tally parity).
  const fly = useCreateOnTheFly();
  const [added, setAdded] = useState<{ items: StockItem[]; godowns: Godown[] }>({ items: [], godowns: [] });
  const allItems = useMemo(() => [...items, ...added.items.filter((a) => !items.some((i) => i.id === a.id))], [items, added.items]);
  const godownList = useMemo(() => [...(opts.godowns ?? []), ...added.godowns], [opts.godowns, added.godowns]);
  const multi = godownList.length > 1;
  const createItem = (lineId: string) => (e: KeyboardEvent<HTMLSelectElement>) => {
    if (!isAltC(e.nativeEvent)) return;
    e.preventDefault();
    void fly.open({ kind: 'stockItem' }).then((it) => {
      const row = it && stockDb.items().find((x) => x.id === it.id);
      if (!row?.track_stock) return;
      setAdded((a) => ({ ...a, items: [...a.items, row] }));
      patch(lineId, { item_id: row.id, unit: undefined, unit_factor: undefined, serials: undefined });
    });
  };
  const createGodown = (lineId: string) => (e: KeyboardEvent<HTMLSelectElement>) => {
    if (!isAltC(e.nativeEvent)) return;
    e.preventDefault();
    void fly.open({ kind: 'godown' }).then((g) => {
      const row = g && godownsDb.list().find((x) => x.id === g.id);
      if (!row) return;
      setAdded((a) => ({ ...a, godowns: [...a.godowns, row] }));
      patch(lineId, { godown_id: row.id });
    });
  };
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
  const byId = new Map(allItems.map((i) => [i.id, i]));
  const anySerial = !!opts.serials && lines.some((l) => byId.get(l.item_id)?.track_serials);
  const kinds: [BomOutputKind, string][] = [['by_product', mfgT('byProduct')], ['co_product', mfgT('coProduct')], ['scrap', mfgT('scrap')]];
  const anyAlt = !!opts.units && lines.some((l) => {
    const it = byId.get(l.item_id);
    return !!(it && cleanAltUnits(it.alt_units, it.unit || 'NOS'));
  });

  return (
    <div className={styles.wrap}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <th>{opts.label}</th>
            <th className={styles.num}>{mfgT('qty')}</th>
            {anyAlt && <th>{mfgT('unit')}</th>}
            {opts.scrapPct && <th className={styles.num}>{mfgT('scrapPct')}</th>}
            {opts.outputs && <th>{mfgT('kind')}</th>}
            {(opts.outputs || opts.valuation) && <th className={styles.num}>{mfgT('ratePerUnit')}</th>}
            {(opts.outputs || opts.valuation) && <th className={styles.num}>{mfgT('costPct')}</th>}
            {multi && <th>{mfgT('godown')}</th>}
            {opts.batch && <th>{mfgT('batch')}</th>}
            {anySerial && <th>{s7T('serials')}</th>}
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
                  <SelectField id={`ln-${l.id}`} className={controls.select} aria-label={`${opts.label} ${mfgT('lineItem', { n })}`} value={l.item_id} onChange={(e) => patch(l.id, { item_id: e.target.value, unit: undefined, unit_factor: undefined, serials: undefined })}
                    onKeyDown={createItem(l.id)} aria-keyshortcuts="Alt+C" title={s7T('altCHint')}>
                    <option value="">{mfgT('choose')}</option>
                    {allItems.map((it) => <option key={it.id} value={it.id}>{it.name}{it.unit ? ` (${it.unit})` : ''}</option>)}
                  </SelectField>
                </td>
                <td>
                  <input
                    className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${opts.label} ${mfgT('lineQty', { n })}`}
                    value={String(l.qty ?? '')} onKeyDown={onQtyKey}
                    onChange={(e) => patch(l.id, { qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                    onBlur={opts.units ? () => patch(l.id, { qty: roundTypedQty(l.qty, l.unit || item?.unit, opts.units ?? []) }) : undefined}
                  />
                </td>
                {anyAlt && (
                  <td>
                    {item && cleanAltUnits(item.alt_units, item.unit || 'NOS') ? (
                      <SelectField className={controls.select} aria-label={`${opts.label} ${mfgT('lineUnit', { n })}`} value={l.unit || item.unit}
                        onChange={(e) => {
                          const p = lineUnitPatch(item, l, e.target.value);
                          patch(l.id, { unit: p.unit_factor ? p.unit : undefined, unit_factor: p.unit_factor, ...(l.rate ? { rate: p.rate || undefined } : {}), qty: roundTypedQty(l.qty, p.unit, opts.units ?? []) });
                        }}>
                        {unitChoices(item).map((c) => <option key={c.unit} value={c.unit}>{c.unit}</option>)}
                      </SelectField>
                    ) : <span className={styles.muted}>{item?.unit ?? ''}</span>}
                  </td>
                )}
                {opts.scrapPct && (
                  <td>
                    <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${opts.label} ${n} ${mfgT('scrapPct')}`}
                      value={l.scrap_pct ? String(l.scrap_pct) : ''} onChange={(e) => patch(l.id, { scrap_pct: Number(e.target.value) || undefined })} />
                  </td>
                )}
                {opts.outputs && (
                  <td>
                    <SelectField className={controls.select} aria-label={`${opts.label} ${n} ${mfgT('kind')}`} value={kind}
                      onChange={(e) => patch(l.id, { kind: e.target.value as BomOutputKind })}>
                      {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                    </SelectField>
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
                    <SelectField className={controls.select} aria-label={`${opts.label} ${n} ${mfgT('godown')}`} value={l.godown_id ?? ''}
                      onChange={(e) => patch(l.id, { godown_id: e.target.value || undefined })} onKeyDown={createGodown(l.id)} aria-keyshortcuts="Alt+C">
                      <option value="">-</option>
                      {godownList.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </SelectField>
                  </td>
                )}
                {opts.batch && (
                  <td>
                    {item?.track_batches ? (
                      <input className={controls.input} aria-label={`${opts.label} ${n} ${mfgT('batch')}`} value={l.batch_no ?? ''}
                        onChange={(e) => patch(l.id, { batch_no: e.target.value || undefined })} />
                    ) : <span className={styles.muted}>-</span>}
                  </td>
                )}
                {anySerial && (
                  <td>
                    {item?.track_serials ? (
                      <SerialCell
                        key={`${l.id}:${l.item_id}`} serials={l.serials} qty={l.qty} label={s7T('lineSerials', { label: opts.label, n })}
                        pool={opts.serials === 'out' && opts.serialPool ? () => opts.serialPool!(l.item_id, l.godown_id) : undefined}
                        onChange={(serials) => patch(l.id, { serials })}
                      />
                    ) : <span className={styles.muted}>-</span>}
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
      {fly.node}
    </div>
  );
}
