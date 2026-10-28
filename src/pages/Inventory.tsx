import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownToLine, BookOpen, Boxes, Download, Edit3, FolderTree, PackagePlus, Plus, Ruler,
  Search, SlidersHorizontal, Trash2, TrendingDown, Warehouse,
} from 'lucide-react';
import { cn, formatMoney, formatDate, todayInput } from '../lib/utils';
import { localDb } from '../lib/localDb';
import { getPeriodContext, setPeriodRange, subscribePeriodContext } from '../lib/books';
import {
  blankStockItem, deadStock, loadPositions, loadSettings, marginReport, movementSummary,
  saveSettings, stockDb, stockSummaryCsv, summarize,
  type CostingMethod, type InventorySettings, type StockItem, type StockMove, type StockPosition,
} from '../lib/inventory';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { LearnMore } from '../components/discover';
import { useToast } from '../components/ui/useToast';
import { can } from '../lib/access';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { ItemFormModal } from '../components/inventory/ItemFormModal';
import { AdjustModal } from '../components/inventory/AdjustModal';
import { LedgerModal } from '../components/inventory/LedgerModal';
import { StockChip } from '../components/inventory/StockChip';
import { BatchesTab } from '../components/inventory/BatchesTab';
import { GodownsModal } from '../components/inventory/GodownsModal';
import { TransfersTab } from '../components/inventory/TransfersTab';
import { SerialLookup } from '../components/inventory/SerialLookup';
import { DEFAULT_EXPIRY_ALERT_DAYS } from '../lib/inventory';
import { expiringBatches, godownSummary, liveTrackingInputs, computeTracking } from '../lib/stock-tracking';
import { godownsDb, rollUpGodowns } from '../lib/godowns';
import { MAIN_GODOWN_ID } from '../types/stock';
import { useT } from '../i18n';
import { invT } from '../i18n/areas/inventory';
import { imT } from '../i18n/areas/inventory-masters';
import { skT } from '../i18n/areas/stock-depth';
import { itemsUnder, stockCategoriesDb, stockGroupsDb, treeRows } from '../lib/stock-groups';
import { compoundText } from '../lib/units';

// WP-8 masters & analysis: loaded only when opened.
const StockGroupsModal = lazy(() => import('../components/inventory/StockGroupsModal').then((m) => ({ default: m.StockGroupsModal })));
const UnitsModal = lazy(() => import('../components/inventory/UnitsModal').then((m) => ({ default: m.UnitsModal })));
const StockQueryTab = lazy(() => import('../components/inventory/StockQueryTab').then((m) => ({ default: m.StockQueryTab })));
// 8F stock depth: analysis, variants / kits / bins, pharma operations (each its own chunk).
const StockAnalysisTab = lazy(() => import('../components/distribution/StockAnalysisTab'));
const DepthTab = lazy(() => import('../components/distribution/DepthTab'));
const ExpiryOpsTab = lazy(() => import('../components/distribution/ExpiryOpsTab'));
const OrdersOutstandingTab = lazy(() => import('../components/inventory/OrdersOutstandingTab').then((m) => ({ default: m.OrdersOutstandingTab })));
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './Inventory.module.css';
import { INVENTORY_PACK_TABS, INVENTORY_TABS, type InventoryPackTab, type InventoryTab } from './page-tabs'; // R6-B1; R9 pack desks
import { visibleTabs } from '../lib/industry-packs';
import { defineArea } from '../i18n/area';
import { getJson, peekTable, DB_PREFIX } from '../lib/storage';
import { discoverT } from '../i18n/areas/discover-r6';

