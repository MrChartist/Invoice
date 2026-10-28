/**
 * R18-A2 writes of `society_units` (`master.edit`, audited, synced, recycle bin on delete) and the member link on
 * clients (`Client.hs`). One `withTablesRollback` over both tables, so a unit and its members never disagree. The unit
 * import's confirm step creates the owners it could not match, then the units, and logs one `import_runs` row (kind
 * `society_units`). Pure rules live in `hs-units.ts` / `hs-units-import.ts`.
 */
import './hs-registry';
import { KEYS, generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import type { Client } from '../../types/invoice';
import type { SocietyUnit } from '../../types/society-r18';
import { HS_IMPORT_KIND, HS_TABLES } from './hs-shared';
import { cleanUnit, memberLinks, validateUnit } from './hs-units';
import type { UnitImport } from './hs-units-import';

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

/** Delete a unit (`master.edit`): the row goes to the recycle bin (watched table); its members are unlinked. */
export function deleteUnit(id: string): void {
  requireAccess('master.edit');
  const next = loadUnits().filter((u) => u.id !== id);
  withTablesRollback([HS_TABLES.units, KEYS.clients], () => {
    setTable(HS_TABLES.units, next);
    relink(next);
  });
}

/**
 * The import's confirm step (`master.edit`): owners not matched are created as clients (`createOwners`; without it those
 * units are saved with no owner), then every unit; one `import_runs` row. Returns the counts.
 */
export function applyUnitImport(imp: UnitImport, opts: { createOwners: boolean; fileName?: string }): { created: number; owners: number; skipped: number } {
  requireAccess('master.edit');
  return withTablesRollback([HS_TABLES.units, KEYS.clients, 'import_runs'], () => {
    const clients = localDb.clients.getAll();
    const made: Client[] = [];
    const byName = new Map<string, string>();
    const units: SocietyUnit[] = loadUnits();
    const now = new Date().toISOString();
    const tenantId = (name?: string) => (name ? clients.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())?.id : undefined);
    for (const r of imp.rows) {
      let owner = r.owner_id;
      if (!owner && r.newOwner && opts.createOwners) {
        const k = `${r.newOwner.name.trim().toLowerCase()}|${r.newOwner.phone ?? ''}`;
        owner = byName.get(k);
        if (!owner) {
          owner = generateId();
          made.push({ id: owner, name: r.newOwner.name.trim(), email: r.newOwner.email ?? '', phone: r.newOwner.phone, address: '', city: '', zip: '', created_at: now } as Client);
          byName.set(k, owner);
        }
      }
      units.push(cleanUnit({ ...r.unit, id: generateId(), updated_at: now, ...(owner ? { owner_id: owner } : {}), ...(tenantId(r.tenantName) ? { tenant_id: tenantId(r.tenantName) } : {}) } as SocietyUnit, now));
    }
    if (made.length) setTable(KEYS.clients, [...clients, ...made]);
    setTable(HS_TABLES.units, units);
    relink(units);
    const skipped = imp.skipped.length + (opts.createOwners ? 0 : imp.unmatched.length);
    setTable('import_runs', [...getTable('import_runs'), { id: generateId(), at: now, kind: HS_IMPORT_KIND, ...(opts.fileName ? { file_name: opts.fileName.slice(0, 200) } : {}), created: imp.rows.length, updated: 0, skipped, errors: 0 }]);
    return { created: imp.rows.length, owners: made.length, skipped };
  });
}

/** Add a member (client) from the unit form: name, phone, e-mail (`master.edit` through the clients table). */
export function addMember(name: string, phone?: string, email?: string): string {
  requireAccess('master.edit');
  if (!name.trim()) throw new Error('A member needs a name.');
  return localDb.clients.upsert({ name: name.trim(), email: email?.trim() ?? '', address: '', city: '', zip: '', ...(phone?.trim() ? { phone: phone.trim() } : {}) });
}
