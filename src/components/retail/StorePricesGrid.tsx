import { useMemo, useRef, useState } from 'react';
import { Download, Store, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { loadBranches } from '../../lib/branch';
import { listCatalog } from '../../lib/catalog';
import { branchPricesDb, gridCsv, parseGridCsv, priceGrid } from '../../lib/retail/store-prices';
import { downloadText } from '../../lib/download';
import { num } from '../../lib/invoice-calc';
import { cn, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './retail-r4.module.css';

/**
 * Store prices (R4-B3): item × store grid of dated overrides, effective from the chosen date, with CSV export / import.
 * An empty cell keeps the store's price list (or the item's normal price); "-" in a CSV cell clears the override.
 */
export default function StorePricesGrid({ onClose, notify }: { onClose: () => void; notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const [from, setFrom] = useState(todayInput());
  const [filter, setFilter] = useState('');
  const branches = useMemo(() => loadBranches().filter((b) => !b.inactive), []);
  const items = useMemo(() => listCatalog().filter((i) => i.id && i.name?.trim()).sort((a, b) => a.name.localeCompare(b.name)), []);
  const [tick, setTick] = useState(0);
  const grid = useMemo(() => priceGrid(branchPricesDb.all(), items.map((i) => i.id), branches.map((b) => b.id), from), [items, branches, from, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edits, setEdits] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const shown = items.filter((i) => !filter.trim() || i.name.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 300);
  const cellKey = (itemId: string, branchId: string) => `${itemId}|${branchId}`;

  const save = () => {
    try {
      const cells = Object.entries(edits).map(([k, v]) => {
        const [item_id, branch_id] = k.split('|');
        return { item_id, branch_id, from, rate: v.trim() === '' ? null : num(v) };
      });
      const n = branchPricesDb.bulk(cells);
      setEdits({});
      setTick((t) => t + 1);
      notify(sT('spSaved', { n }), 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const importCsv = async (file: File) => {
    try {
      const { cells, unknown } = parseGridCsv(await file.text(), items, branches, from);
      const n = branchPricesDb.bulk(cells);
      setTick((t) => t + 1);
      notify(unknown.length ? sT('spImportedSome', { n, names: unknown.slice(0, 5).join(', ') }) : sT('spImported', { n }), unknown.length ? 'info' : 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={sT('spTitle')} subtitle={sT('spSub')}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{sT('close')}</button><button type="button" className={controls.btnPrimary} onClick={save} disabled={!Object.keys(edits).length}>{sT('save')}</button></>}>
      {branches.length === 0 ? <p className={css.muted}>{sT('spNoBranches')}</p> : (
        <div className={css.stack}>
          <div className={css.bar}>
            <label className={controls.field}><span className={controls.label}>{sT('spFrom')}</span><input type="date" className={controls.input} value={from} onChange={(e) => { setFrom(e.target.value); setEdits({}); }} /></label>
            <label className={cn(controls.field, css.grow)}><span className={controls.label}>{sT('spFilter')}</span><input className={controls.input} value={filter} onChange={(e) => setFilter(e.target.value)} /></label>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => downloadText(`store-prices-${from}.csv`, gridCsv(items, branches, branchPricesDb.all(), from), 'text/csv')}><Download size={14} aria-hidden="true" /> {sT('csv')}</button>
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden="true" /> {sT('spImport')}</button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importCsv(f); }} />
          </div>
          <div className={css.wrap}>
            <table className={surface.table}>
              <thead><tr><th>{sT('item')}</th><th className={css.num}>{sT('spBase')}</th>{branches.map((b) => <th key={b.id} className={css.num}><Store size={12} aria-hidden="true" /> {b.name}</th>)}</tr></thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className={css.num}>{num(i.rate)}</td>
                    {branches.map((b) => {
                      const k = cellKey(i.id, b.id);
                      const cur = grid.get(i.id)?.get(b.id);
                      return (
                        <td key={b.id} className={css.num}>
                          <input className={cn(controls.input, controls.inputNumeric, css.gridInput)} inputMode="decimal" aria-label={sT('spCell', { item: i.name, store: b.name })}
                            value={edits[k] ?? (cur !== undefined ? String(cur) : '')} placeholder="-"
                            onChange={(e) => setEdits((x) => ({ ...x, [k]: e.target.value }))} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={css.note}>{sT('spHint')}</p>
        </div>
      )}
    </Modal>
  );
}
