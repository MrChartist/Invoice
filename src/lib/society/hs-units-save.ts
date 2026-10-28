/**
 * R18-A2 writes of `society_units` (`master.edit`, audited, synced; a row removed by `setTable` goes to the recycle bin) and the member link on
 * clients (`Client.hs`). One `withTablesRollback` over both tables, so a unit and its members never disagree. Pure rules
 * live in `hs-units.ts`. (The CSV / XLSX unit import was cut at the R18-A cap, PRD §3 cut 3.)
 */
import './hs-registry';
import { KEYS, generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import type { SocietyUnit } from '../../types/society-r18';
import { HS_TABLES } from './hs-shared';
import { cleanUnit, memberLinks, validateUnit } from './hs-units';

export const loadUnits = (): SocietyUnit[] => getTable<SocietyUnit>(HS_TABLES.units).filter((u) => u && typeof u.id === 'string' && typeof u.code === 'string');

/** Re-link members after the units table changed (only the clients whose `hs` changes are written). */
function relink(units: readonly SocietyUnit[]): void {
  const changed = memberLinks(units, localDb.clients.getAll());
  if (!changed.length) return;
  const byId = new Map(changed.map((c) => [c.id, c]));
  setTable(KEYS.clients, localDb.clients.getAll().map((c) => (c.id && byId.has(c.id) ? byId.get(c.id)! : c)));
}

/** Add / edit a unit (`master.edit`). Throws the first validation problem. */
export function saveUnit(input: Omit<SocietyUnit, 'id' | 'updated_at'> & { id?: string }): SocietyUnit {
  requireAccess('master.edit');
  const all = loadUnits();
  const prev = input.id ? all.find((u) => u.id === input.id) : undefined;
  const unit = cleanUnit({ ...(prev ?? {}), ...input, id: prev?.id ?? generateId(), updated_at: '' } as SocietyUnit);
  const err = validateUnit(unit, all);
  if (err) throw new Error(err);
  const next = prev ? all.map((u) => (u.id === unit.id ? unit : u)) : [...all, unit];
  return withTablesRollback([HS_TABLES.units, KEYS.clients], () => {
    setTable(HS_TABLES.units, next);
    relink(next);
    return unit;
  });
}

/** The member (client) of a typed name: the existing client of that name, else a new one (`master.edit`). */
export function addMember(name: string): string {
  requireAccess('master.edit');
  return localDb.clients.upsert({ name: name.trim(), email: '', address: '', city: '', zip: '' });
}
