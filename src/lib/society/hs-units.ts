/**
 * R18-A2 units and members (pure; family `f-society`): validation, the grid's filters and totals, and the member link
 * on clients (`Client.hs`). A unit's code is the society's own (`A-101`), unique per company. The undivided-interest
 * total is a warning, never a block. Writes live in `hs-units-save.ts` (which imports the registry).
 */
import { round2 } from '../invoice-calc';
import type { Client } from '../../types/invoice';
import type { ClientHs, HsOccupancy, HsSlotKind, HsUnitUse, SocietyUnit } from '../../types/society-r18';

export const UNIT_USES: readonly HsUnitUse[] = ['residential', 'commercial', 'garage', 'other'];
export const OCCUPANCIES: readonly HsOccupancy[] = ['owner', 'tenant', 'vacant'];
export const SLOT_KINDS: readonly HsSlotKind[] = ['covered', 'open', 'stilt', 'two_wheeler'];

/** Codes compare without case or spaces ("a 101" = "A-101" is NOT the same; "A-101 " = "a-101" is). */
export const codeKey = (c: string): string => c.trim().toLowerCase();

const nonNeg = (v: unknown) => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

/** The first problem with a unit (code missing / taken, a negative area or cost), else ''. */
export function validateUnit(u: Pick<SocietyUnit, 'id' | 'code' | 'carpet_area' | 'super_area' | 'undivided_pct' | 'construction_cost' | 'inlets'>, units: readonly Pick<SocietyUnit, 'id' | 'code'>[]): string {
  if (!u.code?.trim()) return 'A unit needs a code (e.g. A-101).';
  const k = codeKey(u.code);
  if (units.some((x) => x.id !== u.id && codeKey(x.code) === k)) return `Unit ${u.code.trim()} already exists.`;
  for (const f of ['carpet_area', 'super_area', 'undivided_pct', 'construction_cost', 'inlets'] as const) if (!nonNeg(u[f])) return `${f.replace('_', ' ')} cannot be negative.`;
  if ((u.undivided_pct ?? 0) > 100) return 'Undivided interest cannot be above 100 %.';
  return '';
}

/** Warnings across units (never blocks): undivided interest must total 100 ± 0.01 % once any unit has it. */
export function unitWarnings(units: readonly SocietyUnit[]): string[] {
  const live = units.filter((u) => u.status !== 'closed' && u.status !== 'merged');
  const withPct = live.filter((u) => typeof u.undivided_pct === 'number');
  const sum = round2(withPct.reduce((t, u) => t + (u.undivided_pct ?? 0), 0));
  return withPct.length && Math.abs(sum - 100) > 0.01 ? [`Undivided interest adds up to ${sum} %, not 100 %.`] : [];
}

/** A clean unit to store (trimmed code, numbers ≥ 0 only, empty optionals dropped). */
export function cleanUnit(u: SocietyUnit, now = new Date().toISOString()): SocietyUnit {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const typed = Object.fromEntries(Object.entries(u.typed ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0));
  const out: SocietyUnit = {
    id: u.id,
    code: u.code.trim(),
    use: UNIT_USES.includes(u.use) ? u.use : 'residential',
    occupancy: OCCUPANCIES.includes(u.occupancy) ? u.occupancy : 'owner',
    parking: (u.parking ?? []).filter((s) => s && SLOT_KINDS.includes(s.kind)).map((s) => ({ slot: String(s.slot ?? '').trim(), kind: s.kind })),
    status: u.status ?? 'active',
    updated_at: now,
  };
  const opt: Partial<SocietyUnit> = {
    wing: u.wing?.trim() || undefined,
    floor: u.floor?.trim() || undefined,
    carpet_area: n(u.carpet_area),
    super_area: n(u.super_area),
    undivided_pct: n(u.undivided_pct),
    construction_cost: n(u.construction_cost),
    inlets: n(u.inlets),
    lifted: u.lifted || undefined,
    owner_id: u.owner_id || undefined,
    joint_ids: u.joint_ids?.filter(Boolean).length ? u.joint_ids.filter(Boolean) : undefined,
    tenant_id: u.occupancy === 'tenant' && u.tenant_id ? u.tenant_id : undefined,
    typed: Object.keys(typed).length ? typed : undefined,
  };
  for (const [k, v] of Object.entries(opt)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  // C / D fields (certificates, transfers, share certificate, nominees, admitted on) and the demo marker are kept.
  for (const k of ['certificates', 'transfers', 'share_cert', 'nominees', 'admitted_on', 'demo'] as const) if (u[k] !== undefined) (out as unknown as Record<string, unknown>)[k] = u[k];
  return out;
}

export interface UnitFilter { wing?: string; use?: string; occupancy?: string }

export const filterUnits = (units: readonly SocietyUnit[], f: UnitFilter): SocietyUnit[] =>
  units.filter((u) => (!f.wing || (u.wing ?? '') === f.wing) && (!f.use || u.use === f.use) && (!f.occupancy || u.occupancy === f.occupancy));

/** The grid's totals: units, carpet / super area, construction cost and parking slots. */
export function unitTotals(units: readonly SocietyUnit[]): { units: number; carpet: number; super: number; cost: number; slots: number } {
  const t = { units: units.length, carpet: 0, super: 0, cost: 0, slots: 0 };
  for (const u of units) {
    t.carpet += u.carpet_area ?? 0;
    t.super += u.super_area ?? 0;
    t.cost += u.construction_cost ?? 0;
    t.slots += u.parking?.length ?? 0;
  }
  return { ...t, carpet: round2(t.carpet), super: round2(t.super), cost: round2(t.cost) };
}

/** Units in code order ("A-2" before "A-10"). */
export const sortUnits = (units: readonly SocietyUnit[]): SocietyUnit[] => [...units].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));

