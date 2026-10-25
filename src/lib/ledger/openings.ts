/**
 * Ledger opening balances (WP-1, P0-1): Tally's "Opening Balance (on 1-Apr-yy) Dr / Cr" on every
 * ledger — chart accounts (default or user) and party ledgers (clients / vendors).
 *
 * Storage:
 *  - `ledger_openings` rows `{id, ledger_id, dr, cr, party_name?, created_at, updated_at?}`;
 *    `ledger_id` is an account id or a party ledger id (`party:debtor:<clientId>`), amounts are
 *    integer PAISE (exactly one of dr / cr > 0), `party_name` is a snapshot used when the party
 *    master is gone. Role action `books.edit`.
 *  - `books_begin` one row `{id: 'books_begin', date}` — the company's "books beginning from"
 *    date. Openings are balances at the START of that day; the ledger posts them as one
 *    "Opening" voucher dated the day before (`postings-openings.ts`).
 *
 * The difference between total debits and credits is never forced away: it is posted to
 * "Opening balance difference" (1090) and reported as "Difference in opening balances: ₹x Dr",
 * Tally's own wording.
 */

import { requireAccess } from '../access';
import { audit } from '../audit';
import { generateId, getTable, setTable } from '../storage';
import { formatMoney } from '../utils';

export const LEDGER_OPENINGS_TABLE = 'ledger_openings';
export const BOOKS_BEGIN_TABLE = 'books_begin';

export interface LedgerOpening {
  id: string;
  ledger_id: string;
  /** Integer paise. */
  dr: number;
  cr: number;
  party_name?: string;
  created_at?: string;
  updated_at?: string;
}

/** A real local calendar day `YYYY-MM-DD` (rejects 2025-02-30). */
function isRealDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Tolerant read: one row per ledger (the last one wins), zero rows dropped. Idempotent. */
export function normalizeOpenings(rows: unknown[]): LedgerOpening[] {
  const byLedger = new Map<string, LedgerOpening>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const ledger_id = clean(o.ledger_id);
    const id = clean(o.id);
    if (!ledger_id || !id || !isInt(o.dr) || !isInt(o.cr)) continue;
    const net = o.dr - o.cr;
    if (net === 0) continue;
    byLedger.set(ledger_id, {
      id,
      ledger_id,
      dr: net > 0 ? net : 0,
      cr: net < 0 ? -net : 0,
      ...(clean(o.party_name) ? { party_name: clean(o.party_name) } : {}),
      ...(clean(o.created_at) ? { created_at: clean(o.created_at) } : {}),
      ...(clean(o.updated_at) ? { updated_at: clean(o.updated_at) } : {}),
    });
  }
  return [...byLedger.values()];
}

export function loadOpenings(): LedgerOpening[] {
  return normalizeOpenings(getTable<unknown>(LEDGER_OPENINGS_TABLE));
}

/** Signed opening (debit-positive paise). */
export const signedOpening = (o: Pick<LedgerOpening, 'dr' | 'cr'>) => o.dr - o.cr;

/** 1 April of the Indian FY containing `today` (YYYY-MM-DD). */
export function defaultBooksBegin(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}

/** Stored books-beginning date, or '' when never set. */
export function storedBooksBegin(): string {
  const row = getTable<{ id?: string; date?: string }>(BOOKS_BEGIN_TABLE).find((r) => r && r.id === 'books_begin');
  const d = row?.date ?? '';
  return isRealDay(d) ? d : '';
}

