import { Fragment, useCallback, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { BillLineTracking, type BillStockContext } from './BillLineTracking';
import type { PurchaseLine } from '../../types/purchases';
import { GST_SLABS } from '../../types/invoice';
import { blankPurchaseLine as blankLine } from '../../lib/purchases';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency } from '../../lib/utils';
import { NumberInput } from '../ui/NumberInput';
import { Typeahead } from '../ui/Typeahead';
import { suggest } from '../../lib/suggest';
import { liveUnits } from '../../lib/units-live';
import { cleanAltUnits, lineFactor, lineUnitPatch, unitChoices } from '../../lib/units';
import type { StockItem } from '../../lib/inventory';
import { unitT } from '../../i18n/areas/units';
import { useT } from '../../i18n';
import { purT } from '../../i18n/areas/purchases';
import { useCreateOnTheFly } from '../masters/useCreateOnTheFly';
import { isAltC } from '../masters/useMasterKeys';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';

export interface LineItemsEditorProps {
  lines: PurchaseLine[];
  onChange: (lines: PurchaseLine[]) => void;
  /** Bills only: batch / serial / godown fields for tracked stock items (6.6 / 6.10 / 6.11). */
  stock?: BillStockContext;
}

/** True when a bill line is a tracked stock item and needs the extra batch / serial / godown row. */
function needsTracking(line: PurchaseLine, ctx: BillStockContext | undefined): boolean {
  if (!ctx || !line.name.trim()) return false;
  const item = ctx.find(line.name, line.hsn);
  return !!item && (!!item.track_batches || !!item.track_serials || ctx.godowns.length > 1);
}

