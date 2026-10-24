/**
 * Multi-godown stock (roadmap 6.10): the `godowns` master and stock transfer vouchers
 * (`stock_transfers`, numbered `STR/FY<yy-yy>/<seq>` per Indian financial year).
 *
 * Opt-in by data: the implicit "Main" godown always exists and is not stored; godown pickers
 * appear only once a second godown is created. Stock per godown is derived on read
 * (`src/lib/stock-tracking.ts`). Costing stays company-wide: a transfer moves quantity only,
 * never value, and nothing here posts to Books or the double-entry ledger.
 *
 * Transfers respect the period lock (create / edit / delete inside a locked period needs a PIN
 * override) and every change is written to the audit log.
 */

import { MAIN_GODOWN_ID, type Godown, type StockTransfer } from '../types/stock';
import { buildInvoiceNumber, getIndianFY, highestSequence } from './invoice-number';
import { num } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { assertUnlocked } from './period-lock';
import { audit } from './audit';

export const GODOWNS_TABLE = 'godowns';
export const TRANSFERS_TABLE = 'stock_transfers';
export const TRANSFER_PREFIX = 'STR';
export { MAIN_GODOWN_ID };

/* ── Pure ─────────────────────────────────────────────────────── */

/** Every godown, Main first. A stored row with id `main` only renames the default godown. */
export function godownList(stored: readonly Godown[]): Godown[] {
  const main = stored.find((g) => g.id === MAIN_GODOWN_ID);
  const rest = stored.filter((g) => g.id !== MAIN_GODOWN_ID && g.name?.trim());
  return [{ id: MAIN_GODOWN_ID, name: main?.name?.trim() || 'Main' }, ...rest];
}

/** Godown pickers and reports appear only once a second godown exists. */
export function isMultiGodown(stored: readonly Godown[]): boolean {
  return godownList(stored).length > 1;
}

export function godownName(list: readonly Godown[], id: string | undefined): string {
  const key = id || MAIN_GODOWN_ID;
  return list.find((g) => g.id === key)?.name ?? (key === MAIN_GODOWN_ID ? 'Main' : 'Unknown godown');
}

/** Next `STR/FY<yy-yy>/<seq>` for a transfer dated `date` (highest issued + 1: deletes never reuse a number). */
export function nextTransferNumber(existing: readonly string[], date?: string): string {
  const fy = getIndianFY(date).label;
  return buildInvoiceNumber(TRANSFER_PREFIX, fy, highestSequence([...existing], TRANSFER_PREFIX, fy) + 1);
}

/** Shape checks that need no stock data; returns an error message or ''. Stock checks live in stock-tracking. */
export function validateTransferShape(t: Pick<StockTransfer, 'date' | 'from_godown' | 'to_godown' | 'lines'>): string {
  if (!t.date) return 'Choose the transfer date.';
  if (!t.from_godown || !t.to_godown) return 'Choose both godowns.';
  if (t.from_godown === t.to_godown) return 'The two godowns must be different.';
  const lines = (t.lines ?? []).filter((l) => l.item_id);
  if (lines.length === 0) return 'Add at least one item to transfer.';
  if (lines.some((l) => num(l.qty) <= 0)) return 'Every line needs a quantity above zero.';
  return '';
}

/* ── Storage ──────────────────────────────────────────────────── */

const now = () => new Date().toISOString();

const lockSubject = (t: Pick<StockTransfer, 'id' | 'date' | 'transfer_number'>) => ({
  id: t.id,
  issue_date: t.date,
  invoice_number: t.transfer_number,
});

