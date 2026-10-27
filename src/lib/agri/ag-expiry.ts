/**
 * AG-D4 expiry gate by class, applied by the stock checks next to the pharma gate: an expired batch of a class whose
 * rule says `block` (pesticides, seeds — Insecticides Rules / Seeds Order, AG21) becomes an error that stops the sale;
 * other classes (fertilisers) keep the "Sell anyway" confirmation. Does nothing unless an item carries `ag_class`.
 */
import { DEALER_CLASS_RULES } from '../agri-rules';
import { ruleAt } from '../tax-rules';
import { getTable, KEYS } from '../storage';

interface Issues { errors: string[]; expired: string[] }

export function agriExpiryGate<T extends Issues>(issues: T, date: string): T {
  if (!issues.expired.length) return issues;
  const classes = classIndex();
  if (!classes.size) return issues;
  const rules = ruleAt(DEALER_CLASS_RULES, date);
  const blocked = (e: string) => rules[classes.get(e.slice(0, e.indexOf(': batch ')).trim().toLowerCase()) ?? '']?.expiry === 'block';
  const stop = issues.expired.filter(blocked);
  if (!stop.length) return issues;
  return { ...issues, errors: [...issues.errors, ...stop.map((e) => `${e} Expired seeds / pesticides cannot be sold (verify AG21).`)], expired: issues.expired.filter((e) => !blocked(e)) };
}
/** `ag_class` of every catalogue / stock item by lower-cased name (the catalogue wins). */
export function classIndex(): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of ['stock_items', KEYS.items]) for (const i of getTable<{ name?: string; ag_class?: string }>(t)) if (i?.ag_class && i.name) m.set(i.name.trim().toLowerCase(), i.ag_class);
  return m;
}
