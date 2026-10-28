/**
 * R15-C2 supplier statements: column presets (BSP billing file, consolidator) scored with the importer's
 * header matcher (the R5-A marketplace mapper, `marketplace/file-map.ts`), the user's fixed mapping remembered per
 * preset (`travel_settings.statement_maps`), rows split by month above 2,000, and table `supplier_statements` (dated
 * by `period_end`, synced, audited, `books.edit`, deletes to the recycle bin) with the match stored on each row. One
 * `import_runs` row (kind `supplier_statement`) per import. Pure above "Storage". Working papers — verify with your CA.
 */
import './tv-registry';
import type { StatementRow, SupplierStatement } from '../../types/travel-r15';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { round2 } from '../invoice-calc';
import { localDb } from '../localDb';
import { purchasesDb } from '../purchases';
import { cellOf, dayOf, numOf, type ColumnMap, type FileTable, type SynonymTable } from '../marketplace/file-map';
import { loadBookings } from './tv-bookings';
import { matchStatement } from './tv-match';
import { readTravelSettings, saveTravelSettings } from './tv-settings';
import { TV_TABLES } from './tv-shared';

export type StatementKind = SupplierStatement['kind'];
/** Presets: BSP, consolidator and (R16-C3) bed bank. */
export const STATEMENT_KINDS: readonly StatementKind[] = ['bsp', 'consolidator', 'bedbank'];
export const MAX_ROWS = 2000;

const DOC = ['Document Number', 'Ticket Number', 'Ticket', 'Doc No'];
const DATE = ['Issue Date', 'Date'];
const PAX = ['Passenger Name', 'Pax'];
const COMM = ['Commission', 'Comm'];
/** Field → header spellings, per preset (scored loosely by `scoreHeader`). */
export const STATEMENT_PRESETS: Readonly<Partial<Record<StatementKind, SynonymTable>>> = {
  bsp: { doc_no: DOC, type: ['Transaction Type', 'TRNC', 'Type'], date: DATE, pax: PAX, gross: ['Gross Fare', 'Fare'], taxes: ['Taxes', 'Tax'], commission: COMM, net: ['Net Remit', 'Balance Payable', 'Net'] },
  consolidator: { doc_no: [...DOC, 'Ref', 'Booking Ref', 'PNR'], type: ['Type'], date: DATE, pax: PAX, gross: ['Gross', 'Amount'], taxes: ['Taxes', 'Tax'], commission: COMM, net: ['Net Payable', 'Net'] },
  // R16-C3: hotel name, confirmation no., check-in, nights, net (the net amount is what we owe: read as gross, net = gross)
  bedbank: { doc_no: ['Confirmation No', 'Conf No', 'Booking Ref', 'Voucher'], date: ['Check-in', 'Check In', 'Arrival'], hotel: ['Hotel Name', 'Hotel', 'Property'], nights: ['Nights', 'Room Nights'], pax: ['Guest Name', 'Lead Guest', 'Guest'], gross: ['Net', 'Net Amount', 'Net Rate', 'Amount'] },
};
export const REQUIRED = ['doc_no', 'gross'];

/** Rows read from a file by the column map (blank document numbers skipped). Net defaults to gross + taxes − commission. */
export function readStatementRows(t: FileTable, cols: ColumnMap): StatementRow[] {
  const out: StatementRow[] = [];
  for (const row of t.rows) {
    const doc_no = cellOf(row, cols, 'doc_no');
    if (!doc_no) continue;
    const gross = Math.abs(numOf(row, cols, 'gross') ?? 0), taxes = Math.abs(numOf(row, cols, 'taxes') ?? 0), commission = Math.abs(numOf(row, cols, 'commission') ?? 0);
    const net = numOf(row, cols, 'net');
    const type = (cellOf(row, cols, 'type') || (cols.has('hotel') ? 'HOTEL' : 'TKTT')).toUpperCase();
    const r: StatementRow = { doc_no, type: /^RF|REFUND/.test(type) ? 'RFND' : /^ADM/.test(type) ? 'ADMA' : /^ACM/.test(type) ? 'ACMA' : type.slice(0, 8), gross: round2(gross), taxes: round2(taxes), commission: round2(commission), net: round2(net === null ? gross + taxes - commission : Math.abs(net)) };
    const date = dayOf(row, cols, 'date'), pax = cellOf(row, cols, 'pax');
    if (date) r.date = date;
    if (pax) r.pax = pax.slice(0, 80);
    const hotel = cellOf(row, cols, 'hotel'), nights = numOf(row, cols, 'nights'); // R16-C3
    if (hotel) r.hotel = hotel.slice(0, 80);
    if (nights) r.nights = Math.abs(nights);
    out.push(r);
  }
  return out;
}

/** Signed effect of a row on what we owe the supplier (refunds and ACMs reduce it; a disputed ADM is left out). */
export const owed = (r: StatementRow): number => (r.status === 'ours_only' || r.disputed ? 0 : r.type === 'RFND' || r.type === 'ACMA' ? -r.net : r.net);

