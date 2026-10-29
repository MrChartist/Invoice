import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { cn, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { generateId, getTable } from '../../lib/storage';
import { computeStock, stockDb, type StockItem } from '../../lib/inventory';
import { computeTracking } from '../../lib/stock-tracking';
import { pendingPoQty, poLinesFromReorder, reorderStatus } from '../../lib/reorder';
import { poTotals, purchaseOrdersDb, validatePo } from '../../lib/purchase-orders';
import { businessContext } from '../../lib/purchases-context';
import { godownName } from '../../lib/godowns';
import type { PurchaseOrder, PurchaseRecord, Vendor } from '../../types/purchases';
import { mfgT } from '../../i18n/areas/manufacturing';
import { ItemFilterBar } from './ItemFilterBar';
import { useItemFilterIds } from './useItemFilterIds';
import { NO_FILTER, applyItemFilter } from '../../lib/stock-filters';
import { qtyText, money, type MfgContext } from './context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';

const rowKey = (itemId: string, godown?: string) => `${itemId}|${godown ?? ''}`;

/** Reorder Status (Tally style) with "Create purchase order", and the reorder-level master. */
export function ReorderTab({ ctx }: { ctx: MfgContext }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const vendors = useMemo(() => getTable<Vendor>('vendors').sort((a, b) => a.name.localeCompare(b.name)), [ctx.version]);
  const allRows = useMemo(() => {
    const positions = computeStock(ctx.inputs);
    const pending = pendingPoQty(getTable<PurchaseOrder>('purchase_orders'), getTable<PurchaseRecord>('purchases'), ctx.items);
    return reorderStatus(positions, pending, computeTracking(ctx.inputs));
  }, [ctx.inputs, ctx.items]);
  // 7S (7.66): stock group / category filter.
  const [filter, setFilter] = useState(NO_FILTER);
  const ids = useItemFilterIds(filter, ctx.items);
  const rows = useMemo(() => applyItemFilter(allRows, ids, (r) => r.item.id), [allRows, ids]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [vendorId, setVendorId] = useState('');
  const selected = rows.filter((r) => picked.has(rowKey(r.item.id, r.godown)) && r.suggested > 0);
  const multi = ctx.godowns.length > 1;

  const toggle = (k: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const createPo = () => {
    const vendor = vendors.find((v) => v.id === vendorId) ?? vendors.find((v) => v.name === selected[0]?.vendor);
    const lines = poLinesFromReorder(selected, generateId);
    const draft = { vendor_name: vendor?.name ?? '', date: todayInput(), lines };
    const err = validatePo(draft);
    if (err) return ctx.error(err);
    try {
      const business = businessContext();
      const pos = vendor?.state_code || vendor?.gstin?.slice(0, 2) || business.stateCode;
      const t = poTotals(lines, pos, business.stateCode);
      const po = purchaseOrdersDb.save({
        ...draft, vendor_id: vendor?.id, vendor_gstin: vendor?.gstin, place_of_supply: pos,
        taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total, notes: 'Raised from Reorder Status',
      });
      setPicked(new Set());
      ctx.changed(mfgT('poCreated', { number: po.po_number }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };

  return (
    <>
      <div className={styles.bar}>
        <Link to="/expenses?tab=orders" className={cn(controls.btnGhost, controls.btnSm)}>{mfgT('openPos')}</Link>
        {ctx.canBooks && (
          <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
            <select className={controls.select} aria-label={mfgT('vendor')} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">{mfgT('vendor')}: {selected[0]?.vendor ?? mfgT('choose')}</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} disabled={selected.length === 0} onClick={createPo}>
              <ShoppingCart size={14} aria-hidden="true" /> {mfgT('createPo')}{selected.length ? ` (${selected.length})` : ''}
            </button>
          </span>
        )}
      </div>
      <ItemFilterBar value={filter} onChange={setFilter} idPrefix="reorder" />
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th><span className={surface.srOnly}>{mfgT('selectRow', { name: '' })}</span></th>
              <th>{mfgT('item')}</th>{multi && <th>{mfgT('godown')}</th>}
              <th className={styles.num}>{mfgT('closing')}</th><th className={styles.num}>{mfgT('reorderLevel')}</th>
              <th className={styles.num}>{mfgT('shortfall')}</th><th className={styles.num}>{mfgT('pendingPo')}</th>
              <th className={styles.num}>{mfgT('moq')}</th><th className={styles.num}>{mfgT('suggested')}</th><th className={styles.num}>{mfgT('rate')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const k = rowKey(r.item.id, r.godown);
              return (
                <tr key={k}>
                  <td><input type="checkbox" disabled={!(r.suggested > 0)} checked={picked.has(k)} onChange={() => toggle(k)} aria-label={mfgT('selectRow', { name: r.item.name })} /></td>
                  <td className={r.below ? styles.loss : undefined}>{r.item.name}</td>
                  {multi && <td>{r.godown ? godownName(ctx.godowns, r.godown) : '-'}</td>}
                  <td className={styles.num}>{qtyText(r.closing)} {r.item.unit}</td>
                  <td className={styles.num}>{qtyText(r.reorderLevel)}</td>
                  <td className={styles.num}>{qtyText(r.shortfall)}</td>
                  <td className={styles.num}>{qtyText(r.pendingPo)}</td>
                  <td className={styles.num}>{r.minOrderQty ? qtyText(r.minOrderQty) : '-'}</td>
                  <td className={styles.num}><strong>{qtyText(r.suggested)}</strong></td>
                  <td className={styles.num}>{money(r.rate)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={multi ? 10 : 9} className={styles.muted}>{mfgT('noReorder')}</td></tr>}
          </tbody>
        </table>
      </div>
      {ctx.canMasters && <LevelsEditor ctx={ctx} />}
    </>
  );
}

/** Reorder level, minimum order quantity and (multi-godown) per-godown levels, edited inline. */
function LevelsEditor({ ctx }: { ctx: MfgContext }) {
  const items = useMemo(() => ctx.items.filter((i) => i.track_stock).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const godowns = ctx.godowns.length > 1 ? ctx.godowns : [];
  const save = (item: StockItem, change: Partial<StockItem>) => {
    try {
      stockDb.saveItem({ ...item, ...change });
      ctx.changed(`${item.name} ✓`);
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  const numInput = (item: StockItem, value: number | undefined, label: string, apply: (n: number) => Partial<StockItem>) => (
    <input
      key={`${item.id}-${label}-${value ?? ''}`} className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" defaultValue={value ? String(value) : ''}
      aria-label={`${label} ${item.name}`}
      onBlur={(e) => { const n = Math.max(num(e.target.value), 0); if (n !== num(value)) save(item, apply(n)); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
  return (
    <>
      <p className={styles.section} style={{ margin: '1.25rem 0 0.5rem' }}>{mfgT('setLevels')}</p>
      <div className={styles.wrap}>
        <table className={styles.grid}>
          <thead>
            <tr><th>{mfgT('item')}</th><th className={styles.num}>{mfgT('reorderLevel')}</th><th className={styles.num}>{mfgT('moq')}</th>
              {godowns.map((g) => <th key={g.id} className={styles.num}>{g.name}</th>)}</tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.name}</td>
                <td>{numInput(it, it.reorder_level, mfgT('reorderLevel'), (n) => ({ reorder_level: n }))}</td>
                <td>{numInput(it, it.min_order_qty, mfgT('moq'), (n) => ({ min_order_qty: n || undefined }))}</td>
                {godowns.map((g) => (
                  <td key={g.id}>{numInput(it, it.reorder_by_godown?.[g.id], `${mfgT('reorderLevel')} ${g.name}`, (n) => {
                    const next = { ...(it.reorder_by_godown ?? {}) };
                    if (n > 0) next[g.id] = n;
                    else delete next[g.id];
                    return { reorder_by_godown: Object.keys(next).length ? next : undefined };
                  })}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
