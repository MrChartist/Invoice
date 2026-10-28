/**
 * R18-A2 writes of `society_units` (`master.edit`, audited, synced; a row removed by `setTable` goes to the recycle bin) and the member link on
 * clients (`Client.hs`). One `withTablesRollback` over both tables, so a unit and its members never disagree. Pure rules
 * live in `hs-units.ts`. `applyUnitsImport` writes a CSV / XLSX import plan (`hs-units-import.ts`) all or nothing, with
 * one `import_runs` row of kind `society_units`.
 */
import './hs-registry';
import { KEYS, generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import type { SocietyUnit } from '../../types/society-r18';
import { HS_TABLES } from './hs-shared';
import { cleanUnit, memberLinks, unitDeleteBlock, validateUnit } from './hs-units';
import { planUnitsImport, type UnitColumns, type UnitTable } from './hs-units-import';

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

/**
 * Delete a unit (`master.edit`; PENDING #4): refused while a bill / run names it or a member is linked
 * (`unitDeleteBlock`). The row leaves through `setTable` on the watched table, so the recycle bin keeps a copy (its
 * restore hook refuses while another live unit holds the code).
 */
export function deleteUnit(id: string): void {
  requireAccess('master.edit');
  const all = loadUnits();
  const u = all.find((x) => x.id === id);
  if (!u) return;
  const why = unitDeleteBlock(u, localDb.invoices.getAll(), getTable<{ unit_ids?: string[] }>(HS_TABLES.runs));
  if (why) throw new Error(why);
  setTable(HS_TABLES.units, all.filter((x) => x.id !== id));
}

/** The member (client) of a typed name: the existing client of that name, else a new one (`master.edit`). */
export function addMember(name: string): string {
  requireAccess('master.edit');
  return localDb.clients.upsert({ name: name.trim(), email: '', address: '', city: '', zip: '' });
}

/**
 * Write a unit import (`master.edit`): re-plans against the live data and refuses while any row has an error; creates
 * the new members (one clients write), writes the units, re-links members and records one `import_runs` row (kind
 * `society_units`) — all in one `withTablesRollback`. Returns the counts.
 */
export function applyUnitsImport(t: UnitTable, cols: UnitColumns, fileName = ''): { created: number; updated: number; members: number } {
  requireAccess('master.edit');
  const units = loadUnits();
  const plan = planUnitsImport(t, cols, units, localDb.clients.getAll());
  if (plan.errors) throw new Error(plan.rows.find((r) => r.error)!.error);
  const out = withTablesRollback([HS_TABLES.units, KEYS.clients], () => {
    // Only the new members are written (with the sheet's phone / email); an existing client is never changed here.
    const known = new Map(localDb.clients.getAll().map((c) => [c.name.trim().toLowerCase(), c.id!]));
    const fresh = new Set(plan.newMembers.map((n) => n.trim().toLowerCase()));
    const parties = plan.rows.flatMap((r) => [...(r.owner ? [r.owner] : []), ...(r.tenant ? [{ name: r.tenant }] : [])]).filter((p) => fresh.delete(p.name.trim().toLowerCase()));
    const ids = parties.length ? localDb.clients.upsertMany(parties.map((p) => ({ address: '', city: '', zip: '', email: '', ...p }))) : [];
    const idOf = new Map([...known, ...parties.map((p, i) => [p.name.trim().toLowerCase(), ids[i]] as const)]);
    const byId = new Map(units.map((u) => [u.id, u]));
    for (const r of plan.rows) {
      const id = r.action === 'update' ? r.unit.id : generateId();
      const u = cleanUnit({ ...r.unit, id, ...(r.owner ? { owner_id: idOf.get(r.owner.name.trim().toLowerCase()) } : {}), ...(r.tenant ? { tenant_id: idOf.get(r.tenant.trim().toLowerCase()) } : {}) });
      byId.set(id, u);
    }
    const next = [...byId.values()];
    setTable(HS_TABLES.units, next);
    relink(next);
    return { created: plan.create, updated: plan.update, members: parties.length };
  });
  try { // fail-soft, like `recordImportRun`: the record of a run never undoes the run
    setTable('import_runs', [...getTable('import_runs'), { id: generateId(), at: new Date().toISOString(), kind: 'society_units', ...(fileName ? { file_name: fileName.slice(0, 200) } : {}), created: out.created, updated: out.updated, skipped: 0, errors: 0 }]);
  } catch { /* a clerk without books rights */ }
  return out;
}
