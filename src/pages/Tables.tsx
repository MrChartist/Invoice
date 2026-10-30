import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardList, ScanBarcode, Settings2 } from 'lucide-react';
import { Page } from '../components/ui/Page';
import { Modal } from '../components/ui/Modal';
import { NumberInput } from '../components/ui/NumberInput';
import { useToast } from '../components/ui/useToast';
import { FloorView } from '../components/restaurant/FloorView';
import { OrderPanel, type MenuItem } from '../components/restaurant/OrderPanel';
import type { DiningTable, OrderChannel, TableOrder } from '../types/restaurant';
import type { InvoiceRecord } from '../types/invoice';
import { localDb } from '../lib/localDb';
import { getTable, subscribeStorageChanges, DB_PREFIX } from '../lib/storage';
import { TABLES as STOCK, loadPositions, type StockItem } from '../lib/inventory';
import { num } from '../lib/invoice-calc';
import { listUsers } from '../lib/auth';
import { counterUser } from '../lib/pos-shifts';
import { checkEcoGstin } from '../lib/eco';
import { isLive, localDay, STARTER_AREA_NAME } from '../lib/restaurant/tables';
import { autoUnavailable, idsInGroup, isUnavailable } from '../lib/restaurant/modifiers';
import { RT, openOrder, ordersDb, restaurantDb, set86Items } from '../lib/restaurant/orders-store';
import { cn } from '../lib/utils';
import { isPackOn } from '../lib/industry-packs'; // R7-A
import { useT } from '../i18n';
import { rT } from '../i18n/areas/restaurant';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/restaurant/restaurant.module.css';
import { SelectField } from '../components/ui/SelectField';

const TablesSettings = lazy(() => import('../components/restaurant/TablesSettings').then((m) => ({ default: m.TablesSettings })));
const KotRegisterModal = lazy(() => import('../components/restaurant/KotRegister').then((m) => ({ default: m.KotRegisterModal })));
// R7-A: hotel front desk (`?tab=frontdesk`) — loaded only for that tab, and then the floor below is not mounted.
const FrontDesk = lazy(() => import('../components/hotel/FrontDesk'));

type View = { kind: 'area'; areaId: string } | { kind: 'channel'; channel: Exclude<OrderChannel, 'dine_in'> };
const CHANNELS: Exclude<OrderChannel, 'dine_in'>[] = ['takeaway', 'delivery', 'aggregator'];
const CH_LABEL = { takeaway: 'chTakeaway', delivery: 'chDelivery', aggregator: 'chAggregator' } as const;

/** Menu: catalogue + stock-only items, each with its stock group (station routing, modifiers, 86). */
function loadMenu() {
  const catalog = localDb.items.getAll();
  const stock = getTable<StockItem>(STOCK.items);
  const groupOf = new Map(stock.map((s) => [s.name.trim().toLowerCase(), s.group_id]));
  const names = new Set(catalog.map((c) => c.name.trim().toLowerCase()));
  const menu: MenuItem[] = [
    ...catalog.map((c) => ({ ...c, group_id: c.group_id ?? groupOf.get(c.name.trim().toLowerCase()) })),
    ...stock.filter((s) => !names.has(s.name.trim().toLowerCase())).map((s) => ({
      id: s.id, name: s.name, type: 'Product', hsn: s.hsn ?? '', unit: s.unit || 'NOS', quantity: 1, rate: num(s.sale_rate),
      ...(typeof s.tax_rate === 'number' ? { tax_rate: s.tax_rate } : {}), amount: 0, group_id: s.group_id,
    })),
  ];
  return {
    catalog,
    menu,
    stock,
    groups: getTable<{ id: string; name: string; parent_id?: string }>('stock_groups'),
    posBills: localDb.invoices.getAll().filter((i) => i.pos) as InvoiceRecord[],
  };
}

/** `/tables`: the restaurant floor, or (R7-A, hotel pack) the front desk for `?tab=frontdesk`. */
export function Tables() {
  const [params] = useSearchParams();
  if (params.get('tab') === 'frontdesk') return <Suspense fallback={null}><FrontDesk /></Suspense>;
  return <RestaurantFloor />;
}