const ScreenTip = lazy(() => import('../components/help/ScreenTip')); // R6-A6 one-time tip
const HsnStockTab = lazy(() => import('../components/trade/HsnStockTab')); // R8-C (TR-C4)
// R9: retail pack desks (one lazy chunk each; stubs until RT-B … RT-E merge), the short book and the relabel queue (RT-A).
const PharmacyDesk = lazy(() => import('../components/retail-r9/PharmacyDesk'));
const ApparelDesk = lazy(() => import('../components/retail-r9/ApparelDesk'));
const DevicesDesk = lazy(() => import('../components/retail-r9/DevicesDesk'));
const JewelleryDesk = lazy(() => import('../components/retail-r9/JewelleryDesk'));
const ShortBookTab = lazy(() => import('../components/retail-r9/rt-a-hub').then((m) => ({ default: m.ShortBookTab })));
const RelabelQueue = lazy(() => import('../components/retail-r9/rt-a-hub').then((m) => ({ default: m.RelabelQueue })));
const MrpBasisTool = lazy(() => import('../components/retail-r9/rt-a-hub').then((m) => ({ default: m.MrpBasisTool })));
// R12: agri desks (one lazy chunk each). AG-A's farm desk; the dairy / mill / cold / inputs / members desks are stubs
// until AG-B / C / D replace those files (this page is not edited again).
const FarmDesk = lazy(() => import('../components/agri/FarmDesk'));
const DairyDesk = lazy(() => import('../components/agri/DairyDesk'));
const MillDesk = lazy(() => import('../components/agri/MillDesk'));
const ColdDesk = lazy(() => import('../components/agri/ColdDesk'));
const InputsDesk = lazy(() => import('../components/agri/InputsDesk'));
const MembersDesk = lazy(() => import('../components/agri/MembersDesk'));
const r9TabT = defineArea(
  { pharmacy: 'Pharmacy', apparel: 'Apparel', devices: 'Devices', jewellery: 'Jewellery', shortbook: 'Short book', farm: 'Farm', dairy: 'Dairy', mill: 'Mill', cold: 'Cold storage', inputs: 'Inputs', members: 'Members' } as const,
  { pharmacy: 'फ़ार्मेसी', apparel: 'कपड़े', devices: 'डिवाइस', jewellery: 'ज्वेलरी', shortbook: 'शॉर्ट बुक', farm: 'खेती', dairy: 'डेयरी', mill: 'मिल', cold: 'शीतगृह', inputs: 'खाद-बीज', members: 'सदस्य' },
);
/** R9: the short book tab shows for a retail counter, once it is switched on, or once it has rows. */
const shortBookShown = (): boolean => {
  const rs = getJson<{ short_book?: { enabled?: boolean } } | null>(`${DB_PREFIX}retail_settings`, null);
  return localDb.settings.get().business_type === 'kirana' || !!rs?.short_book?.enabled || peekTable('short_book').length > 0;
};
import { trT } from '../i18n/areas/trade-r8c';
// R4-C4: "Deleted · Undo" for deletes on this page (restores from the recycle bin) — lazy.
const UndoDeleted = lazy(() => import('../components/trust/UndoDeleted'));

