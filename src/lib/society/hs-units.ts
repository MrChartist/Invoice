/**
 * R18-A2 units and members (pure; family `f-society`): validation, the grid's filters and totals, and the member link
 * on clients (`Client.hs`). A unit's code is the society's own (`A-101`), unique per company. The undivided-interest
 * total is a warning, never a block. Writes live in `hs-units-save.ts` (which imports the registry).
 */
import { round2 } from '../invoice-calc';
import { hsT } from '../../i18n/areas/society-r18a';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { ClientHs, HsOccupancy, HsSlotKind, HsUnitUse, SocietyUnit } from '../../types/society-r18';

export const UNIT_USES: readonly HsUnitUse[] = ['residential', 'commercial', 'garage', 'other'];
export const OCCUPANCIES: readonly HsOccupancy[] = ['owner', 'tenant', 'vacant'];
export const SLOT_KINDS: readonly HsSlotKind[] = ['covered', 'open', 'stilt', 'two_wheeler'];

const NUMS = ['carpet_area', 'super_area', 'undivided_pct', 'construction_cost'] as const;
const key = (c: string) => c.trim().toLowerCase();

/** The first problem with a unit (code missing / taken, a negative or non-number area or cost), else ''. */
export function validateUnit(u: Pick<SocietyUnit, 'id' | 'code' | (typeof NUMS)[number]>, units: readonly Pick<SocietyUnit, 'id' | 'code'>[]): string {
  if (!u.code?.trim()) return hsT('eCode'); // QA21 W8: translated when called
  if (units.some((x) => x.id !== u.id && key(x.code) === key(u.code))) return hsT('eTaken', { c: u.code.trim() });
  for (const f of NUMS) if (u[f] !== undefined && !(Number(u[f]) >= 0)) return hsT('eNum', { f });
  return (u.undivided_pct ?? 0) > 100 ? hsT('eUndiv') : '';
}

const live = (u: SocietyUnit) => u.status !== 'closed' && u.status !== 'merged';

/** Warnings across units (never blocks): undivided interest must total 100 ± 0.01 % once any unit has it. */
export function unitWarnings(units: readonly SocietyUnit[]): string[] {
  const pct = units.filter((u) => live(u) && typeof u.undivided_pct === 'number');
  const sum = round2(pct.reduce((t, u) => t + (u.undivided_pct ?? 0), 0));
  return pct.length && Math.abs(sum - 100) > 0.01 ? [hsT('wUndiv', { s: sum })] : [];
}

/** A clean unit to store: trimmed code, empty optionals dropped, a tenant only on a let unit (use / occupancy come from pickers). */
export function cleanUnit(u: SocietyUnit, now = new Date().toISOString()): SocietyUnit {
  const out = { ...u, code: u.code.trim(), parking: u.parking ?? [], status: u.status ?? 'active', updated_at: now } as Record<string, unknown>;
  if (out.occupancy !== 'tenant') delete out.tenant_id;
  for (const [k, v] of Object.entries(out)) if (v === undefined || v === '' || (Array.isArray(v) && !v.length && k !== 'parking') || (typeof v === 'number' && !(v >= 0))) delete out[k];
  return out as unknown as SocietyUnit;
}

export interface UnitFilter { wing?: string; use?: string; occupancy?: string }

export const filterUnits = (units: readonly SocietyUnit[], f: UnitFilter): SocietyUnit[] =>
  units.filter((u) => (!f.wing || u.wing === f.wing) && (!f.use || u.use === f.use) && (!f.occupancy || u.occupancy === f.occupancy));

/** The grid's totals: carpet area, construction cost and parking slots. */
export const unitTotals = (units: readonly SocietyUnit[]): { carpet: number; cost: number; slots: number } =>
  units.reduce((t, u) => ({ carpet: round2(t.carpet + (u.carpet_area ?? 0)), cost: round2(t.cost + (u.construction_cost ?? 0)), slots: t.slots + (u.parking?.length ?? 0) }), { carpet: 0, cost: 0, slots: 0 });

/** Units in code order ("A-2" before "A-10"). */
export const sortUnits = (units: readonly SocietyUnit[]): SocietyUnit[] => [...units].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

export const wingsOf = (units: readonly SocietyUnit[]): string[] => [...new Set(units.map((u) => u.wing ?? '').filter(Boolean))].sort();

/**
 * The members' `Client.hs` after units change (pure): every client named on a live unit gets that unit (owner / joint /
 * tenant; the owner role wins), and loses the units no longer theirs. Only clients whose `hs` changes are returned; a
 * client with no unit left has `hs` removed. One pass over units and clients (2,000 units stay linear).
 */
export function memberLinks(units: readonly SocietyUnit[], clients: readonly Client[]): Client[] {
  const want = new Map<string, ClientHs>();
  const add = (id: string | undefined, unit: string, role: ClientHs['role']) => {
    if (!id) return;
    const cur = want.get(id) ?? { unit_ids: [], role };
    cur.unit_ids.push(unit);
    if (role === 'owner' || (role === 'joint' && cur.role === 'tenant')) cur.role = role;
    want.set(id, cur);
  };
  for (const u of units.filter(live)) {
    add(u.owner_id, u.id, 'owner');
    for (const j of u.joint_ids ?? []) add(j, u.id, 'joint');
    if (u.occupancy === 'tenant') add(u.tenant_id, u.id, 'tenant');
  }
  const out: Client[] = [];
  for (const c of clients) {
    const w = c.id ? want.get(c.id) : undefined;
    const next = w && { ...w, unit_ids: [...new Set(w.unit_ids)].sort(), ...(c.hs?.member_no ? { member_no: c.hs.member_no } : {}) };
    if (c.id && JSON.stringify(next ?? null) !== JSON.stringify(c.hs ?? null)) out.push({ ...c, hs: next });
  }
  return out;
}

/** Member names of a unit (owner first, then joint owners), for the paper and the grid. */
export const memberNames = (u: Pick<SocietyUnit, 'owner_id' | 'joint_ids'>, byId: ReadonlyMap<string, Pick<Client, 'name'>>): string[] =>
  [u.owner_id, ...(u.joint_ids ?? [])].map((id) => (id ? byId.get(id)?.name : undefined)).filter((n): n is string => !!n);

/** The next code after the wing prefix (A-101 → A-102), else `<wing>-101` / `U-1`. */
export function suggestCode(units: readonly Pick<SocietyUnit, 'code'>[], wing = ''): string {
  const p = `${wing.trim() || 'U'}-`;
  const max = Math.max(0, ...units.filter((u) => u.code.startsWith(p)).map((u) => Number(u.code.slice(p.length)) || 0));
  return `${p}${max ? max + 1 : wing.trim() ? 101 : 1}`;
}

/**
 * Why a unit cannot be deleted (else ''): a document or billing run names it (bills stay with their unit — close it
 * instead), or a member is still linked (clear the owner / tenant first, so the recycle bin never has to re-link
 * clients on restore).
 */
export function unitDeleteBlock(u: SocietyUnit, invoices: readonly Pick<InvoiceRecord, 'hs'>[], runs: readonly { unit_ids?: readonly string[] }[] = []): string {
  if (invoices.some((i) => i.hs?.unit?.id === u.id) || runs.some((r) => r.unit_ids?.includes(u.id))) return hsT('delBilled', { c: u.code });
  return u.owner_id || u.joint_ids?.length || u.tenant_id ? hsT('delLinked', { c: u.code }) : '';
}
