/**
 * TR-A1 party-item special rates (table `party_rates`) and the last purchase rate from a supplier.
 *
 * A row is one client (sale) or vendor (purchase) × one item, dated (`valid_from` … `valid_to`, inclusive): its own
 * rate and / or a discount chain / ₹ per unit. Resolution in the editor: **party rate** → price level → price list →
 * slab → last rate → catalogue (`resolvePrice`'s `partyRate` argument, basis "Party rate"). Credit / debit notes are
 * never re-priced. The bill modal only hints (never applies a typed rate). Purchases are read through
 * `readPurchase` / `readPurchaseLines` (purchases contract, Rule 9).
 */
import './tr-registry';
import type { PartyRate } from '../../types/trade-r8';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { TR_TABLES } from './tr-shared';
import { parseChain } from './tr-discounts';

export const PARTY_RATES_TABLE = TR_TABLES.partyRates;
export const PARTY_RATE_BASIS = 'Party rate';
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export const loadPartyRates = (): readonly PartyRate[] => peekTable<PartyRate>(PARTY_RATES_TABLE).filter((r) => r && typeof r.id === 'string');

/** The rate row for a party and item on `day` (latest `valid_from` wins), or undefined. */
export function partyRateFor(rows: readonly PartyRate[], side: PartyRate['side'], party: { id?: string; name?: string } | undefined, item: { id?: string; name: string }, day: string): PartyRate | undefined {
  if (!party || (!party.id && !norm(party.name))) return undefined;
  let best: PartyRate | undefined;
  for (const r of rows) {
    if (r.side !== side || (party.id ? r.party_id !== party.id : norm(r.party_name) !== norm(party.name))) continue;
    if (!((item.id && r.item_id === item.id) || norm(r.item_name) === norm(item.name))) continue;
    if (day < r.valid_from || (r.valid_to && day > r.valid_to)) continue;
    if (!best || r.valid_from > best.valid_from) best = r;
  }
  return best;
}

/** Validation; '' when fine. */
export function validatePartyRate(r: Partial<PartyRate>): string {
  if (!r.party_id) return 'Choose the party.';
  if (!norm(r.item_name)) return 'Choose the item.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.valid_from ?? '')) return 'Enter the date the rate starts.';
  if (r.valid_to && r.valid_to < r.valid_from!) return 'The rate ends before it starts.';
  if (!(num(r.rate) > 0) && !r.disc_chain?.length && !(num(r.disc_per_unit) > 0)) return 'Enter a rate or a discount.';
  return '';
}

export function savePartyRate(input: Omit<PartyRate, 'id'> & { id?: string }): PartyRate {
  requireAccess('master.edit');
  const err = validatePartyRate(input);
  if (err) throw new Error(err);
  const all = getTable<PartyRate>(PARTY_RATES_TABLE);
  const row: PartyRate = {
    ...input,
    id: input.id || generateId(),
    item_name: input.item_name.trim(),
    ...(num(input.rate) > 0 ? { rate: round2(num(input.rate)) } : { rate: undefined }),
    updated_at: new Date().toISOString(),
  };
  setTable(PARTY_RATES_TABLE, all.some((r) => r.id === row.id) ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  return row;
}

export function removePartyRate(id: string): void {
  requireAccess('master.edit');
  setTable(PARTY_RATES_TABLE, getTable<PartyRate>(PARTY_RATES_TABLE).filter((r) => r.id !== id));
}

/**
 * Bulk paste (Distribution → Masters / Settings): one row per line, "item, rate, discount" (tab or comma; the
 * discount may be a chain "18+4"). Returns the parsed rows and the line numbers that could not be read.
 */
export function parseBulkRates(text: string): { rows: { item_name: string; rate?: number; disc_chain?: number[] }[]; bad: number[] } {
  const rows: { item_name: string; rate?: number; disc_chain?: number[] }[] = [];
  const bad: number[] = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const [name, rate, disc] = line.split(/\t|,/).map((x) => x.trim());
    const chain = disc ? parseChain(disc) : null;
    if (!name || (rate && !(Number(rate) >= 0)) || (disc && !chain) || (!rate && !chain)) return void bad.push(i + 1);
    rows.push({ item_name: name, ...(Number(rate) > 0 ? { rate: Number(rate) } : {}), ...(chain ? { disc_chain: chain } : {}) });
  });
  return { rows, bad };
}

export interface LastPurchase {
  rate: number;
  date: string;
  number: string;
}

/** The rate (unit cost before tax) this item was last bought at from `vendor` (live bills only). */
export function lastPurchaseRate(purchases: readonly unknown[], vendor: { id?: string; name?: string }, itemName: string): LastPurchase | null {
  let best: LastPurchase | null = null;
  for (const raw of purchases) {
    const b = readPurchase(raw);
    const vid = (raw as { vendor_id?: string })?.vendor_id;
    if (!b || b.isExpense || isVoidStatus(b.status) || !(vendor.id && vid ? vid === vendor.id : norm(b.partyName) === norm(vendor.name))) continue;
    for (const l of readPurchaseLines(raw)) {
      if (norm(l.name) !== norm(itemName) || !(l.unitCost > 0)) continue;
      if (!best || b.date > best.date) best = { rate: round2(l.unitCost), date: b.date, number: b.number };
    }
  }
  return best;
}