type Tab = InventoryTab | InventoryPackTab;
const TABS: readonly Tab[] = [...INVENTORY_TABS, ...INVENTORY_PACK_TABS.map((t) => t.id)]; // R6-B1: list in page-tabs.ts; R9 pack desks
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
  useT(); // re-render on a language switch (5.4)
  const [version, setVersion] = useState(0);
  const [settings, setSettings] = useState<InventorySettings>(() => loadSettings());
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') as Tab | null;
    return t && TABS.includes(t) ? t : 'summary';
  });
  const [godownsOpen, setGodownsOpen] = useState(false);
  const [mastersOpen, setMastersOpen] = useState<'' | 'groups' | 'units'>('');
  const [groupFilter, setGroupFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<{ item: StockItem; isNew: boolean } | null>(null);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [ledgerId, setLedgerId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<StockItem | null>(null);
  const [deadDays, setDeadDays] = useState(90);
  // PENDING 36: movement / analysis follow the shared report period (Books, GST reports, Alt+F2); a date typed here sets it.
  const { period: sharedPeriod } = useSyncExternalStore(subscribePeriodContext, getPeriodContext, getPeriodContext);
  const from = sharedPeriod.start;
  const to = sharedPeriod.end;
  const setFrom = (v: string) => { if (v) setPeriodRange({ start: v, end: v > to ? v : to }); };
  const setTo = (v: string) => { if (v) setPeriodRange({ start: v < from ? v : from, end: v }); };
  const { notify, toastNode } = useToast();
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Re-read stock when user returns to the tab
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  // `version` is the cache-buster: every write bumps it so derived stock recomputes.
  /* eslint-disable react-hooks/exhaustive-deps */
  const positions = useMemo(() => loadPositions({ method: settings.method, includeChallans: settings.includeChallans }), [version, settings]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const totals = useMemo(() => summarize(positions), [positions]);
  // Batches / godowns / serials (6.6 / 6.10 / 6.11): all derived, all opt-in.
  /* eslint-disable react-hooks/exhaustive-deps */
  const trackInputs = useMemo(() => ({ ...liveTrackingInputs(), includeChallans: settings.includeChallans }), [version, settings]);
  const godowns = useMemo(() => godownsDb.list(), [version]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const tracking = useMemo(() => computeTracking(trackInputs), [trackInputs]);
  const transfers = useMemo(() => trackInputs.transfers ?? [], [trackInputs]);
  const multi = godowns.length > 1;
  // WP-8: a godown with sub-godowns shows their stock too (the Total column is unchanged).
  const parentGodowns = useMemo(() => new Set(godowns.map((g) => g.parent_id).filter((x): x is string => !!x)), [godowns]);
  const showBatches = positions.some((p) => p.item.track_stock && p.item.track_batches);
  const showSerials = positions.some((p) => p.item.track_stock && p.item.track_serials);
  const expiryDays = settings.expiryAlertDays ?? DEFAULT_EXPIRY_ALERT_DAYS;
  const today = todayInput();
  const expiring = useMemo(() => (showBatches ? expiringBatches(tracking, today, expiryDays) : []), [showBatches, tracking, today, expiryDays]);
  const godownRows = useMemo(() => (multi ? godownSummary(tracking) : []), [multi, tracking]);
  const transfersUse = useMemo(() => new Set(transfers.flatMap((t) => [t.from_godown, t.to_godown])), [transfers]);
  const tabs = ([
    ['summary', invT('tabSummary')], ['movement', invT('tabMovement')], ['dead', invT('tabDead')], ['margin', invT('tabMargin')],
    ...(showBatches ? [['batches', invT('tabBatches')]] : []),
    ...(multi ? [['godowns', invT('tabGodowns')], ['transfers', invT('tabTransfers')]] : []),
    ...(showSerials ? [['serials', invT('tabSerials')]] : []),
    ['query', imT('tabQuery')], ['orders', imT('tabOrders')],
    ['analysis', skT('tabAnalysis')], ['depth', skT('tabDepth')], ...(showBatches ? [['expiry', skT('tabExpiry')]] : []),
    ['hsn', trT('hsnTitle')], // R8-C (TR-C4)
    ...(shortBookShown() || tab === 'shortbook' ? [['shortbook', r9TabT('shortbook')]] : []), // R9 (RT-A4)
    ...visibleTabs(INVENTORY_PACK_TABS, localDb.settings.get(), tab).map((t) => [t.id, r9TabT(t.id)]), // R9 pack desks
  ] as [Tab, string][]);
  // Stock groups / categories (WP-8): filters appear once any exist.
  /* eslint-disable react-hooks/exhaustive-deps */
  const groupList = useMemo(() => stockGroupsDb.all(), [version]);
  const categoryList = useMemo(() => stockCategoriesDb.all(), [version]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const activeTab: Tab = tabs.some(([k]) => k === tab) ? tab : 'summary';

  const guard = (fn: () => void, okMsg: string) => {
    try {
      fn();
      refresh();
      notify(okMsg);
    } catch (err) {
      // Storage, period-lock and role refusals carry a readable message.
      notify(err instanceof Error && err.message ? err.message : invT('saveFailed'), 'error');
    }
  };

  // Valuation settings are owner-only (6.21); the lib refuses too.
  const canSettings = can('settings.manage');
  const updateSettings = (next: InventorySettings) => {
    try {
      saveSettings(next);
      setSettings(next);
    } catch (err) {
      notify(err instanceof Error && err.message ? err.message : invT('settingsFailed'), 'error');
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const inGroup = groupFilter ? new Set(itemsUnder(groupFilter === '-' ? '' : groupFilter, groupList, positions.map((p) => p.item), 'group').map((i) => i.id)) : null;
    const inCategory = categoryFilter ? new Set(itemsUnder(categoryFilter === '-' ? '' : categoryFilter, categoryList, positions.map((p) => p.item), 'category').map((i) => i.id)) : null;
    return positions
      .filter((p) => {
        if (inGroup && !inGroup.has(p.item.id)) return false;
        if (inCategory && !inCategory.has(p.item.id)) return false;
        if (filter === 'low' && !(p.isLow && !p.isNegative)) return false;
        if (filter === 'out' && p.status !== 'out') return false;
        if (filter === 'negative' && !p.isNegative) return false;
        if (filter === 'untracked' && p.item.track_stock) return false;
        if (!q) return true;
        return [p.item.name, p.item.sku, p.item.hsn, p.item.location].some((v) => (v ?? '').toLowerCase().includes(q));
      })
      .sort((a, b) => a.item.name.localeCompare(b.item.name));
  }, [positions, query, filter, groupFilter, categoryFilter, groupList, categoryList]);

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
    }, invT(catalogueMissing.length === 1 ? 'importedOne' : 'importedMany', { n: catalogueMissing.length }));

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
      <Suspense fallback={null}><ScreenTip id="inventory" /></Suspense>
      <PageHeader
        title={invT('title')}
        subtitle={invT('subtitle')}
        actions={
          <>
            {/* Phase 7: BOM, Manufacturing / Stock Journal, Physical Stock, Reorder Status, stock reports */}
            <Link to="/manufacturing" className={controls.btnOutline}>{invT('manufacturing')}</Link>
            {/* R6-C1 (line added by R6-B): landed cost vouchers live under Manufacturing. */}
            <Link to="/manufacturing?tab=landed" className={controls.btnOutline} data-landed-link>{discoverT('invLanded')}</Link>
            <button type="button" className={controls.btnOutline} onClick={() => download(`stock-summary-${todayInput()}.csv`, stockSummaryCsv(positions))} disabled={!hasItems}>
              <Download size={16} aria-hidden="true" /> {invT('exportCsv')}
            </button>
            <button type="button" className={controls.btnPrimary} onClick={() => setEditing({ item: blankStockItem(), isNew: true })}>
              <Plus size={16} aria-hidden="true" /> {invT('addItem')}
            </button>
          </>
        }
      />

      <div className={surface.statGrid}>
        <StatCard label={invT('statValue')} value={`₹ ${formatMoney(totals.stockValue)}`} hint={settings.method === 'FIFO' ? invT('costingFifo') : invT('costingAvg')} icon={Boxes} />
        <StatCard label={invT('statSkus')} value={String(totals.skus)} hint={invT('tracked', { n: totals.tracked })} icon={PackagePlus} />
        <StatCard label={invT('statLow')} value={String(totals.lowCount)} hint={invT('outCount', { n: totals.outCount })} icon={TrendingDown} tone={totals.lowCount ? 'warning' : 'default'} />
        <StatCard label={invT('statNegative')} value={String(totals.negativeCount)} hint={totals.negativeCount ? invT('soldMore') : invT('allValid')} icon={AlertTriangle} tone={totals.negativeCount ? 'loss' : 'default'} />
      </div>

      <div className={surface.card}>
        <div className={styles.settingsBar}>
          <label className="inline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className={controls.label}>{invT('costing')}</span>
            <select
              className={cn(controls.select, styles.methodSelect)} value={settings.method}
              onChange={(e) => updateSettings({ ...settings, method: e.target.value as CostingMethod })}
              aria-label={invT('costingMethod')} disabled={!canSettings}
            >
              <option value="WEIGHTED_AVG">{invT('weightedAvg')}</option>
              <option value="FIFO">FIFO</option>
            </select>
          </label>
          <label className={controls.check}>
            <input type="checkbox" checked={settings.includeChallans} disabled={!canSettings} onChange={(e) => updateSettings({ ...settings, includeChallans: e.target.checked })} />
            {invT('challans')}
          </label>
          {showBatches && (
            <label className="inline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className={controls.label}>{invT('expiryAlert')}</span>
              <input
                type="number" min={1} max={3650} className={cn(controls.input, controls.inputNumeric)} style={{ width: '5.5rem' }}
                value={expiryDays} aria-label={invT('expiryAlertAria')} disabled={!canSettings}
                onChange={(e) => updateSettings({ ...settings, expiryAlertDays: Math.min(3650, Math.max(1, Math.round(Number(e.target.value) || DEFAULT_EXPIRY_ALERT_DAYS))) })}
              />
            </label>
          )}
          {multi && (
            <label className="inline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className={controls.label}>{invT('defaultGodown')}</span>
              <select
                className={cn(controls.select, styles.methodSelect)} value={godowns.some((g) => g.id === settings.defaultGodown) ? settings.defaultGodown : MAIN_GODOWN_ID}
                aria-label={invT('defaultGodownAria')} disabled={!canSettings}
                onChange={(e) => updateSettings({ ...settings, defaultGodown: e.target.value === MAIN_GODOWN_ID ? undefined : e.target.value })}
              >
                {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setGodownsOpen(true)}>
            <Warehouse size={14} aria-hidden="true" /> {invT('godowns')}{multi ? ` (${godowns.length})` : ''}
          </button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setMastersOpen('groups')}>
            <FolderTree size={14} aria-hidden="true" /> {imT('groupsBtn')}
          </button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setMastersOpen('units')}>
            <Ruler size={14} aria-hidden="true" /> {imT('unitsBtn')}
          </button>
          <Link to="/distribution" className={cn(controls.btnOutline, controls.btnSm)}>{skT('distLink')}</Link>
          {catalogueMissing.length > 0 && (
            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={importCatalogue}>
              <ArrowDownToLine size={14} /> {invT('importFromCatalogueN', { n: catalogueMissing.length })}
            </button>
          )}
        </div>

        <div className={styles.toolbar}>
          <div className={`${controls.segment} ${styles.touchSeg}`} role="tablist" aria-label={invT('reports')}>
            {tabs.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={activeTab === k} className={activeTab === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </div>
          {activeTab === 'summary' && (
            <>
              <div className={styles.search}>
                <Search size={16} className={styles.searchIcon} aria-hidden />
                <input
                  type="search" className={cn(controls.input, styles.searchInput)} placeholder={invT('searchPh')}
                  value={query} onChange={(e) => setQuery(e.target.value)} aria-label={invT('searchAria')}
                />
              </div>
              <select className={cn(controls.select, styles.methodSelect)} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label={invT('filterStatus')}>
                <option value="all">{invT('allItems')}</option>
                <option value="low">{invT('st.low')}</option>
                <option value="out">{invT('st.out')}</option>
                <option value="negative">{invT('st.negative')}</option>
                <option value="untracked">{invT('st.untracked')}</option>
              </select>
              {groupList.length > 0 && (
                <select className={cn(controls.select, styles.methodSelect)} value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label={imT('groupFilter')}>
                  <option value="">{imT('allGroups')}</option>
                  {treeRows(groupList).map((r) => <option key={r.node.id} value={r.node.id}>{r.path}</option>)}
                  <option value="-">{imT('primary')}</option>
                </select>
              )}
              {categoryList.length > 0 && (
                <select className={cn(controls.select, styles.methodSelect)} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label={imT('categoryFilter')}>
                  <option value="">{imT('allCategories')}</option>
                  {treeRows(categoryList).map((r) => <option key={r.node.id} value={r.node.id}>{r.path}</option>)}
                  <option value="-">{imT('notCategorised')}</option>
                </select>
              )}
            </>
          )}
          {(activeTab === 'movement' || activeTab === 'analysis') && (
            <div className={styles.dateRange}>
              <div className={controls.field}><label className={controls.label} htmlFor="inv-from">{invT('from')}</label><input id="inv-from" type="date" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
              <div className={controls.field}><label className={controls.label} htmlFor="inv-to">{invT('to')}</label><input id="inv-to" type="date" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
          )}
          {activeTab === 'dead' && (
            <label className={controls.field} style={{ maxWidth: 180 }}>
              <span className={controls.label}>{invT('noMovementDays')}</span>
              <input type="number" min={1} className={cn(controls.input, controls.inputNumeric)} value={deadDays} onChange={(e) => setDeadDays(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          )}
        </div>

        {expiring.length > 0 && activeTab === 'summary' && (
          <div className={styles.warnings} role="alert">
            <strong><AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> {invT('expiry')}</strong>
            <span>
              {invT('expiryWarn', { expired: expiring.filter((r) => r.daysLeft < 0).length, soon: expiring.filter((r) => r.daysLeft >= 0).length, days: expiryDays })}{' '}
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setTab('batches')}>{invT('reviewBatches')}</button>
            </span>
          </div>
        )}

        {negatives.length > 0 && activeTab === 'summary' && (
          <div className={styles.warnings} role="alert">
            <strong><AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> {invT('statNegative')}</strong>
            <span>
              {invT('negWarn', { list: negatives.map((p) => `${p.item.name} (${p.qty} ${p.item.unit})`).join(', ') })}
            </span>
          </div>
        )}

        {activeTab === 'shortbook' || INVENTORY_PACK_TABS.some((t) => t.id === activeTab) ? (
          <Suspense fallback={null}>
            {activeTab === 'shortbook' && <ShortBookTab onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'pharmacy' && <PharmacyDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'apparel' && <ApparelDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'devices' && <DevicesDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'jewellery' && <JewelleryDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {/* R12: agri desks */}
            {activeTab === 'farm' && <FarmDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'dairy' && <DairyDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'mill' && <MillDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'cold' && <ColdDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'inputs' && <InputsDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
            {activeTab === 'members' && <MembersDesk view={searchParams.get('view') ?? undefined} onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
          </Suspense>
        ) : !hasItems ? (
          <EmptyState
            icon={Boxes}
            title={invT('emptyTitle')}
            text={invT('emptyText')}
            action={
              <div className={surface.pageActions} style={{ justifyContent: 'center' }}>
                <button type="button" className={controls.btnPrimary} onClick={() => setEditing({ item: blankStockItem(), isNew: true })}><Plus size={16} /> {invT('addFirst')}</button>
                {catalogueMissing.length > 0 && (
                  <button type="button" className={controls.btnOutline} onClick={importCatalogue}><ArrowDownToLine size={16} /> {invT('importFromCatalogue')}</button>
                )}
                {/* R6-B3: items can also come from a CSV / XLSX file (Settings → Data → Import). */}
                <Link to="/settings?tab=data" className={controls.btnOutline} data-inv-import>{discoverT('invImport')}</Link>
                <LearnMore topic="inventory" />
              </div>
            }
          />
        ) : (
          <div className={surface.tableWrap}>
            {activeTab === 'summary' && <Suspense fallback={null}><RelabelQueue version={version} /><MrpBasisTool onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} /></Suspense>}
            {activeTab === 'summary' && (
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>{invT('thItem')}</th><th className={surface.numeric}>{invT('thQty')}</th><th className={surface.numeric}>{invT('thAvgCost')}</th>
                    <th className={surface.numeric}>{invT('thValue')}</th><th className={surface.numeric}>{invT('thReorder')}</th><th>{invT('thStatus')}</th>
                    <th><span className={surface.srOnly}>{invT('thActions')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={7} className={styles.itemMeta}>{invT('noItemsMatch')}</td></tr>}
                  {filtered.map((p) => (
                    <tr key={p.item.id}>
                      <td>{nameCell(p)}</td>
                      <td className={cn(surface.numeric, p.isNegative && styles.negative)}>
                        {p.item.track_stock ? `${p.qty} ${p.item.unit}` : '—'}
                        {p.item.track_stock && p.item.alt_units?.length ? <span className={styles.itemMeta} style={{ display: 'block' }}>{compoundText(p.qty, p.item)}</span> : null}
                      </td>
                      <td className={surface.numeric}>{p.item.track_stock ? formatMoney(p.avgCost) : '—'}</td>
                      <td className={cn(surface.numeric, p.value < 0 && styles.negative)}>{p.item.track_stock ? formatMoney(p.value) : '—'}</td>
                      <td className={surface.numeric}>{p.item.track_stock && p.item.reorder_level ? p.item.reorder_level : '—'}</td>
                      <td><StockChip status={p.status} /></td>
                      <td>
                        <span className={surface.rowActions}>
                          <button type="button" className={controls.btnIcon} title={invT('ledger')} aria-label={invT('ledgerFor', { name: p.item.name })} onClick={() => setLedgerId(p.item.id)}><BookOpen size={16} /></button>
                          {p.item.track_stock && <button type="button" className={controls.btnIcon} title={invT('adjust')} aria-label={invT('adjustNamed', { name: p.item.name })} onClick={() => setAdjustId(p.item.id)}><SlidersHorizontal size={16} /></button>}
                          <button type="button" className={controls.btnIcon} title={invT('editItem')} aria-label={invT('editNamed', { name: p.item.name })} onClick={() => setEditing({ item: p.item, isNew: false })}><Edit3 size={16} /></button>
                          <button type="button" className={controls.btnDanger} title={invT('deleteItem')} aria-label={invT('deleteNamed', { name: p.item.name })} onClick={() => setDeleting(p.item)}><Trash2 size={16} /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeTab === 'movement' && (
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>{invT('thItem')}</th><th className={surface.numeric}>{invT('thOpening')}</th><th className={surface.numeric}>{invT('thIn')}</th>
                    <th className={surface.numeric}>{invT('thOut')}</th><th className={surface.numeric}>{invT('thClosing')}</th><th className={surface.numeric}>{invT('thClosingValue')}</th>
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
                  {movement.length === 0 && <tr><td colSpan={6} className={styles.itemMeta}>{invT('noTracked')}</td></tr>}
                </tbody>
              </table>
            )}

            {activeTab === 'dead' && (
              <table className={surface.table}>
                <thead>
                  <tr><th>{invT('thItem')}</th><th className={surface.numeric}>{invT('thQty')}</th><th className={surface.numeric}>{invT('thValueLocked')}</th><th>{invT('thLastMovement')}</th><th className={surface.numeric}>{invT('thDaysIdle')}</th></tr>
                </thead>
                <tbody>
                  {dead.map((d) => (
                    <tr key={d.position.item.id}>
                      <td>{nameCell(d.position)}</td>
                      <td className={surface.numeric}>{d.position.qty} {d.position.item.unit}</td>
                      <td className={surface.numeric}>{formatMoney(d.position.value)}</td>
                      <td>{d.lastMovement ? formatDate(d.lastMovement) : invT('never')}</td>
                      <td className={surface.numeric}>{d.daysIdle}</td>
                    </tr>
                  ))}
                  {dead.length === 0 && <tr><td colSpan={5} className={styles.itemMeta}>{invT('nothingIdle', { n: deadDays })}</td></tr>}
                </tbody>
              </table>
            )}

            {activeTab === 'batches' && (
              <BatchesTab tracking={tracking} today={today} days={expiryDays} godowns={godowns} onDownload={download} />
            )}
            {activeTab === 'batches' && <Suspense fallback={null}><MrpBasisTool onDone={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} /></Suspense>}

            {activeTab === 'godowns' && (
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th>{invT('thItem')}</th>
                    {godowns.map((g) => <th key={g.id} className={surface.numeric}>{g.name}{parentGodowns.has(g.id) ? ` ${imT('inclSub')}` : ''}</th>)}
                    <th className={surface.numeric}>{invT('thTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {godownRows.map((r) => ({ ...r, byGodown: parentGodowns.size ? rollUpGodowns(r.byGodown, godowns) : r.byGodown })).map((r) => (
                    <tr key={r.item.id}>
                      <td>{r.item.name}</td>
                      {godowns.map((g) => (
                        <td key={g.id} className={cn(surface.numeric, (r.byGodown[g.id] ?? 0) < 0 && styles.negative)}>{r.byGodown[g.id] ?? 0}</td>
                      ))}
                      <td className={surface.numeric}><strong>{r.total} {r.item.unit}</strong></td>
                    </tr>
                  ))}
                  {godownRows.length === 0 && <tr><td colSpan={godowns.length + 2} className={styles.itemMeta}>{invT('noTracked')}</td></tr>}
                </tbody>
              </table>
            )}

            {activeTab === 'transfers' && (
              <TransfersTab
                transfers={transfers}
                godowns={godowns}
                items={positions.map((p) => p.item)}
                inputs={trackInputs}
                onChanged={(m) => { refresh(); notify(m); }}
                onError={(m) => notify(m, 'error')}
              />
            )}

            {(activeTab === 'query' || activeTab === 'orders') && (
              <Suspense fallback={null}>
                {activeTab === 'query' && <StockQueryTab items={positions.map((p) => p.item)} version={version} today={today} initialId={searchParams.get('item') ?? undefined} />}
                {activeTab === 'orders' && <OrdersOutstandingTab version={version} today={today} />}
              </Suspense>
            )}

            {activeTab === 'hsn' && <Suspense fallback={null}><HsnStockTab today={today} /></Suspense>}

            {(activeTab === 'analysis' || activeTab === 'depth' || activeTab === 'expiry') && (
              <Suspense fallback={null}>
                {activeTab === 'analysis' && <StockAnalysisTab positions={positions} from={from} to={to} />}
                {activeTab === 'depth' && <DepthTab items={positions.map((p) => p.item)} tracking={tracking} onChanged={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
                {activeTab === 'expiry' && <ExpiryOpsTab items={positions.map((p) => p.item)} positions={positions} tracking={tracking} today={today} onChanged={(m, bad) => { refresh(); notify(m, bad ? 'error' : undefined); }} />}
              </Suspense>
            )}

            {activeTab === 'serials' && (
              <SerialLookup tracking={tracking} today={today} godowns={godowns} initialQuery={searchParams.get('serial') ?? ''} />
            )}

            {activeTab === 'margin' && (
              <table className={surface.table}>
                <thead>
                  <tr><th>{invT('thItem')}</th><th className={surface.numeric}>{invT('thSold')}</th><th className={surface.numeric}>{invT('thAvgSale')}</th><th className={surface.numeric}>{invT('thAvgCost')}</th><th className={surface.numeric}>{invT('thMarginUnit')}</th><th className={surface.numeric}>{invT('thMarginPct')}</th><th className={surface.numeric}>{invT('thTotalMargin')}</th></tr>
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
                  {margins.length === 0 && <tr><td colSpan={7} className={styles.itemMeta}>{invT('noTracked')}</td></tr>}
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
          guard(() => stockDb.saveItem(item), editing?.isNew ? invT('itemAdded') : invT('itemUpdated'));
          setEditing(null);
        }}
      />
      <AdjustModal
        open={!!adjustPos}
        position={adjustPos}
        tracking={adjustPos ? tracking.get(adjustPos.item.id) : undefined}
        godowns={godowns}
        defaultGodown={settings.defaultGodown}
        onClose={() => setAdjustId(null)}
        onSave={(move: StockMove) => {
          guard(() => stockDb.addMove(move), invT('stockAdjusted'));
          setAdjustId(null);
        }}
      />
      <LedgerModal
        open={!!ledgerPos}
        position={ledgerPos}
        onClose={() => setLedgerId(null)}
        onDeleteMove={(id) => guard(() => stockDb.deleteMove(id), invT('adjRemoved'))}
        onDownload={download}
      />
      <GodownsModal
        open={godownsOpen}
        godowns={godowns}
        tracking={tracking}
        transfersUse={transfersUse}
        onClose={() => setGodownsOpen(false)}
        onChanged={(m) => { refresh(); notify(m); }}
      />
      {mastersOpen && (
        <Suspense fallback={null}>
          {mastersOpen === 'groups' && <StockGroupsModal open items={positions.map((p) => p.item)} onClose={() => setMastersOpen('')} onChanged={(m) => { refresh(); notify(m); }} />}
          {mastersOpen === 'units' && <UnitsModal open items={positions.map((p) => p.item)} onClose={() => setMastersOpen('')} onChanged={(m) => { refresh(); notify(m); }} />}
        </Suspense>
      )}
      <ConfirmDialog
        open={!!deleting}
        destructive
        title={invT('deleteTitle')}
        message={invT('deleteMessage', { name: deleting?.name ?? '' })}
        confirmLabel={invT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && guard(() => stockDb.deleteItem(deleting.id), invT('itemDeleted'))}
      />
      {toastNode}
      <Suspense fallback={null}><UndoDeleted /></Suspense>
    </div>
  );
}
