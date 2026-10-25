import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Download, IndianRupee, Landmark, Receipt, Store, TrendingUp, Wallet } from 'lucide-react';
import { useCan } from '../../hooks/useCan';
import { useToast } from '../ui/useToast';
import { enabledModules } from '../../lib/shop-mode';
import { isTileVisible } from '../../lib/shop-presets';
import { ALL_TILES, computeTiles, forBranch, loadTilePrefs, saveTilePrefs, type TileId } from '../../lib/dashboard-tiles';
import { loadBooksData } from '../../lib/books';
import { loadPositions } from '../../lib/inventory';
import { UNASSIGNED, branchesDb } from '../../lib/branch';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { reachT } from '../../i18n/areas/reach';
import { downloadText } from '../../lib/download';
import type { CreditLink } from '../../lib/stats';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { tilesT } from '../../i18n/areas/extras';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import own from './tiles.module.css';

const ApprovalsPanel = lazy(() => import('../approvals/ApprovalsPanel').then((m) => ({ default: m.ApprovalsPanel })));
const BranchesPanel = lazy(() => import('../branches/BranchesPanel').then((m) => ({ default: m.BranchesPanel })));
const AmcPanel = lazy(() => import('../amc/AmcPanel').then((m) => ({ default: m.AmcPanel })));
const LoyaltyPanel = lazy(() => import('../loyalty/LoyaltyPanel').then((m) => ({ default: m.LoyaltyPanel })));
// 7U business extras (each its own chunk, only when the tile is on).
const AgentsPanel = lazy(() => import('../extras7u/AgentsPanel').then((m) => ({ default: m.AgentsPanel })));
const OffersPanel = lazy(() => import('../extras7u/OffersPanel').then((m) => ({ default: m.OffersPanel })));
// 8G: Today card + offline insights (own chunks).
const TodayPanel = lazy(() => import('../invoicing-ux/TodayPanel'));
const InsightsPanel = lazy(() => import('../invoicing-ux/InsightsPanel'));
const PharmaPanel = lazy(() => import('../extras7u/PharmaPanel').then((m) => ({ default: m.PharmaPanel })));

const TILE_LABEL: Record<Exclude<TileId, 'today' | 'insights'>, Parameters<typeof tilesT>[0]> = {
  receivables: 'receivables',
  payables: 'payables',
  cashBank: 'cashBank',
  gstDue: 'gstDue',
  topItems: 'topItems',
  lowStock: 'lowStock',
  branches: 'branches',
  approvals: 'approvals',
  amcDue: 'amcDue',
  loyalty: 'loyalty',
  agents: 'agents',
  offers: 'offers',
  pharma: 'pharma',
};
const tileLabel = (t: TileId) => (t === 'today' ? uxT('tdTitle') : t === 'insights' ? uxT('inTitle') : tilesT(TILE_LABEL[t]));

/**
 * Configurable dashboard tiles (WP-9, P1-17). Mounted lazily below the dashboard's own content,
 * so first paint is unchanged; the figures are computed here, after the chunk loads.
 */
