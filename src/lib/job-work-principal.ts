/**
 * Principal's goods by godown and batch (7S, roadmap 7.73 — Job Work In side). We are the job worker: the
 * principal's material is never our stock, so it stays a register (`job_work_principal`), now with the godown it
 * lies in and the principal's batch on each line. This report shows what is with us per principal × item × godown ×
 * batch (received − sent back), so a physical check of the principal's goods can be done godown-wise. Pure.
 */
import type { PrincipalMovement } from '../types/job-work';
import { num } from './invoice-calc';

const roundQty = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

export interface PrincipalStockRow {
  party: string;
  name: string;
  unit?: string;
  /** Godown id ('' = not recorded). */
  godown: string;
  /** Batch ('' = none). */
  batch: string;
  received: number;
  returned: number;
  pending: number;
}

/**
 * The principal's goods still with us by party, item (case-insensitive), godown and batch, as of `asOf`
 * (inclusive, bare local day; empty = all). A return without a godown / batch settles the oldest balances of
 * that party × item first, so older entries made before 7S still net off.
 */
export function principalStock(rows: readonly PrincipalMovement[], asOf = ''): PrincipalStockRow[] {
  const m = new Map<string, PrincipalStockRow>();
  const order: string[] = [];
  const sorted = [...rows].filter((r) => r && (!asOf || String(r.date).slice(0, 10) <= asOf))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || Number(a.kind === 'return') - Number(b.kind === 'return'));
  for (const r of sorted) {
    const party = r.party_name.trim();
    for (const l of r.lines ?? []) {
      const name = String(l?.name ?? '').trim();
      let q = num(l.qty);
      if (!name || !(q > 0)) continue;
      const base = `${party.toLowerCase()}|${name.toLowerCase()}`;
      const godown = l.godown_id ?? '';
      const batch = (l.batch_no ?? '').trim();
      if (r.kind === 'receipt') {
        const k = `${base}|${godown}|${batch.toUpperCase()}`;
        let row = m.get(k);
        if (!row) {
          row = { party, name, ...(l.unit ? { unit: l.unit } : {}), godown, batch, received: 0, returned: 0, pending: 0 };
          m.set(k, row);
          order.push(k);
        }
        row.received = roundQty(row.received + q);
        row.pending = roundQty(row.received - row.returned);
        continue;
      }
      // Return: the named godown / batch first, then the oldest open balances of the item.
      const keys = order.filter((k) => k.startsWith(`${base}|`));
      const exact = keys.filter((k) => {
        const row = m.get(k) as PrincipalStockRow;
        return (!godown || row.godown === godown) && (!batch || row.batch.toUpperCase() === batch.toUpperCase());
      });
      for (const k of [...exact, ...keys.filter((x) => !exact.includes(x))]) {
        if (q <= 0) break;
        const row = m.get(k) as PrincipalStockRow;
        const take = Math.min(q, Math.max(row.pending, 0));
        if (take <= 0) continue;
        row.returned = roundQty(row.returned + take);
        row.pending = roundQty(row.received - row.returned);
        q = roundQty(q - take);
      }
      if (q > 0) {
        // More sent back than recorded as received: shown as a negative balance on the first row.
        const k = keys[0] ?? `${base}|${godown}|${batch.toUpperCase()}`;
        const row = m.get(k) ?? { party, name, godown, batch, received: 0, returned: 0, pending: 0 };
        if (!m.has(k)) {
          m.set(k, row);
          order.push(k);
        }
        row.returned = roundQty(row.returned + q);
        row.pending = roundQty(row.received - row.returned);
      }
    }
  }
  return order.map((k) => m.get(k) as PrincipalStockRow).filter((r) => Math.abs(r.pending) > 1e-9);
}
