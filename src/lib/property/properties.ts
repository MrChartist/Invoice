/** R5-C5 properties and their units (`properties`, `master.edit`). */
import type { Property, PropertyUnit, UnitUse } from '../../types/institutions-r5';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { LEASES_TABLE, PROPERTIES_TABLE, R5cError, str } from '../institutions/r5c';

export const UNIT_USES: readonly UnitUse[] = ['commercial', 'residential_dwelling', 'other'];

export function normalizeProperty(raw: unknown): Property | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Partial<Property>;
  if (!str(o.id)) return null;
  return {
    ...(o as Property), id: str(o.id), name: str(o.name) || 'Property', address: str(o.address), state: str(o.state),
    ...(str(o.gstin) ? { gstin: str(o.gstin).toUpperCase() } : {}),
    units: (Array.isArray(o.units) ? o.units : []).flatMap((u: Partial<PropertyUnit>) => (str(u?.id) ? [{ id: str(u.id), name: str(u.name) || 'Unit', ...(Number(u.area) > 0 ? { area: Number(u.area) } : {}), use: UNIT_USES.includes(u.use as UnitUse) ? (u.use as UnitUse) : 'commercial' }] : [])),
  };
}

export const loadProperties = (): Property[] => peekTable<unknown>(PROPERTIES_TABLE).flatMap((r) => normalizeProperty(r) ?? []);

export function saveProperty(input: Omit<Property, 'id' | 'units'> & { id?: string; units: (Omit<PropertyUnit, 'id'> & { id?: string })[] }): Property {
  requireAccess('master.edit');
  if (!str(input.name)) throw new R5cError('name');
  const row = normalizeProperty({ ...input, id: input.id || generateId(), units: input.units.filter((u) => str(u.name)).map((u) => ({ ...u, id: u.id || generateId() })) })!;
  const all = getTable<Property>(PROPERTIES_TABLE);
  setTable(PROPERTIES_TABLE, all.some((p) => p.id === row.id) ? all.map((p) => (p.id === row.id ? row : p)) : [...all, row]);
  return row;
}

export function deleteProperty(id: string): void {
  requireAccess('master.edit');
  if (peekTable<{ property_id?: string }>(LEASES_TABLE).some((l) => l.property_id === id)) throw new R5cError('inUse');
  setTable(PROPERTIES_TABLE, getTable<Property>(PROPERTIES_TABLE).filter((p) => p.id !== id));
}
