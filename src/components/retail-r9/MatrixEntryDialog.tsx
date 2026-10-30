/**
 * RT-C2 size × colour grid entry (lazy dialog, in the Apparel desk chunk): pick a style; rows = axis 1, columns =
 * axis 2, one table per value of a third axis. The grid opens with the bill's current quantities; *Put on the bill*
 * sets one line per non-zero cell (updated, never duplicated). *Create missing* makes the absent children through
 * `generateVariants` (`master.edit`), carrying the style's price band.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Boxes } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { rtcT } from '../../i18n/areas/retail-r9c';
import { stockDb, type StockItem } from '../../lib/inventory';
import { generateId } from '../../lib/storage';
import { generateVariants, type VariantAxis } from '../../lib/variants';
import { gridAxes, gridCells, gridParents, gridToLines, linesToGrid, purchaseLine, setBands, type GridQty } from '../../lib/retail/rt-matrix';
import { useT } from '../../i18n';
import type { PurchaseLine } from '../../types/purchases';
import { num } from '../../lib/invoice-calc';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

type AnyLine = { id: string; name: string; quantity: number; rate: number; item_id?: string };

export interface MatrixEntryProps<L extends AnyLine> {
  open: boolean;
  onClose: () => void;
  lines: readonly L[];
  /** The style to open with (the line's parent), else the user picks. */
  parentId?: string;
  /** Default rate of a style (sale rate for a sale, last cost for a bill). */
  rateOf: (parent: StockItem) => number;
  make: (child: StockItem, parent: StockItem, qty: number, rate: number) => L;
  onApply: (lines: L[], n: number) => void;
}