export function totalsOf(rows: readonly StatementRow[]): SupplierStatement['totals'] {
  const t = { gross: 0, taxes: 0, commission: 0, net: 0 };
  for (const r of rows) {
    if (r.status === 'ours_only') continue;
    const s = r.type === 'RFND' || r.type === 'ACMA' ? -1 : 1;
    t.gross += s * r.gross; t.taxes += s * r.taxes; t.commission += s * r.commission; t.net += owed(r);
  }
  return { gross: round2(t.gross), taxes: round2(t.taxes), commission: round2(t.commission), net: round2(t.net) };
}

/** Rows split into statements of ≤ 2,000 rows, by month of the row date (undated rows go with the first). */
export function splitByMonth(rows: readonly StatementRow[]): StatementRow[][] {
  if (rows.length <= MAX_ROWS) return [rows.slice()];
  const by = new Map<string, StatementRow[]>();
  for (const r of rows) { const k = r.date?.slice(0, 7) ?? ''; by.set(k, [...(by.get(k) ?? []), r]); }
  const out: StatementRow[][] = [];
  for (const [, g] of [...by].sort(([a], [b]) => a.localeCompare(b))) for (let i = 0; i < g.length; i += MAX_ROWS) out.push(g.slice(i, i + MAX_ROWS));
  return out;
}

// ── Storage ──────────────────────────────────────────────────────

export const loadStatements = (): SupplierStatement[] => getTable<SupplierStatement>(TV_TABLES.statements).filter((s) => s?.id);

/** The match source of a statement: invoices, bookings and the invoice ids that carry a live credit note. */
function rematch(st: SupplierStatement): SupplierStatement {
  const invoices = localDb.invoices.getAll();
  const live = new Set(invoices.filter((i) => i.status !== 'Cancelled').map((i) => i.id));
  const credited = new Set(getTable<{ from_id: string; to_id: string; relation: string }>('doc_links').filter((l) => l?.relation === 'credit_note' && live.has(l.to_id)).map((l) => l.from_id));
  const rows = matchStatement(st, { invoices, bookings: loadBookings(), credited });
  return { ...st, rows, totals: totalsOf(rows) };
}

const write = (rows: SupplierStatement[]) => setTable(TV_TABLES.statements, rows);

export interface StatementImport { vendor_id: string; kind: StatementKind; ref: string; period_start: string; period_end: string; rows: StatementRow[]; file_name?: string; map?: Record<string, string> }

/** Save an imported statement (split by month above 2,000 rows), matched; remembers the column map (owner). */
export function importStatement(i: StatementImport): SupplierStatement[] {
  requireAccess('books.edit');
  if (!i.vendor_id) throw new Error('Choose the supplier.');
  if (!i.rows.length) throw new Error('No rows with a document number were found.');
  if (!(i.period_start <= i.period_end)) throw new Error('The period end is before its start.');
  assertUnlocked({ issue_date: i.period_end }, 'create');
  const now = new Date().toISOString();
  const parts = splitByMonth(i.rows);
  const made = parts.map((rows, n) => rematch({ id: generateId(), vendor_id: i.vendor_id, kind: i.kind, ref: parts.length > 1 ? `${i.ref} (${n + 1}/${parts.length})` : i.ref, period_start: i.period_start, period_end: i.period_end, rows, totals: totalsOf(rows), ...(i.file_name ? { file_name: i.file_name.slice(0, 200) } : {}), created_at: now }));
  write([...loadStatements(), ...made]);
  setTable('import_runs', [...getTable('import_runs'), { id: generateId(), at: now, kind: 'supplier_statement', ...(i.file_name ? { file_name: i.file_name.slice(0, 200) } : {}), created: i.rows.length, updated: 0, skipped: 0, errors: 0 }]);
  if (i.map) try { saveTravelSettings({ statement_maps: { ...readTravelSettings().statement_maps, [i.kind]: i.map } }); } catch { /* only the owner's map is remembered */ }
  return made;
}

/** Change one statement (re-match, dispute an ADM, link a bill). */
export function updateStatement(id: string, fn: (s: SupplierStatement) => SupplierStatement, again = false): SupplierStatement {
  requireAccess('books.edit');
  const all = loadStatements();
  const prev = all.find((s) => s.id === id);
  if (!prev) throw new Error('This statement is no longer on the list.');
  let next: SupplierStatement = { ...fn(prev), updated_at: new Date().toISOString() };
  if (again) next = rematch(next);
  next.totals = totalsOf(next.rows);
  write(all.map((s) => (s.id === id ? next : s)));
  return next;
}

/** Delete a statement (recycle bin); refused once its bill is made. */
export function removeStatement(id: string): void {
  requireAccess('books.edit');
  const all = loadStatements();
  const s = all.find((x) => x.id === id);
  if (!s) return;
  if (s.bill_id && purchasesDb.get(s.bill_id)) throw new Error('Its bill is made — delete the bill first.');
  assertUnlocked({ issue_date: s.period_end }, 'delete');
  write(all.filter((x) => x.id !== id));
}
