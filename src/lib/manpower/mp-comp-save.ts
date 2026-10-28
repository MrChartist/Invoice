/**
 * R17-C1 writer of `site_compliance` (one row per site × month): PF TRRN / ESI challan, status, the client's hold.
 * `doc.create`; the period lock by the month's last day; audited through the watched table. `proved` is refused
 * without the TRRN (and the challan when ESI is due). Proof files ride in `attachments` (owner table in `attachments.ts`).
 */
import './mp-registry';
import type { SiteCompliance } from '../../types/manpower-r17';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { MP_TABLES } from './mp-shared';
import { MONTH_RE, monthEnd } from './mp-muster';
import { proofError, type Amounts } from './mp-compliance';

export const loadCompliance = (month?: string): SiteCompliance[] => getTable<SiteCompliance>(MP_TABLES.compliance).filter((c) => c?.id && c.site_id && (!month || c.month === month));

export type CompPatch = Partial<Pick<SiteCompliance, 'pf' | 'esi' | 'status' | 'hold' | 'attachments'>>;

/** Save the proof of a site × month (`totals` = the site's shares, for the ESI-due test). */
export function saveCompliance(siteId: string, month: string, patch: CompPatch, totals: Amounts): SiteCompliance {
  requireAccess('doc.create');
  if (!MONTH_RE.test(month)) throw new Error('Choose the month.');
  const all = loadCompliance();
  const prev = all.find((c) => c.site_id === siteId && c.month === month);
  const row: SiteCompliance = { pf: {}, esi: {}, status: 'pending', ...prev, ...patch, id: prev?.id ?? generateId(), site_id: siteId, month, date: monthEnd(month), updated_at: new Date().toISOString() };
  const err = proofError(row, totals);
  if (err) throw new Error(err === 'pf' ? 'Type the PF TRRN to mark it proved.' : 'Type the ESI challan to mark it proved.');
  assertUnlocked({ id: row.id, issue_date: row.date }, 'edit');
  setTable(MP_TABLES.compliance, prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
  return row;
}
