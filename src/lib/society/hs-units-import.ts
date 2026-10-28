/**
 * R18-A2 society unit import (pure; family `f-society`; PRD A2 criterion 4, the R18-A cut 3 closed later): a sheet
 * already read into headers / rows (CSV through `csv.ts`, XLSX through the dynamic `xlsx.ts`, in the view) → a preview
 * plan. Fixed template `code, wing, use, carpet_area, super_area, undivided_pct, construction_cost, owner, phone, email,
 * occupancy, tenant, parking` (header spellings scored by `import-mapping.ts`'s `scoreHeader`, passed in by the view so
 * the family imports nothing lazy). An existing code is updated (only the columns given), a new one created; owners and
 * tenants are matched to clients by name (a phone that differs is a warning); names with no client are listed and
 * created only when the user confirms. Any row error blocks the whole import (all or nothing). Writes live in
 * `hs-units-save.ts` (`applyUnitsImport`).
 */
import { hsT } from '../../i18n/areas/society-r18a';
import type { Client } from '../../types/invoice';
import type { HsOccupancy, HsUnitUse, SocietyUnit } from '../../types/society-r18';
import { cleanUnit, validateUnit } from './hs-units';

export type UnitImportField = 'code' | 'wing' | 'use' | 'carpet_area' | 'super_area' | 'undivided_pct' | 'construction_cost' | 'owner' | 'phone' | 'email' | 'occupancy' | 'tenant' | 'parking';

/** Header spellings per field (the first is the template's). */
export const UNIT_IMPORT_FIELDS: Readonly<Record<UnitImportField, readonly string[]>> = {
  code: ['code', 'Unit code', 'Unit', 'Unit No', 'Flat', 'Flat No', 'Flat Number', 'Shop No', 'Door No'],
  wing: ['wing', 'Block', 'Building', 'Tower'],
  use: ['use', 'Unit type', 'Type', 'Usage'],
  carpet_area: ['carpet_area', 'Carpet area', 'Carpet', 'Area'],
  super_area: ['super_area', 'Super area', 'Super built-up area', 'Built-up area', 'Saleable area'],
  undivided_pct: ['undivided_pct', 'Undivided %', 'Undivided interest', 'UDS %', 'Share %'],
  construction_cost: ['construction_cost', 'Construction cost', 'Cost'],
  owner: ['owner', 'Owner name', 'Member', 'Member name', 'Name'],
  phone: ['phone', 'Mobile', 'Phone No', 'Contact No'],
  email: ['email', 'Email ID', 'E-mail'],
  occupancy: ['occupancy', 'Let out', 'Occupied by', 'Tenanted'],
  tenant: ['tenant', 'Tenant name', 'Occupant'],
  parking: ['parking', 'Parking slots', 'Slots', 'Car parking'],
};
export const UNIT_IMPORT_TEMPLATE = Object.keys(UNIT_IMPORT_FIELDS).join(',');

export type UnitColumns = Partial<Record<UnitImportField, number>>;
export interface UnitTable { headers: readonly string[]; rows: readonly (readonly string[])[] }

/** Header → field, each column used once, strongest pairs first (`score` = `scoreHeader` of import-mapping). */
export function guessUnitColumns(headers: readonly string[], score: (h: string, syn: string[]) => number): UnitColumns {
  const pairs: [UnitImportField, number, number][] = [];
  for (const [f, syn] of Object.entries(UNIT_IMPORT_FIELDS) as [UnitImportField, readonly string[]][]) headers.forEach((h, i) => { const s = score(h, [...syn]); if (s >= 0.5) pairs.push([f, i, s]); });
  pairs.sort((a, b) => b[2] - a[2]);
  const out: UnitColumns = {}, used = new Set<number>();
  for (const [f, i] of pairs) if (out[f] === undefined && !used.has(i)) { out[f] = i; used.add(i); }
  return out;
}

export interface UnitImportRow {
  /** 1-based sheet row (the header is row 1). */
  line: number;
  code: string;
  action: 'create' | 'update';
  unit: SocietyUnit;
  owner?: { name: string; phone?: string; email?: string };
  tenant?: string;
  error?: string;
  warning?: string;
}
export interface UnitImportPlan { rows: UnitImportRow[]; newMembers: string[]; create: number; update: number; errors: number }

