/**
 * AG-D4 expiry gate by class, applied by the stock checks next to the pharma gate: an expired batch of a class whose
 * rule says `block` (pesticides, seeds — Insecticides Rules / Seeds Order, AG21) becomes an error that stops the sale;
 * other classes (fertilisers) keep the "Sell anyway" confirmation. Does nothing unless an item carries `ag_class`.
 * Kept tiny and self-contained (the stock checks load with the editor): the blocked classes mirror the `block` rows of
 * `agri-rules.ts` `DEALER_CLASS_RULES` — `tests/ag-inputs.test.ts` pins the two together.
 */
import { getTable, KEYS } from '../storage';

export const BLOCK_ON_EXPIRY: ReadonlySet<string> = new Set(['seed_sowing', 'pesticide_chem', 'biopesticide']);

interface Issues { errors: string[]; expired: string[] }

export function agriExpiryGate<T extends Issues>(issues: T): T {
  if (!issues.expired.length) return issues;
  const blocked = new Set<string>();
  for (const t of ['stock_items', KEYS.items]) for (const i of getTable<{ name?: string; ag_class?: string }>(t)) if (i?.name && BLOCK_ON_EXPIRY.has(i.ag_class ?? '')) blocked.add(i.name.trim().toLowerCase());
  if (!blocked.size) return issues;
  const hit = (e: string) => blocked.has(e.slice(0, e.indexOf(': batch ')).trim().toLowerCase());
  const stop = issues.expired.filter(hit);
  if (!stop.length) return issues;
  return { ...issues, errors: [...issues.errors, ...stop.map((e) => `${e} Expired seeds / pesticides cannot be sold (verify AG21).`)], expired: issues.expired.filter((e) => !hit(e)) };
}
