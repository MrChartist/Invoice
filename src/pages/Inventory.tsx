import { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownToLine, BookOpen, Boxes, Download, Edit3, PackagePlus, Plus,
  Search, SlidersHorizontal, Trash2, TrendingDown,
} from 'lucide-react';
import { cn, formatMoney, formatDate, todayInput, addDaysInput } from '../lib/utils';
import { localDb } from '../lib/localDb';
import { StorageWriteError } from '../lib/storage';
import {
  blankStockItem, deadStock, loadPositions, loadSettings, marginReport, movementSummary,
  saveSettings, stockDb, stockSummaryCsv, summarize,
  type CostingMethod, type InventorySettings, type StockItem, type StockMove, type StockPosition,
} from '../lib/inventory';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../components/ui/useToast';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { ItemFormModal } from '../components/inventory/ItemFormModal';
import { AdjustModal } from '../components/inventory/AdjustModal';
import { LedgerModal } from '../components/inventory/LedgerModal';
import { StockChip } from '../components/inventory/StockChip';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './Inventory.module.css';

type Tab = 'summary' | 'movement' | 'dead' | 'margin';
type Filter = 'all' | 'low' | 'out' | 'negative' | 'untracked';

function download(filename: string, csv: string) {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Inventory() {
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState<InventorySettings>(() => loadSettings());
  const [tab, setTab] = useState<Tab>('summary');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ item: StockItem; isNew: boolean } | null>(null);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StockItem | null>(null);
  const [deadDays, setDeadDays] = useState(90);
  const [from, setFrom] = useState(() => addDaysInput(-30));
  const [to, setTo] = useState(todayInput());
  const { notify, toastNode } = useToast();

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // `version` is the cache-buster: every write bumps it so derived stock recomputes.
  /* eslint-disable react-hooks/exhaustive-deps */
  const positions = useMemo(() => loadPositions({ method: settings.method, includeChallans: settings.includeChallans }), [version, settings]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const totals = useMemo(() => summarize(positions), [positions]);

  const guard = (fn: () => void, okMsg: string) => {
    try {
      fn();
      refresh();
      notify(okMsg);
    } catch (err) {
      notify(err instanceof StorageWriteError ? err.message : 'Could not save changes.', 'error');
    }
  };

  const updateSettings = (next: InventorySettings) => {
    try {
      saveSettings(next);
    } catch {
      notify('Could not save inventory settings.', 'error');
    }
    setSettings(next);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return positions
      .filter((p) => {
        if (filter === 'low' && !(p.isLow && !p.isNegative)) return false;
        if (filter === 'out' && p.status !== 'out') return false;
        if (filter === 'negative' && !p.isNegative) return false;
        if (filter === 'untracked' && p.item.track_stock) return false;
        if (!q) return true;
        return [p.item.name, p.item.sku, p.item.hsn, p.item.location].some((v) => (v ?? '').toLowerCase().includes(q));
      })
      .sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [positions, query, filter]);

  const catalogueMissing = useMemo(() => {
    const have = new Set(positions.map((p) => p.item.name.trim().toLowerCase()));
    return localDb.items.getAll().filter((i) => i.name?.trim() && !have.has(i.name.trim().toLowerCase()));
  }, [positions]);

  const importCatalogue = () =>
    guard(() => {
      for (const c of catalogueMissing) {
        stockDb.saveItem(
          blankStockItem({
            name: c.name.trim(), hsn: c.hsn || undefined, unit: c.unit || 'NOS',
            track_stock: c.type !== 'service', sale_rate: c.rate || undefined, tax_rate: c.tax_rate,
          }),
        );
      }
    }, `Imported ${catalogueMissing.length} item${catalogueMissing.length === 1 ? '' : 's'} from your catalogue`);

  const adjustPos = positions.find((p) => p.item.id === adjustId) ?? null;
  const ledgerPos = positions.find((p) => p.item.id === ledgerId) ?? null;
  const takenNames = positions
    .filter((p) => p.item.id !== editing?.item.id)
    .map((p) => p.item.name.trim().toLowerCase());

  const movement = useMemo(() => movementSummary(positions, from, to), [positions, from, to]);
  const dead = useMemo(() => deadStock(positions, deadDays, todayInput()), [positions, deadDays]);
  const margins = useMemo(() => marginReport(positions), [positions]);

  const negatives = positions.filter((p) => p.isNegative);
  const hasItems = positions.length > 0;

  const nameCell = (p: StockPosition) => (
    <div className={styles.itemName}>
      <button type="button" className={styles.nameBtn} onClick={() => setLedgerId(p.item.id)}>{p.item.name}</button>
      <span className={styles.itemMeta}>
        {[p.item.sku, p.item.hsn && `HSN ${p.item.hsn}`, p.item.location].filter(Boolean).join(' · ') || p.item.unit}
      </span>
    </div>
  );

  return (
    <div className={surface.page}>
      <PageHeader
        title="Inventory"
        subtitle="Live stock from your invoices, purchases and adjustments — nothing is edited on your documents."
        actions={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => download(`stock-summary-${todayInput()}.csv`, stockSummaryCsv(positions))} disabled={!hasItems}>
              <Download size={16} aria-hidden="true" /> Export CSV
            </button>
            <button type="button" className={controls.btnPrimary} onClick={() => setEditing({ item: blankStockItem(), isNew: true })}>
              <Plus size={16} aria-hidden="true" /> Add item
            </button>
          </>
        }
      />

      <div className={surface.statGrid}>
        <StatCard label="Stock value" value={`₹ ${formatMoney(totals.stockValue)}`} hint={`${settings.method === 'FIFO' ? 'FIFO' : 'Weighted average'} costing`} icon={Boxes} />
        <StatCard label="SKUs" value={String(totals.skus)} hint={`${totals.tracked} tracked`} icon={PackagePlus} />
        <StatCard label="Low stock" value={String(totals.lowCount)} hint={`${totals.outCount} out of stock`} icon={TrendingDown} tone={totals.lowCount ? 'warning' : 'default'} />
        <StatCard label="Negative stock" value={String(totals.negativeCount)} hint={totals.negativeCount ? 'Sold more than recorded' : 'All balances valid'} icon={AlertTriangle} tone={totals.negativeCount ? 'loss' : 'default'} />
      </div>

      <div className={surface.card}>
        <div className={styles.settingsBar}>
          <label className="inline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className={controls.label}>Costing</span>
            <select
              className={cn(controls.select, styles.methodSelect)} value={settings.method}
              onChange={(e) => updateSettings({ ...settings, method: e.target.value as CostingMethod })}
              aria-label="Costing method"
            >
              <option value="WEIGHTED_AVG">Weighted average</option>
              <option value="FIFO">FIFO</option>
            </select>
          </label>
          <label className={controls.check}>
            <input type="checkbox" checked={settings.includeChallans} onChange={(e) => updateSettings({ ...settings, includeChallans: e.target.checked })} />
            Delivery challans reduce stock
          </label>
          {catalogueMissing.length > 0 && (
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={importCatalogue}>
              <ArrowDownToLine size={14} /> Import {catalogueMissing.length} from catalogue
            </button>
          )}
        </div>

        <div className={styles.toolbar}>
          <div className={`${controls.segment} ${styles.touchSeg}`} role="tablist" aria-label="Inventory reports">
            {([['summary', 'Stock summary'], ['movement', 'Movement'], ['dead', 'Dead stock'], ['margin', 'Margin']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'summary' && (
            <>
              <div className={styles.search}>
                <Search size={16} className={styles.searchIcon} aria-hidden />
                <input
                  type="search" className={cn(controls.input, styles.searchInput)} placeholder="Search name, SKU, HSN, location"
                  value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search stock items"
                />
              </div>
              <select className={cn(controls.select, styles.methodSelect)} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Filter by status">
                <option value="all">All items</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
                <option value="negative">Negative</option>
                <option value="untracked">Not tracked</option>
              </select>
            </>
          )}
          {tab === 'movement' && (
            <div className={styles.dateRange}>
              <div className={controls.field}><label className={controls.label} htmlFor="inv-from">From</label><input id="inv-from" type="date" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className={controls.field}><label className={controls.label} htmlFor="inv-to">To</label><input id="inv-to" type="date" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          )}
          {tab === 'dead' && (
            <label className={controls.field} style={{ maxWidth: 180 }}>
              <span className={controls.label}>No movement for (days)</span>
              <input type="number" min={1} className={cn(controls.input, controls.inputNumeric)} value={deadDays} onChange={(e) => setDeadDays(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          )}
        </div>

        {negatives.length > 0 && tab === 'summary' && (
          <div className={styles.warnings} role="alert">
            <strong><AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> Negative stock</strong>
            <span>
              {negatives.map((p) => `${p.item.name} (${p.qty} ${p.item.unit})`).join(', ')} — invoices sold more than your purchases and opening stock record. Add a purchase or an adjustment to correct it.
            </span>
          </div>
        )}

        {!hasItems ? (
          <EmptyState
            icon={Boxes}
            title="No stock items yet"
            text="Add the products you sell with an opening quantity. Sales on invoices will reduce stock automatically; purchases add to it."
            action={
              <div className={surface.pageActions} style={{ justifyContent: 'center' }}>
                <button type="button" className={controls.btnPrimary} onClick={() => setEditing({ item: blankStockItem(), isNew: true })}><Plus size={16} /> Add first item</button>
                {catalogueMissing.length > 0 && (
                  <button type="button" className={controls.btnOutline} onClick={importCatalogue}><ArrowDownToLine size={16} /> Import from catalogue</button>
                )}
              </div>
            }
          />
        ) : (
          <div className={surface.tableWrap}>
            {tab === 'summary' && (
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>Item</th><th className={surface.numeric}>Qty</th><th className={surface.numeric}>Avg cost</th>
                    <th className={surface.numeric}>Value</th><th className={surface.numeric}>Reorder</th><th>Status</th>
                    <th><span className={surface.srOnly}>Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={7} className={styles.itemMeta}>No items match.</td></tr>}
                  {filtered.map((p) => (
                    <tr key={p.item.id}>
                      <td>{nameCell(p)}</td>
                      <td className={cn(surface.numeric, p.isNegative && styles.negative)}>{p.item.track_stock ? `${p.qty} ${p.item.unit}` : '—'}</td>
                      <td className={surface.numeric}>{p.item.track_stock ? formatMoney(p.avgCost) : '—'}</td>
                      <td className={cn(surface.numeric, p.value < 0 && styles.negative)}>{p.item.track_stock ? formatMoney(p.value) : '—'}</td>
                      <td className={surface.numeric}>{p.item.track_stock && p.item.reorder_level ? p.item.reorder_level : '—'}</td>
                      <td><StockChip status={p.status} /></td>
                      <td>
                        <span className={surface.rowActions}>
                          <button type="button" className={controls.btnIcon} title="Stock ledger" aria-label={`Ledger for ${p.item.name}`} onClick={() => setLedgerId(p.item.id)}><BookOpen size={16} /></button>
                          {p.item.track_stock && <button type="button" className={controls.btnIcon} title="Adjust stock" aria-label={`Adjust ${p.item.name}`} onClick={() => setAdjustId(p.item.id)}><SlidersHorizontal size={16} /></button>}
                          <button type="button" className={controls.btnIcon} title="Edit item" aria-label={`Edit ${p.item.name}`} onClick={() => setEditing({ item: p.item, isNew: false })}><Edit3 size={16} /></button>
                          <button type="button" className={controls.btnDanger} title="Delete item" aria-label={`Delete ${p.item.name}`} onClick={() => setDeleting(p.item)}><Trash2 size={16} /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {tab === 'movement' && (
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>Item</th><th className={surface.numeric}>Opening</th><th className={surface.numeric}>In</th>
                    <th className={surface.numeric}>Out</th><th className={surface.numeric}>Closing</th><th className={surface.numeric}>Closing value</th>
                  </tr>
                </thead>
                <tbody>
                  {movement.map((m) => (
                    <tr key={m.item.id}>
                      <td>{m.item.name}</td>
                      <td className={surface.numeric}>{m.openingQty}</td>
                      <td className={cn(surface.numeric, styles.positive)}>{m.inQty || ''}</td>
                      <td className={surface.numeric}>{m.outQty || ''}</td>
                      <td className={cn(surface.numeric, m.closingQty < 0 && styles.negative)}>{m.closingQty} {m.item.unit}</td>
                      <td className={surface.numeric}>{formatMoney(m.closingValue)}</td>
                    </tr>
                  ))}
                  {movement.length === 0 && <tr><td colSpan={6} className={styles.itemMeta}>No tracked items.</td></tr>}
                </tbody>
              </table>
            )}

            {tab === 'dead' && (
              <table className={surface.table}>
                <thead>
                  <tr><th>Item</th><th className={surface.numeric}>Qty</th><th className={surface.numeric}>Value locked</th><th>Last movement</th><th className={surface.numeric}>Days idle</th></tr>
                </thead>
                <tbody>
                  {dead.map((d) => (
                    <tr key={d.position.item.id}>
                      <td>{nameCell(d.position)}</td>
                      <td className={surface.numeric}>{d.position.qty} {d.position.item.unit}</td>
                      <td className={surface.numeric}>{formatMoney(d.position.value)}</td>
                      <td>{d.lastMovement ? formatDate(d.lastMovement) : 'Never'}</td>
                      <td className={surface.numeric}>{d.daysIdle}</td>
                    </tr>
                  ))}
                  {dead.length === 0 && <tr><td colSpan={5} className={styles.itemMeta}>Nothing has been idle for {deadDays}+ days.</td></tr>}
                </tbody>
              </table>
            )}

            {tab === 'margin' && (
              <table className={surface.table}>
                <thead>
                  <tr><th>Item</th><th className={surface.numeric}>Sold</th><th className={surface.numeric}>Avg sale</th><th className={surface.numeric}>Avg cost</th><th className={surface.numeric}>Margin / unit</th><th className={surface.numeric}>Margin %</th><th className={surface.numeric}>Total margin</th></tr>
                </thead>
                <tbody>
                  {margins.map((m) => (
                    <tr key={m.item.id}>
                      <td>{m.item.name}</td>
                      <td className={surface.numeric}>{m.soldQty}</td>
                      <td className={surface.numeric}>{formatMoney(m.avgSaleRate)}</td>
                      <td className={surface.numeric}>{formatMoney(m.avgCostRate)}</td>
                      <td className={cn(surface.numeric, m.marginPerUnit < 0 && styles.negative)}>{formatMoney(m.marginPerUnit)}</td>
                      <td className={cn(surface.numeric, m.marginPct < 0 && styles.negative)}>{m.marginPct}%</td>
                      <td className={cn(surface.numeric, m.totalMargin < 0 && styles.negative)}>{formatMoney(m.totalMargin)}</td>
                    </tr>
                  ))}
                  {margins.length === 0 && <tr><td colSpan={7} className={styles.itemMeta}>No tracked items.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <ItemFormModal
        open={!!editing}
        item={editing?.item ?? null}
        isNew={editing?.isNew ?? false}
        takenNames={takenNames}
        onClose={() => setEditing(null)}
        onSave={(item) => {
          guard(() => stockDb.saveItem(item), editing?.isNew ? 'Item added' : 'Item updated');
          setEditing(null);
        }}
      />
      <AdjustModal
        open={!!adjustPos}
        position={adjustPos}
        onClose={() => setAdjustId(null)}
        onSave={(move: StockMove) => {
          guard(() => stockDb.addMove(move), 'Stock adjusted');
          setAdjustId(null);
        }}
      />
      <LedgerModal
        open={!!ledgerPos}
        position={ledgerPos}
        onClose={() => setLedgerId(null)}
        onDeleteMove={(id) => guard(() => stockDb.deleteMove(id), 'Adjustment removed')}
        onDownload={download}
      />
      <ConfirmDialog
        open={!!deleting}
        destructive
        title="Delete stock item?"
        message={`"${deleting?.name ?? ''}" and its manual adjustments will be removed. Invoices are not affected.`}
        confirmLabel="Delete"
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && guard(() => stockDb.deleteItem(deleting.id), 'Item deleted')}
      />
      {toastNode}
    </div>
  );
}
