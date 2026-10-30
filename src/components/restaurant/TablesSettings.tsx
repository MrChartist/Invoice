import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import type { InvoiceItem } from '../../types/invoice';
import type { DiningArea, DiningTable, ModifierGroup, RestaurantSettings } from '../../types/restaurant';
import type { PrinterMode } from '../../lib/escpos';
import { generateId } from '../../lib/storage';
import { priceLevelsDb } from '../../lib/pricing';
import { restaurantDb } from '../../lib/restaurant/orders-store';
import { KITCHEN, STARTER_AREA_NAME } from '../../lib/restaurant/tables';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { rT } from '../../i18n/areas/restaurant';
import controls from '../../styles/controls.module.css';
import styles from './restaurant.module.css';
import { StationsPanel } from './StationsPanel';
import { ModifiersPanel } from './ModifiersPanel';

type Tab = 'areas' | 'stations' | 'modifiers' | 'printers' | 'rules';

export interface TablesSettingsProps {
  catalog: readonly InvoiceItem[];
  stockGroups: readonly { id: string; name: string; parent_id?: string }[];
  onClose: () => void;
  onSaved: () => void;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
}

/** Settings → Tables: areas & tables, stations, modifiers, KOT printers (device), rules (R3-A1 / A2 / A4). */
export function TablesSettings({ catalog, stockGroups, onClose, onSaved, notify }: TablesSettingsProps) {
  useT();
  const [tab, setTab] = useState<Tab>('areas');
  const [areas, setAreas] = useState<DiningArea[]>(restaurantDb.areas);
  const [tables, setTables] = useState<DiningTable[]>(restaurantDb.tables);
  const [settings, setSettings] = useState<RestaurantSettings>(restaurantDb.settings);
  const levels = priceLevelsDb.all();
  const [printers, setPrinters] = useState<Record<string, { mode: PrinterMode; width: 58 | 80; drawer: boolean; baud: number }>>({});
  const [printersLoaded, setPrintersLoaded] = useState(false);

  const guard = (fn: () => void) => {
    try {
      fn();
      notify(rT('saved'));
      onSaved();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const loadPrinters = async () => {
    if (printersLoaded) return;
    const m = await import('../../lib/restaurant/kot-print');
    setPrinters(m.loadKotPrinters());
    setPrintersLoaded(true);
  };
  const savePrinters = async () => {
    const m = await import('../../lib/restaurant/kot-print');
    m.saveKotPrinters(printers);
    notify(rT('saved'));
  };
  const stations = [...new Set([KITCHEN, ...(settings.station_names ?? [])])];

  return (
    <Modal open size="xl" onClose={onClose} title={rT('settings')}>
      <div className={styles.tabs} role="tablist">
        {(['areas', 'stations', 'modifiers', 'printers', 'rules'] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={cn(styles.tab, tab === t && styles.tabOn)} onClick={() => { setTab(t); if (t === 'printers') void loadPrinters(); }}>
            {rT(t === 'areas' ? 'tabAreas' : t === 'stations' ? 'tabStations' : t === 'modifiers' ? 'tabModifiers' : t === 'printers' ? 'tabPrinters' : 'tabRules')}
          </button>
        ))}
      </div>

      {tab === 'areas' && (
        <div className={styles.settingsGrid}>
          <strong>{rT('areas')}</strong>
          {areas.map((a) => (
            <div key={a.id} className={styles.editRow}>
              <label className={controls.field}><span className={controls.label}>{rT('areaName')}</span><input className={controls.input} value={a.name} onChange={(e) => setAreas((r) => r.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)))} /></label>
              <label className={controls.field}>
                <span className={controls.label}>{rT('priceLevel')}</span>
                <select className={controls.select} value={a.price_level_id ?? ''} onChange={(e) => setAreas((r) => r.map((x) => (x.id === a.id ? { ...x, price_level_id: e.target.value || undefined } : x)))}>
                  <option value="">{rT('noLevel')}</option>
                  {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <label className={cn(controls.field, styles.narrow)} title={rT('scHelp')}><span className={controls.label}>{rT('scPct')}</span><NumberInput className={controls.input} value={a.service_charge_pct ?? 0} onChange={(v) => setAreas((r) => r.map((x) => (x.id === a.id ? { ...x, service_charge_pct: v > 0 ? v : undefined } : x)))} /></label>
              <button type="button" className={controls.btnDanger} disabled={areas.length < 2 || tables.some((t) => t.area_id === a.id)} onClick={() => setAreas((r) => r.filter((x) => x.id !== a.id))} aria-label={rT('remove', { name: a.name })}><Trash2 size={14} /></button>
            </div>
          ))}
          <p className={controls.hint}>{rT('scHelp')}</p>
          <div><button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setAreas((r) => [...r, { id: generateId(), name: '', sort: r.length + 1, ...(num0(settings.service_charge_default) ? { service_charge_pct: num0(settings.service_charge_default) } : {}) }])}><Plus size={14} /> {rT('addArea')}</button></div>
          <strong>{rT('tables')}</strong>
          {tables.map((t) => (
            <div key={t.id} className={styles.editRow} data-table-row={t.name}>
              <label className={cn(controls.field, styles.narrow)}><span className={controls.label}>{rT('tableName')}</span><input className={controls.input} value={t.name} onChange={(e) => setTables((r) => r.map((x) => (x.id === t.id ? { ...x, name: e.target.value } : x)))} /></label>
              <label className={cn(controls.field, styles.narrow)}><span className={controls.label}>{rT('seats')}</span><NumberInput className={controls.input} value={t.seats} blankZero={false} onChange={(v) => setTables((r) => r.map((x) => (x.id === t.id ? { ...x, seats: v } : x)))} /></label>
              <label className={controls.field}>
                <span className={controls.label}>{rT('areaName')}</span>
                <select className={controls.select} value={t.area_id} onChange={(e) => setTables((r) => r.map((x) => (x.id === t.id ? { ...x, area_id: e.target.value } : x)))}>
                  {areas.map((a) => <option key={a.id} value={a.id}>{(a.name === STARTER_AREA_NAME ? rT('chDine') : a.name) || '-'}</option>)}
                </select>
              </label>
              <button type="button" className={controls.btnDanger} onClick={() => setTables((r) => r.filter((x) => x.id !== t.id))} aria-label={rT('remove', { name: t.name })}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className={styles.actions}>
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setTables((r) => [...r, { id: generateId(), name: String(r.length + 1), seats: 4, area_id: areas[areas.length - 1]?.id ?? '', sort: r.length + 1 }])}><Plus size={14} /> {rT('addTable')}</button>
            <button type="button" className={controls.btnPrimary} onClick={() => guard(() => { restaurantDb.saveAreas(areas); restaurantDb.saveTables(tables.map((t, i) => ({ ...t, sort: i + 1 }))); })} data-save-tables>{rT('save')}</button>
          </div>
        </div>
      )}

      {tab === 'stations' && <StationsPanel settings={settings} groups={stockGroups} onSave={(s) => guard(() => { restaurantDb.saveSettings(s); setSettings(s); })} />}

      {tab === 'modifiers' && <ModifiersPanel groups={restaurantDb.modifierGroups()} catalog={catalog} stockGroups={stockGroups} onSave={(rows: ModifierGroup[]) => guard(() => restaurantDb.saveModifierGroups(rows))} />}

      {tab === 'printers' && (
        <div className={styles.settingsGrid}>
          <p className={controls.hint}>{rT('printersHelp')}</p>
          {stations.map((s) => {
            const p = printers[s] ?? { mode: 'browser' as PrinterMode, width: 80 as const, drawer: false, baud: 9600 };
            return (
              <div key={s} className={styles.editRow}>
                <strong className={styles.narrow}>{s}</strong>
                <label className={controls.field}>
                  <span className={controls.label}>{rT('pMode')}</span>
                  <select className={controls.select} value={p.mode} onChange={(e) => setPrinters((x) => ({ ...x, [s]: { ...p, mode: e.target.value as PrinterMode } }))}>
                    {(['browser', 'raw', 'serial', 'bluetooth'] as PrinterMode[]).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{rT('pWidth')}</span>
                  <select className={controls.select} value={p.width} onChange={(e) => setPrinters((x) => ({ ...x, [s]: { ...p, width: Number(e.target.value) === 58 ? 58 : 80 } }))}>
                    <option value={80}>80 mm</option>
                    <option value={58}>58 mm</option>
                  </select>
                </label>
              </div>
            );
          })}
          <div><button type="button" className={controls.btnPrimary} onClick={() => void savePrinters()}>{rT('save')}</button></div>
        </div>
      )}

      {tab === 'rules' && (
        <div className={styles.settingsGrid}>
          <label className={controls.field}><span className={controls.label}>{rT('scDefault')}</span><NumberInput className={cn(controls.input, styles.narrow)} value={settings.service_charge_default ?? 0} onChange={(v) => setSettings((s) => ({ ...s, service_charge_default: Math.min(Math.max(v, 0), 100) }))} /></label>
          <p className={controls.hint}>{rT('scHelp')}</p>
          <label className={controls.field}><span className={controls.label}>{rT('capLines')}</span><NumberInput className={cn(controls.input, styles.narrow)} value={settings.cancel_cap?.lines ?? 2} blankZero={false} onChange={(v) => setSettings((s) => ({ ...s, cancel_cap: { lines: Math.max(Math.floor(v), 0), amount: s.cancel_cap?.amount ?? 500 } }))} /></label>
          <label className={controls.field}><span className={controls.label}>{rT('capAmount')}</span><NumberInput className={cn(controls.input, styles.narrow)} value={settings.cancel_cap?.amount ?? 500} blankZero={false} onChange={(v) => setSettings((s) => ({ ...s, cancel_cap: { lines: s.cancel_cap?.lines ?? 2, amount: Math.max(v, 0) } }))} /></label>
          <label className={controls.check}><input type="checkbox" checked={!!settings.auto86} onChange={(e) => setSettings((s) => ({ ...s, auto86: e.target.checked }))} /> {rT('auto86')}</label>
          <p className={controls.hint}>{rT('gstNote')}</p>
          <p className={controls.hint}>{rT('dayCloseNote')}</p>
          <div><button type="button" className={controls.btnPrimary} onClick={() => guard(() => restaurantDb.saveSettings(settings))}>{rT('save')}</button></div>
        </div>
      )}
    </Modal>
  );
}

const num0 = (v: unknown) => (Number(v) > 0 ? Number(v) : 0);