export default function MatrixEntryDialog<L extends AnyLine>({ open, onClose, lines, parentId, rateOf, make, onApply }: MatrixEntryProps<L>) {
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => stockDb.items(), [tick, open]);
  const parents = useMemo(() => gridParents(all), [all]);
  const [pid, setPid] = useState(parentId ?? '');
  const parent = parents.find((p) => p.id === (pid || parentId)) ?? (parents.length === 1 ? parents[0] : undefined);
  const [cells, setCells] = useState<Record<string, { qty: number; rate?: number }>>({});
  const [rate, setRate] = useState<number | null>(null);
  const [perCell, setPerCell] = useState(false);
  const [err, setErr] = useState('');
  const [loadedFor, setLoadedFor] = useState('');
  if (parent && loadedFor !== parent.id) {
    // Opening a style: start from the bill's current quantities.
    const g = linesToGrid(lines, parent, all);
    setLoadedFor(parent.id);
    setCells(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { qty: v.qty, rate: v.rate }])));
    setRate(Object.values(g)[0]?.rate ?? rateOf(parent));
  }
  const axes = parent ? gridAxes(parent) : [];
  const grid = parent ? gridCells(parent, all) : [];
  const total = Object.values(cells).reduce((s, c) => s + num(c.qty), 0);
  const missing = grid.filter((c) => !c.child);

  const createMissing = () => {
    if (!parent) return;
    try {
      const plan = generateVariants(parent.id, axes, { withBarcodes: true, newId: generateId });
      if (parent.gst_band) setBands(plan.create.map((c) => ({ id: c.id, band: parent.gst_band })));
      setErr(rtcT('gridCreated', { n: plan.create.length }));
      setTick((t) => t + 1);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const apply = () => {
    if (!parent) return;
    const q: GridQty[] = grid.map((c) => ({ key: c.key, qty: num(cells[c.key]?.qty), ...(perCell && num(cells[c.key]?.rate) > 0 ? { rate: num(cells[c.key]?.rate) } : {}) }));
    const r = gridToLines(lines, parent, all, q, num(rate), (child, qty, rt) => make(child, parent, qty, rt));
    if (r.missing.length) return setErr(rtcT('gridMissing', { list: r.missing.join(', ') }));
    onApply(r.lines, q.filter((c) => c.qty > 0).length);
    onClose();
  };
  const set = (key: string, patch: { qty?: number; rate?: number }) => setCells((c) => ({ ...c, [key]: { ...c[key], ...patch, qty: patch.qty ?? c[key]?.qty ?? 0 } }));

  return (
    <Modal open={open} onClose={onClose} size="lg" title={<><Boxes size={16} aria-hidden="true" /> {rtcT('gridTitle')}{parent ? `: ${parent.name}` : ''}</>}
      footer={<><span className={controls.hint}>{rtcT('gridTotal', { n: total })}</span><button type="button" className={controls.btnOutline} onClick={onClose}>✕</button><button type="button" className={controls.btnPrimary} disabled={!parent} onClick={apply} data-grid-apply>{rtcT('gridApply')}</button></>}>
      {parents.length === 0 ? <p className={controls.hint}>{rtcT('gridNoStyle')}</p> : (
        <>
          <div className={controls.row} style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
            <label className={controls.field}><span className={controls.label}>{rtcT('gridStyle')}</span>
              <select className={controls.select} value={parent?.id ?? ''} onChange={(e) => setPid(e.target.value)} data-grid-style>
                <option value="">-</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className={controls.field} style={{ maxWidth: 140 }}><span className={controls.label}>{rtcT('gridRate')}</span>
              <NumberInput className={controls.input} value={rate ?? 0} onChange={setRate} data-grid-rate />
            </label>
            <label className={controls.check}><input type="checkbox" checked={perCell} onChange={(e) => setPerCell(e.target.checked)} /> {rtcT('gridCellRate')}</label>
          </div>
          {missing.length > 0 && <p className={controls.hint}>{rtcT('gridMissing', { list: missing.map((m) => Object.values(m.attrs).join(' / ')).join(', ') })} <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={createMissing}>{rtcT('gridCreate')}</button></p>}
          {parent && (
            <GridTables axes={axes} cells={grid} render={(cell) => (
              <>
                <NumberInput className={controls.input} style={{ maxWidth: 72, opacity: cell.child ? 1 : 0.5 }} value={cells[cell.key]?.qty ?? 0} onChange={(n) => set(cell.key, { qty: n })} aria-label={Object.values(cell.attrs).join(' ')} data-grid-cell={cell.key} />
                {perCell && <NumberInput className={controls.input} style={{ maxWidth: 72 }} value={cells[cell.key]?.rate ?? 0} onChange={(n) => set(cell.key, { rate: n })} placeholder="₹" aria-label={`${Object.values(cell.attrs).join(' ')} ₹`} />}
              </>
            )} />
          )}
          {err && <p className={controls.hint} role="status">{err}</p>}
        </>
      )}
    </Modal>
  );
}

/** Rows = axis 1, columns = axis 2, one table per value of a third axis; `render` fills a cell (shared with the stock grid). */
export function GridTables<C extends { key: string; attrs: Record<string, string> }>({ axes, cells, render }: { axes: readonly VariantAxis[]; cells: readonly C[]; render: (cell: C) => ReactNode }) {
  const [rowAx, colAx, tabAx] = axes;
  if (!rowAx) return null;
  const cols = colAx?.values ?? [''];
  return (
    <>
      {(tabAx?.values ?? ['']).map((tv) => (
        <div className={surface.tableWrap} key={tv}>
          {tabAx && <strong>{tabAx.name}: {tv}</strong>}
          <table className={surface.table} data-grid-table>
            <thead><tr><th>{rowAx.name}</th>{cols.map((c) => <th key={c} className={surface.numeric}>{c || '-'}</th>)}</tr></thead>
            <tbody>
              {rowAx.values.map((r) => (
                <tr key={r}>
                  <th>{r}</th>
                  {cols.map((c) => {
                    const cell = cells.find((g) => g.attrs[rowAx.name] === r && (!colAx || g.attrs[colAx.name] === c) && (!tabAx || g.attrs[tabAx.name] === tv));
                    return <td key={c} className={surface.numeric} title={cell ? Object.values(cell.attrs).join(' / ') : undefined}>{cell && render(cell)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

/** Supplier bill: the Grid button (one grid → one line per non-zero cell, stock-in by item id). */
export function BillGrid({ lines, onChange, date }: { lines: PurchaseLine[]; onChange: (lines: PurchaseLine[]) => void; date?: string }) {
  useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(true)} data-grid-open><Boxes size={14} aria-hidden="true" /> {rtcT('gridBtn')}</button>
      {open && <MatrixEntryDialog<PurchaseLine> open lines={lines} rateOf={(p) => num(p.opening_rate)} onClose={() => setOpen(false)} make={(c, p, q, r) => purchaseLine(c, p, q, r, generateId(), date)} onApply={onChange} />}
    </>
  );
}
