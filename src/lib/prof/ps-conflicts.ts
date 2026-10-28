/**
 * PS-A2 conflict checks (table `conflict_checks`, dated, `master.edit`, audited): names are folded (case, punctuation,
 * "M/s", "Pvt Ltd / Private Limited / LLP / & Co" dropped), PAN and GSTIN match exactly (a PAN also inside a GSTIN), and
 * other names hit on a token overlap ≥ 0.8. The search covers clients, vendors, every matter's parties (closed matters
 * too) and engagement titles of the open company only. The result is recorded — clear / conflict / waived (the owner,
 * with a reason and a consent note, audited). The app never decides: BCI Rule 33 / ICAI independence are cited (PS28).
 * Pure above "Storage".
 */
import './ps-registry';
import type { Client } from '../../types/invoice';
import type { Vendor } from '../../types/purchases';
import type { ConflictCheck, ConflictHit, Engagement, MatterInfo } from '../../types/prof-r14';
import type { CostCentre } from '../cost-centres';
import { generateId, getTable, setTable } from '../storage';
import { currentActor, requireAccess } from '../access';
import { audit } from '../audit';
import { PS_TABLES } from './ps-shared';

const DROP = new Set(['m', 's', 'ms', 'mr', 'mrs', 'the', 'pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company', 'and', 'inc', 'corp']);
const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;

/** Folded tokens of a name ("M/s Shree Traders Pvt. Ltd." → ["shree", "traders"]). */
export const nameTokens = (s: string): string[] => s.toLowerCase().replace(/&/g, ' ').replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').split(' ').filter((w) => w && !DROP.has(w));
export const foldName = (s: string): string => nameTokens(s).join(' ');

/** Token overlap of two folded token lists: shared ÷ the longer list. */
export function overlap(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const shared = new Set(a.filter((w) => sb.has(w))).size;
  return shared / Math.max(new Set(a).size, sb.size);
}

interface Candidate { source: ConflictHit['source']; ref_id: string; name: string; tokens: string[]; ids: string[]; matter_code?: string; role?: string }

export interface ConflictSources {
  clients: readonly Pick<Client, 'id' | 'name' | 'gstin' | 'pan'>[];
  vendors: readonly Pick<Vendor, 'id' | 'name' | 'gstin' | 'pan'>[];
  matters: readonly (Pick<CostCentre, 'id' | 'name'> & { ps?: MatterInfo })[];
  engagements?: readonly Pick<Engagement, 'id' | 'title' | 'number'>[];
}

const ids = (...v: (string | undefined)[]) => v.map((x) => x?.trim().toUpperCase() ?? '').filter(Boolean);

/** Pure: every candidate once, tokens folded once (5,000 parties search in well under 50 ms). */
export function candidates(src: ConflictSources): Candidate[] {
  const out: Candidate[] = [];
  const add = (source: Candidate['source'], ref_id: string, name: string, idv: string[], extra: Partial<Candidate> = {}) => name.trim() && out.push({ source, ref_id, name, tokens: nameTokens(name), ids: idv, ...extra });
  for (const c of src.clients) add('client', c.id ?? '', c.name, ids(c.gstin, c.pan));
  for (const v of src.vendors) add('vendor', v.id, v.name, ids(v.gstin, v.pan));
  for (const m of src.matters) for (const p of m.ps?.parties ?? []) add('party', m.id, p.name, ids(p.gstin, p.pan), { matter_code: m.ps?.code, role: p.role });
  for (const e of src.engagements ?? []) add('engagement', e.id, e.title, [], { matter_code: e.number });
  return out;
}

/** Pure: hits for the terms (a name, a PAN or a GSTIN each), best first. */
export function searchConflicts(terms: readonly string[], list: readonly Candidate[]): ConflictHit[] {
  const hits = new Map<string, ConflictHit>();
  for (const raw of terms) {
    const term = raw.trim();
    if (!term) continue;
    const up = term.toUpperCase().replace(/\s+/g, '');
    const isId = PAN.test(up) || GSTIN.test(up);
    const pan = GSTIN.test(up) ? up.slice(2, 12) : up;
    const tk = nameTokens(term);
    for (const c of list) {
      const score = isId ? (c.ids.some((x) => x === up || x === pan || (PAN.test(pan) && x.slice(2, 12) === pan)) ? 1 : 0) : tk.join(' ') === c.tokens.join(' ') ? 1 : overlap(tk, c.tokens);
      if (score < 0.8) continue;
      const key = `${c.source}|${c.ref_id}|${c.name}`;
      if ((hits.get(key)?.score ?? 0) < score) hits.set(key, { source: c.source, ref_id: c.ref_id, name: c.name, score: Math.round(score * 100) / 100, ...(c.matter_code ? { matter_code: c.matter_code } : {}), ...(c.role ? { role: c.role } : {}) });
    }
  }
  return [...hits.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Names / ids recorded with an unwaived "conflict": a new engagement for any of them warns (never blocks). */
export function conflictWarnings(names: readonly string[], checks: readonly ConflictCheck[]): ConflictCheck[] {
  const want = names.map(nameTokens).filter((t) => t.length);
  return checks.filter((c) => c.result === 'conflict' && c.terms.some((t) => want.some((w) => overlap(nameTokens(t), w) >= 0.8)));
}

// ── Storage ──────────────────────────────────────────────────────

export const loadChecks = (): ConflictCheck[] => getTable<ConflictCheck>(PS_TABLES.conflicts).filter((r) => r && typeof r.id === 'string');

export type CheckInput = Omit<ConflictCheck, 'id' | 'created_at' | 'by'> & { id?: string };

/** Record a check (`master.edit`); a waiver is the owner's, with a reason (audited). */
export function saveCheck(i: CheckInput): ConflictCheck {
  requireAccess('master.edit');
  if (!i.terms.some((t) => t.trim())) throw new Error('Type at least one name, PAN or GSTIN.');
  if (i.result === 'waived') {
    requireAccess('settings.manage');
    if (!i.reason?.trim()) throw new Error('Give the reason for waiving the conflict (and where the consent is kept).');
  }
  const all = loadChecks();
  const prev = i.id ? all.find((c) => c.id === i.id) : undefined;
  const now = new Date().toISOString();
  const row: ConflictCheck = { ...prev, ...i, terms: i.terms.map((t) => t.trim()).filter(Boolean), id: prev?.id ?? generateId(), by: currentActor()?.name, created_at: prev?.created_at ?? now, ...(prev ? { updated_at: now } : {}) };
  setTable(PS_TABLES.conflicts, prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
  if (row.result === 'waived') audit.record({ entity: 'client', entity_id: row.id, action: 'update', summary: `Conflict waived by the owner for ${row.terms.join(', ')}: ${row.reason}${row.consent_note ? ` (consent: ${row.consent_note})` : ''}` });
  return row;
}

/** Delete a check (the row goes to the recycle bin; a matter that names it keeps the id). A waiver is the owner's (R16-B5). */
export function deleteCheck(id: string): void {
  requireAccess('master.edit');
  const all = loadChecks();
  const row = all.find((c) => c.id === id);
  if (!row) throw new Error('Conflict check not found.');
  if (row.result === 'waived') requireAccess('settings.manage');
  setTable(PS_TABLES.conflicts, all.filter((c) => c.id !== id));
}