/** Books beginning date: stored, else 1 April of the current FY. */
export function loadBooksBegin(today: string): string {
  return storedBooksBegin() || defaultBooksBegin(today);
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Pin the books-beginning date the first time openings are saved, so a default (1 April of the
 * current FY) cannot move the opening voucher when the next FY starts. Returns the date in force.
 */
export function ensureBooksBegin(today: string = localToday()): string {
  const stored = storedBooksBegin();
  if (stored) return stored;
  const date = defaultBooksBegin(today);
  setTable(BOOKS_BEGIN_TABLE, [{ id: 'books_begin', date }]);
  return date;
}

export function saveBooksBegin(date: string): void {
  if (!isRealDay(date)) throw new Error('Choose the books beginning date.');
  requireAccess('books.edit');
  const prev = storedBooksBegin();
  setTable(BOOKS_BEGIN_TABLE, [{ id: 'books_begin', date }]);
  if (prev !== date) {
    audit.record({ entity: 'voucher', entity_id: 'books_begin', action: prev ? 'update' : 'create', doc_number: 'Opening', summary: `Books beginning date set to ${date}${prev ? ` (was ${prev})` : ''}` });
  }
}

/**
 * The master opening balance of a ledger (debit-positive paise) — what was typed in Ledger
 * Creation / the opening trial balance. `asOf` before the books-beginning date gives 0 (there
 * were no books yet). For the ledger's balance on any later day, use `reports.openingBalances`.
 */
export function openingBalance(
  ledgerId: string,
  asOf?: string,
  openings: readonly LedgerOpening[] = loadOpenings(),
  booksBegin: string = asOf ? loadBooksBegin(asOf) : '',
): number {
  if (asOf && booksBegin && asOf < booksBegin) return 0;
  const row = openings.find((o) => o.ledger_id === ledgerId);
  return row ? signedOpening(row) : 0;
}

/** Σ debits − Σ credits of the openings (paise). Non-zero = "Difference in opening balances". */
export function openingDifference(openings: readonly Pick<LedgerOpening, 'dr' | 'cr'>[]): number {
  return openings.reduce((s, o) => s + o.dr - o.cr, 0);
}

/** Tally's banner text, or '' when the openings agree. */
export function openingDifferenceText(diff: number): string {
  return diff === 0 ? '' : `Difference in opening balances: ₹${formatMoney(Math.abs(diff) / 100)} ${diff > 0 ? 'Dr' : 'Cr'}`;
}

export interface OpeningEntry {
  ledger_id: string;
  /** Debit-positive paise; 0 removes the opening. */
  amount: number;
  party_name?: string;
}

/**
 * Apply opening entries (one or many — the opening trial balance saves all at once). Ledgers not
 * named keep their opening. Audited once per call.
 */
export function saveOpenings(entries: readonly OpeningEntry[]): LedgerOpening[] {
  requireAccess('books.edit');
  const rows = loadOpenings();
  const byLedger = new Map(rows.map((r) => [r.ledger_id, r]));
  const now = new Date().toISOString();
  let changed = 0;
  for (const e of entries) {
    const id = clean(e.ledger_id);
    if (!id || !Number.isInteger(e.amount)) continue;
    const prev = byLedger.get(id);
    if (e.amount === 0) {
      if (prev) {
        byLedger.delete(id);
        changed++;
      }
      continue;
    }
    if (prev && signedOpening(prev) === e.amount && (prev.party_name ?? '') === clean(e.party_name ?? prev.party_name)) continue;
    const party = clean(e.party_name ?? prev?.party_name);
    byLedger.set(id, {
      id: prev?.id ?? generateId(),
      ledger_id: id,
      dr: e.amount > 0 ? e.amount : 0,
      cr: e.amount < 0 ? -e.amount : 0,
      ...(party ? { party_name: party } : {}),
      created_at: prev?.created_at ?? now,
      ...(prev ? { updated_at: now } : {}),
    });
    changed++;
  }
  if (!changed) return rows;
  ensureBooksBegin();
  const next = [...byLedger.values()];
  setTable(LEDGER_OPENINGS_TABLE, next);
  const diff = openingDifference(next);
  audit.record({
    entity: 'voucher',
    entity_id: 'ledger_openings',
    action: 'update',
    doc_number: 'Opening',
    summary: `Opening balances changed for ${changed} ledger${changed === 1 ? '' : 's'}${diff ? ` · ${openingDifferenceText(diff)}` : ''}`,
  });
  return next;
}

/** Rupees as typed → integer paise (exact). */
export function toPaiseExact(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  const p = Math.round(Number(`${Math.abs(n).toFixed(2)}e2`));
  return n < 0 ? -p : p;
}
