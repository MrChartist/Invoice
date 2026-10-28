/**
 * R18-A2 unit import (pure; family `f-society`): a sheet already read into headers / rows (CSV through `csv.ts`, XLSX
 * through the dynamic `xlsx.ts`, in the view). Fixed template `code, wing, use, carpet_area, super_area, undivided_pct,
 * construction_cost, owner, phone, email, occupancy, tenant, parking`. Owners are matched to clients by name + phone
 * (by name alone only when exactly one client has it); the owners not found are listed and created only on the user's
 * confirmation. Codes already in the society or repeated in the sheet are skipped and listed.
 */
import { codeKey, OCCUPANCIES, UNIT_USES, validateUnit } from './hs-units';
import type { Client } from '../../types/invoice';
import type { HsOccupancy, HsSlot, HsUnitUse, SocietyUnit } from '../../types/society-r18';

export const UNIT_TEMPLATE = ['code', 'wing', 'use', 'carpet_area', 'super_area', 'undivided_pct', 'construction_cost', 'owner', 'phone', 'email', 'occupancy', 'tenant', 'parking'] as const;

/** One unit row read from the sheet: the unit (no id yet), its owner match and the owner to create when none matched. */
export interface ImportedUnit {
  unit: Omit<SocietyUnit, 'id' | 'updated_at'>;
  /** Matched client id; absent → `newOwner` is created on confirmation. */
  owner_id?: string;
  newOwner?: { name: string; phone?: string; email?: string };
  tenantName?: string;
}
export interface UnitImport { rows: ImportedUnit[]; skipped: string[]; unmatched: string[] }

const key = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const digits = (p?: string) => (p ?? '').replace(/\D/g, '').slice(-10);
const nameKey = (n?: string) => (n ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const numOf = (v: unknown): number | undefined => {
  const s = String(v ?? '').replace(/[,₹\s]/g, '');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

/** A client index by name + phone and by name (built once: a 2,000-unit sheet stays linear). */
export function clientIndex(clients: readonly Client[]): (name: string, phone?: string) => string | undefined {
  const byBoth = new Map<string, string>();
  const byName = new Map<string, { ids: string[]; phoneless: string[] }>();
  for (const c of clients) {
    if (!c.id) continue;
    const n = nameKey(c.name);
    const d = digits(c.phone);
    if (d) byBoth.set(`${n}|${d}`, c.id);
    const e = byName.get(n) ?? { ids: [], phoneless: [] };
    e.ids.push(c.id);
    if (!d) e.phoneless.push(c.id);
    byName.set(n, e);
  }
  return (name, phone) => {
    const n = nameKey(name);
    const d = digits(phone);
    const e = byName.get(n);
    if (d) return byBoth.get(`${n}|${d}`) ?? (e?.ids.length === 1 && e.phoneless.length === 1 ? e.ids[0] : undefined);
    return e?.ids.length === 1 ? e.ids[0] : undefined;
  };
}

/** Parking cell: a count ("2"), or slot names ("P1, P2" / "P1 covered; S2 two wheeler"). */
function slotsOf(cell: string): HsSlot[] {
  const s = cell.trim();
  if (!s) return [];
  if (/^\d+$/.test(s)) return Array.from({ length: Math.min(Number(s), 20) }, (_, i) => ({ slot: `P${i + 1}`, kind: 'covered' as const }));
  return s.split(/[;,]/).map((x) => x.trim()).filter(Boolean).slice(0, 20).map((x) => {
    const kind = /two.?wheeler|2w/i.test(x) ? 'two_wheeler' : /stilt/i.test(x) ? 'stilt' : /open/i.test(x) ? 'open' : 'covered';
    return { slot: x.replace(/\s*(covered|open|stilt|two.?wheeler|2w)\s*$/i, '').trim() || x, kind };
  });
}

export function mapUnitsTable(t: { headers: readonly string[]; rows: readonly (readonly string[])[] }, clients: readonly Client[], existing: readonly Pick<SocietyUnit, 'id' | 'code'>[]): UnitImport {
  const hs = t.headers.map(key);
  const col = (...names: string[]) => hs.findIndex((h) => names.includes(h));
  const c = {
    code: col('code', 'unit', 'flat', 'flat_no', 'unit_code'), wing: col('wing', 'block', 'tower'), use: col('use', 'type'),
    carpet: col('carpet_area', 'carpet'), super: col('super_area', 'super_built_up_area', 'super_builtup', 'sba'), pct: col('undivided_pct', 'undivided', 'uds_pct'),
    cost: col('construction_cost', 'cost'), owner: col('owner', 'owner_name', 'member', 'name'), phone: col('phone', 'mobile'), email: col('email', 'e_mail'),
    occ: col('occupancy'), tenant: col('tenant', 'let_out', 'tenant_name'), parking: col('parking', 'parking_slots', 'slots'),
  };
  if (c.code < 0) throw new Error('The sheet needs a code column (the flat / unit number, e.g. A-101).');
  const match = clientIndex(clients);
  const seen = new Set(existing.map((u) => codeKey(u.code)));
  const out: UnitImport = { rows: [], skipped: [], unmatched: [] };
  const cell = (r: readonly string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  for (const r of t.rows) {
    const code = cell(r, c.code);
    if (!code) continue;
    if (seen.has(codeKey(code))) {
      out.skipped.push(`${code}: already in the society or repeated in the sheet`);
      continue;
    }
    const useRaw = cell(r, c.use).toLowerCase();
    const use: HsUnitUse = (UNIT_USES as readonly string[]).includes(useRaw) ? (useRaw as HsUnitUse) : /shop|office|commercial/.test(useRaw) ? 'commercial' : /garage/.test(useRaw) ? 'garage' : 'residential';
    const tenantRaw = cell(r, c.tenant);
    const occRaw = cell(r, c.occ).toLowerCase();
    const letOut = /^(y|yes|true|1|let|let out)$/i.test(tenantRaw);
    const occupancy: HsOccupancy = (OCCUPANCIES as readonly string[]).includes(occRaw) ? (occRaw as HsOccupancy) : letOut || (tenantRaw && !/^(n|no|false|0)$/i.test(tenantRaw)) ? 'tenant' : 'owner';
    const unit: ImportedUnit['unit'] = { code, use, occupancy, parking: slotsOf(cell(r, c.parking)), status: 'active' };
    const wing = cell(r, c.wing);
    if (wing) unit.wing = wing;
    for (const [f, i] of [['carpet_area', c.carpet], ['super_area', c.super], ['undivided_pct', c.pct], ['construction_cost', c.cost]] as const) {
      const v = numOf(cell(r, i));
      if (v !== undefined) unit[f] = v;
    }
    const err = validateUnit({ id: '', ...unit }, []);
    if (err || Object.values(unit).some((v) => typeof v === 'number' && Number.isNaN(v))) {
      out.skipped.push(`${code}: ${err || 'a number column is not a number'}`);
      continue;
    }
    seen.add(codeKey(code));
    const owner = cell(r, c.owner);
    const phone = cell(r, c.phone);
    const email = cell(r, c.email);
    const row: ImportedUnit = { unit };
    if (owner) {
      const id = match(owner, phone);
      if (id) row.owner_id = id;
      else {
        row.newOwner = { name: owner, ...(phone ? { phone } : {}), ...(email ? { email } : {}) };
        out.unmatched.push(`${code}: ${owner}`);
      }
    }
    if (occupancy === 'tenant' && tenantRaw && !letOut) row.tenantName = tenantRaw;
    out.rows.push(row);
  }
  return out;
}