export const godownsDb = {
  stored: (): Godown[] => getTable<Godown>(GODOWNS_TABLE),
  list: (): Godown[] => godownList(godownsDb.stored()),
  isMulti: (): boolean => isMultiGodown(godownsDb.stored()),

  /** Add or rename a godown. Names are unique (case-insensitive). */
  save(input: { id?: string; name: string; address?: string }): Godown {
    const name = input.name.trim();
    if (!name) throw new Error('Enter a godown name.');
    const rows = godownsDb.stored();
    const list = godownList(rows);
    if (list.some((g) => g.id !== input.id && g.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new Error(`A godown named "${name}" already exists.`);
    }
    const existing = input.id ? rows.find((g) => g.id === input.id) : undefined;
    const row: Godown = {
      ...existing,
      id: input.id || generateId(),
      name,
      ...(input.address?.trim() ? { address: input.address.trim() } : {}),
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    setTable(GODOWNS_TABLE, existing ? rows.map((g) => (g.id === row.id ? row : g)) : [...rows, row]);
    return row;
  },

  /** Delete a godown. Refused for Main and while any record still points at it (`inUse`). */
  remove(id: string, inUse: boolean): void {
    if (id === MAIN_GODOWN_ID) throw new Error('The main godown cannot be deleted.');
    if (inUse) throw new Error('Stock, bills, invoices or transfers still use this godown, so it cannot be deleted.');
    setTable(GODOWNS_TABLE, godownsDb.stored().filter((g) => g.id !== id));
  },
};

export const transfersDb = {
  all: (): StockTransfer[] => getTable<StockTransfer>(TRANSFERS_TABLE),
  get: (id: string): StockTransfer | undefined => transfersDb.all().find((t) => t.id === id),
  nextNumber: (date?: string): string => nextTransferNumber(transfersDb.all().map((t) => t.transfer_number), date),

  /**
   * Insert or update (by id). A new transfer without a number gets the next one in its FY.
   * Throws `PeriodLockedError` inside a locked period; audited.
   */
  save(input: Omit<StockTransfer, 'id' | 'transfer_number'> & { id?: string; transfer_number?: string }): StockTransfer {
    const shape = validateTransferShape(input);
    if (shape) throw new Error(shape);
    const rows = transfersDb.all();
    const existing = input.id ? rows.find((r) => r.id === input.id) : undefined;
    if (existing) assertUnlocked(lockSubject(existing), 'edit');
    const number = (input.transfer_number ?? '').trim() || existing?.transfer_number || transfersDb.nextNumber(input.date);
    const id = existing?.id ?? input.id ?? generateId();
    const state = assertUnlocked(lockSubject({ id, date: input.date, transfer_number: number }), existing ? 'edit' : 'create');
    if (rows.some((r) => r.id !== id && r.transfer_number.toUpperCase() === number.toUpperCase())) {
      throw new Error(`Transfer number ${number} is already used.`);
    }
    const record: StockTransfer = {
      ...existing,
      ...input,
      id,
      transfer_number: number,
      lines: input.lines.filter((l) => l.item_id && num(l.qty) > 0),
      created_at: existing?.created_at ?? now(),
      updated_at: now(),
    };
    setTable(TRANSFERS_TABLE, existing ? rows.map((r) => (r.id === id ? record : r)) : [...rows, record]);
    const units = record.lines.reduce((s, l) => s + num(l.qty), 0);
    audit.record({
      entity: 'stock_transfer',
      entity_id: id,
      action: existing ? 'update' : 'create',
      doc_number: number,
      summary: `${existing ? 'Edited' : 'Created'} stock transfer ${number}: ${record.lines.length} line${record.lines.length === 1 ? '' : 's'}, ${units} unit${units === 1 ? '' : 's'}${state === 'overridden' ? ' (period lock overridden)' : ''}`,
    });
    return record;
  },

  /** Delete a transfer (period lock respected; audited). */
  remove(id: string): void {
    const t = transfersDb.get(id);
    if (!t) return;
    assertUnlocked(lockSubject(t), 'delete');
    setTable(TRANSFERS_TABLE, transfersDb.all().filter((r) => r.id !== id));
    audit.record({
      entity: 'stock_transfer',
      entity_id: id,
      action: 'delete',
      doc_number: t.transfer_number,
      summary: `Deleted stock transfer ${t.transfer_number}`,
    });
  },
};