export function DashboardTiles() {
  useT();
  const { can, actor } = useCan();
  const { notify, toastNode } = useToast();
  const userId = actor?.id ?? 'default';
  const [tiles, setTiles] = useState<TileId[]>(() => loadTilePrefs(userId));
  const [branch, setBranch] = useState('');
  const [tick, setTick] = useState(0);
  const branches = useMemo(() => branchesDb.all(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useMemo(() => {
    const showStock = tiles.includes('lowStock');
    let stock: { name: string; qty: number; unit: string; reorder: number; isLow: boolean; tracked?: boolean }[] = [];
    if (showStock || tiles.includes('insights')) {
      try {
        stock = loadPositions().map((p) => ({ name: p.item.name, qty: p.qty, unit: p.item.unit || '', reorder: Number(p.item.reorder_level) || 0, isLow: p.isLow, tracked: !!p.item.track_stock }));
      } catch {
        stock = [];
      }
    }
    return { books: loadBooksData(), links: getTable<CreditLink>('doc_links'), branches, stock };
  }, [tiles, branches]);
  const v = useMemo(() => computeTiles(forBranch(data, branch)), [data, branch]);
  // Shop mode (8H): tiles of modules this company does not use are hidden (and left out of the picker).
  const modules = useMemo(() => enabledModules(localDb.settings.get()), []);
  const on = (t: TileId) => tiles.includes(t) && isTileVisible(t, modules);

  const toggle = (t: TileId) => {
    const next = on(t) ? tiles.filter((x) => x !== t) : [...tiles, t];
    setTiles(next);
    try {
      saveTilePrefs(next, userId);
    } catch {
      /* a viewer's preference just is not remembered */
    }
  };

  // Catalogue v2 (8H): photos, categories, MRP badges and a one-message WhatsApp cart (or script-free).
  const exportCatalogue = async (cart: boolean) => {
    const stock = new Map<string, number>();
    try {
      for (const s of loadPositions()) if (s.item.track_stock) stock.set(s.item.name.trim().toLowerCase(), s.qty);
    } catch {
      /* no stock */
    }
    try {
      const { exportCatalogueHtml } = await import('../../lib/catalogue-export');
      downloadText('catalogue.html', await exportCatalogueHtml({ cart, stock }), 'text/html');
      notify(tilesT('catalogueDone'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const money = (n: number) => formatCurrency(n);
  const stat = (id: TileId, icon: ReactNode, value: string, hint: string, to?: string) => (
    <div className={surface.stat} data-tile={id} key={id}>
      <div className={surface.statTop}>
        <span className={surface.statLabel}>{tileLabel(id)}</span>
        <span className={surface.statIcon}>{icon}</span>
      </div>
      <div className={surface.statValue}>{to ? <Link to={to}>{value}</Link> : value}</div>
      <div className={surface.statHint}>{hint}</div>
    </div>
  );

  return (
    <section className={own.wrap} aria-label={tilesT('title')}>
      <div className={own.head}>
        <h2 className={own.title}><Boxes size={16} /> {tilesT('title')}</h2>
        <div className={own.tools}>
          {branches.length > 0 && (
            <select className={controls.select} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label={tilesT('branchFilter')}>
              <option value="">{tilesT('allBranches')}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value={UNASSIGNED}>{tilesT('noBranch')}</option>
            </select>
          )}
          <details className={own.picker}>
            <summary>{tilesT('customise')}</summary>
            <div className={own.pickerBody}>
              {ALL_TILES.filter((t) => isTileVisible(t, modules)).map((t) => (
                <label key={t} className={controls.check}>
                  <input type="checkbox" checked={on(t)} onChange={() => toggle(t)} /> {tileLabel(t)}
                </label>
              ))}
              {can('view') && (
                <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => void exportCatalogue(true)}>
                  <Download size={14} /> {tilesT('catalogue')}
                </button>
              )}
              {can('view') && (
                <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => void exportCatalogue(false)}>
                  <Download size={14} /> {reachT('catPlain')}
                </button>
              )}
            </div>
          </details>
        </div>
      </div>

      <div className={surface.statGrid}>
        {on('receivables') && stat('receivables', <Receipt size={16} />, money(v.receivables.outstanding), tilesT('overdueHint', { amount: money(v.receivables.overdue), n: String(v.receivables.overdueCount) }), '/receivables')}
        {on('payables') && stat('payables', <Wallet size={16} />, money(v.payables.due), tilesT('billsHint', { n: String(v.payables.bills) }), '/expenses')}
        {on('cashBank') && stat('cashBank', <Landmark size={16} />, money(v.cashBank.cash + v.cashBank.bank), tilesT('cashBankHint', { cash: money(v.cashBank.cash), bank: money(v.cashBank.bank) }), '/books')}
        {on('gstDue') && stat('gstDue', <IndianRupee size={16} />, money(v.gstDue.payable + v.gstDue.cess), tilesT('gstHint', { month: v.gstDue.month }), '/gst-reports')}
      </div>

      <div className={own.grid}>
        {on('topItems') && (
          <div className={surface.card} data-tile="topItems">
            <div className={surface.cardHead}><span className={surface.cardHeadIcon}><TrendingUp size={16} /> {tilesT('topItems')}</span></div>
            <div className={surface.cardBody}>
              {v.topItems.length === 0 ? <p className={controls.hint}>{tilesT('noSales')}</p> : (
                <ol className={own.list}>
                  {v.topItems.map((t) => <li key={t.name}><span>{t.name} <small>× {t.qty}</small></span><strong>{money(t.value)}</strong></li>)}
                </ol>
              )}
            </div>
          </div>
        )}
        {on('lowStock') && (
          <div className={surface.card} data-tile="lowStock">
            <div className={surface.cardHead}><span className={surface.cardHeadIcon}><Boxes size={16} /> {tilesT('lowStock')}</span></div>
            <div className={surface.cardBody}>
              {v.lowStock.length === 0 ? <p className={controls.hint}>{tilesT('stockOk')}</p> : (
                <ul className={own.list}>
                  {v.lowStock.map((s) => <li key={s.name}><Link to="/inventory">{s.name}</Link><strong>{tilesT('stockLine', { qty: String(s.qty), unit: s.unit, reorder: String(s.reorder) })}</strong></li>)}
                </ul>
              )}
            </div>
          </div>
        )}
        <Suspense fallback={null}>
          {on('today') && <TodayPanel books={data.books} />}
          {on('insights') && <InsightsPanel books={data.books} stock={data.stock.filter((x) => x.tracked)} />}
          {on('branches') && (
            <div data-tile="branches">
              <BranchesPanel rows={v.branches} canEdit={can('master.edit')} onChanged={() => setTick((t) => t + 1)} notify={notify} icon={<Store size={16} />} />
            </div>
          )}
          {on('approvals') && <div data-tile="approvals"><ApprovalsPanel notify={notify} /></div>}
          {on('amcDue') && <div data-tile="amcDue"><AmcPanel notify={notify} icon={<Boxes size={16} />} /></div>}
          {on('loyalty') && <div data-tile="loyalty"><LoyaltyPanel notify={notify} /></div>}
          {on('agents') && <div data-tile="agents"><AgentsPanel notify={notify} icon={<TrendingUp size={16} />} /></div>}
          {on('offers') && <div data-tile="offers"><OffersPanel notify={notify} icon={<Receipt size={16} />} /></div>}
          {on('pharma') && <div data-tile="pharma"><PharmaPanel notify={notify} icon={<Boxes size={16} />} /></div>}
        </Suspense>
      </div>
      <p className={controls.hint}>{tilesT('footnote')}</p>
      {toastNode}
    </section>
  );
}
