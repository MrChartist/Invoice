/**
 * "Last rate to this party" (8G, 8.104 — Tally / Vyapar habit): the rate an item was last billed to the
 * same customer, with the date and document. Pure; the editor reads invoices through `peekTable`.
 *
 * Precedence when an item is picked (pricing-actions.ts): a price level / selling price list / slab
 * (6.9 / 7S) wins; otherwise the last rate to this party is applied (basis "Last rate"); otherwise the
 * catalogue rate. The user can always choose the other rate from the hint under the lines.
 */

import type { InvoiceRecord } from '../types/invoice';

export const LAST_RATE_BASIS = 'Last rate';

const SALE_DOCS = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY']);
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export interface LastRate {
  rate: number;
  date: string;
  number: string;
  invoiceId: string;
  unit?: string;
}

/** Same party: client id when both have one, else the case-folded name. */
function sameParty(a: { id?: string; name?: string } | undefined, b: { id?: string; name?: string } | undefined): boolean {
  if (!a || !b) return false;
  if (a.id && b.id) return a.id === b.id;
  return !!norm(a.name) && norm(a.name) === norm(b.name);
}

/** Every item's last rate to `party` (one pass over the invoices), keyed by folded item name. */
export function lastRatesFor(
  invoices: readonly Pick<InvoiceRecord, 'id' | 'doc_type' | 'status' | 'client' | 'issue_date' | 'invoice_number' | 'items' | 'currency'>[],
  party: { id?: string; name?: string } | undefined,
  opts: { excludeId?: string; currency?: string } = {},
): Map<string, LastRate> {
  const out = new Map<string, LastRate>();
  if (!party || (!party.id && !norm(party.name))) return out;
  const cur = (opts.currency || 'INR').toUpperCase();
  for (const inv of invoices) {
    if (!inv || inv.id === opts.excludeId || !SALE_DOCS.has(inv.doc_type) || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    if ((inv.currency || 'INR').toUpperCase() !== cur || !sameParty(inv.client, party)) continue;
    const date = String(inv.issue_date ?? '').slice(0, 10);
    for (const l of inv.items ?? []) {
      const k = norm(l?.name);
      const rate = Number(l?.rate);
      if (!k || !(rate > 0) || l.free_of) continue;
      const prev = out.get(k);
      if (!prev || date > prev.date || (date === prev.date && String(inv.invoice_number) > prev.number)) {
        out.set(k, { rate, date, number: inv.invoice_number, invoiceId: inv.id, ...(l.unit ? { unit: l.unit } : {}) });
      }
    }
  }
  return out;
}

export function lastRateFor(
  invoices: Parameters<typeof lastRatesFor>[0],
  party: { id?: string; name?: string } | undefined,
  itemName: string,
  opts: { excludeId?: string; currency?: string } = {},
): LastRate | null {
  return lastRatesFor(invoices, party, opts).get(norm(itemName)) ?? null;
}

/**
 * The rate to put on a freshly picked line: the last rate when no automatic price basis (level, list,
 * slab) applied, else null (keep what pricing chose). A line whose unit differs from the last sale is
 * left alone — 1 BOX and 1 NOS are not the same rate.
 */
export function lastRateToApply(line: { rate: number; price_basis?: string; unit?: string }, last: LastRate | null): number | null {
  if (!last || line.price_basis) return null;
  if (last.unit && line.unit && norm(last.unit) !== norm(line.unit)) return null;
  return last.rate !== line.rate ? last.rate : null;
}
