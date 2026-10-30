/**
 * PS-A2 matters: a matter IS a project cost centre (R3-B2) with `CostCentre.ps` (code, kind, court / case no., parties,
 * responsible / originating timekeeper, opened / closed, conflict check, engagement). No new table: the R3-B project
 * board, budgets and the 80 / 100 % bell work unchanged on a matter. The matter code is unique per company
 * (`<client code>/<seq>` suggested; the client code is `Client.ps.code`, else the name's initials). In a `legal` profile a
 * matter opens only after a conflict check, unless the owner skips it with a reason (audited; never blocks otherwise).
 * Pure above "Storage".
 */
import type { Client } from '../../types/invoice';
import type { MatterInfo, MatterParty } from '../../types/prof-r14';
import { loadCostCentres, saveCostCentre, type CostCentre } from '../cost-centres';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { localDb } from '../localDb';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ROLES: readonly MatterParty['role'][] = ['client', 'opposite', 'related', 'witness', 'other'];

export const isMatter = (c: Pick<CostCentre, 'ps'> | undefined): c is CostCentre & { ps: MatterInfo } => !!c?.ps?.code;
export const matterLabel = (c: Pick<CostCentre, 'name' | 'ps'>): string => (c.ps?.code ? `${c.ps.code}: ${c.name}` : c.name);
export const isOpen = (c: Pick<CostCentre, 'ps'>): boolean => !c.ps?.closed;

/** The client's code: `Client.ps.code`, else the initials of its name (2–4 letters). */
export function clientCode(c: Pick<Client, 'name' | 'ps'> | undefined): string {
  const own = c?.ps?.code?.trim().toUpperCase();
  if (own) return own;
  const words = (c?.name ?? '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['M', 'S', 'MS', 'THE', 'PVT', 'LTD', 'LLP', 'AND', 'CO'].includes(w));
  const ini = words.map((w) => w[0]).join('').slice(0, 4);
  return ini.length >= 2 ? ini : (words[0] ?? 'MAT').slice(0, 3);
}

/** `<client code>/<seq>`: the next free sequence of that prefix (3 digits). */
export function suggestCode(prefix: string, centres: readonly Pick<CostCentre, 'ps'>[]): string {
  const p = `${prefix.trim().toUpperCase()}/`;
  let max = 0;
  for (const c of centres) {
    const code = c.ps?.code?.toUpperCase() ?? '';
    if (code.startsWith(p)) max = Math.max(max, Number(code.slice(p.length)) || 0);
  }
  return `${p}${String(max + 1).padStart(3, '0')}`;
}

/** Problems with matter fields (empty = may be saved). */
export function validateMatter(m: MatterInfo, id: string | undefined, centres: readonly CostCentre[]): string {
  const code = m.code?.trim();
  if (!code) return 'Give the matter a code.';
  if (centres.some((c) => c.id !== id && c.ps?.code?.trim().toLowerCase() === code.toLowerCase())) return `Matter code ${code} is already used.`;
  if (!DAY.test(m.opened ?? '')) return 'Enter the date the matter was opened.';
  if (m.closed && (!DAY.test(m.closed) || m.closed < m.opened)) return 'The closing date is before the opening date.';
  if (m.parties.some((p) => !p.name?.trim() || !ROLES.includes(p.role))) return 'Every party needs a name and a role.';
  return '';
}

/** Pure: the matter fields cleaned (blank optionals dropped, PAN / GSTIN upper-cased). */
export function cleanMatter(m: MatterInfo): MatterInfo {
  const t = (v?: string) => v?.trim() || undefined;
  const out: MatterInfo = {
    code: m.code.trim().toUpperCase(), kind: m.kind, opened: m.opened,
    parties: m.parties.map((p) => ({ name: p.name.trim(), role: p.role, ...(t(p.pan) ? { pan: t(p.pan)!.toUpperCase() } : {}), ...(t(p.gstin) ? { gstin: t(p.gstin)!.toUpperCase() } : {}) })),
  };
  for (const k of ['practice_area', 'court', 'case_no', 'forum', 'responsible_id', 'originating_id', 'closed', 'conflict_id', 'engagement_id', 'skip_reason'] as const) if (t(m[k])) out[k] = t(m[k]);
  return out;
}

// ── Storage ──────────────────────────────────────────────────────

export const loadMatters = (all: readonly CostCentre[] = loadCostCentres()): (CostCentre & { ps: MatterInfo })[] => all.filter(isMatter);

/** A legal profile asks for a conflict check first; the owner may skip it with a reason (audited). */
export const needsConflictCheck = (m: Pick<MatterInfo, 'conflict_id' | 'skip_reason'>, kind = localDb.settings.get().prof_kind): boolean => kind === 'legal' && !m.conflict_id && !m.skip_reason;

export interface MatterInput {
  id?: string;
  name: string;
  client_id?: string;
  budget_minutes?: number;
  fee_budget?: number;
  hourly_rate?: number;
  ps: MatterInfo;
}

/** Open / edit a matter (`master.edit`; a skip of the conflict check is the owner's, audited). */
export function saveMatter(i: MatterInput): CostCentre {
  requireAccess('master.edit');
  const all = loadCostCentres();
  const prev = i.id ? all.find((c) => c.id === i.id) : undefined;
  const ps = cleanMatter(i.ps);
  const err = validateMatter(ps, prev?.id, all);
  if (err) throw new Error(err);
  if (!prev && needsConflictCheck(ps)) throw new Error('Run a conflict check on the parties first (or, as the owner, skip it with a reason).');
  if (ps.skip_reason && ps.skip_reason !== prev?.ps?.skip_reason) requireAccess('settings.manage');
  const row = saveCostCentre({
    ...(prev ?? { active: true, status: 'active' as const, start: ps.opened }),
    id: prev?.id,
    name: i.name,
    kind: 'project',
    client_id: i.client_id || undefined,
    ...(i.budget_minutes !== undefined ? { budget_minutes: i.budget_minutes } : {}),
    ...(i.fee_budget !== undefined ? { fee_budget: i.fee_budget } : {}),
    ...(i.hourly_rate !== undefined ? { hourly_rate: i.hourly_rate } : {}),
    ...(ps.closed ? { status: 'done' as const } : prev?.ps?.closed ? { status: 'active' as const } : {}),
    ps,
  });
  if (ps.skip_reason && ps.skip_reason !== prev?.ps?.skip_reason) {
    audit.record({ entity: 'cost_centre', entity_id: row.id, action: 'update', summary: `Conflict check skipped for matter ${ps.code} by the owner: ${ps.skip_reason}` });
  }
  return row;
}

/** Close (with a date) or reopen (`closed` undefined) a matter. */
export function setMatterClosed(id: string, closed: string | undefined): CostCentre {
  const c = loadCostCentres().find((x) => x.id === id);
  if (!isMatter(c)) throw new Error('This matter is no longer on the list.');
  const { closed: _old, ...rest } = c.ps;
  return saveMatter({ id, name: c.name, client_id: c.client_id, ps: closed ? { ...rest, closed } : rest });
}