export const wingsOf = (units: readonly SocietyUnit[]): string[] => [...new Set(units.map((u) => u.wing ?? '').filter(Boolean))].sort();

/**
 * The members' `Client.hs` after units change (pure): every client named on a unit gets that unit (owner / joint /
 * tenant role, the owner role winning), and loses the units no longer theirs. Only clients whose `hs` changes are
 * returned. A client with no unit left has `hs` removed.
 */
export function memberLinks(units: readonly SocietyUnit[], clients: readonly Client[]): Client[] {
  const want = new Map<string, ClientHs>();
  const rank = { owner: 3, joint: 2, tenant: 1 } as const;
  const add = (id: string | undefined, unit: string, role: ClientHs['role']) => {
    if (!id) return;
    const cur = want.get(id) ?? { unit_ids: [], role };
    if (!cur.unit_ids.includes(unit)) cur.unit_ids.push(unit);
    if (rank[role] > rank[cur.role]) cur.role = role;
    want.set(id, cur);
  };
  for (const u of units) {
    if (u.status === 'closed' || u.status === 'merged') continue;
    add(u.owner_id, u.id, 'owner');
    for (const j of u.joint_ids ?? []) add(j, u.id, 'joint');
    if (u.occupancy === 'tenant') add(u.tenant_id, u.id, 'tenant');
  }
  const out: Client[] = [];
  for (const c of clients) {
    if (!c.id) continue;
    const w = want.get(c.id);
    const next = w ? { ...w, unit_ids: [...w.unit_ids].sort(), ...(c.hs?.member_no ? { member_no: c.hs.member_no } : {}) } : undefined;
    if (JSON.stringify(next ?? null) !== JSON.stringify(c.hs ?? null)) out.push({ ...c, hs: next });
  }
  return out;
}

/** Member names of a unit (owner first, then joint owners), for the paper and the grid. */
export const memberNames = (u: Pick<SocietyUnit, 'owner_id' | 'joint_ids'>, byId: ReadonlyMap<string, Pick<Client, 'name'>>): string[] =>
  [u.owner_id, ...(u.joint_ids ?? [])].map((id) => (id ? byId.get(id)?.name : undefined)).filter((n): n is string => !!n);

/** "Suggest the next code": the highest number after the wing prefix + 1 (A-101 → A-102), else `U-001`. */
export function suggestCode(units: readonly Pick<SocietyUnit, 'code'>[], wing?: string): string {
  const p = wing?.trim() ? `${wing.trim()}-` : 'U-';
  let max = 0;
  for (const u of units) if (u.code.startsWith(p)) max = Math.max(max, Number(u.code.slice(p.length)) || 0);
  return `${p}${max ? max + 1 : wing?.trim() ? 101 : '001'}`;
}