const k = (s: string) => s.trim().toLowerCase();
const USE: Record<string, HsUnitUse> = { residential: 'residential', flat: 'residential', home: 'residential', commercial: 'commercial', shop: 'commercial', office: 'commercial', garage: 'garage', other: 'other' };
const OCC: Record<string, HsOccupancy> = { owner: 'owner', self: 'owner', no: 'owner', n: 'owner', tenant: 'tenant', let: 'tenant', 'let out': 'tenant', rented: 'tenant', yes: 'tenant', y: 'tenant', vacant: 'vacant', empty: 'vacant' };

/** The preview of a sheet against the live units and clients (pure). Rows with no code are skipped. */
export function planUnitsImport(t: UnitTable, cols: UnitColumns, units: readonly SocietyUnit[], clients: readonly Client[]): UnitImportPlan {
  if (cols.code === undefined) throw new Error(hsT('impNoCode'));
  const cell = (r: readonly string[], f: UnitImportField) => (cols[f] === undefined ? undefined : String(r[cols[f]!] ?? '').trim());
  const byName = new Map(clients.map((c) => [k(c.name ?? ''), c]));
  const byCode = new Map(units.map((u) => [k(u.code), u]));
  const seen = new Set<string>(), fresh = new Map<string, string>();
  const plan: UnitImportPlan = { rows: [], newMembers: [], create: 0, update: 0, errors: 0 };
  t.rows.forEach((r, n) => {
    const code = cell(r, 'code') ?? '';
    if (!code) return;
    const prev = byCode.get(k(code));
    const u: Record<string, unknown> = { ...(prev ?? { id: `new:${n}`, use: 'residential', occupancy: 'owner', parking: [], status: 'active' }), code };
    const errs: string[] = [];
    const num = (f: 'carpet_area' | 'super_area' | 'undivided_pct' | 'construction_cost') => {
      const v = cell(r, f);
      if (!v) return;
      const x = Number(v.replace(/[₹,\s]/g, ''));
      if (Number.isFinite(x) && x >= 0) u[f] = x; else errs.push(hsT('eNum', { f }));
    };
    const pick = <T,>(f: UnitImportField, map: Record<string, T>, key: string) => { const v = cell(r, f); if (v) { if (map[k(v)]) u[key] = map[k(v)]; else errs.push(hsT('impBad', { f, v })); } };
    if (cell(r, 'wing')) u.wing = cell(r, 'wing');
    pick('use', USE, 'use');
    (['carpet_area', 'super_area', 'undivided_pct', 'construction_cost'] as const).forEach(num);
    let tenant = cell(r, 'tenant');
    pick('occupancy', OCC, 'occupancy');
    if (tenant && /^(yes|no|y|n)$/i.test(tenant)) { if (!cell(r, 'occupancy')) u.occupancy = OCC[k(tenant)]; tenant = ''; } // "tenant: yes / no"
    else if (tenant && !cell(r, 'occupancy')) u.occupancy = 'tenant';
    const p = cell(r, 'parking');
    if (p) {
      const slots = /^\d+$/.test(p) ? Array.from({ length: Math.min(20, Number(p)) }, (_, i) => `P${i + 1}`) : p.split(/[,;/]/).map((s) => s.trim()).filter(Boolean);
      u.parking = slots.map((slot) => ({ slot, kind: 'covered' }));
    }
    const owner = cell(r, 'owner');
    const row: UnitImportRow = { line: n + 2, code, action: prev ? 'update' : 'create', unit: u as unknown as SocietyUnit };
    if (owner) {
      row.owner = { name: owner, ...(cell(r, 'phone') ? { phone: cell(r, 'phone') } : {}), ...(cell(r, 'email') ? { email: cell(r, 'email') } : {}) };
      const c = byName.get(k(owner));
      const digits = (s?: string) => (s ?? '').replace(/\D/g, '').slice(-10);
      if (c && row.owner.phone && c.phone && digits(c.phone) !== digits(row.owner.phone)) row.warning = hsT('impPhone', { n: c.name });
    }
    if (tenant && u.occupancy === 'tenant') row.tenant = tenant;
    for (const name of [owner, row.tenant]) if (name && !byName.has(k(name)) && !fresh.has(k(name))) fresh.set(k(name), name);
    if (seen.has(k(code))) errs.push(hsT('impDup', { c: code }));
    seen.add(k(code));
    row.unit = cleanUnit(row.unit, '');
    const err = validateUnit(row.unit, units); // a new code is never taken here: an existing one is an update
    if (err) errs.push(err);
    if (errs.length) { row.error = errs.join(' '); plan.errors++; } else plan[row.action]++;
    plan.rows.push(row);
  });
  plan.newMembers = [...fresh.values()];
  return plan;
}
