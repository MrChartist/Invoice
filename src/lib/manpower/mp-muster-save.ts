/**
 * R17-B1 muster writes (`site_musters`): save a draft (one per site × month), lock / unlock, and the import-run log.
 * `doc.create`; the period lock by the month's last day; audited through the watched table.
 */
import './mp-registry';
import type { MusterRow, SiteMuster } from '../../types/manpower-r17';
import type { Site } from './mp-sites';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { MP_TABLES } from './mp-shared';
import { MONTH_RE, loadMusters, monthEnd, musterOf, validateRows } from './mp-muster';
import { billsOf } from './mp-bill';
import type { InvoiceRecord } from '../../types/invoice';

const clean = (r: MusterRow): MusterRow => {
  const o: MusterRow = { employee_id: r.employee_id, post_id: r.post_id, duties: Number(r.duties) || 0 };
  if (Number(r.ot_hours) > 0) o.ot_hours = Math.round(Number(r.ot_hours) * 100) / 100;
  if (r.relief) o.relief = true;
  if (r.note?.trim()) o.note = r.note.trim().slice(0, 120);
  return o;
};

const lockGuard = (m: Pick<SiteMuster, 'id' | 'date'>) => assertUnlocked({ id: m.id, issue_date: m.date }, 'edit');

/** Save the draft muster of a site × month (`doc.create`). A second muster for the same site × month is refused. */
export function saveMuster(site: Site, month: string, rows: readonly MusterRow[], id?: string): SiteMuster {
  requireAccess('doc.create');
  if (!MONTH_RE.test(month)) throw new Error('Choose the month.');
  const all = loadMusters();
  const prev = id ? all.find((m) => m.id === id) : undefined;
  const twin = musterOf(all, site.id, month);
  if (twin && twin.id !== prev?.id) throw new Error('This site already has a muster for the month.');
  if (prev?.status === 'locked') throw new Error('The muster is locked; unlock it first.');
  const err = validateRows(rows, site);
  if (err) throw new Error(err);
  const row: SiteMuster = { id: prev?.id ?? generateId(), site_id: site.id, month, date: monthEnd(month), rows: rows.map(clean), status: 'draft', updated_at: new Date().toISOString() };
  lockGuard(row);
  setTable(MP_TABLES.musters, prev ? all.map((m) => (m.id === row.id ? row : m)) : [...all, row]);
  return row;
}

/** Lock / unlock a muster (`doc.create`, audited by the watched table). */
export function setMusterLock(id: string, lock: boolean): SiteMuster {
  requireAccess('doc.create');
  const all = loadMusters();
  const m = all.find((x) => x.id === id);
  if (!m) throw new Error('This muster is no longer on the list.');
  lockGuard(m);
  if (!lock && m.status === 'locked') {
    // QA20 V7: a locked muster is the source of a final payroll run and of its bills; reopening it would change
    // duties under both without a trace (the bill stays "billed", the run keeps the old attendance).
    if (getTable<{ month?: string; status?: string }>('payroll_runs').some((r) => r?.month === m.month && r.status === 'final')) throw new Error(`Payroll for ${m.month} is finalized; reopen it before unlocking this muster.`);
    const bills = billsOf(getTable<InvoiceRecord>('invoices'), m.id);
    if (bills.length) throw new Error(`This muster is billed (${bills.map((b) => b.invoice_number || 'draft').join(', ')}): cancel the bill, or raise a credit / debit note for the difference.`);
  }
  const { locked_at: _l, ...rest } = m;
  void _l;
  const row: SiteMuster = lock ? { ...m, status: 'locked', locked_at: new Date().toISOString() } : { ...rest, status: 'draft' };
  setTable(MP_TABLES.musters, all.map((x) => (x.id === id ? { ...row, updated_at: new Date().toISOString() } : x)));
  return row;
}

/** B1 criterion 4: log an import run (kind `muster`) — the setup checklist's import step reads `import_runs`. */
export function logMusterImport(fileName: string, created: number, skipped: number): void {
  try {
    setTable('import_runs', [...getTable('import_runs'), { id: generateId(), at: new Date().toISOString(), kind: 'muster', file_name: fileName.slice(0, 200), created, updated: 0, skipped, errors: 0 }]);
  } catch {
    /* the record of a run never undoes it */
  }
}