/** Editable bill lines: item, HSN/SAC, qty, rate, GST%. */
export function LineItemsEditor({ lines, onChange, stock }: LineItemsEditorProps) {
  useT(); // re-render on a language switch (5.4)
  const patch = (id: string, change: Partial<PurchaseLine>) =>
    onChange(lines.map((l) => {
      if (l.id !== id) return l;
      const next = { ...l, ...change } as PurchaseLine & Record<string, unknown>;
      for (const k of Object.keys(change)) if (next[k] === undefined) delete next[k];
      return next;
    }));
  // WP-8: stock items for the name picker (sets `item_id`) and alternate units; re-read on name focus.
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const units = useMemo(() => liveUnits(), [tick]);
  const itemSuggestions = useCallback(
    (q: string) => suggest(q, units.items, { label: (i) => i.name, extra: (i) => [i.hsn, i.sku], sub: (i) => [i.hsn && `HSN ${i.hsn}`, i.unit].filter(Boolean).join(' · ') }),
    [units],
  );
  const pickItem = (line: PurchaseLine, it: StockItem) =>
    patch(line.id, {
      name: it.name, item_id: it.id, unit: it.unit, unit_factor: undefined,
      ...(it.hsn ? { hsn: it.hsn } : {}),
      ...(typeof it.tax_rate === 'number' ? { tax_rate: it.tax_rate } : {}),
    });
  // Alt+C on the item name creates a stock item with the typed name and picks it (Tally parity).
  const fly = useCreateOnTheFly();
  const createItem = (line: PurchaseLine) => {
    void fly.open({ kind: 'stockItem', name: line.name }).then((saved) => {
      if (!saved) return;
      const fresh = liveUnits().items.find((x) => x.id === saved.id);
      setTick((t) => t + 1);
      if (fresh) pickItem(line, fresh);
    });
  };
  /** The line's stock item when it has alternate units (picked id first, else name + HSN). */
  const altItem = (l: PurchaseLine): StockItem | undefined => {
    const byId = l.item_id ? units.items.find((i) => i.id === l.item_id) : undefined;
    if (byId) return cleanAltUnits(byId.alt_units, byId.unit) ? byId : undefined;
    return units.pick?.find(l.name, l.hsn)?.item;
  };

  return (
    <div>
      <div className={styles.linesWrap}>
        <table className={styles.lines}>
          <thead>
            <tr>
              <th className={styles.colName}>{purT('thItem')}</th>
              <th className={styles.colHsn}>{purT('thHsn')}</th>
              <th className={styles.colQty}>{purT('thQty')}</th>
              <th className={styles.colRate}>{purT('thRate')}</th>
              <th className={styles.colTax}>{purT('thGstPct')}</th>
              <th className={styles.colAmt}>{purT('thAmount')}</th>
              <th className={styles.colAct}><span className={surface.srOnly}>{purT('remove')}</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <Fragment key={l.id}>
              <tr>
                <td data-label={purT('thItem')}>
                  <Typeahead
                    className={controls.ghost}
                    value={l.name}
                    placeholder={purT('itemPh')}
                    aria-label={purT('lineItem', { n: i + 1 })}
                    onFocus={() => setTick((t) => t + 1)}
                    getSuggestions={itemSuggestions}
                    onPick={(it) => pickItem(l, it)}
                    aria-keyshortcuts="Alt+C"
                    onKeyDown={(e) => {
                      if (!isAltC(e.nativeEvent)) return;
                      e.preventDefault();
                      createItem(l);
                    }}
                    // Typing a different name detaches the picked stock item (older lines match by name + HSN).
                    onChange={(name) => patch(l.id, { name, ...(l.item_id && units.items.find((x) => x.id === l.item_id)?.name.trim().toLowerCase() !== name.trim().toLowerCase() ? { item_id: undefined, unit_factor: undefined } : {}) })}
                  />
                </td>
                <td data-label={purT('thHsn')}>
                  <input
                    className={controls.ghost}
                    value={l.hsn ?? ''}
                    inputMode="numeric"
                    placeholder="HSN"
                    aria-label={purT('lineHsn', { n: i + 1 })}
                    onChange={(e) => patch(l.id, { hsn: e.target.value.replace(/[^0-9]/g, '').slice(0, 8) })}
                  />
                </td>
                <td data-label={purT('thQty')}>
                  <NumberInput
                    className={controls.ghostNumeric}
                    value={l.quantity}
                    blankZero={false}
                    aria-label={purT('lineQty', { n: i + 1 })}
                    onChange={(quantity) => patch(l.id, { quantity })}
                  />
                  {(() => {
                    const it = altItem(l);
                    if (!it) return null;
                    const f = lineFactor(l);
                    return (
                      <>
                        <select className={`${controls.ghost} ${styles.lineUnit}`} value={l.unit || it.unit} aria-label={unitT('lineUnit', { n: i + 1 })} onChange={(e) => patch(l.id, lineUnitPatch(it, l, e.target.value))}>
                          {unitChoices(it).map((c) => <option key={c.unit} value={c.unit}>{c.unit}</option>)}
                        </select>
                        {f !== 1 && <span className={styles.lineUnitHint}>{unitT('equals', { qty: Math.round(l.quantity * f * 1000) / 1000, unit: it.unit })}</span>}
                      </>
                    );
                  })()}
                </td>
                <td data-label={purT('thRate')}>
                  <NumberInput
                    className={controls.ghostNumeric}
                    value={l.rate}
                    placeholder="0.00"
                    aria-label={purT('lineRate', { n: i + 1 })}
                    onChange={(rate) => patch(l.id, { rate })}
                  />
                </td>
                <td data-label={purT('thGstPct')}>
                  <select
                    className={controls.ghost}
                    value={l.tax_rate}
                    aria-label={purT('lineGst', { n: i + 1 })}
                    onChange={(e) => patch(l.id, { tax_rate: Number(e.target.value) })}
                  >
                    {GST_SLABS.map((s) => (
                      <option key={s} value={s}>{s}%</option>
                    ))}
                  </select>
                </td>
                <td className={styles.lineAmount} data-label={purT('thAmount')}>{formatCurrency(round2(l.quantity * l.rate))}</td>
                <td>
                  <button
                    type="button"
                    className={controls.btnDanger}
                    aria-label={purT('removeLine', { n: i + 1 })}
                    disabled={lines.length === 1}
                    onClick={() => onChange(lines.filter((x) => x.id !== l.id))}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
              {stock && needsTracking(l, stock) && (
                <tr className={styles.trackRow}>
                  <td colSpan={7}>
                    <BillLineTracking line={l} index={i} ctx={stock} onPatch={(change) => patch(l.id, change)} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className={`${controls.btnGhost} ${controls.btnSm}`}
        style={{ marginTop: '0.5rem' }}
        onClick={() => onChange([...lines, blankLine(lines[lines.length - 1]?.tax_rate ?? 18)])}
      >
        <Plus size={15} /> {purT('addLine')}
      </button>
      {fly.node}
    </div>
  );
}
