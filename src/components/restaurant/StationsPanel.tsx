import { useState } from 'react';
import type { RestaurantSettings } from '../../types/restaurant';
import { KITCHEN } from '../../lib/restaurant/tables';
import { useT } from '../../i18n';
import { rT } from '../../i18n/areas/restaurant';
import controls from '../../styles/controls.module.css';
import styles from './restaurant.module.css';

export interface StationsPanelProps {
  settings: RestaurantSettings;
  groups: readonly { id: string; name: string; parent_id?: string }[];
  onSave: (s: RestaurantSettings) => void;
}

/** Settings → Tables → Stations: stock group → kitchen station (R3-A2). */
export function StationsPanel({ settings, groups, onSave }: StationsPanelProps) {
  useT();
  const [names, setNames] = useState((settings.station_names ?? [KITCHEN]).join(', '));
  const [map, setMap] = useState<Record<string, string>>(settings.stations ?? {});
  const list = [...new Set([KITCHEN, ...names.split(',').map((s) => s.trim()).filter(Boolean)])];
  return (
    <div className={styles.settingsGrid}>
      <p className={controls.hint}>{rT('stationsHelp')}</p>
      <label className={controls.field}>
        <span className={controls.label}>{rT('stationNames')}</span>
        <input className={controls.input} value={names} onChange={(e) => setNames(e.target.value)} />
      </label>
      {!groups.length && <p className={styles.muted}>{rT('noGroups')}</p>}
      {groups.map((g) => (
        <label key={g.id} className={styles.partRow}>
          <span>{rT('groupStation', { group: g.name })}</span>
          <select className={controls.select} value={map[g.id] ?? KITCHEN} onChange={(e) => setMap((m) => ({ ...m, [g.id]: e.target.value }))}>
            {list.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      ))}
      <div>
        <button type="button" className={controls.btnPrimary} onClick={() => onSave({ ...settings, station_names: list, stations: Object.fromEntries(Object.entries(map).filter(([, s]) => s && s !== KITCHEN)) })}>
          {rT('save')}
        </button>
      </div>
    </div>
  );
}