/** Restaurant floor (R3-A): areas and counter channels, running orders, KOT, split and settle. */
function RestaurantFloor() {
  const { t } = useT();
  const hotel = useMemo(() => isPackOn(localDb.settings.get(), 'hotel'), []); // R7-A
  const { notify, toastNode } = useToast();
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [now, setNow] = useState(() => new Date());
  const day = localDay(now);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const areas = useMemo(() => restaurantDb.areas(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tables = useMemo(() => restaurantDb.tables(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const orders = useMemo(() => ordersDb.all(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => loadMenu(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const modifierGroups = useMemo(() => restaurantDb.modifierGroups(), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const settings = useMemo(() => restaurantDb.settings(), [tick]);
  const [view, setView] = useState<View>(() => ({ kind: 'area', areaId: restaurantDb.areas()[0]?.id ?? '' }));
  const [selected, setSelected] = useState<string | null>(null);
  const [opening, setOpening] = useState<{ channel: OrderChannel; table?: DiningTable } | null>(null);
  const [covers, setCovers] = useState(2);
  const [captainId, setCaptainId] = useState(() => counterUser().id);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [ecoName, setEcoName] = useState('');
  const [ecoGstin, setEcoGstin] = useState('');
  const [ecoRef, setEcoRef] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [printTickets, setPrintTickets] = useState(true);
  const users = useMemo(() => {
    const list = listUsers().map((u) => ({ id: u.id, name: u.name }));
    const me = counterUser();
    return list.some((u) => u.id === me.id) ? list : [me, ...list];
  }, []);

  // Other tabs / folder sync: re-read when the orders change elsewhere; a clock for "minutes open".
  useEffect(() => subscribeStorageChanges((key) => { if (key === `${DB_PREFIX}${RT.orders}` || key === `${DB_PREFIX}items_catalog`) refresh(); }), [refresh]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // Auto-86 at zero stock (optional): tracked items with nothing left after what live orders hold.
  const menu = useMemo(() => {
    if (!settings.auto86) return data.menu;
    const positions = loadPositions();
    const live = orders.filter(isLive).flatMap((o) => o.lines);
    return data.menu.map((m) => {
      const pos = positions.find((p) => p.item.track_stock && p.item.name.trim().toLowerCase() === m.name.trim().toLowerCase());
      if (!pos || isUnavailable(m, day)) return m;
      return autoUnavailable(pos.qty, live.filter((l) => l.name === m.name)) ? { ...m, unavailable_on: day } : m;
    });
  }, [data.menu, settings.auto86, orders, day]);

  const whereOf = useCallback(
    (o: TableOrder) => (o.table_id ? rT('tableN', { name: tables.find((t) => t.id === o.table_id)?.name ?? o.table_id.replace(/^tbl_/, '') }) : `${o.channel === 'aggregator' && o.eco_name ? `${o.eco_name} · ` : ''}${rT('tokenN', { n: o.token ?? '' })}`),
    [tables],
  );
  const current = selected ? orders.find((o) => o.id === selected) : undefined;

  const startOpen = (channel: OrderChannel, table?: DiningTable) => {
    setOpening({ channel, table });
    setCovers(channel === 'dine_in' ? 2 : 0);
    setCustName('');
    setCustPhone('');
    setEcoName('');
    setEcoGstin('');
    setEcoRef('');
  };
  const ecoCheck = opening?.channel === 'aggregator' && ecoGstin.trim() ? checkEcoGstin(ecoGstin) : null;
  const doOpen = () => {
    if (!opening) return;
    try {
      const cap = users.find((u) => u.id === captainId) ?? counterUser();
      const o = openOrder({
        channel: opening.channel,
        table_id: opening.table?.id,
        area_id: view.kind === 'area' ? view.areaId : undefined,
        covers,
        captain: cap,
        client: custName.trim() ? { name: custName, phone: custPhone } : undefined,
        eco_gstin: ecoGstin,
        eco_name: ecoName,
        ref: ecoRef,
      });
      setOpening(null);
      setSelected(o.id);
      refresh();
      setTimeout(() => document.getElementById('order-search')?.focus(), 50);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const off86 = data.catalog.filter((c) => isUnavailable(c, day));
  const toggle86 = (ids: string[], off: boolean) => {
    try {
      set86Items(ids, off, day);
      refresh();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const [pick86, setPick86] = useState('');
  const [group86, setGroup86] = useState('');

  return (
    <Page
      title={rT('title')}
      subtitle={rT('subtitle')}
      actions={
        <>
          <Link className={controls.btnOutline} to="/pos"><ScanBarcode size={16} /> {rT('posLink')}</Link>
          <button type="button" className={controls.btnOutline} onClick={() => setRegisterOpen(true)} data-kot-register><ClipboardList size={16} /> {rT('register')}</button>
          <button type="button" className={controls.btnIcon} onClick={() => setSettingsOpen(true)} aria-label={rT('settings')} title={rT('settings')} data-tables-settings><Settings2 size={16} /></button>
        </>
      }
    >

      <div className={styles.tabs} role="tablist" aria-label={rT('title')}>
        {hotel && <Link className={styles.tab} to="/tables?tab=frontdesk" data-front-desk>{t('nav.frontDesk')}</Link>}
        {areas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={view.kind === 'area' && view.areaId === a.id} className={cn(styles.tab, view.kind === 'area' && view.areaId === a.id && styles.tabOn)} onClick={() => setView({ kind: 'area', areaId: a.id })}>
            {a.name === STARTER_AREA_NAME ? rT('chDine') : a.name}
          </button>
        ))}
        {CHANNELS.map((c) => (
          <button key={c} type="button" role="tab" aria-selected={view.kind === 'channel' && view.channel === c} className={cn(styles.tab, view.kind === 'channel' && view.channel === c && styles.tabOn)} onClick={() => setView({ kind: 'channel', channel: c })} data-channel={c}>
            {rT(CH_LABEL[c])} {orders.filter((o) => isLive(o) && o.channel === c).length || ''}
          </button>
        ))}
      </div>

      <div className={styles.layout}>
        <section className={surface.card} aria-label={rT('title')}>
          <div className={surface.cardBody}>
            <FloorView
              view={view}
              tables={tables}
              orders={orders}
              selectedId={selected ?? undefined}
              now={now}
              onTable={(t, o) => (o ? setSelected(o.id) : startOpen('dine_in', t))}
              onOrder={(o) => setSelected(o.id)}
              onNew={(c) => startOpen(c)}
            />
            <details className={styles.panel} style={{ marginTop: 16 }}>
              <summary>{rT('toggle86')}{off86.length ? ` · ${rT('off86', { n: off86.length })}` : ''}</summary>
              <div className={styles.editRow}>
                <label className={controls.field}>
                  <span className={controls.label}>{rT('mark86')}</span>
                  <SelectField className={controls.select} value={pick86} onChange={(e) => setPick86(e.target.value)} data-86-pick>
                    <option value="">-</option>
                    {data.catalog.filter((c) => !isUnavailable(c, day)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </SelectField>
                </label>
                <button type="button" className={controls.btnOutline} disabled={!pick86} onClick={() => { toggle86([pick86], true); setPick86(''); }}>{rT('mark86')}</button>
              </div>
              {data.groups.length > 0 && (
                <div className={styles.editRow}>
                  <label className={controls.field}>
                    <span className={controls.label}>{rT('appliesGroups')}</span>
                    <SelectField className={controls.select} value={group86} onChange={(e) => setGroup86(e.target.value)}>
                      <option value="">-</option>
                      {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </SelectField>
                  </label>
                  <button type="button" className={controls.btnOutline} disabled={!group86} onClick={() => toggle86(idsInGroup(data.catalog, data.stock, group86, data.groups), true)}>{rT('group86')}</button>
                  <button type="button" className={controls.btnGhost} disabled={!group86} onClick={() => toggle86(idsInGroup(data.catalog, data.stock, group86, data.groups), false)}>{rT('group86On')}</button>
                </div>
              )}
              <ul className={styles.kotList}>
                {off86.map((c) => (
                  <li key={c.id}><span className={styles.off}>{c.name}</span><button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => toggle86([c.id], false)}>{rT('clear86')}</button></li>
                ))}
              </ul>
            </details>
            <label className={controls.check} style={{ marginTop: 12 }}>
              <input type="checkbox" checked={printTickets} onChange={(e) => setPrintTickets(e.target.checked)} data-print-tickets /> {rT('printTickets')}
            </label>
          </div>
        </section>

        {current && (
          <OrderPanel
            key={current.id}
            order={current}
            orders={orders}
            tables={tables}
            menu={menu}
            stock={data.stock}
            groups={data.groups}
            modifierGroups={modifierGroups}
            posBills={data.posBills}
            day={day}
            printTickets={printTickets}
            whereOf={whereOf}
            notify={notify}
            onChanged={refresh}
            onClose={() => setSelected(null)}
          />
        )}
      </div>

      {opening && (
        <Modal
          open
          size="sm"
          onClose={() => setOpening(null)}
          title={opening.table ? rT('openTable', { name: opening.table.name }) : `${rT('newOrder')} · ${rT(CH_LABEL[opening.channel as Exclude<OrderChannel, 'dine_in'>] ?? 'chDine')}`}
          footer={
            <>
              <button type="button" className={controls.btnOutline} onClick={() => setOpening(null)}>{rT('cancel')}</button>
              <button type="button" className={controls.btnPrimary} onClick={doOpen} disabled={!!ecoCheck && !ecoCheck.valid} data-open-order>{rT('openOrder')}</button>
            </>
          }
        >
          <div className={styles.settingsGrid}>
            {opening.channel === 'dine_in' && (
              <label className={controls.field}>
                <span className={controls.label}>{rT('covers')}</span>
                <NumberInput id="open-covers" className={cn(controls.input, styles.narrow)} value={covers} blankZero={false} onChange={(v) => setCovers(Math.max(Math.floor(v), 1))} />
              </label>
            )}
            <label className={controls.field}>
              <span className={controls.label}>{rT('captain')}</span>
              <SelectField className={controls.select} value={captainId} onChange={(e) => setCaptainId(e.target.value)}>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </SelectField>
            </label>
            {opening.channel === 'aggregator' ? (
              <>
                <label className={controls.field}><span className={controls.label}>{rT('ecoName')}</span><input className={controls.input} value={ecoName} onChange={(e) => setEcoName(e.target.value)} /></label>
                <label className={controls.field}><span className={controls.label}>{rT('ecoGstin')}</span><input className={cn(controls.input, controls.inputMono)} value={ecoGstin} onChange={(e) => setEcoGstin(e.target.value.toUpperCase())} maxLength={15} /></label>
                {ecoCheck && !ecoCheck.valid && <p className={styles.error}>{rT('ecoGstinBad', { reason: ecoCheck.message ?? '' })}</p>}
                <label className={controls.field}><span className={controls.label}>{rT('ecoRef')}</span><input className={controls.input} value={ecoRef} onChange={(e) => setEcoRef(e.target.value)} /></label>
                <p className={styles.small}>{rT('ecoNote')}</p>
              </>
            ) : (
              <div className={styles.editRow}>
                <label className={controls.field}><span className={controls.label}>{rT('customer')}</span><input className={controls.input} value={custName} onChange={(e) => setCustName(e.target.value)} placeholder={rT('customerName')} /></label>
                <label className={controls.field}><span className={controls.label}>{rT('customerPhone')}</span><input className={controls.input} value={custPhone} inputMode="tel" onChange={(e) => setCustPhone(e.target.value)} /></label>
              </div>
            )}
          </div>
        </Modal>
      )}

      <Suspense fallback={null}>
        {settingsOpen && <TablesSettings catalog={data.catalog} stockGroups={data.groups} onClose={() => setSettingsOpen(false)} onSaved={refresh} notify={notify} />}
        {registerOpen && <KotRegisterModal orders={orders} day={day} whereOf={whereOf} onClose={() => setRegisterOpen(false)} />}
      </Suspense>
      {toastNode}
    </Page>
  );
}

export default Tables;
