/**
 * All-or-nothing writes across a few tables (security review 2026-10, H2 / M3 / M4 / L4). The data
 * layer has no real transactions: a save that writes several tables in steps (a voucher, then the
 * receipt rows that settle its bills) could stop half-way on a refusal (period lock, approval, role)
 * and leave rows that post twice. `withTablesRollback` snapshots the named tables, runs the steps
 * and, if anything throws, writes the snapshot back before re-throwing — so callers can keep their
 * own validation and audit code and still never leave half a change behind. Audit rows already
 * written stay (the log is append-only); callers record a "rolled back" note when it matters.
 */
import { getTable, setTable } from './storage';

export function withTablesRollback<T>(tables: readonly string[], fn: () => T): T {
  const before = tables.map((name) => [name, getTable<unknown>(name)] as const);
  try {
    return fn();
  } catch (err) {
    for (const [name, rows] of before) {
      try {
        setTable(name, rows as unknown[]);
      } catch {
        /* keep restoring the other tables; the original error is what the caller needs */
      }
    }
    throw err;
  }
}
