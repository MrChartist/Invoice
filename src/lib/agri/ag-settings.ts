/**
 * Round 12: the company object `mrchartist_inv_agri_settings` (owner only, `settings.manage`, audited on save, synced as
 * a singleton, backed up). Absent = nothing set. Minimum compatible version written by AG-D before AG-A landed (read /
 * merge-save only); AG-A owns this file and its switches.
 */
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { AgriSettings } from '../../types/agri-r12';
import { AG_OBJECTS } from './ag-shared';

export const AGRI_SETTINGS_KEY = `${DB_PREFIX}${AG_OBJECTS.agriSettings}`;

export function readAgriSettings(): AgriSettings {
  try {
    const raw = getJson<AgriSettings | null>(AGRI_SETTINGS_KEY, null);
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function saveAgriSettings(patch: Partial<AgriSettings>): AgriSettings {
  requireAccess('settings.manage');
  const next = { ...readAgriSettings(), ...patch };
  setJson(AGRI_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: AG_OBJECTS.agriSettings, action: 'update', summary: `Agriculture settings: ${Object.keys(patch).join(', ')}` });
  } catch {
    /* logging never blocks */
  }
  return next;
}
